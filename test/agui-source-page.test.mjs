import assert from "node:assert/strict"
import { createServer } from "node:http"
import { describe, it } from "node:test"

import * as agentProjection from "../dist/infrastructure/clients/agent/projection.js"
import { AgUiConsumerLeaseLostError, AgUiSourceContractError, AgUiSourceReadError } from "../dist/application/agui/errors.js"
import { AgUiProjectionService } from "../dist/application/agui/project-session-events.js"
import { AgUiProjectorRunner } from "../dist/application/agui/projector.js"
import { AgentAgUiSourceReader } from "../dist/infrastructure/clients/agent/projector-source.js"
import { loadConfig } from "../dist/config/runtime.js"

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  if (address === null || typeof address === "string") throw new Error("test server did not bind")
  return `http://127.0.0.1:${address.port}`
}

async function close(server) {
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
}

const event = (sequence, overrides = {}) => ({
  chat_event_id: `source_${sequence}`,
  session_id: "session_1",
  run_id: "run_1",
  source_index: sequence - 1,
  event_type: sequence === 1 ? "run.started" : "assistant.delta",
  payload_json: sequence === 1 ? '{"status":"running"}' : '{"delta":"hello"}',
  seq: sequence,
  created_at: sequence * 1000,
  ...overrides,
})

const FAILURE_CODES = [
  "token_budget_exceeded",
  "recursion_limit_exceeded",
  "assembly_failed",
  "enqueue_failed",
  "dispatch_exhausted",
  "contract_incompatible",
  "internal_error",
  "model_unavailable",
  "dependency_unavailable",
  "model_access_denied",
]
const RETRYABLE_FAILURE_CODES = new Set(["model_unavailable", "dependency_unavailable"])

function failureEvent(sequence, failure) {
  return event(sequence, { event_type: "run.failed", payload_json: JSON.stringify(failure) })
}

function assertMappedFailure(failure) {
  const mapped = agentProjection.mapAgentEvent(failureEvent(1, failure))
  assert.equal(mapped?.kind, "run.failed")
  assert.deepEqual(mapped?.payload, {
    failure: { source: "agent", code: failure.code, retryable: failure.retryable },
    message: "Agent run failed",
  })
}

function projectorLease(sessionId) {
  return {
    tenantId: "tenant_1",
    sessionId,
    subjectId: "user_1",
    leaseOwner: "worker_1",
    leaseToken: `lease_${sessionId}`,
    fence: 1,
    leaseUntil: "2026-09-30T00:01:00.000Z",
    leaseRemainingMs: 60_000,
    sourceHighWatermark: 0,
    failureCount: 0,
  }
}

function projectorOptions() {
  return {
    workerId: "worker_1",
    now: () => new Date("2026-09-30T00:00:00.000Z"),
    maxConsumersPerCycle: 2,
    sourcePageSize: 10,
    maxPagesPerConsumer: 1,
    leaseDurationMs: 30_000,
    pollIntervalMs: 60_000,
    errorBackoffMs: 1_000,
    errorBackoffMaxMs: 8_000,
    errorBackoffJitterPercent: 0,
    retentionMs: 86_400_000,
    gcIntervalMs: 60_000,
    gcBatchSize: 10,
    cursorTombstoneRetentionMs: 172_800_000,
  }
}

