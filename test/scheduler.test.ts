import assert from "node:assert/strict"
import { createServer } from "node:http"
import { describe, it } from "node:test"

import { DEFAULT_AGUI_CONFIG } from "../dist/config/runtime.js"
import { createBffServer } from "../dist/main.js"
import { schedulerDispatchDigest } from "../dist/infrastructure/clients/scheduler/dispatch-identity.js"
import { parseSchedulerDispatchWebhook } from "../dist/infrastructure/clients/scheduler/webhook-contract.js"
import { buildAgentLaunch, buildScheduledAgentLaunch } from "../dist/infrastructure/clients/agent/index.js"
import { scheduledTaskId } from "../dist/http/routes/scheduler.js"

function headers(overrides: Record<string, string> = {}) {
  return {
    "x-kokoro-tenant-id": "tenant_fixture",
    "x-kokoro-scheduler-schedule": "kokoro.scheduled.scheduled_fixture",
    "x-kokoro-scheduler-occurrence": "2026-09-01T12:00:00.123456789Z",
    "x-request-id": "request_fixture",
    "idempotency-key": " opaque key ",
    traceparent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01",
    ...overrides,
  }
}

describe("Scheduler generated webhook boundary", () => {
  it("validates exact producer headers and preserves opaque identity bytes", () => {
    assert.deepEqual(parseSchedulerDispatchWebhook(headers(), { tenant_id: "tenant_fixture" }), {
      tenantId: "tenant_fixture",
      schedule: "kokoro.scheduled.scheduled_fixture",
      occurrence: "2026-09-01T12:00:00.123456789Z",
      requestId: "request_fixture",
      idempotencyKey: " opaque key ",
      traceparent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01",
      body: { tenant_id: "tenant_fixture" },
    })
  })

  it("preserves top-level and nested special JSON keys for receipt digesting", () => {
    const left = JSON.parse('{"tenant_id":"tenant_fixture","__proto__":{"version":1},"nested":{"__proto__":"left"}}') as Record<string, unknown>
    const topChanged = JSON.parse('{"tenant_id":"tenant_fixture","__proto__":{"version":2},"nested":{"__proto__":"left"}}') as Record<string, unknown>
    const nestedChanged = JSON.parse('{"tenant_id":"tenant_fixture","__proto__":{"version":1},"nested":{"__proto__":"right"}}') as Record<string, unknown>
    const parsed = parseSchedulerDispatchWebhook(headers(), left)
    assert.deepEqual(parsed?.body, left)
    assert.equal(Object.hasOwn(parsed?.body ?? {}, "__proto__"), true)
    const common = { tenantId: "tenant_fixture", schedule: "kokoro.scheduled.scheduled_fixture", occurrence: "2026-09-01T12:00:00Z" }
    assert.notEqual(schedulerDispatchDigest({ ...common, body: left }), schedulerDispatchDigest({ ...common, body: topChanged }))
    assert.notEqual(schedulerDispatchDigest({ ...common, body: left }), schedulerDispatchDigest({ ...common, body: nestedChanged }))
  })

  it("rejects non-finite numbers before receipt admission", () => {
    assert.equal(parseSchedulerDispatchWebhook(headers(), { tenant_id: "tenant_fixture", nested: { value: Number.POSITIVE_INFINITY } }), null)
  })

  it("rejects the deleted job header, compact time, offsets, and missing trace context", () => {
    const removedHeader = ["x-kokoro-scheduler", "job"].join("-")
    assert.equal(parseSchedulerDispatchWebhook({ ...headers(), "x-kokoro-scheduler-schedule": undefined, [removedHeader]: "old" }, {}), null)
    assert.equal(parseSchedulerDispatchWebhook(headers({ "x-kokoro-scheduler-occurrence": "20260901T120000Z" }), {}), null)
    assert.equal(parseSchedulerDispatchWebhook(headers({ "x-kokoro-scheduler-occurrence": "2026-09-01T12:00:00+00:00" }), {}), null)
    assert.equal(parseSchedulerDispatchWebhook({ ...headers(), traceparent: undefined }, {}), null)
  })
})

async function listen(server: ReturnType<typeof createServer> | ReturnType<typeof createBffServer>): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  if (address === null || typeof address === "string") throw new Error("server did not bind")
  return `http://127.0.0.1:${address.port}`
}

