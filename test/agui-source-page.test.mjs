import assert from "node:assert/strict"
import { createServer } from "node:http"
import { describe, it } from "node:test"

import * as agentProjection from "../dist/infrastructure/clients/agent/projection.js"
import { AgUiConsumerLeaseLostError, AgUiSourceContractError, AgUiSourceReadError } from "../dist/application/agui/errors.js"
import { AgUiProjectionService } from "../dist/application/agui/project-session-events.js"
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
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
}

const event = (sequence, overrides = {}) => ({
  chat_event_id: `source_${sequence}`,
  session_id: "session_1",
  run_id: "run_1",
  event_type: sequence === 1 ? "run.started" : "assistant.delta",
  payload_json: sequence === 1 ? '{"status":"running"}' : '{"delta":"hello"}',
  seq: sequence,
  created_at: sequence * 1000,
  ...overrides,
})

describe("Agent event page boundary", () => {
  it("accepts a contiguous partial page and preserves its source snapshot fence", () => {
    assert.equal(typeof agentProjection.agentEventPage, "function")
    assert.deepEqual(
      agentProjection.agentEventPage({
        events: [event(1), event(2)],
        next_seq: 2,
        watermark: 4,
      }, "session_1", 0, 1000),
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
    assert.deepEqual(
      agentProjection.agentEventPage({ events: [], next_seq: 4, watermark: 4 }, "session_1", 4, 1000),
      { events: [], nextSequence: 4, watermark: 4, exhausted: true },
    )
    assert.equal(
      agentProjection.agentEventPage({ events: [], next_seq: 4, watermark: 5 }, "session_1", 4, 1000),
      null,
    )
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
      agentProjection.agentEventPage({
        events: [event(1, { session_id: "session_other" })],
        next_seq: 1,
        watermark: 1,
      }, "session_1", 0, 1000),
      null,
    )
    assert.equal(
      agentProjection.agentEventPage({ events: [event(1), event(2)], next_seq: 2, watermark: 2 }, "session_1", 0, 1),
      null,
    )
  })

  it("classifies an invalid event payload as a permanent source contract error", async () => {
    const server = createServer((_request, response) => {
      response.setHeader("content-type", "application/json")
      response.end(JSON.stringify({
        data: {
          events: [event(1, { payload_json: "not-json" })],
          next_seq: 1,
          watermark: 1,
        },
      }))
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
        AgUiSourceContractError,
      )
    } finally {
      await close(server)
    }
  })

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
        (error) => error instanceof AgUiSourceReadError
          && error.code === "agent_source_unauthorized"
          && error.retryable === false,
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
          (error) => error instanceof AgUiSourceReadError
            && error.code === code
            && error.retryable === retryable,
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
        reader.read(
          { tenantId: "tenant_1", sessionId: "session_1", subjectId: "user_1" },
          0,
          100,
          {
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
          },
        ),
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
        sleep: async (milliseconds) => { delays.push(milliseconds) },
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
        (error) => error instanceof AgUiSourceReadError
          && error.code === "agent_source_rate_limited"
          && error.retryable === true
          && error.retryAfterMs === 2000,
      )
      assert.equal(requests, 1)
    } finally {
      await close(server)
    }
  })
})

describe("AG-UI source continuity defense", () => {
  const source = (sequence) => ({
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

    await assert.rejects(
      service.ingest("tenant_1", "session_1", [source(2)]),
      /source sequence is not contiguous/u,
    )
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

    await assert.rejects(
      service.ingest("tenant_1", "session_1", [source(2), source(1)]),
      /source sequence is not contiguous/u,
    )
  })
})