describe("Agent event page boundary", () => {
  for (const code of FAILURE_CODES) {
    it(`maps the complete owner failure ${code}/false to one safe profile`, () => {
      assertMappedFailure({ status: "failed", code, retryable: false })
    })
  }

  for (const code of RETRYABLE_FAILURE_CODES) {
    it(`maps the complete owner failure ${code}/true to one safe profile`, () => {
      assertMappedFailure({ status: "failed", code, retryable: true })
    })
  }

  for (const code of FAILURE_CODES.filter((candidate) => !RETRYABLE_FAILURE_CODES.has(candidate))) {
    it(`rejects the illegal owner failure ${code}/true`, () => {
      assert.throws(() => agentProjection.mapAgentEvent(failureEvent(1, { status: "failed", code, retryable: true })))
    })
  }

  for (const [name, failure] of [
    ["unknown code", { status: "failed", code: "unknown", retryable: false }],
    ["extra property", { status: "failed", code: "internal_error", retryable: false, diagnostic: "secret" }],
    ["missing code", { status: "failed", retryable: false }],
    ["missing retryable", { status: "failed", code: "internal_error" }],
    ["string retryable", { status: "failed", code: "internal_error", retryable: "false" }],
    ["number retryable", { status: "failed", code: "internal_error", retryable: 0 }],
    ["null retryable", { status: "failed", code: "internal_error", retryable: null }],
    ["missing status", { code: "internal_error", retryable: false }],
    ["wrong status", { status: "completed", code: "internal_error", retryable: false }],
    ["null status", { status: null, code: "internal_error", retryable: false }],
  ]) {
    it(`rejects an owner failure with ${name}`, () => {
      assert.throws(() => agentProjection.mapAgentEvent(failureEvent(1, failure)))
    })
  }

  it("requires the pinned S4 delivery identity and kind instead of a hash-only success", () => {
    const delivery = event(1, {
      event_type: "delivery",
      payload_json: JSON.stringify({
        tool_call_id: "tool_1",
        artifact_id: "artifact_1",
        asset_id: "asset_1",
        artifact_kind: "code",
        path: "/report.py",
        title: "Report",
        mime: "text/x-python",
        size: 6,
        content_hash: "a".repeat(64),
        note: "",
      }),
    })
    const mapped = agentProjection.mapAgentEvent(delivery)
    assert.equal(mapped?.kind, "delivery.created")
    assert.equal(mapped?.payload.artifact_id, "artifact_1")
    assert.equal(mapped?.payload.asset_id, "asset_1")
    assert.equal(mapped?.payload.artifact_kind, "code")
    assert.equal(mapped?.payload.tool_call_id, "tool_1")
    for (const bad of [
      { artifact_id: undefined },
      { asset_id: undefined },
      { artifact_kind: undefined },
      { artifact_kind: "unknown" },
      { artifact_kind: "DOCUMENT" },
      { content_hash: "bad" },
      { size: undefined },
      { size: -1 },
      { size: 1.5 },
      { size: Number.MAX_SAFE_INTEGER + 1 },
    ]) {
      const payload = { ...JSON.parse(delivery.payload_json), ...bad }
      assert.throws(() => agentProjection.mapAgentEvent({ ...delivery, payload_json: JSON.stringify(payload) }))
    }
  })

  it("accepts a contiguous partial page and preserves its source snapshot fence", () => {
    assert.equal(typeof agentProjection.agentEventPage, "function")
    assert.deepEqual(
      agentProjection.agentEventPage(
        {
          events: [event(1), event(2)],
          next_seq: 2,
          watermark: 4,
        },
        "session_1",
        0,
        1000,
      ),
      {
        events: [event(1), event(2)],
        nextSequence: 2,
        watermark: 4,
        exhausted: false,
      },
    )
  })

  it("accepts an empty page only when the requested source snapshot is exhausted", () => {
    assert.equal(typeof agentProjection.agentEventPage, "function")
    assert.deepEqual(agentProjection.agentEventPage({ events: [], next_seq: 4, watermark: 4 }, "session_1", 4, 1000), {
      events: [],
      nextSequence: 4,
      watermark: 4,
      exhausted: true,
    })
    assert.equal(agentProjection.agentEventPage({ events: [], next_seq: 4, watermark: 5 }, "session_1", 4, 1000), null)
  })

  it("rejects source gaps, backward pages, and pagination fence drift", () => {
    assert.equal(typeof agentProjection.agentEventPage, "function")
    const invalidPages = [
      { events: [event(2)], next_seq: 2, watermark: 2 },
      { events: [event(1), event(2), event(1, { chat_event_id: "source_backwards" })], next_seq: 1, watermark: 2 },
      { events: [event(1)], next_seq: 0, watermark: 1 },
      { events: [event(1)], next_seq: 1, watermark: 0 },
      { events: [event(1)], next_seq: 1 },
      { events: [event(1)], watermark: 1 },
    ]
    for (const page of invalidPages) {
      assert.equal(agentProjection.agentEventPage(page, "session_1", 0, 1000), null)
    }
  })

  it("rejects source identity drift and page overflow", () => {
    assert.equal(typeof agentProjection.agentEventPage, "function")
    assert.equal(
      agentProjection.agentEventPage(
        {
          events: [event(1, { session_id: "session_other" })],
          next_seq: 1,
          watermark: 1,
        },
        "session_1",
        0,
        1000,
      ),
      null,
    )
    assert.equal(agentProjection.agentEventPage({ events: [event(1), event(2)], next_seq: 2, watermark: 2 }, "session_1", 0, 1), null)
  })

  it("retries a source gap, then accepts a full owner envelope with an empty final segment", async () => {
    let requests = 0
    const completed = event(2, { event_type: "assistant.completed", payload_json: '{"content":""}', chat_message_id: "segment_1" })
    const server = createServer((_request, response) => {
      requests += 1
      const events = requests === 1 ? [completed] : [event(1), completed]
      response.setHeader("content-type", "application/json")
      response.end(JSON.stringify({ data: { events, next_seq: 2, watermark: 2 }, meta: { request_id: "agent_request" } }))
    })
    const baseUrl = await listen(server)
    try {
      const config = loadConfig({
        KOKORO_BFF_SHARED_SECRET: "test-secret",
        KOKORO_BFF_POSTGRES_URL: "postgresql://localhost/kokoro_bff?schema=kokoro_bff",
        KOKORO_BFF_REDIS_URL: "redis://localhost:6379/8",
        KOKORO_INTERNAL_SECRET_BFF: "upstream-secret",
      })
      const reader = new AgentAgUiSourceReader(config, baseUrl, { maxAttempts: 2, sleep: async () => undefined })
      const page = await reader.read({ tenantId: "tenant_1", sessionId: "session_1", subjectId: "user_1" }, 0, 100)
      assert.equal(requests, 2)
      assert.equal(page.nextSequence, 2)
      assert.equal(page.events[1].event.payload.content, "")
      assert.equal(page.events[1].sourcePayload.source_index, 1)
    } finally {
      await close(server)
    }
  })

  it("rejects 204 and bare replay pages at the live HTTP entry", async () => {
    for (const responseShape of ["no-content", "bare"]) {
      const server = createServer((_request, response) => {
        if (responseShape === "no-content") {
          response.writeHead(204)
          response.end()
          return
        }
        response.setHeader("content-type", "application/json")
        response.end(JSON.stringify({ events: [], next_seq: 0, watermark: 0 }))
      })
      const baseUrl = await listen(server)
      try {
        const config = loadConfig({
          KOKORO_BFF_SHARED_SECRET: "test-secret",
          KOKORO_BFF_POSTGRES_URL: "postgresql://localhost/kokoro_bff?schema=kokoro_bff",
          KOKORO_BFF_REDIS_URL: "redis://localhost:6379/8",
          KOKORO_INTERNAL_SECRET_BFF: "upstream-secret",
        })
        const reader = new AgentAgUiSourceReader(config, baseUrl, { maxAttempts: 1 })
        await assert.rejects(reader.read({ tenantId: "tenant_1", sessionId: "session_1", subjectId: "user_1" }, 0, 100), AgUiSourceContractError)
      } finally {
        await close(server)
      }
    }
  })

  it("classifies an invalid event payload as a permanent source contract error", async () => {
    const server = createServer((_request, response) => {
      response.setHeader("content-type", "application/json")
      response.end(
        JSON.stringify({
          data: {
            events: [event(1, { payload_json: "not-json" })],
            next_seq: 1,
            watermark: 1,
          },
          meta: { request_id: "invalid-payload-test" },
        }),
      )
    })
    const baseUrl = await listen(server)
    try {
      const config = loadConfig({
        KOKORO_BFF_SHARED_SECRET: "test-secret",
        KOKORO_BFF_POSTGRES_URL: "postgresql://localhost/kokoro_bff?schema=kokoro_bff",
        KOKORO_BFF_REDIS_URL: "redis://localhost:6379/8",
        KOKORO_INTERNAL_SECRET_BFF: "upstream-secret",
      })
      const reader = new AgentAgUiSourceReader(config, baseUrl, { maxAttempts: 1 })
      await assert.rejects(reader.read({ tenantId: "tenant_1", sessionId: "session_1", subjectId: "user_1" }, 0, 100), AgUiSourceContractError)
    } finally {
      await close(server)
    }
  })

  for (const [positionName, invalidIndex] of [
    ["first", 0],
    ["middle", 1],
    ["last", 2],
  ]) {
    it(`rejects a ${positionName} malformed failure before ingest and blocks only its consumer`, async () => {
      const badPage = [event(1), event(2), event(3)]
      badPage[invalidIndex] = failureEvent(invalidIndex + 1, {
        code: "model_unavailable",
        retryable: true,
      })
      const server = createServer((request, response) => {
        response.setHeader("content-type", "application/json")
        response.end(
          JSON.stringify(
            request.url?.includes("session_2")
              ? { data: { events: [], next_seq: 0, watermark: 0 }, meta: { request_id: "valid-consumer" } }
              : { data: { events: badPage, next_seq: 3, watermark: 3 }, meta: { request_id: `bad-${positionName}` } },
          ),
        )
      })
      const baseUrl = await listen(server)
      const blocked = []
      const progressed = []
      let ingests = 0
      try {
        const config = loadConfig({
          KOKORO_BFF_SHARED_SECRET: "test-secret",
          KOKORO_BFF_POSTGRES_URL: "postgresql://localhost/kokoro_bff?schema=kokoro_bff",
          KOKORO_BFF_REDIS_URL: "redis://localhost:6379/8",
          KOKORO_INTERNAL_SECRET_BFF: "upstream-secret",
        })
        const reader = new AgentAgUiSourceReader(config, baseUrl, { maxAttempts: 1 })
        const consumers = {
          seedConsumers: async () => 0,
          claimConsumers: async () => [projectorLease("session_1"), projectorLease("session_2")],
          renewConsumerLease: async () => true,
          markConsumerProgress: async (lease) => {
            progressed.push(lease.sessionId)
            return true
          },
          markConsumerRetryable: async () => assert.fail("contract failures must not retry"),
          markConsumerBlocked: async (lease, code) => {
            blocked.push([lease.sessionId, code])
            return true
          },
          releaseConsumer: async () => true,
          collectGarbage: async () => ({ streamsScanned: 0, framesDeleted: 0, tombstonesInserted: 0, tombstonesDeleted: 0 }),
        }
        const runner = new AgUiProjectorRunner(
          {
            ingest: async (_tenantId, _sessionId, sources) => {
              ingests += 1
              return { insertedSources: sources.length, insertedFrames: 0, sourceHighWatermark: sources.at(-1)?.sourceSequence ?? 0 }
            },
          },
          consumers,
          reader,
          projectorOptions(),
        )

        const result = await runner.runOnce()

        assert.deepEqual(
          {
            blocked: result.consumersBlocked,
            succeeded: result.consumersSucceeded,
            sourceEvents: result.sourceEvents,
            ingests,
            blockedConsumers: blocked,
            progressed,
          },
          {
            blocked: 1,
            succeeded: 1,
            sourceEvents: 0,
            ingests: 0,
            blockedConsumers: [["session_1", "source_contract_invalid"]],
            progressed: ["session_2"],
          },
        )
      } finally {
        await close(server)
      }
    })
  }

  it("classifies authentication failures as permanent and does not retry them", async () => {
    let requests = 0
    const server = createServer((_request, response) => {
      requests += 1
      response.writeHead(401, { "content-type": "application/json" })
      response.end(JSON.stringify({ error: { code: "unauthorized", message: "unauthorized" } }))
    })
    const baseUrl = await listen(server)
    try {
      const config = loadConfig({
        KOKORO_BFF_SHARED_SECRET: "test-secret",
        KOKORO_BFF_POSTGRES_URL: "postgresql://localhost/kokoro_bff?schema=kokoro_bff",
        KOKORO_BFF_REDIS_URL: "redis://localhost:6379/8",
        KOKORO_INTERNAL_SECRET_BFF: "upstream-secret",
      })
      const reader = new AgentAgUiSourceReader(config, baseUrl, { maxAttempts: 3 })
      await assert.rejects(
        reader.read({ tenantId: "tenant_1", sessionId: "session_1", subjectId: "user_1" }, 0, 100),
        (error) => error instanceof AgUiSourceReadError && error.code === "agent_source_unauthorized" && error.retryable === false,
      )
      assert.equal(requests, 1)
    } finally {
      await close(server)
    }
  })

  it("keeps HTTP source failure classification stable across retryable and permanent statuses", async () => {
    const matrix = [
      [400, "agent_source_request_invalid", false],
      [403, "agent_source_forbidden", false],
      [404, "agent_source_unavailable", true],
      [408, "agent_source_unavailable", true],
      [410, "agent_source_history_expired", false],
      [425, "agent_source_unavailable", true],
      [429, "agent_source_rate_limited", true],
      [500, "agent_source_unavailable", true],
    ]
    for (const [status, code, retryable] of matrix) {
      const server = createServer((_request, response) => {
        response.writeHead(status, { "content-type": "application/json" })
        response.end(JSON.stringify({ error: { code: "owner_error", message: "owner error" } }))
      })
      const baseUrl = await listen(server)
      try {
        const config = loadConfig({
          KOKORO_BFF_SHARED_SECRET: "test-secret",
          KOKORO_BFF_POSTGRES_URL: "postgresql://localhost/kokoro_bff?schema=kokoro_bff",
          KOKORO_BFF_REDIS_URL: "redis://localhost:6379/8",
          KOKORO_INTERNAL_SECRET_BFF: "upstream-secret",
        })
        const reader = new AgentAgUiSourceReader(config, baseUrl, { maxAttempts: 1 })
        await assert.rejects(
          reader.read({ tenantId: "tenant_1", sessionId: "session_1", subjectId: "user_1" }, 0, 100),
          (error) => error instanceof AgUiSourceReadError && error.code === code && error.retryable === retryable,
          `HTTP ${status}`,
        )
      } finally {
        await close(server)
      }
    }
  })

  it("bounds transient attempts by the persisted lease deadline", async () => {
    const server = createServer(() => {
      // The request-specific timeout must close this socket before the global timeout.
    })
    const baseUrl = await listen(server)
    try {
      const config = loadConfig({
        KOKORO_BFF_SHARED_SECRET: "test-secret",
        KOKORO_BFF_POSTGRES_URL: "postgresql://localhost/kokoro_bff?schema=kokoro_bff",
        KOKORO_BFF_REDIS_URL: "redis://localhost:6379/8",
        KOKORO_INTERNAL_SECRET_BFF: "upstream-secret",
        KOKORO_UPSTREAM_TIMEOUT_MS: "2000",
      })
      const reader = new AgentAgUiSourceReader(config, baseUrl, {
        maxAttempts: 3,
        leaseSettlementReserveMs: 100,
      })
      const startedAt = Date.now()
      await assert.rejects(
        reader.read({ tenantId: "tenant_1", sessionId: "session_1", subjectId: "user_1" }, 0, 100, {
          tenantId: "tenant_1",
          sessionId: "session_1",
          subjectId: "user_1",
          leaseOwner: "worker_1",
          leaseToken: "lease_1",
          fence: 1,
          leaseUntil: new Date(Date.now() + 350).toISOString(),
          leaseRemainingMs: 350,
          sourceHighWatermark: 0,
          failureCount: 0,
        }),
        AgUiConsumerLeaseLostError,
      )
      assert.ok(Date.now() - startedAt < 1000)
    } finally {
      await close(server)
    }
  })

  it("caps exponential source retry jitter at the configured maximum delay", async () => {
    const delays = []
    const server = createServer((_request, response) => {
      response.writeHead(503, { "content-type": "application/json" })
      response.end(JSON.stringify({ error: { code: "unavailable", message: "unavailable" } }))
    })
    const baseUrl = await listen(server)
    try {
      const config = loadConfig({
        KOKORO_BFF_SHARED_SECRET: "test-secret",
        KOKORO_BFF_POSTGRES_URL: "postgresql://localhost/kokoro_bff?schema=kokoro_bff",
        KOKORO_BFF_REDIS_URL: "redis://localhost:6379/8",
        KOKORO_INTERNAL_SECRET_BFF: "upstream-secret",
      })
      const reader = new AgentAgUiSourceReader(config, baseUrl, {
        maxAttempts: 2,
        retryBaseDelayMs: 500,
        retryMaxDelayMs: 500,
        retryJitterPercent: 100,
        random: () => 1,
        sleep: async (milliseconds) => {
          delays.push(milliseconds)
        },
      })
      await assert.rejects(
        reader.read({ tenantId: "tenant_1", sessionId: "session_1", subjectId: "user_1" }, 0, 100),
        (error) => error instanceof AgUiSourceReadError && error.retryable === true,
      )
      assert.deepEqual(delays, [500])
    } finally {
      await close(server)
    }
  })

  it("preserves Retry-After for the durable retry scheduler instead of outliving the lease", async () => {
    let requests = 0
    const server = createServer((_request, response) => {
      requests += 1
      response.writeHead(429, { "content-type": "application/json", "retry-after": "2" })
      response.end(JSON.stringify({ error: { code: "rate_limited", message: "slow down" } }))
    })
    const baseUrl = await listen(server)
    try {
      const config = loadConfig({
        KOKORO_BFF_SHARED_SECRET: "test-secret",
        KOKORO_BFF_POSTGRES_URL: "postgresql://localhost/kokoro_bff?schema=kokoro_bff",
        KOKORO_BFF_REDIS_URL: "redis://localhost:6379/8",
        KOKORO_INTERNAL_SECRET_BFF: "upstream-secret",
      })
      const reader = new AgentAgUiSourceReader(config, baseUrl, {
        maxAttempts: 3,
        retryMaxDelayMs: 500,
      })
      await assert.rejects(
        reader.read({ tenantId: "tenant_1", sessionId: "session_1", subjectId: "user_1" }, 0, 100),
        (error) =>
          error instanceof AgUiSourceReadError && error.code === "agent_source_rate_limited" && error.retryable === true && error.retryAfterMs === 2000,
      )
      assert.equal(requests, 1)
    } finally {
      await close(server)
    }
  })
})