async function close(server: ReturnType<typeof createServer> | ReturnType<typeof createBffServer>): Promise<void> {
  if ("shutdown" in server) await server.shutdown()
  else await new Promise<void>((resolve) => server.close(() => resolve()))
}

function config(agentBase: string | null, upstreamTimeoutMs = 70_000) {
  return {
    host: "127.0.0.1",
    port: 4300,
    mode: "live" as const,
    domain: "dev.kokoro.localhost",
    tenantId: "tenant_fixture",
    iamBaseUrl: null,
    sharedSecret: "web-secret",
    upstreamSecret: "bff-secret",
    upstreamTimeoutMs,
    upstreamMaxResponseBytes: 1024 * 1024,
    schedulerServiceToken: "scheduler-secret",
    schedulerTargetUrl: null,
    agentEnabled: agentBase !== null,
    postgresUrl: null,
    redisUrl: null,
    agUi: DEFAULT_AGUI_CONFIG,
    upstreams: { system: null, capability: null, storage: null, scheduler: null, agents: agentBase, billing: null },
  }
}

function dispatchSnapshot(leaseRemainingMs: number) {
  return {
    scope: '["tenant_fixture","scheduler-dispatch:v1","budget-key"]',
    digest: "a".repeat(64),
    claimToken: "claim",
    leaseRemainingMs,
    leaseObservedAt: performance.now(),
    snapshot: {
      tenantId: "tenant_fixture",
      schedule: "kokoro.scheduled.scheduled_fixture",
      occurrence: "2026-09-01T12:00:00Z",
      idempotencyKey: "budget-key",
      actorId: "owner_fixture",
      taskId: "scheduled_fixture",
      launch: {
        requestId: "snapshot-request",
        body: { request_id: "snapshot-request", run_id: "run_fixture", content: "go" },
        identityAssertionRef: "bff:fixture",
        receipt: { run_id: "run_fixture", user_message_id: "user_fixture", assistant_message_id: "assistant_fixture" },
      },
    },
  }
}

function dispatchHeaders(idempotencyKey = "budget-key", requestId = "transport-request"): Record<string, string> {
  return {
    authorization: "Bearer scheduler-secret",
    "content-type": "application/json",
    "x-kokoro-tenant-id": "tenant_fixture",
    "x-kokoro-scheduler-schedule": "kokoro.scheduled.scheduled_fixture",
    "x-kokoro-scheduler-occurrence": "2026-09-01T12:00:00Z",
    "x-request-id": requestId,
    "idempotency-key": idempotencyKey,
    traceparent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01",
  }
}

function dispatchBody(extra = ""): string {
  return `{"tenant_id":"tenant_fixture","task_id":"scheduled_fixture","owner_id":"owner_fixture","prompt":"go","auto_approve":false,"timezone":"UTC"${extra}}`
}

