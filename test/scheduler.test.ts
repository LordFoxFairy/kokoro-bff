import "reflect-metadata"
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { describe, it } from "node:test"
import { Test } from "@nestjs/testing"

import {
  AGENT_CANCELLATION_DISPATCHER,
  AGENT_DISPATCH_DISPATCHER,
  AGUI_PROJECTOR,
  BFF_CONFIG,
  BFF_DATABASE,
  PROJECT_SCOPE_RELEASE_DISPATCHER,
  PROJECT_LOOKUP,
  PROJECT_READ_LOOKUP,
  SCHEDULED_TASK_SERVICE,
  SCHEDULED_TASK_IDEMPOTENCY,
  SESSION_ADMISSION,
  SCHEDULED_AGENT_DISPATCH_REPOSITORY,
  SCHEDULED_AGENT_DISPATCHER,
  SCHEDULED_TASK_DISPATCHER,
  SCHEDULER_DISPATCH_RECEIPTS,
} from "../dist/common/tokens.js"
import { DEFAULT_AGUI_CONFIG } from "../dist/config/runtime.js"
import { BFF_NEST_APPLICATION_OPTIONS } from "../dist/main.js"
import { SCHEDULED_TASK_CALLBACK_LOOKUP } from "../dist/modules/scheduled-tasks/scheduled-task.providers.js"
import { ScheduledTasksModule } from "../dist/modules/scheduled-tasks/scheduled-tasks.module.js"
import { schedulerDispatchDigest } from "../dist/infrastructure/clients/scheduler/dispatch-identity.js"
import { parseSchedulerDispatchWebhook } from "../dist/infrastructure/clients/scheduler/webhook-contract.js"
import { buildScheduledAgentLaunch } from "../dist/infrastructure/clients/agent/index.js"
import { handleScheduledTaskMutationBusiness, scheduledTaskMutation } from "../dist/http/routes/scheduled-task-mutation-native.js"
import { handleScheduledTaskReadRequest } from "../dist/http/routes/scheduled-task-native.js"
import { mutationTicket } from "../dist/application/idempotency.js"
import { SessionAdmissionDouble } from "./doubles/session-admission.ts"
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

async function listen(server: ReturnType<typeof createServer>): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  if (address === null || typeof address === "string") throw new Error("server did not bind")
  return `http://127.0.0.1:${address.port}`
}

async function close(server: ReturnType<typeof createServer>): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()))
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