describe("AG-UI source continuity defense", () => {
  const source = (sequence) => ({
    sourceRunId: null,
    sourceEventId: `source_${sequence}`,
    sourceSequence: sequence,
    sourceOccurredAt: new Date(sequence * 1000).toISOString(),
    sourcePayload: { seq: sequence },
    event: null,
  })

  it("rejects a source sequence that skips the committed high watermark", async () => {
    const repository = {
      readStream: async () => ({
        version: 0,
        sourceHighWatermark: 0,
        projectionState: { textMessageIds: [], toolCallIds: [] },
      }),
      assertPersistedSources: async () => undefined,
      commitProjection: async () => "committed",
      replay: async () => ({ kind: "page", frames: [], atHead: true, terminalRunId: null }),
      status: async () => ({ sourceHighWatermark: 0, currentCursor: null }),
    }
    const service = new AgUiProjectionService(repository)

    await assert.rejects(service.ingest("tenant_1", "session_1", [source(2)]), /source sequence is not contiguous/u)
  })

  it("rejects a backward source batch instead of sorting it into validity", async () => {
    const repository = {
      readStream: async () => ({
        version: 0,
        sourceHighWatermark: 0,
        projectionState: { textMessageIds: [], toolCallIds: [] },
      }),
      assertPersistedSources: async () => undefined,
      commitProjection: async () => "committed",
      replay: async () => ({ kind: "page", frames: [], atHead: true, terminalRunId: null }),
      status: async () => ({ sourceHighWatermark: 0, currentCursor: null }),
    }
    const service = new AgUiProjectionService(repository)

    await assert.rejects(service.ingest("tenant_1", "session_1", [source(2), source(1)]), /source sequence is not contiguous/u)
  })

  it("projects only a complete typed Artifact delivery claim", async () => {
    let committed
    const repository = {
      readStream: async () => ({ version: 0, sourceHighWatermark: 0, projectionState: { textMessageIds: [], toolCallIds: [] } }),
      assertPersistedSources: async () => undefined,
      commitProjection: async (command) => {
        committed = command
        return "committed"
      },
    }
    const service = new AgUiProjectionService(repository)
    const payload = {
      tool_call_id: "tool_1",
      artifact_id: "artifact_1",
      asset_id: "asset_1",
      artifact_kind: "document",
      content_hash: "a".repeat(64),
      path: "/report.md",
      title: "Report",
      mime: "text/markdown",
      size: 12,
    }
    const delivery = {
      sourceRunId: "run_1",
      sourceEventId: "delivery_1",
      sourceSequence: 1,
      sourceOccurredAt: "2026-09-28T00:00:00.000Z",
      sourcePayload: { event_type: "delivery", payload_json: JSON.stringify(payload) },
      event: {
        event_id: "delivery_1",
        seq: 1,
        session_id: "session_1",
        run_id: "run_1",
        kind: "delivery.created",
        timestamp: "2026-09-28T00:00:00.000Z",
        payload,
      },
    }
    await service.ingest("tenant_1", "session_1", [delivery])
    assert.deepEqual(committed.sources[0].artifactDelivery, {
      runId: "run_1",
      toolCallId: "tool_1",
      artifactId: "artifact_1",
      assetId: "asset_1",
      artifactKind: "document",
      contentSha256: "a".repeat(64),
      title: "Report",
      mime: "text/markdown",
      size: 12,
    })
    for (const invalid of [
      { artifact_id: undefined },
      { asset_id: undefined },
      { artifact_kind: "unknown" },
      { content_hash: "BAD" },
      { tool_call_id: undefined },
      { title: undefined },
      { mime: undefined },
      { size: -1 },
      { size: 1.5 },
      { size: "12" },
      { size: 2 ** 53 },
    ]) {
      await assert.rejects(
        service.ingest("tenant_1", "session_1", [
          {
            ...delivery,
            event: { ...delivery.event, payload: { ...payload, ...invalid } },
          },
        ]),
        AgUiSourceContractError,
      )
    }
    await assert.rejects(
      service.ingest("tenant_1", "session_1", [
        {
          ...delivery,
          event: { ...delivery.event, run_id: null },
        },
      ]),
      AgUiSourceContractError,
    )
  })
})