describe("Scheduler receiver admission", () => {
  it("returns 400 for raw 1e400 JSON without receipt or Agent I/O", async () => {
    let receiptClaims = 0
    let agentCalls = 0
    const agent = createServer((_request, response) => {
      agentCalls += 1
      response.end()
    })
    const agentBase = await listen(agent)
    const store = {
      services: { scheduledTasks: { findRecord: async () => null } },
      schedulerDispatchReceipts: {
        claim: async () => {
          receiptClaims += 1
          return { outcome: "pending" }
        },
      },
      ready: async () => undefined,
      close: async () => undefined,
    }
    const bff = createBffServer(config(agentBase), { businessStore: store as never, readiness: async () => undefined })
    const base = await listen(bff)
    try {
      const result = await fetch(`${base}/internal/bff/scheduled-tasks/dispatch`, {
        method: "POST",
        headers: dispatchHeaders(),
        body: dispatchBody(',"nested":{"value":1e400}'),
      })
      assert.equal(result.status, 400)
      assert.equal(receiptClaims, 0)
      assert.equal(agentCalls, 0)
    } finally {
      await close(bff)
      await close(agent)
    }
  })

  it("returns 409 when a special-key body changes under the same receipt key", async () => {
    let admittedDigest: string | null = null
    const receipts = {
      claim: async (_scope: string, digest: string) => {
        if (admittedDigest === null) {
          admittedDigest = digest
          return { outcome: "terminal", response: { status: 202, body: { data: { run_id: "first" } } } }
        }
        return admittedDigest === digest ? { outcome: "terminal", response: { status: 202, body: { data: { run_id: "first" } } } } : { outcome: "conflict" }
      },
    }
    const store = {
      services: { scheduledTasks: { findRecord: async () => null } },
      schedulerDispatchReceipts: receipts,
      ready: async () => undefined,
      close: async () => undefined,
    }
    const bff = createBffServer(config(null), { businessStore: store as never, readiness: async () => undefined })
    const base = await listen(bff)
    try {
      const first = await fetch(`${base}/internal/bff/scheduled-tasks/dispatch`, {
        method: "POST",
        headers: dispatchHeaders("special-key"),
        body: dispatchBody(',"__proto__":{"version":1}'),
      })
      const second = await fetch(`${base}/internal/bff/scheduled-tasks/dispatch`, {
        method: "POST",
        headers: dispatchHeaders("special-key", "transport-request-2"),
        body: dispatchBody(',"__proto__":{"version":2}'),
      })
      assert.equal(first.status, 202)
      assert.equal(second.status, 409)
    } finally {
      await close(bff)
    }
  })

  it("does not call Agent when the receipt lease cannot fund settlement reserve", async () => {
    let agentCalls = 0
    const agent = createServer((_request, response) => {
      agentCalls += 1
      response.end()
    })
    const agentBase = await listen(agent)
    const claim = dispatchSnapshot(4_999)
    const receipts = {
      claim: async () => ({ outcome: "claimed", claim }),
      releaseRetryable: async () => true,
      complete: async () => true,
    }
    const store = {
      services: { scheduledTasks: { findRecord: async () => null } },
      schedulerDispatchReceipts: receipts,
      ready: async () => undefined,
      close: async () => undefined,
    }
    const bff = createBffServer(config(agentBase), { businessStore: store as never, readiness: async () => undefined })
    const base = await listen(bff)
    try {
      const result = await fetch(`${base}/internal/bff/scheduled-tasks/dispatch`, { method: "POST", headers: dispatchHeaders(), body: dispatchBody() })
      assert.equal(result.status, 502)
      assert.equal(agentCalls, 0)
    } finally {
      await close(bff)
      await close(agent)
    }
  })

  it("caps slow Scheduler Agent I/O by remaining lease despite a 70s global timeout", async () => {
    let agentCalls = 0
    const agent = createServer((_request, response) => {
      agentCalls += 1
      setTimeout(() => {
        if (!response.destroyed) response.end(JSON.stringify({ data: { run_id: "run_fixture" } }))
      }, 1000)
    })
    const agentBase = await listen(agent)
    const claim = dispatchSnapshot(5_150)
    const receipts = {
      claim: async () => ({ outcome: "claimed", claim }),
      releaseRetryable: async () => true,
      complete: async () => true,
    }
    const store = {
      services: { scheduledTasks: { findRecord: async () => null } },
      schedulerDispatchReceipts: receipts,
      ready: async () => undefined,
      close: async () => undefined,
    }
    const bff = createBffServer(config(agentBase, 70_000), { businessStore: store as never, readiness: async () => undefined })
    const base = await listen(bff)
    try {
      const startedAt = Date.now()
      const result = await fetch(`${base}/internal/bff/scheduled-tasks/dispatch`, { method: "POST", headers: dispatchHeaders(), body: dispatchBody() })
      assert.equal(result.status, 502)
      assert.equal(agentCalls, 1)
      assert.ok(Date.now() - startedAt < 900)
    } finally {
      await close(bff)
      await close(agent)
    }
  })

  it("charges claim return latency against a recovered snapshot before Agent I/O", async () => {
    let agentCalls = 0
    const agent = createServer((_request, response) => {
      agentCalls += 1
      response.setHeader("content-type", "application/json")
      response.end(JSON.stringify({ data: { run_id: "run_fixture" } }))
    })
    const agentBase = await listen(agent)
    const claim = dispatchSnapshot(5_100)
    const receipts = {
      claim: async () => {
        claim.leaseObservedAt = performance.now()
        await new Promise((resolve) => setTimeout(resolve, 150))
        return { outcome: "claimed", claim }
      },
      releaseRetryable: async () => true,
      complete: async () => true,
    }
    const store = {
      services: { scheduledTasks: { findRecord: async () => null } },
      schedulerDispatchReceipts: receipts,
      ready: async () => undefined,
      close: async () => undefined,
    }
    const bff = createBffServer(config(agentBase), { businessStore: store as never, readiness: async () => undefined })
    const base = await listen(bff)
    try {
      const result = await fetch(`${base}/internal/bff/scheduled-tasks/dispatch`, { method: "POST", headers: dispatchHeaders(), body: dispatchBody() })
      assert.equal(result.status, 502)
      assert.equal(agentCalls, 0)
    } finally {
      await close(bff)
      await close(agent)
    }
  })

  it("charges prepare return latency against first-admission Agent I/O", async () => {
    let agentCalls = 0
    const agent = createServer((_request, response) => {
      agentCalls += 1
      response.setHeader("content-type", "application/json")
      response.end(JSON.stringify({ data: { run_id: "unexpected" } }))
    })
    const agentBase = await listen(agent)
    const claim = { ...dispatchSnapshot(60_000), snapshot: null }
    const receipts = {
      claim: async () => ({ outcome: "claimed", claim }),
      prepareSnapshot: async () => {
        const leaseObservedAt = performance.now()
        await new Promise((resolve) => setTimeout(resolve, 150))
        return { leaseRemainingMs: 5_100, leaseObservedAt }
      },
      releaseRetryable: async () => true,
      complete: async () => true,
    }
    const record = {
      ownerId: "owner_fixture",
      task: {
        id: "scheduled_fixture",
        title: "Fixture",
        prompt: "go",
        frequency: "daily",
        time: "08:00",
        timezone: "UTC",
        nextRunAt: new Date("2026-09-01T08:00:00.000Z"),
        autoApprove: false,
        enabled: true,
        status: "active",
        revision: 1,
      },
    }
    const store = {
      services: { scheduledTasks: { findRecord: async () => record } },
      schedulerDispatchReceipts: receipts,
      ready: async () => undefined,
      close: async () => undefined,
    }
    const bff = createBffServer(config(agentBase), { businessStore: store as never, readiness: async () => undefined })
    const base = await listen(bff)
    try {
      const result = await fetch(`${base}/internal/bff/scheduled-tasks/dispatch`, { method: "POST", headers: dispatchHeaders(), body: dispatchBody() })
      assert.equal(result.status, 502)
      assert.equal(agentCalls, 0)
    } finally {
      await close(bff)
      await close(agent)
    }
  })
})