async function startSchedulerReceiver(
  runtimeConfig: ReturnType<typeof config>,
  scheduledTasks: object,
  receipts: object,
  scheduledAgentDispatch?: object,
  overrides: ReadonlyArray<readonly [symbol, unknown]> = [],
) {
  const unexpectedDatabaseIo = (): never => assert.fail("Scheduler callback fixture must not access database resources")
  const builder = Test.createTestingModule({ imports: [ScheduledTasksModule] })
    .overrideProvider(BFF_CONFIG)
    .useValue(runtimeConfig)
    .overrideProvider(BFF_DATABASE)
    .useValue({
      pool: { query: unexpectedDatabaseIo, connect: unexpectedDatabaseIo, end: unexpectedDatabaseIo },
      redis: { connect: unexpectedDatabaseIo, ping: unexpectedDatabaseIo, close: unexpectedDatabaseIo },
      ready: unexpectedDatabaseIo,
      close: async () => undefined,
    })
    .overrideProvider(SCHEDULED_TASK_CALLBACK_LOOKUP)
    .useValue(scheduledTasks)
    .overrideProvider(SCHEDULER_DISPATCH_RECEIPTS)
    .useValue(receipts)
  if (scheduledAgentDispatch !== undefined) {
    builder.overrideProvider(SCHEDULED_AGENT_DISPATCH_REPOSITORY).useValue(scheduledAgentDispatch)
  }
  // The tests exercise the receiver, never the background delivery or projection workers.
  for (const token of [
    AGENT_CANCELLATION_DISPATCHER,
    AGENT_DISPATCH_DISPATCHER,
    AGUI_PROJECTOR,
    PROJECT_SCOPE_RELEASE_DISPATCHER,
    SCHEDULED_AGENT_DISPATCHER,
    SCHEDULED_TASK_DISPATCHER,
  ]) {
    builder.overrideProvider(token).useValue(null)
  }
  for (const [token, value] of overrides) builder.overrideProvider(token).useValue(value)
  const module = await builder.compile()
  const app = module.createNestApplication({ ...BFF_NEST_APPLICATION_OPTIONS, logger: false })
  try {
    await app.listen(0, "127.0.0.1")
    return { base: await app.getUrl(), close: () => app.close() }
  } catch (error) {
    try {
      await app.close()
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Scheduler receiver fixture setup failed")
    }
    throw error
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
      taskRevision: 1,
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
  return `{"tenant_id":"tenant_fixture","task_id":"scheduled_fixture","task_revision":1,"owner_id":"owner_fixture","prompt":"go","auto_approve":false,"timezone":"UTC"${extra}}`
}

describe("Scheduler receiver admission", () => {
  it("rejects missing or malformed task revisions before claiming a receipt", async () => {
    let claims = 0
    const tasks = { findRecord: async () => null }
    const receipts = {
      claim: async () => {
        claims += 1
        return { outcome: "pending" }
      },
    }
    const bff = await startSchedulerReceiver(config(null), tasks, receipts)
    const base = bff.base
    try {
      const original = JSON.parse(dispatchBody()) as Record<string, unknown>
      for (const value of [undefined, null, "1", 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
        const body = { ...original, task_revision: value }
        const result = await fetch(`${base}/internal/bff/scheduled-tasks/dispatch`, {
          method: "POST",
          headers: dispatchHeaders(),
          body: JSON.stringify(body),
        })
        assert.equal(result.status, 400, `invalid revision ${String(value)}`)
      }
      assert.equal(claims, 0)
    } finally {
      await bff.close()
    }
  })

  it("rejects an old cadence revision without preparing or accepting a launch", async () => {
    let prepared = 0
    let accepted = 0
    let recovered: ReturnType<typeof dispatchSnapshot>["snapshot"] | null = null
    const tasks = {
      findRecord: async () => ({
        ownerId: "owner_fixture",
        task: { id: "scheduled_fixture", prompt: "go", autoApprove: false, timezone: "UTC", revision: 2, enabled: true, status: "active" },
      }),
    }
    const receipts = {
      claim: async () => ({ outcome: "claimed", claim: { ...dispatchSnapshot(60_000), snapshot: recovered } }),
      prepareSnapshot: async () => {
        prepared += 1
        return {}
      },
      complete: async () => true,
    }
    const scheduledAgentDispatch = {
      accept: async () => {
        accepted += 1
        return { outcome: "accepted" }
      },
    }
    const bff = await startSchedulerReceiver(config(null), tasks, receipts, scheduledAgentDispatch)
    const base = bff.base
    try {
      const result = await fetch(`${base}/internal/bff/scheduled-tasks/dispatch`, {
        method: "POST",
        headers: dispatchHeaders(),
        body: dispatchBody(),
      })
      assert.equal(result.status, 409)
      assert.equal(((await result.json()) as { error: { code: string } }).error.code, "invalid_scheduler_dispatch")
      assert.equal(prepared, 0)
      assert.equal(accepted, 0)
      recovered = { ...dispatchSnapshot(60_000).snapshot, taskRevision: 2 }
      const retry = await fetch(`${base}/internal/bff/scheduled-tasks/dispatch`, {
        method: "POST",
        headers: dispatchHeaders("recovered-key"),
        body: dispatchBody(),
      })
      assert.equal(retry.status, 409)
      assert.equal(prepared, 0)
      assert.equal(accepted, 0)
    } finally {
      await bff.close()
    }
  })

  it("returns 400 for raw 1e400 JSON without receipt or Agent I/O", async (t) => {
    let receiptClaims = 0
    let agentCalls = 0
    const agent = createServer((_request, response) => {
      agentCalls += 1
      response.end()
    })
    t.after(() => close(agent))
    const agentBase = await listen(agent)
    const tasks = { findRecord: async () => null }
    const receipts = {
      claim: async () => {
        receiptClaims += 1
        return { outcome: "pending" }
      },
    }
    const bff = await startSchedulerReceiver(config(agentBase), tasks, receipts)
    const base = bff.base
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
      await bff.close()
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
    const tasks = { findRecord: async () => null }
    const bff = await startSchedulerReceiver(config(null), tasks, receipts)
    const base = bff.base
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
      await bff.close()
    }
  })

  it("durably accepts without performing Agent I/O in the callback", async (t) => {
    let agentCalls = 0
    const agent = createServer((_request, response) => {
      agentCalls += 1
      setTimeout(() => {
        if (!response.destroyed) response.end(JSON.stringify({ data: { run_id: "run_fixture" } }))
      }, 1000)
    })
    t.after(() => close(agent))
    const agentBase = await listen(agent)
    const claim = dispatchSnapshot(5_150)
    const receipts = {
      claim: async () => ({ outcome: "claimed", claim }),
      releaseRetryable: async () => true,
      complete: async () => true,
    }
    const tasks = { findRecord: async () => null }
    const scheduledAgentDispatch = { accept: async () => ({ outcome: "accepted" }) }
    const bff = await startSchedulerReceiver(config(agentBase, 70_000), tasks, receipts, scheduledAgentDispatch)
    const base = bff.base
    try {
      const startedAt = Date.now()
      const result = await fetch(`${base}/internal/bff/scheduled-tasks/dispatch`, { method: "POST", headers: dispatchHeaders(), body: dispatchBody() })
      assert.equal(result.status, 202)
      assert.equal(result.headers.get("x-request-id"), "transport-request")
      assert.equal(agentCalls, 0)
      assert.ok(Date.now() - startedAt < 900)
    } finally {
      await bff.close()
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

  it("uses only the supplied canonical occurrence identity for Scheduler execution ids", () => {
    const common = { requestId: "request", sessionId: "scheduled:task", occurrenceIdentity: "a".repeat(64), content: "hello" }
    const left = buildScheduledAgentLaunch({ ...common, identity: { namespace: "tenant", userId: "actor-a" } })
    const right = buildScheduledAgentLaunch({ ...common, requestId: "other-request", identity: { namespace: "tenant", userId: "actor-b" } })
    assert.deepEqual(left.body.selected_skill_source_refs, [])
    assert.equal(left.receipt.run_id, right.receipt.run_id)
    assert.equal(left.identityAssertionRef, right.identityAssertionRef)
    assert.notEqual(left.body.request_id, right.body.request_id)
  })
})

describe("ScheduledTask HTTP method ownership", () => {
  it("admits shared ScheduledTask creates through the readable Project boundary and keeps actual actor, edit denial and original ACK", async () => {
    const project = { id: "project-shared" }
    const calls: Array<{ subjectId: string; actorId: string; projectId: string | undefined }> = []
    const receipts = new Map<string, { fingerprint: string; status: number; body: unknown }>()
    const bff = await startSchedulerReceiver({ ...config(null), iamWebOrigin: "https://web.example.test" }, {}, {}, undefined, [
      [
        SESSION_ADMISSION,
        new SessionAdmissionDouble(
          Object.fromEntries(
            ["creator", "editor", "viewer", "revoked", "foreign"].map((subject) => [subject, { namespace: "tenant_fixture", userId: subject }]),
          ),
        ),
      ],
      [PROJECT_LOOKUP, { find: async (scope: { subjectId: string }) => (scope.subjectId === "creator" ? project : null) }],
      [
        PROJECT_READ_LOOKUP,
        {
          find: async (scope: { subjectId: string }, id: string) =>
            id === project.id && ["creator", "editor", "viewer"].includes(scope.subjectId) ? project : null,
        },
      ],
      [
        SCHEDULED_TASK_IDEMPOTENCY,
        {
          claimReceipt: async (scope: string, fingerprint: string) => {
            const prior = receipts.get(scope)
            if (prior) return { claimed: false, receipt: prior }
            receipts.set(scope, { fingerprint, status: 102, body: {} })
            return { claimed: true, receipt: null }
          },
          putReceipt: async (scope: string, receipt: { fingerprint: string; status: number; body: unknown }) => {
            receipts.set(scope, receipt)
          },
        },
      ],
      [
        SCHEDULED_TASK_SERVICE,
        {
          create: async (scope: { subjectId: string }, input: { projectId?: string }, id: string, lineage: { actorId: string }) => {
            // The real repository owns the locked edit gate; readable viewer must reach its 403, not preflight 404.
            if (scope.subjectId === "viewer") throw new Error("SCHEDULED_TASK_EDIT_FORBIDDEN")
            calls.push({ subjectId: scope.subjectId, actorId: lineage.actorId, projectId: input.projectId })
            return { ...input, id, enabled: true, status: "active", revision: 1 }
          },
        },
      ],
    ])
    const body = { title: "Shared QA", prompt: "No dispatch", frequency: "daily", time: "08:00", timezone: "UTC" }
    const create = (subject: string, path: string, key: string, input: object) =>
      fetch(bff.base + path, {
        method: "POST",
        headers: {
          "x-kokoro-service": "web-bff",
          "x-kokoro-internal-secret": "web-secret",
          cookie: `kokoro-issuer.session_token=${subject}`,
          origin: "https://web.example.test",
          "content-type": "application/json",
          "idempotency-key": key,
        },
        body: JSON.stringify(input),
      })
    try {
      for (const [path, input] of [
        [`/v1/projects/${project.id}/scheduled-tasks`, body],
        ["/v1/scheduled-tasks", { ...body, project_id: project.id }],
      ] as const) {
        const key = `create-${path}`
        for (const subject of ["creator", "editor"]) {
          const response = await create(subject, path, key, input)
          assert.equal(response.status, 200, `${subject} ${path}`)
          const ack = await response.json()
          const count = calls.length
          const replay = await create(subject, path, key, input)
          assert.equal(replay.status, 200)
          assert.deepEqual(await replay.json(), ack)
          assert.equal(calls.length, count)
          assert.deepEqual(calls.at(-1), { subjectId: subject, actorId: subject, projectId: project.id })
        }
        for (const [subject, status, code] of [
          ["viewer", 403, "scheduled_task_edit_forbidden"],
          ["revoked", 404, "project_not_found"],
          ["foreign", 404, "project_not_found"],
        ] as const) {
          const count = calls.length
          const response = await create(subject, path, key, input)
          assert.equal(response.status, status)
          assert.equal((await response.json()).error.code, code)
          assert.equal(calls.length, count)
        }
      }
      assert.equal(calls.length, 4)
    } finally {
      await bff.close()
    }
  })

  it("completes a 404 receipt only for the exact Project-not-found owner error and releases unknown failures", async () => {
    const context = { requestId: "mutation-error", identity: { namespace: "tenant_fixture", userId: "owner" } }
    const idempotency = new Map()
    let ownerError: unknown
    let receiptScope = ""
    const server = createServer((request, response) => {
      void mutationTicket("original-key", "PATCH", "/scheduled-tasks/task-1", context, "original-fingerprint", idempotency).then(async (claim) => {
        assert.ok(claim.ticket)
        receiptScope = claim.ticket.scope
        await handleScheduledTaskMutationBusiness(
          request,
          response,
          context,
          {
            update: async () => {
              throw ownerError
            },
          } as never,
          {} as never,
          { status: "active", enabled: true },
          claim.ticket,
          idempotency,
        )
      })
    })
    const base = await listen(server)
    try {
      for (const [error, status, code, message] of [
        [new Error("PROJECT_NOT_FOUND"), 404, "project_not_found", "Project was not found"],
        [new Error("database-secret-canary"), 503, "business_store_unavailable", "The BFF business store is unavailable"],
        ["PROJECT_NOT_FOUND", 503, "business_store_unavailable", "The BFF business store is unavailable"],
      ] as const) {
        ownerError = error
        idempotency.clear()
        const response = await fetch(base + "/v1/scheduled-tasks/task-1", {
          method: "PATCH",
          headers: { "idempotency-key": "original-key", "if-match": '"1"' },
        })
        assert.equal(response.status, status)
        assert.equal(response.headers.get("x-request-id"), context.requestId)
        assert.equal(response.headers.get("cache-control"), "no-store")
        const body = await response.json()
        assert.deepEqual(body, { error: { code, message }, meta: { request_id: context.requestId } })
        if (status === 404) assert.deepEqual([...idempotency.entries()], [[receiptScope, { fingerprint: "original-fingerprint", receipt: { status, body } }]])
        else assert.equal(idempotency.size, 0)
      }
    } finally {
      await close(server)
    }
  })

  it("matches collection create without treating item POST as create and preserves existing mutation targets", async () => {
    const server = createServer((request, response) => {
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(scheduledTaskMutation(request)))
    })
    const base = await listen(server)
    try {
      for (const [method, path, expected] of [
        ["POST", "/v1/scheduled-tasks", { kind: "create" }],
        ["POST", "/v1/scheduled-tasks/task-1", null],
        ["POST", "/v1/projects/project-1/scheduled-tasks", { kind: "project_create", projectId: "project-1" }],
        ["POST", "/v1/scheduled-tasks/task-1/retry", { kind: "retry", taskId: "task-1" }],
        ["PATCH", "/v1/scheduled-tasks/task-1", { kind: "patch", taskId: "task-1" }],
        ["DELETE", "/v1/scheduled-tasks/task-1", { kind: "delete", taskId: "task-1" }],
      ] as const) {
        const response = await fetch(base + path, { method })
        assert.equal(response.status, 200)
        assert.deepEqual(await response.json(), expected, `${method} ${path}`)
      }
    } finally {
      await close(server)
    }
  })

  it("current-state GET never intercepts non-GET methods or authenticates their requests", async () => {
    const admission = new SessionAdmissionDouble({ session: { namespace: "tenant_fixture", userId: "owner" } })
    let reads = 0
    const reader = {
      read: async (_scope: unknown, _requestId: string, _signal: AbortSignal, options: { revalidate(): Promise<void> }) => {
        reads++
        await options.revalidate()
        return []
      },
    }
    const server = createServer((request, response) => {
      void handleScheduledTaskReadRequest(
        request,
        response,
        { ...config(null, 1000), iamWebOrigin: "https://web.example.test" },
        admission,
        reader as never,
      ).then((handled) => {
        if (!handled) response.writeHead(404).end()
      })
    })
    const base = await listen(server)
    const native = {
      "x-kokoro-service": "web-bff",
      "x-kokoro-internal-secret": "web-secret",
      cookie: "kokoro-issuer.session_token=session",
      origin: "https://web.example.test",
    }
    try {
      for (const method of ["POST", "PATCH", "DELETE", "PUT"]) {
        const response = await fetch(`${base}/v1/scheduled-tasks`, { method, headers: native })
        assert.equal(response.status, 404, method)
        await response.arrayBuffer()
        assert.equal(reads, 0)
        assert.equal(admission.calls.length, 0)
      }
      const response = await fetch(`${base}/v1/scheduled-tasks`, { headers: native })
      assert.equal(response.status, 200)
      assert.deepEqual((await response.json()).data, { tasks: [] })
      assert.equal(reads, 1)
      assert.equal(admission.calls.length, 2)
    } finally {
      await close(server)
    }
  })
})