// R57: the real source decoder must consume only the published HTTP4 full-state surface.

function r57Waiting() {
  return {
    interaction_revision: 7,
    pause_revision: 7,
    pause_ref: "pause:run_hitl_1:7",
    phase: "waiting",
    groups: [
      {
        group_id: "group_tools",
        items: [
          {
            item_id: "item_approve",
            request_id: "request_tool_1",
            kind: "tool_approval",
            allowed_decisions: ["approve", "edit", "reject"],
            display: {
              name: "search",
              description: "Search approved index",
              editable: true,
              input_schema: { type: "object", properties: { query: { type: "string" } } },
              result_preview: null,
              truncated: null,
              source: null,
            },
          },
          {
            item_id: "item_edit",
            request_id: "request_tool_2",
            kind: "tool_approval",
            allowed_decisions: ["edit", "reject"],
            display: { name: "edit", description: "Edit parameters", editable: true, input_schema: { type: "object" } },
          },
          {
            item_id: "item_reject",
            request_id: "request_review_1",
            kind: "result_review",
            allowed_decisions: ["approve", "reject"],
            display: {
              name: "review",
              description: "Review result",
              editable: false,
              input_schema: { type: "object" },
              result_preview: "bounded result",
              truncated: false,
              source: "tool",
            },
          },
        ],
      },
      {
        group_id: "group_inputs",
        items: [
          {
            item_id: "item_respond",
            request_id: "request_question_1",
            kind: "ask_user_question",
            allowed_decisions: ["respond", "reject"],
            display: { name: "question", description: "Choose a region", editable: false, input_schema: { type: "object" } },
            validation: { code: "json_schema_invalid", instance_path: ["region", 0] },
          },
          {
            item_id: "item_submit",
            request_id: "request_input_1",
            kind: "input",
            allowed_decisions: ["submit"],
            display: { name: "form", description: "Confirm values", editable: true, input_schema: { type: "object" } },
          },
        ],
      },
    ],
    action_result: null,
  }
}
function r57Control() {
  return {
    kind: "run.resume",
    expected_pause_revision: 7,
    pause_ref: "pause:run_hitl_1:7",
    decisions: [
      { type: "approve", item_id: "item_approve" },
      { type: "edit", item_id: "item_edit", args: { count: 2, note: null } },
      { type: "reject", item_id: "item_reject" },
      { type: "respond", item_id: "item_respond", response: "continue" },
      { type: "submit", item_id: "item_submit", value: { confirmed: true, comment: null } },
    ],
  }
}