describe("Agent launch identities", () => {
  it("binds scheduled task ids to tenant, trusted subject, path, and key without delimiter ambiguity", () => {
    const context = (tenant: string, subject: string) => ({ requestId: "request", identity: { namespace: tenant, userId: subject } })
    const canonical = scheduledTaskId(context("tenant", "subject"), "/scheduled-tasks", "key")
    assert.equal(canonical, scheduledTaskId(context("tenant", "subject"), "/scheduled-tasks", "key"))
    assert.notEqual(canonical, scheduledTaskId(context("tenant", "other-subject"), "/scheduled-tasks", "key"))
    assert.notEqual(
      scheduledTaskId(context("tenant", "subject\u001f/scheduled-tasks"), "/scheduled-tasks", "key"),
      scheduledTaskId(context("tenant", "subject"), "/scheduled-tasks\u001f/scheduled-tasks", "key"),
    )
  })

  it("keeps ordinary Chat launch identity actor-dependent", () => {
    const common = { requestId: "request", sessionId: "session", idempotencyKey: "key", content: "hello" }
    const left = buildAgentLaunch({ ...common, identity: { namespace: "tenant", userId: "actor-a" } })
    const right = buildAgentLaunch({ ...common, identity: { namespace: "tenant", userId: "actor-b" } })
    assert.notEqual(left.receipt.run_id, right.receipt.run_id)
  })

  it("uses only the supplied canonical occurrence identity for Scheduler execution ids", () => {
    const common = { requestId: "request", sessionId: "scheduled:task", occurrenceIdentity: "a".repeat(64), content: "hello" }
    const left = buildScheduledAgentLaunch({ ...common, identity: { namespace: "tenant", userId: "actor-a" } })
    const right = buildScheduledAgentLaunch({ ...common, requestId: "other-request", identity: { namespace: "tenant", userId: "actor-b" } })
    assert.equal(left.receipt.run_id, right.receipt.run_id)
    assert.equal(left.identityAssertionRef, right.identityAssertionRef)
    assert.notEqual(left.body.request_id, right.body.request_id)
  })
})