function r57Source(payload, sequence = 1, eventType = "interaction.state") {
  return event(sequence, { event_type: eventType, payload_json: JSON.stringify(payload) })
}
it("R57 source maps the full six-field waiting state without flattening groups or optional presence", () => {
  const payload = r57Waiting()
  const mapped = agentProjection.mapAgentEvent(r57Source(payload))
  assert.deepEqual(mapped, {
    event_id: "source_1",
    seq: 1,
    session_id: "session_1",
    run_id: "run_1",
    kind: "interaction.state",
    timestamp: "1970-01-01T00:00:01.000Z",
    payload,
  })
})
for (const phase of ["active", "resuming", "terminal"]) {
  it(`R57 source accepts published ${phase} with historical positive pause locator`, () => {
    const payload = {
      ...r57Waiting(),
      interaction_revision: 8,
      phase,
      groups: phase === "resuming" ? r57Waiting().groups : [],
      action_result: { command_id: "command_resume_1", pause_revision: 7, kind: phase === "resuming" ? "unknown" : "native_consumed" },
    }
    assert.deepEqual(agentProjection.mapAgentEvent(r57Source(payload))?.payload, payload)
  })
}
it("R57 source preserves optional null versus omitted as different full-state content", () => {
  const explicit = r57Waiting()
  const omitted = structuredClone(explicit)
  for (const key of ["result_preview", "truncated", "source"]) delete omitted.groups[0].items[0].display[key]
  assert.deepEqual(agentProjection.mapAgentEvent(r57Source(explicit))?.payload, explicit)
  assert.deepEqual(agentProjection.mapAgentEvent(r57Source(omitted))?.payload, omitted)
  assert.notDeepEqual(explicit, omitted)
})
it("R57 strict source page rejects retired interaction even when its legacy payload is otherwise valid", () => {
  const legacy = r57Source(
    { segment_id: "segment_1", tool_id: "tool_1", name: "legacy", kind: "tool_approval", allowed_decisions: ["approve"], pending_tool_ids: ["tool_1"] },
    1,
    "interaction",
  )
  assert.equal(agentProjection.agentEventPage({ events: [legacy], next_seq: 1, watermark: 1 }, "session_1", 0, 10), null)
})
const r57InvalidStates = [
  [
    "missing required field",
    (p) => {
      delete p.pause_ref
    },
  ],
  [
    "unknown top-level field",
    (p) => {
      p.owner_digest = "not-published"
    },
  ],
  [
    "unsafe revision",
    (p) => {
      p.interaction_revision = Number.MAX_SAFE_INTEGER + 1
    },
  ],
  [
    "pause newer than interaction",
    (p) => {
      p.pause_revision = 8
    },
  ],
  [
    "zero revision with ref",
    (p) => {
      p.pause_revision = 0
    },
  ],
  [
    "positive revision null ref",
    (p) => {
      p.pause_ref = null
    },
  ],
  [
    "waiting empty groups",
    (p) => {
      p.groups = []
    },
  ],
  [
    "active nonempty groups",
    (p) => {
      p.phase = "active"
    },
  ],
  [
    "duplicate group identity",
    (p) => {
      p.groups[1].group_id = p.groups[0].group_id
    },
  ],
  [
    "duplicate cross-group item identity",
    (p) => {
      p.groups[1].items[0].item_id = p.groups[0].items[0].item_id
    },
  ],
  [
    "unknown item kind",
    (p) => {
      p.groups[0].items[0].kind = "legacy_tool"
    },
  ],
  [
    "duplicate allowed decision",
    (p) => {
      p.groups[0].items[0].allowed_decisions = ["approve", "approve"]
    },
  ],
  [
    "empty allowed decisions",
    (p) => {
      p.groups[0].items[0].allowed_decisions = []
    },
  ],
  [
    "private item argument",
    (p) => {
      p.groups[0].items[0].args = { secret: "private" }
    },
  ],
  [
    "preview without source",
    (p) => {
      delete p.groups[0].items[2].display.source
    },
  ],
  [
    "bad validation path",
    (p) => {
      p.groups[1].items[0].validation.instance_path = [false]
    },
  ],
  [
    "resuming without result",
    (p) => {
      p.phase = "resuming"
    },
  ],
  [
    "resuming mismatched action revision",
    (p) => {
      p.phase = "resuming"
      p.action_result = { command_id: "c", pause_revision: 6, kind: "accepted" }
    },
  ],
  [
    "waiting validation failure not older",
    (p) => {
      p.action_result = { command_id: "c", pause_revision: 7, kind: "validation_failed" }
    },
  ],
]
for (const [name, mutate] of r57InvalidStates) {
  it(`R57 strict full-state decoder rejects ${name}`, () => {
    const invalid = r57Waiting()
    mutate(invalid)
    assert.throws(
      () => agentProjection.mapAgentEvent(r57Source(invalid)),
      undefined,
      "invalid owner state must fail closed, not silently become a zero-frame source",
    )
  })
}
it("R57 real HTTP source reader rejects a mixed valid start and malformed interaction before returning any page", async () => {
  const invalid = r57Waiting()
  invalid.groups[1].items[0].item_id = invalid.groups[0].items[0].item_id
  let publishInvalid = false
  const server = createServer((_request, response) => {
    response.setHeader("content-type", "application/json")
    response.end(
      JSON.stringify({
        data: { events: [event(1), r57Source(publishInvalid ? invalid : r57Waiting(), 2)], next_seq: 2, watermark: 2 },
        meta: { request_id: "r57_source" },
      }),
    )
  })
  const base = await listen(server)
  try {
    const reader = new AgentAgUiSourceReader(
      loadConfig({
        KOKORO_BFF_SHARED_SECRET: "r57-web-secret",
        KOKORO_INTERNAL_SECRET_BFF: "r57-owner-secret",
        KOKORO_BFF_POSTGRES_URL: "postgresql://localhost/kokoro_bff?schema=kokoro_bff",
        KOKORO_BFF_REDIS_URL: "redis://localhost:6379/8",
      }),
      base,
      { maxAttempts: 1 },
    )
    const scope = { tenantId: "tenant_1", subjectId: "user_1", sessionId: "session_1" }
    const positive = await reader.read(scope, 0, 10)
    assert.equal(positive.events.length, 2)
    assert.deepEqual(positive.events[1].event?.payload, r57Waiting(), "valid HTTP4 full state must be accepted before testing the negative")
    publishInvalid = true
    await assert.rejects(reader.read(scope, 0, 10), AgUiSourceContractError)
  } finally {
    await close(server)
  }
})

it("R57 source optional-presence vectors keep the two independent owner full-state digests distinct", async () => {
  const { createHash } = await import("node:crypto")
  const canonical = (value) =>
    Array.isArray(value)
      ? "[" + value.map(canonical).join(",") + "]"
      : value !== null && typeof value === "object"
        ? "{" +
          Object.keys(value)
            .sort()
            .map((key) => JSON.stringify(key) + ":" + canonical(value[key]))
            .join(",") +
          "}"
        : JSON.stringify(value)
  const explicit = r57Waiting()
  explicit.groups[0].items = explicit.groups[0].items.slice(0, 1)
  const omitted = structuredClone(explicit)
  for (const key of ["result_preview", "truncated", "source"]) delete omitted.groups[0].items[0].display[key]
  const mappedExplicit = agentProjection.mapAgentEvent(r57Source(explicit))
  const mappedOmitted = agentProjection.mapAgentEvent(r57Source(omitted))
  assert.deepEqual(mappedExplicit?.payload, explicit)
  assert.deepEqual(mappedOmitted?.payload, omitted)
  assert.equal(createHash("sha256").update(canonical(mappedExplicit.payload)).digest("hex"), "1f189ebdc6434757949ae96350ba4b6a0c92f3a26a8e2e0d99f9e8ff6af1a22e")
  assert.equal(createHash("sha256").update(canonical(mappedOmitted.payload)).digest("hex"), "4d8573e1211c7aaa33a6d37cde0bf830e2fb9e7bf52e7d214229fd30e05ab9aa")
})
