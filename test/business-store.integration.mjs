import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { createServer } from "node:http"
import { test } from "node:test"

import { Pool } from "pg"
import { createClient } from "redis"

import { createBffServer } from "../dist/main.js"
import { SessionAdmissionDouble } from "./doubles/session-admission.ts"

const postgresUrl = process.env.KOKORO_TEST_POSTGRES_URL
const redisUrl = process.env.KOKORO_TEST_REDIS_URL
const servers = []
const sessionAdmission = new SessionAdmissionDouble()

async function listen(server) {
  servers.push(server)
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("server did not bind")
  return `http://127.0.0.1:${address.port}`
}

async function close(server) {
  await new Promise((resolve) => server.close(() => resolve()))
  await new Promise((resolve) => setTimeout(resolve, 30))
}

async function waitFor(predicate, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error("timed out waiting for integration condition")
}

function auth(namespace, principal = "user_integration") {
  const token = `session-${namespace}-${principal}`
  sessionAdmission.allow(token, { namespace, userId: principal })
  return {
    "x-kokoro-service": "web-bff",
    "x-kokoro-internal-secret": "web-secret",
    authorization: `Bearer ${token}`,
  }
}

async function assertTenantForbidden(response) {
  assert.equal(response.status, 403)
  assert.equal((await response.json()).error.code, "product_tenant_forbidden")
}

function bffConfig(overrides = {}) {
  return {
    host: "127.0.0.1",
    port: 4300,
    mode: "live",
    domain: "dev.kokoro.localhost",
    tenantId: overrides.tenantId ?? "tenant_test",
    iamBaseUrl: null,
    sharedSecret: "web-secret",
    upstreamSecret: "bff-secret",
    upstreamTimeoutMs: 5000,
    upstreamMaxResponseBytes: 1024 * 1024,
    agentEnabled: overrides.agentEnabled ?? false,
    schedulerServiceToken: "scheduler-secret",
    schedulerTargetUrl: overrides.schedulerTargetUrl,
    postgresUrl,
    redisUrl,
    agUi: {
      replayPageFrames: 128,
      replayPageBytes: 1024 * 1024,
      streamMaxFrames: 10_000,
      streamMaxBytes: 16 * 1024 * 1024,
      streamMaxDurationMs: 5 * 60 * 1000,
      maxConnectionsGlobal: 256,
      maxConnectionsPerTenant: 64,
      maxConnectionsPerSession: 8,
      ledgerPollBaseDelayMs: 1000,
      ledgerPollMaxDelayMs: 8000,
      ledgerPollJitterPercent: 20,
      replayCacheTtlMs: 25,
      projectorMaxConsumersPerCycle: 32,
      projectorSourcePageSize: 256,
      projectorMaxPagesPerConsumer: 8,
      projectorSourceMaxAttempts: 3,
      projectorLeaseDurationMs: 15_000,
      projectorLeaseSettlementReserveMs: 500,
      projectorPollIntervalMs: 1000,
      projectorErrorBackoffMs: 5000,
      projectorErrorBackoffMaxMs: 5 * 60 * 1000,
      projectorErrorBackoffJitterPercent: 20,
      retentionMs: 7 * 24 * 60 * 60 * 1000,
      gcIntervalMs: 15 * 60 * 1000,
      gcBatchSize: 100,
      cursorTombstoneRetentionMs: 30 * 24 * 60 * 60 * 1000,
    },
    upstreams: {
      system: null,
      model: null,
      capability: null,
      storage: null,
      scheduler: overrides.schedulerBase,
      agents: overrides.agentBase ?? null,
      billing: null,
    },
  }
}

const integrationTest = postgresUrl && redisUrl ? test : test.skip

integrationTest("keeps Project and ScheduledTask facts private to the trusted subject", async () => {
  const pool = new Pool({ connectionString: postgresUrl, options: "-c search_path=kokoro_bff -c timezone=UTC" })
  const redis = createClient({ url: redisUrl })
  const tenant = `privacy_${Date.now()}`
  const crossTenant = `${tenant}_cross`
  const ownerA = "privacy_owner_a"
  const ownerB = "privacy_owner_b"
  let bff
  try {
    await pool.query(
      "DROP TABLE IF EXISTS bff_scheduled_agent_source_event, bff_scheduled_agent_dispatch, bff_scheduled_agent_scope, bff_agui_cursor_tombstone, bff_agui_event, bff_agui_source_event, bff_conversation_artifact, bff_agui_stream, bff_agent_cancellation_outbox, bff_agent_dispatch_outbox, bff_share, bff_message, bff_conversation, bff_scheduled_task_outbox, bff_scheduled_task, bff_project_task, bff_idempotency_receipt, bff_project_instruction_revision, bff_project_skill, bff_project CASCADE",
    )
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    await redis.connect()
    bff = createBffServer(bffConfig({ tenantId: tenant }), { sessionAdmission })
    const base = await listen(bff)

    const createProject = async (owner, key) =>
      fetch(`${base}/v1/projects`, {
        method: "POST",
        headers: { ...auth(tenant, owner), "content-type": "application/json", "idempotency-key": key },
        body: JSON.stringify({ name: "Private plan", description: owner }),
      })
    const projectAResponse = await createProject(ownerA, "project-a")
    assert.equal(projectAResponse.status, 200)
    const projectA = (await projectAResponse.json()).data.project

    const ownerBProjects = await fetch(`${base}/v1/projects`, { headers: auth(tenant, ownerB) })
    assert.deepEqual((await ownerBProjects.json()).data.projects, [])
    const crossTenantProjects = await fetch(`${base}/v1/projects`, { headers: auth(crossTenant, ownerA) })
    await assertTenantForbidden(crossTenantProjects)

    const projectBResponse = await createProject(ownerB, "project-b")
    assert.equal(projectBResponse.status, 200)
    const projectB = (await projectBResponse.json()).data.project
    assert.equal(projectB.slug, projectA.slug)
    assert.notEqual(projectB.id, projectA.id)

    const beforeDeniedProject = await pool.query("SELECT instruction FROM bff_project WHERE project_id = $1", [projectA.id])
    const beforeDeniedProjectReceipts = await pool.query("SELECT count(*)::int AS count FROM bff_idempotency_receipt")
    const deniedProjectDetail = await fetch(`${base}/v1/projects/${projectA.id}`, { headers: auth(tenant, ownerB) })
    assert.equal(deniedProjectDetail.status, 404)
    const deniedProjectPatch = await fetch(`${base}/v1/projects/${projectA.id}`, {
      method: "PATCH",
      headers: { ...auth(tenant, ownerB), "content-type": "application/json", "idempotency-key": "denied-project-patch" },
      body: JSON.stringify({ instruction: "steal" }),
    })
    assert.equal(deniedProjectPatch.status, 404)
    await assertTenantForbidden(await fetch(`${base}/v1/projects/${projectA.id}`, { headers: auth(crossTenant, ownerA) }))
    const crossTenantProjectPatch = await fetch(`${base}/v1/projects/${projectA.id}`, {
      method: "PATCH",
      headers: { ...auth(crossTenant, ownerA), "content-type": "application/json", "idempotency-key": "cross-tenant-project-patch" },
      body: JSON.stringify({ instruction: "steal across tenant" }),
    })
    await assertTenantForbidden(crossTenantProjectPatch)
    const afterDeniedProject = await pool.query("SELECT instruction FROM bff_project WHERE project_id = $1", [projectA.id])
    const afterDeniedProjectReceipts = await pool.query("SELECT count(*)::int AS count FROM bff_idempotency_receipt")
    assert.equal(afterDeniedProject.rows[0].instruction, beforeDeniedProject.rows[0].instruction)
    assert.equal(afterDeniedProjectReceipts.rows[0].count, beforeDeniedProjectReceipts.rows[0].count)

    const scheduledPayload = (projectId) => ({
      project_id: projectId,
      title: "Private schedule",
      prompt: "Review privately.",
      frequency: "daily",
      time: "08:00",
      timezone: "UTC",
      next_run_at: "2026-09-01T08:00:00.000Z",
      auto_approve: false,
    })
    const createScheduled = async (owner, projectId) =>
      fetch(`${base}/v1/scheduled-tasks`, {
        method: "POST",
        headers: { ...auth(tenant, owner), "content-type": "application/json", "idempotency-key": "same-scheduled-key" },
        body: JSON.stringify(scheduledPayload(projectId)),
      })
    const taskAResponse = await createScheduled(ownerA, projectA.id)
    const taskBResponse = await createScheduled(ownerB, projectB.id)
    assert.equal(taskAResponse.status, 200)
    assert.equal(taskBResponse.status, 200)
    const taskA = (await taskAResponse.json()).data.task
    const taskB = (await taskBResponse.json()).data.task
    assert.notEqual(taskA.id, taskB.id)

    const slugTaskResponse = await fetch(`${base}/v1/scheduled-tasks`, {
      method: "POST",
      headers: { ...auth(tenant, ownerA), "content-type": "application/json", "idempotency-key": "scheduled-by-owned-slug" },
      body: JSON.stringify(scheduledPayload(projectA.slug)),
    })
    assert.equal(slugTaskResponse.status, 200)
    const slugTask = (await slugTaskResponse.json()).data.task
    const storedSlugTask = await pool.query("SELECT project_id FROM bff_scheduled_task WHERE task_id = $1", [slugTask.id])
    assert.equal(storedSlugTask.rows[0].project_id, projectA.id)

    const ownerBTasks = await fetch(`${base}/v1/scheduled-tasks`, { headers: auth(tenant, ownerB) })
    assert.deepEqual(
      (await ownerBTasks.json()).data.tasks.map((task) => task.id),
      [taskB.id],
    )
    const crossTenantTasks = await fetch(`${base}/v1/scheduled-tasks`, { headers: auth(crossTenant, ownerA) })
    await assertTenantForbidden(crossTenantTasks)

    const beforeDeniedTask = await pool.query("SELECT prompt FROM bff_scheduled_task WHERE task_id = $1", [taskA.id])
    const beforeDeniedOutbox = await pool.query("SELECT count(*)::int AS count FROM bff_scheduled_task_outbox")
    const beforeDeniedTaskReceipts = await pool.query("SELECT count(*)::int AS count FROM bff_idempotency_receipt")
    const deniedTaskDetail = await fetch(`${base}/v1/scheduled-tasks/${taskA.id}`, { headers: auth(tenant, ownerB) })
    assert.equal(deniedTaskDetail.status, 404)
    await assertTenantForbidden(await fetch(`${base}/v1/scheduled-tasks/${taskA.id}`, { headers: auth(crossTenant, ownerA) }))
    for (const [operation, method, body] of [
      ["patch", "PATCH", { prompt: "steal" }],
      ["retry", "POST", undefined],
      ["delete", "DELETE", undefined],
    ]) {
      const suffix = operation === "retry" ? "/retry" : ""
      const denied = await fetch(`${base}/v1/scheduled-tasks/${taskA.id}${suffix}`, {
        method,
        headers: { ...auth(tenant, ownerB), "content-type": "application/json", "idempotency-key": `denied-task-${operation}` },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      assert.equal(denied.status, 404)
    }
    const crossTenantTaskPatch = await fetch(`${base}/v1/scheduled-tasks/${taskA.id}`, {
      method: "PATCH",
      headers: { ...auth(crossTenant, ownerA), "content-type": "application/json", "idempotency-key": "cross-tenant-task-patch" },
      body: JSON.stringify({ prompt: "steal across tenant" }),
    })
    await assertTenantForbidden(crossTenantTaskPatch)
    const afterDeniedTask = await pool.query("SELECT prompt FROM bff_scheduled_task WHERE task_id = $1", [taskA.id])
    const afterDeniedOutbox = await pool.query("SELECT count(*)::int AS count FROM bff_scheduled_task_outbox")
    const afterDeniedTaskReceipts = await pool.query("SELECT count(*)::int AS count FROM bff_idempotency_receipt")
    assert.equal(afterDeniedTask.rows[0].prompt, beforeDeniedTask.rows[0].prompt)
    assert.equal(afterDeniedOutbox.rows[0].count, beforeDeniedOutbox.rows[0].count)
    assert.equal(afterDeniedTaskReceipts.rows[0].count, beforeDeniedTaskReceipts.rows[0].count)
  } finally {
    if (bff) await close(bff)
    await redis.quit().catch(() => undefined)
    await pool.end()
  }
})

integrationTest("persists BFF facts, registers Scheduler, and replays Agent dispatch across restart", async () => {
  const schemaPool = new Pool({ connectionString: postgresUrl, options: "-c search_path=kokoro_bff -c timezone=UTC" })
  const redis = createClient({ url: redisUrl })
  const namespace = `integration_${Date.now()}`
  const schedulerCalls = []
  const agentCalls = []
  let schedulerBase
  let agentBase
  let bff
  try {
    await schemaPool.query(
      "DROP TABLE IF EXISTS bff_scheduled_agent_source_event, bff_scheduled_agent_dispatch, bff_scheduled_agent_scope, bff_agui_cursor_tombstone, bff_agui_event, bff_agui_source_event, bff_conversation_artifact, bff_agui_stream, bff_agent_cancellation_outbox, bff_agent_dispatch_outbox, bff_share, bff_message, bff_conversation, bff_scheduled_task_outbox, bff_scheduled_task, bff_project_task, bff_idempotency_receipt, bff_project_instruction_revision, bff_project_skill, bff_project CASCADE",
    )
    await schemaPool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    await redis.connect()

    const scheduler = createServer((request, response) => {
      const chunks = []
      request.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
      request.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8")
        schedulerCalls.push({
          method: request.method,
          url: request.url,
          authorization: request.headers.authorization,
          service: request.headers["x-kokoro-service"],
          requestId: request.headers["x-request-id"],
          schedule: raw ? JSON.parse(raw) : null,
        })
        response.setHeader("content-type", "application/json")
        response.end(
          JSON.stringify({ data: { name: request.url?.split("/").at(-1), status: "registered" }, meta: { request_id: request.headers["x-request-id"] } }),
        )
      })
    })
    schedulerBase = await listen(scheduler)

    const agent = createServer((request, response) => {
      if (request.method === "GET" && request.url?.startsWith("/v1/sessions/")) {
        const after = Number(new URL(request.url, "http://agent.test").searchParams.get("after_seq") ?? "0")
        response.setHeader("content-type", "application/json")
        response.end(
          JSON.stringify({
            data: { events: [], next_seq: after, watermark: after },
            meta: { request_id: request.headers["x-request-id"] ?? "scheduled-source" },
          }),
        )
        return
      }
      const chunks = []
      request.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
      request.on("end", () => {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"))
        agentCalls.push({
          body,
          authorization: request.headers.authorization,
          service: request.headers["x-kokoro-service"],
          tenant: request.headers["x-kokoro-tenant-ref"],
          subject: request.headers["x-kokoro-subject-ref"],
          assertion: request.headers["x-kokoro-identity-assertion-ref"],
        })
        response.setHeader("content-type", "application/json")
        response.end(JSON.stringify({ data: { run_id: body.run_id }, meta: { request_id: request.headers["x-kokoro-request-id"] } }))
      })
    })
    agentBase = await listen(agent)

    const targetUrl = "http://kokoro-bff:4300/internal/bff/scheduled-tasks/dispatch"
    bff = createBffServer(bffConfig({ tenantId: namespace, schedulerBase, agentBase, agentEnabled: true, schedulerTargetUrl: targetUrl }), { sessionAdmission })
    const base = await listen(bff)

    const createHeaders = { ...auth(namespace), "content-type": "application/json", "idempotency-key": "schedule-create-integration" }
    const createPayload = {
      title: "Daily review",
      prompt: "Review the project.",
      frequency: "daily",
      time: "08:00",
      timezone: "UTC",
      next_run_at: "2026-09-01T08:00:00.000Z",
      auto_approve: true,
    }
    const created = await fetch(`${base}/v1/scheduled-tasks`, { method: "POST", headers: createHeaders, body: JSON.stringify(createPayload) })
    assert.equal(created.status, 200)
    const createdBody = await created.json()
    const taskId = createdBody.data.task.id
    assert.match(taskId, /^scheduled_[0-9a-f]{32}$/)
    await waitFor(() => schedulerCalls.length === 1)
    assert.equal(schedulerCalls[0].method, "POST")
    assert.equal(schedulerCalls[0].authorization, "Bearer scheduler-secret")
    assert.equal(schedulerCalls[0].service, "web-bff")
    assert.equal(schedulerCalls[0].schedule.url, targetUrl)
    assert.equal(schedulerCalls[0].schedule.body.owner_id, "user_integration")

    const otherTenant = await fetch(`${base}/v1/scheduled-tasks`, { headers: auth(`${namespace}_other`) })
    await assertTenantForbidden(otherTenant)

    const patched = await fetch(`${base}/v1/scheduled-tasks/${taskId}`, {
      method: "PATCH",
      headers: { ...auth(namespace), "content-type": "application/json", "idempotency-key": "schedule-patch-integration" },
      body: JSON.stringify({ prompt: "Review the project and report blockers." }),
    })
    assert.equal(patched.status, 200)
    const patchedTask = (await patched.json()).data.task
    assert.equal(patchedTask.prompt, "Review the project and report blockers.")
    await waitFor(() => schedulerCalls.length === 2)
    assert.equal(schedulerCalls.at(-1).method, "PUT")

    const dispatchBody = schedulerCalls.at(-1).schedule.body
    const dispatchHeaders = {
      authorization: "Bearer scheduler-secret",
      "content-type": "application/json",
      "x-kokoro-tenant-id": namespace,
      "x-kokoro-scheduler-schedule": schedulerCalls.at(-1).url.split("/").at(-1),
      "x-kokoro-scheduler-occurrence": "2026-09-01T12:00:00.123456789Z",
      "x-request-id": "sched_integration_delivery_1",
      "idempotency-key": " opaque-scheduler-key ",
      traceparent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01",
    }
    const mismatchedOccurrence = await fetch(`${base}/internal/bff/scheduled-tasks/dispatch`, {
      method: "POST",
      headers: { ...dispatchHeaders, "x-kokoro-tenant-id": `${namespace}_mismatch` },
      body: JSON.stringify(dispatchBody),
    })
    assert.equal(mismatchedOccurrence.status, 400)
    const dispatched = await fetch(`${base}/internal/bff/scheduled-tasks/dispatch`, {
      method: "POST",
      headers: dispatchHeaders,
      body: JSON.stringify(dispatchBody),
    })
    assert.equal(dispatched.status, 202)
    assert.equal(agentCalls.length, 0)
    await waitFor(() => agentCalls.length === 1)
    assert.equal(agentCalls[0].authorization, "Bearer bff-secret")
    assert.equal(agentCalls[0].service, "kokoro-bff")
    assert.equal(agentCalls[0].tenant, namespace)
    assert.equal(agentCalls[0].subject, "user_integration")
    assert.match(agentCalls[0].assertion, /^bff:[0-9a-f]{64}$/)
    assert.equal(agentCalls[0].body.execution_identity, undefined)
    const replayedDispatch = await fetch(`${base}/internal/bff/scheduled-tasks/dispatch`, {
      method: "POST",
      headers: dispatchHeaders,
      body: JSON.stringify(dispatchBody),
    })
    assert.equal(replayedDispatch.status, 202)
    assert.equal(agentCalls.length, 1)

    const paused = await fetch(`${base}/v1/scheduled-tasks/${taskId}`, {
      method: "PATCH",
      headers: { ...auth(namespace), "content-type": "application/json", "idempotency-key": "schedule-pause-integration" },
      body: JSON.stringify({ status: "paused", enabled: false }),
    })
    assert.equal(paused.status, 200)
    await waitFor(() => schedulerCalls.length === 3)
    const pausedDispatch = await fetch(`${base}/internal/bff/scheduled-tasks/dispatch`, {
      method: "POST",
      headers: {
        ...dispatchHeaders,
        "x-kokoro-scheduler-occurrence": "2026-09-01T12:00:01.000000000Z",
        "x-request-id": "sched_integration_delivery_paused",
        "idempotency-key": "paused-scheduler-key",
      },
      body: JSON.stringify(dispatchBody),
    })
    assert.equal(pausedDispatch.status, 409)
    assert.equal((await pausedDispatch.json()).error.code, "scheduled_task_not_active")
    assert.equal(agentCalls.length, 1)

    const reactivated = await fetch(`${base}/v1/scheduled-tasks/${taskId}`, {
      method: "PATCH",
      headers: { ...auth(namespace), "content-type": "application/json", "idempotency-key": "schedule-reactivate-integration" },
      body: JSON.stringify({ status: "active", enabled: true }),
    })
    assert.equal(reactivated.status, 200)
    await waitFor(() => schedulerCalls.length === 4)

    await waitFor(async () => {
      const settled = await schemaPool.query(
        `SELECT status
           FROM bff_scheduled_task_outbox
          WHERE tenant_id = $1
          ORDER BY created_at ASC, outbox_id ASC`,
        [namespace],
      )
      return settled.rows.length === 4 && settled.rows.every((row) => row.status === "succeeded")
    })
    const outboxLineage = await schemaPool.query(
      `SELECT command_type, tenant_id, actor_id, request_id, idempotency_key, status, fence
         FROM bff_scheduled_task_outbox
        WHERE tenant_id = $1
        ORDER BY created_at ASC, outbox_id ASC`,
      [namespace],
    )
    assert.deepEqual(
      outboxLineage.rows.map((row) => [row.command_type, row.tenant_id, row.actor_id, row.status]),
      [
        ["scheduler.register", namespace, "user_integration", "succeeded"],
        ["scheduler.replace", namespace, "user_integration", "succeeded"],
        ["scheduler.replace", namespace, "user_integration", "succeeded"],
        ["scheduler.replace", namespace, "user_integration", "succeeded"],
      ],
    )
    assert.ok(outboxLineage.rows.every((row) => Number(row.fence) >= 1))

    await close(bff)
    bff = createBffServer(bffConfig({ tenantId: namespace, schedulerBase, agentBase, agentEnabled: true, schedulerTargetUrl: targetUrl }), { sessionAdmission })
    const restartedBase = await listen(bff)
    await new Promise((resolve) => setTimeout(resolve, 100))
    const listed = await fetch(`${restartedBase}/v1/scheduled-tasks`, { headers: auth(namespace) })
    assert.deepEqual(
      (await listed.json()).data.tasks.map((task) => task.id),
      [taskId],
    )
    const replayedCreate = await fetch(`${restartedBase}/v1/scheduled-tasks`, { method: "POST", headers: createHeaders, body: JSON.stringify(createPayload) })
    assert.equal(replayedCreate.status, 200)
    assert.deepEqual((await replayedCreate.json()).data.task, createdBody.data.task)
    assert.equal(schedulerCalls.length, 4)

    const deleted = await fetch(`${restartedBase}/v1/scheduled-tasks/${taskId}`, {
      method: "DELETE",
      headers: { ...auth(namespace), "idempotency-key": "schedule-delete-integration" },
    })
    assert.equal(deleted.status, 200)
    await waitFor(() => schedulerCalls.length === 5)
    assert.equal(schedulerCalls.at(-1).method, "DELETE")
    const afterDelete = await fetch(`${restartedBase}/v1/scheduled-tasks`, { headers: auth(namespace) })
    assert.deepEqual((await afterDelete.json()).data.tasks, [])
  } finally {
    if (bff) await close(bff)
    for (const server of servers.splice(0)) {
      if (!server.listening) continue
      await close(server)
    }
    await redis.quit().catch(() => undefined)
    await schemaPool.end()
  }
})

// R73 uses the real HTTP router, business services, PostgreSQL repositories and durable receipts.
// Root must install the canonical schema in its owned fixture before selecting these tests.
// No schema installer, global DROP/TRUNCATE, Redis reset or mock HTTP response is used here.
function r73CreatePayload(extra = {}) {
  return {
    title: "R73 independent review",
    prompt: "Review the next steps.",
    frequency: "daily",
    time: "08:00",
    timezone: "UTC",
    next_run_at: "2026-10-03T08:00:00.000Z",
    auto_approve: false,
    ...extra,
  }
}

async function r73CreateFixture(t) {
  const { randomUUID } = await import("node:crypto")
  const suffix = randomUUID().replaceAll("-", "")
  const tenant = `r73_${suffix}`
  const otherTenant = `${tenant}_other`
  const owner = `owner_${suffix}`
  const otherOwner = `other_${suffix}`
  const pool = new Pool({ connectionString: postgresUrl, options: "-c search_path=kokoro_bff -c timezone=UTC" })
  const instances = []
  t.after(async () => {
    try {
      for (const server of instances) await server.shutdown()
    } finally {
      await pool.end()
    }
  })
  const start = async (tenantId) => {
    const server = createBffServer(bffConfig({ tenantId }), {
      sessionAdmission,
      // Admission/atomic-create tests intentionally leave real outbox rows pending.
      // Only delivery scheduling is disabled; persistence and HTTP responses remain production code.
      scheduledTaskDispatcher: { start() {}, async stop() {} },
    })
    instances.push(server)
    const base = await listen(server)
    const readiness = await fetch(`${base}/readyz`, { signal: AbortSignal.timeout(5000) })
    await readiness.arrayBuffer()
    assert.equal(readiness.status, 200, "Root-owned canonical PostgreSQL/Redis fixture must be ready before business assertions")
    return { server, base }
  }
  const fixture = { suffix, tenant, otherTenant, owner, otherOwner, pool, start, ...(await start(tenant)) }
  fixture.restart = async () => {
    await fixture.server.shutdown()
    Object.assign(fixture, await start(tenant))
  }
  fixture.project = async (name, subject = owner, tenantId = tenant, base = fixture.base) => {
    const response = await fetch(`${base}/v1/projects`, {
      method: "POST",
      headers: { ...auth(tenantId, subject), "content-type": "application/json", "idempotency-key": `project-${name}-${suffix}` },
      body: JSON.stringify({ name, description: "R73 owned Project fixture" }),
      signal: AbortSignal.timeout(5000),
    })
    const body = await response.json()
    assert.equal(response.status, 200, "legal Project creation must succeed before the ScheduledTask assertion")
    return body.data.project
  }
  fixture.create = async (key, payload, { query = "", subject = owner, tenantId = tenant, base = fixture.base } = {}) => {
    const response = await fetch(`${base}/v1/scheduled-tasks${query}`, {
      method: "POST",
      headers: {
        ...auth(tenantId, subject),
        "content-type": "application/json",
        "idempotency-key": key,
        "x-kokoro-request-id": `r73-${key}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    })
    return { status: response.status, body: await response.json() }
  }
  fixture.snapshot = async () => {
    const tenants = [tenant, otherTenant]
    const [tasks, outbox, receipts] = await Promise.all([
      pool.query("SELECT to_jsonb(t) AS record FROM bff_scheduled_task AS t WHERE tenant_id = ANY($1::text[]) ORDER BY task_id", [tenants]),
      pool.query("SELECT to_jsonb(o) AS record FROM bff_scheduled_task_outbox AS o WHERE tenant_id = ANY($1::text[]) ORDER BY outbox_id", [tenants]),
      pool.query(
        "SELECT to_jsonb(r) AS record FROM bff_idempotency_receipt AS r WHERE starts_with(scope, $1) OR starts_with(scope, $2) ORDER BY scope",
        tenants.map((value) => `${JSON.stringify([value]).slice(0, -1)},`),
      ),
    ])
    return {
      tasks: tasks.rows.map((row) => row.record),
      outbox: outbox.rows.map((row) => row.record),
      receipts: receipts.rows.map((row) => row.record),
    }
  }
  return fixture
}

async function r73AssertCreated(fixture, result, key, projectId, { tenantId = fixture.tenant, subject = fixture.owner } = {}) {
  assert.equal(result.status, 200)
  const task = result.body.data.task
  assert.equal(task.enabled, true)
  assert.equal(task.status, "active")
  assert.equal(Object.hasOwn(task, "conversation_id"), false)
  assert.equal(Object.hasOwn(task, "session_id"), false)
  const state = await fixture.snapshot()
  const rows = state.tasks.filter((row) => row.task_id === task.id)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].tenant_id, tenantId)
  assert.equal(rows[0].owner_id, subject)
  assert.equal(rows[0].project_id, projectId)
  assert.equal(rows[0].enabled, true)
  assert.equal(rows[0].status, "active")
  const commands = state.outbox.filter((row) => row.task_id === task.id)
  assert.equal(commands.length, 1)
  assert.equal(commands[0].tenant_id, tenantId)
  assert.equal(commands[0].actor_id, subject)
  assert.equal(commands[0].command_type, "scheduler.register")
  assert.equal(commands[0].idempotency_key, key)
  assert.equal(commands[0].status, "pending")
  const receipts = state.receipts.filter((row) => row.scope === JSON.stringify([tenantId, subject, "POST", "/scheduled-tasks", key]))
  assert.equal(receipts.length, 1)
  assert.equal(receipts[0].status, 200)
  assert.deepEqual(receipts[0].response_body, result.body)
  return task.id
}

integrationTest("R73 create HTTP rejects closed-input violations with no task, outbox or receipt writes", async (t) => {
  const fixture = await r73CreateFixture(t)
  const project = await fixture.project("R73 visible project")
  await t.test("legal independent control", async () => {
    const result = await fixture.create("control-independent", r73CreatePayload())
    await r73AssertCreated(fixture, result, "control-independent", null)
  })
  for (const [label, reference] of [
    ["id", project.id],
    ["slug", project.slug],
  ]) {
    await t.test(`legal associated ${label} control stores canonical Project identity`, async () => {
      const key = `control-project-${label}`
      const result = await fixture.create(key, r73CreatePayload({ project_id: reference }))
      await r73AssertCreated(fixture, result, key, project.id)
    })
  }
  const invalidBodies = [
    ["project-null", { project_id: null }],
    ["project-number", { project_id: 42 }],
    ["project-boolean", { project_id: false }],
    ["project-array", { project_id: [] }],
    ["project-object", { project_id: {} }],
    ["project-empty", { project_id: "" }],
    ["project-spaces", { project_id: "   " }],
    ["project-tabs", { project_id: "\t" }],
    ["project-leading-space", { project_id: ` ${project.id}` }],
    ["project-trailing-space", { project_id: `${project.id} ` }],
    ["project-leading-newline", { project_id: `\n${project.id}` }],
    ["project-trailing-newline", { project_id: `${project.id}\n` }],
    ["project-leading-nbsp", { project_id: `\u00a0${project.id}` }],
    ["project-trailing-bom", { project_id: `${project.id}\ufeff` }],
    ["unknown-field", { unexpected: true }],
    ["body-tenant", { tenant_id: fixture.otherTenant }],
    ["body-owner", { owner_id: fixture.otherOwner }],
    ["body-conversation", { conversation_id: "not-a-parent" }],
    ["body-session", { session_id: "not-a-parent" }],
    ["auto-null", { auto_approve: null }],
    ["auto-number", { auto_approve: 0 }],
    ["auto-string", { auto_approve: "false" }],
    ["auto-array", { auto_approve: [] }],
    ["auto-object", { auto_approve: {} }],
    ["enabled-false", { enabled: false }],
    ["enabled-true", { enabled: true }],
    ["status-active", { status: "active" }],
    ["status-paused", { status: "paused" }],
    ["status-failed", { status: "failed" }],
  ]
  for (const [label, extra] of invalidBodies) {
    await t.test(`400 ${label} before any durable mutation`, async () => {
      const before = await fixture.snapshot()
      const result = await fixture.create(`invalid-${label}`, r73CreatePayload(extra))
      const after = await fixture.snapshot()
      assert.deepEqual({ status: result.status, state: after }, { status: 400, state: before })
      assert.equal(typeof result.body.error.code, "string")
      assert.equal(Object.hasOwn(result.body, "data"), false)
    })
  }
  for (const [label, query] of [
    ["unknown", "?unexpected=1"],
    ["repeated", "?unexpected=1&unexpected=2"],
    ["empty-value", "?unexpected="],
    ["project-query", `?project_id=${encodeURIComponent(project.id)}`],
  ]) {
    await t.test(`400 ${label} query under explicit R73 no-query policy`, async () => {
      const before = await fixture.snapshot()
      const result = await fixture.create(`query-${label}`, r73CreatePayload(), { query })
      assert.deepEqual({ status: result.status, state: await fixture.snapshot() }, { status: 400, state: before })
      assert.equal(typeof result.body.error.code, "string")
    })
  }
})

integrationTest("R73 create HTTP hides foreign and absent Projects before claiming a receipt", async (t) => {
  const fixture = await r73CreateFixture(t)
  const own = await fixture.project("R73 own project")
  const foreignOwner = await fixture.project("R73 another owner", fixture.otherOwner)
  const cross = await fixture.start(fixture.otherTenant)
  const foreignTenant = await fixture.project("R73 another tenant", fixture.owner, fixture.otherTenant, cross.base)
  await r73AssertCreated(fixture, await fixture.create("visible-control", r73CreatePayload({ project_id: own.id })), "visible-control", own.id)
  for (const [label, reference] of [
    ["other-owner", foreignOwner.id],
    ["not-found", `project_absent_${fixture.suffix}`],
    ["cross-tenant", foreignTenant.id],
  ]) {
    await t.test(`404 ${label} with unchanged task/outbox/receipt`, async () => {
      const before = await fixture.snapshot()
      const result = await fixture.create(`hidden-${label}`, r73CreatePayload({ project_id: reference }))
      assert.deepEqual(
        { status: result.status, code: result.body.error?.code, state: await fixture.snapshot() },
        { status: 404, code: "project_not_found", state: before },
      )
      assert.equal(Object.hasOwn(result.body, "data"), false)
    })
  }
  await t.test("wrong admitted tenant remains 403 rather than the Project-reference 404", async () => {
    const before = await fixture.snapshot()
    const result = await fixture.create("wrong-tenant-admission", r73CreatePayload({ project_id: foreignTenant.id }), { tenantId: fixture.otherTenant })
    assert.deepEqual(
      { status: result.status, code: result.body.error?.code, state: await fixture.snapshot() },
      { status: 403, code: "product_tenant_forbidden", state: before },
    )
  })
})

integrationTest("R73 create HTTP replays across restart but rechecks current Project access and fingerprint", async (t) => {
  const fixture = await r73CreateFixture(t)
  const first = await fixture.project("R73 replay first")
  const second = await fixture.project("R73 replay second")
  const key = "replay-associated"
  const payload = r73CreatePayload({ project_id: first.id })
  const original = await fixture.create(key, payload)
  await r73AssertCreated(fixture, original, key, first.id)
  const independent = await fixture.create("replay-independent", r73CreatePayload())
  await r73AssertCreated(fixture, independent, "replay-independent", null)
  const beforeRestart = await fixture.snapshot()
  await fixture.restart()
  await t.test("linked exact replay returns the original complete 200 without another write", async () => {
    assert.deepEqual(await fixture.create(key, payload), original)
    assert.deepEqual(await fixture.snapshot(), beforeRestart)
  })
  await t.test("independent exact replay still works after restart", async () => {
    assert.deepEqual(await fixture.create("replay-independent", r73CreatePayload()), independent)
    assert.deepEqual(await fixture.snapshot(), beforeRestart)
  })
  await t.test("same key with another visible Project conflicts without altering the receipt", async () => {
    const result = await fixture.create(key, r73CreatePayload({ project_id: second.id }))
    assert.deepEqual(
      { status: result.status, code: result.body.error?.code, state: await fixture.snapshot() },
      { status: 409, code: "idempotency_conflict", state: beforeRestart },
    )
  })
  await t.test("invalid body and query are rejected before an existing terminal receipt or fingerprint conflict", async (nested) => {
    for (const [label, body, query] of [
      ["unknown-body", { ...payload, unexpected: true }, ""],
      ["unknown-query", payload, "?unexpected=1"],
      ["repeated-query", payload, "?unexpected=1&unexpected=2"],
    ]) {
      await nested.test(label, async () => {
        const result = await fixture.create(key, body, { query })
        assert.deepEqual({ status: result.status, state: await fixture.snapshot() }, { status: 400, state: beforeRestart })
      })
    }
  })
  await t.test("Project access revoked after creation prevents terminal receipt replay", async () => {
    // This is a direct owner-state fixture change, not a claimed public Project-transfer API.
    const changed = await fixture.pool.query(
      "UPDATE bff_project SET owner_id = $1, updated_at = CURRENT_TIMESTAMP(3) WHERE tenant_id = $2 AND owner_id = $3 AND project_id = $4",
      [fixture.otherOwner, fixture.tenant, fixture.owner, first.id],
    )
    assert.equal(changed.rowCount, 1)
    const result = await fixture.create(key, payload)
    assert.deepEqual(
      { status: result.status, code: result.body.error?.code, state: await fixture.snapshot() },
      { status: 404, code: "project_not_found", state: beforeRestart },
    )
  })
})

integrationTest("R73 create HTTP scopes the same idempotency key by trusted subject and tenant", async (t) => {
  const fixture = await r73CreateFixture(t)
  const a = await fixture.project("R73 scope A")
  const b = await fixture.project("R73 scope B", fixture.otherOwner)
  const cross = await fixture.start(fixture.otherTenant)
  const c = await fixture.project("R73 scope C", fixture.owner, fixture.otherTenant, cross.base)
  const results = []
  for (const [project, options] of [
    [a, {}],
    [b, { subject: fixture.otherOwner }],
    [c, { tenantId: fixture.otherTenant, base: cross.base }],
  ]) {
    const result = await fixture.create("same-scoped-key", r73CreatePayload({ project_id: project.id }), options)
    results.push(await r73AssertCreated(fixture, result, "same-scoped-key", project.id, options))
    const beforeReplay = await fixture.snapshot()
    assert.deepEqual(await fixture.create("same-scoped-key", r73CreatePayload({ project_id: project.id }), options), result)
    assert.deepEqual(await fixture.snapshot(), beforeReplay)
  }
  assert.equal(new Set(results).size, 3)
})

integrationTest("R73 create HTTP rolls back a task when its outbox insert fails and releases the pending receipt", async (t) => {
  const fixture = await r73CreateFixture(t)
  const project = await fixture.project("R73 rollback project")
  const key = `rollback-${fixture.suffix}`
  const functionName = `r73_fail_${fixture.suffix}`
  const triggerName = `r73_fail_trigger_${fixture.suffix}`
  const payload = r73CreatePayload({ project_id: project.id })
  let functionInstalled = false
  let triggerInstalled = false
  const before = await fixture.snapshot()
  try {
    // Names/key are locally generated hexadecimal fixture identifiers, never request input.
    await fixture.pool.query(
      `CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'R73 owned outbox insert fault'; END; $$`,
    )
    functionInstalled = true
    await fixture.pool.query(
      `CREATE TRIGGER ${triggerName} BEFORE INSERT ON bff_scheduled_task_outbox
       FOR EACH ROW WHEN (NEW.idempotency_key = '${key}') EXECUTE FUNCTION ${functionName}()`,
    )
    triggerInstalled = true
    const result = await fixture.create(key, payload)
    assert.deepEqual(
      { status: result.status, code: result.body.error?.code, state: await fixture.snapshot() },
      { status: 503, code: "business_store_unavailable", state: before },
    )
  } finally {
    try {
      if (triggerInstalled) await fixture.pool.query(`DROP TRIGGER ${triggerName} ON bff_scheduled_task_outbox`)
    } finally {
      if (functionInstalled) await fixture.pool.query(`DROP FUNCTION ${functionName}()`)
    }
  }
  // Recovery uses the exact same key/body after restart, proving the failed receipt did not stick.
  await fixture.restart()
  const recovered = await fixture.create(key, payload)
  await r73AssertCreated(fixture, recovered, key, project.id)
  const afterRecovery = await fixture.snapshot()
  assert.deepEqual(await fixture.create(key, payload), recovered)
  assert.deepEqual(await fixture.snapshot(), afterRecovery)
})

integrationTest("R74 create syntax validation precedes Project visibility and rejects empty query components", async (t) => {
  const fixture = await r73CreateFixture(t)
  const missingProject = `project_absent_${fixture.suffix}`
  await r73AssertCreated(fixture, await fixture.create("r74-legal-control", r73CreatePayload()), "r74-legal-control", null)
  for (const [label, payload, query] of [
    ["unknown-body-before-project", r73CreatePayload({ project_id: missingProject, unexpected: true }), ""],
    ["invalid-auto-before-project", r73CreatePayload({ project_id: missingProject, auto_approve: "false" }), ""],
    ["query-before-project", r73CreatePayload({ project_id: missingProject }), "?unexpected=1"],
    ["empty-query-component", r73CreatePayload(), "?"],
    ["empty-query-pairs", r73CreatePayload(), "?&&"],
  ]) {
    await t.test(label, async () => {
      const before = await fixture.snapshot()
      const result = await r74CreateWithRawQuery(fixture, `r74-${label}`, payload, query)
      assert.deepEqual({ status: result.status, state: await fixture.snapshot() }, { status: 400, state: before })
    })
  }
})

async function r74CreateWithRawQuery(fixture, key, payload, query) {
  const { request } = await import("node:http")
  const url = new URL(fixture.base)
  // Use an explicit request-target: fetch URL normalization may erase a bare '?'.
  return new Promise((resolve, reject) => {
    const outgoing = request(
      {
        hostname: url.hostname,
        port: url.port,
        path: `/v1/scheduled-tasks${query}`,
        method: "POST",
        headers: { ...auth(fixture.tenant, fixture.owner), "content-type": "application/json", "idempotency-key": key },
        signal: AbortSignal.timeout(5000),
      },
      (response) => {
        const chunks = []
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
        response.once("error", reject)
        response.once("end", () => {
          try {
            resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) })
          } catch (error) {
            reject(error)
          }
        })
      },
    )
    outgoing.once("error", reject)
    outgoing.end(JSON.stringify(payload))
  })
}

// R237 stage 2. Root installs the stage-1 schema first; missing columns are not HTTP RED.
// These are BFF HTTP / real PostgreSQL tests. IAM admission is the existing boundary double.
import { randomUUID } from "node:crypto"
import { PostgresBffRepositories } from "../dist/infrastructure/postgres/repositories.js"
import { PostgresProjectRepository } from "../dist/infrastructure/postgres/project-repository.js"
import { PostgresChatRepository } from "../dist/infrastructure/postgres/chat-repository.js"
import { PostgresScheduledTaskRepository } from "../dist/infrastructure/postgres/scheduled-task-repository.js"

const r237IdleWorker = { start() {}, async stop() {} }
const r237Tombstone = "2026-09-01T00:00:00.000Z"

async function r237Fixture(t) {
  const pool = new Pool({ connectionString: postgresUrl, options: "-c search_path=kokoro_bff -c timezone=UTC" })
  const tenant = `r237_${randomUUID().replaceAll("-", "")}`
  const owner = "r237_owner"
  let store
  let bff
  const tables = []
  t.after(async () => {
    try {
      if (bff) await close(bff)
    } finally {
      try {
        await store?.close()
      } finally {
        try {
          for (const table of tables) {
            if (table === "bff_idempotency_receipt") await pool.query(`DELETE FROM ${table} WHERE position($1 in scope)>0`, [tenant])
            else await pool.query(`DELETE FROM ${table} WHERE tenant_id=$1 OR tenant_id=$2`, [tenant, `${tenant}_other`])
          }
        } finally {
          await pool.end()
        }
      }
    }
  })
  const prerequisite = await pool.query(
    `SELECT format_type(atttypid,atttypmod) AS type,attnotnull AS not_null
       FROM pg_attribute WHERE attrelid='kokoro_bff.bff_project'::regclass AND attname='deleted_at' AND NOT attisdropped`,
  )
  assert.deepEqual(
    prerequisite.rows,
    [{ type: "timestamp(3) with time zone", not_null: false }],
    "SCHEMA PREREQUISITE ONLY: run R237 fresh catalog before HTTP eligibility RED",
  )
  const catalog = await pool.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema='kokoro_bff' AND table_type='BASE TABLE'
       AND (table_name='bff_idempotency_receipt' OR table_name IN
         (SELECT table_name FROM information_schema.columns WHERE table_schema='kokoro_bff' AND column_name='tenant_id'))
       ORDER BY table_name`,
  )
  tables.push(...catalog.rows.map((row) => row.table_name))
  assert.ok(tables.every((name) => /^bff_[a-z_]+$/u.test(name)))
  store = new PostgresBffRepositories(postgresUrl, redisUrl)
  await store.ready()
  bff = createBffServer(
    {
      ...bffConfig({ tenantId: tenant, agentEnabled: true, agentBase: "http://127.0.0.1:9" }),
      storage: { baseUrl: "http://127.0.0.1:9", secret: "r237-no-storage-service", objectOrigin: "http://127.0.0.1:9" },
    },
    {
      businessStore: store,
      sessionAdmission,
      agentDispatchDispatcher: r237IdleWorker,
      agentCancellationDispatcher: r237IdleWorker,
      agUiProjector: r237IdleWorker,
      scheduledTaskDispatcher: r237IdleWorker,
      scheduledAgentDispatcher: r237IdleWorker,
      scheduledAgentTerminalConsumer: r237IdleWorker,
    },
  )
  const base = await listen(bff)
  const request = async (path, method = "GET", body, options = {}) => {
    const response = await fetch(`${base}/v1/${path}`, {
      method,
      signal: AbortSignal.timeout(6000),
      headers: {
        ...auth(options.tenant ?? tenant, options.owner ?? owner),
        "content-type": "application/json",
        "idempotency-key": options.key ?? `r237-${randomUUID()}`,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    return { status: response.status, body: await response.json(), requestId: response.headers.get("x-request-id") }
  }
  // Entire owner tables (not counts, not just Message): every field, including receipts/outboxes/projections.
  const facts = async () => {
    const result = {}
    for (const table of tables)
      result[table] = (await pool.query(`SELECT to_jsonb(fact) AS row FROM ${table} AS fact ORDER BY to_jsonb(fact)::text`)).rows.map(({ row }) => row)
    return result
  }
  const project = async (kind = "active") => {
    const id = `project_${randomUUID()}`
    const slug = `r237-${randomUUID()}`
    await pool.query(
      `INSERT INTO bff_project(project_id,tenant_id,owner_id,name,slug,instruction,deleted_at)
       VALUES($1,$2,$3,'R237 Project',$4,'original instruction',$5)`,
      [id, kind === "tenant" ? `${tenant}_other` : tenant, kind === "owner" ? "other_owner" : owner, slug, kind === "deleted" ? r237Tombstone : null],
    )
    return { id, slug }
  }
  const conversation = async (projectRef = null, subject = owner) => {
    const id = `conv_${randomUUID()}`
    await pool.query(
      "INSERT INTO bff_conversation(conversation_id,tenant_id,owner_id,project_ref,title,status) VALUES($1,$2,$3,$4,'Original title','active')",
      [id, tenant, subject, projectRef],
    )
    await pool.query(
      "INSERT INTO bff_message(message_id,tenant_id,conversation_id,role,content,status,message_seq) VALUES($1,$2,$3,'user','Private message','completed',1)",
      [`msg_${randomUUID()}`, tenant, id],
    )
    await pool.query("INSERT INTO bff_share(share_id,tenant_id,conversation_id,url) VALUES($1,$2,$3,'https://example.invalid/share')", [
      `share_${randomUUID()}`,
      tenant,
      id,
    ])
    return id
  }
  const deny = async (operation, status = 404, code) => {
    const before = await facts()
    const result = await operation()
    assert.equal(result.status, status, JSON.stringify(result.body))
    assert.ok(result.requestId, "request ID header survives authorization errors")
    if (code) assert.equal(result.body.error.code, code)
    assert.deepEqual(await facts(), before, "rejected request changed BFF facts or receipt")
    return result
  }
  return { pool, tenant, owner, store, request, facts, project, conversation, deny, scope: { tenantId: tenant, subjectId: owner } }
}

function r237Schedule(projectId) {
  return {
    project_id: projectId,
    title: "R237 task",
    prompt: "Review",
    frequency: "daily",
    time: "08:00",
    timezone: "UTC",
    next_run_at: "2099-01-01T08:00:00.000Z",
    auto_approve: false,
  }
}

integrationTest("R237 HTTP Project active and denied ID-slug matrix leaves complete facts unchanged", async (t) => {
  for (const kind of ["deleted", "owner", "tenant"])
    await t.test(kind, async (t) => {
      const f = await r237Fixture(t)
      const active = await f.project()
      const hidden = await f.project(kind)
      const list = await f.request("projects")
      assert.equal(list.status, 200)
      assert.deepEqual(
        list.body.data.projects.map((item) => item.id),
        [active.id],
      )
      for (const ref of [hidden.id, hidden.slug]) {
        for (const suffix of ["", "/instruction-revisions", "/tasks"]) await f.deny(() => f.request(`projects/${ref}${suffix}`), 404, "project_not_found")
        await f.deny(() => f.request(`projects/${ref}`, "PATCH", { instruction: "Denied" }), 404, "project_not_found")
        await f.deny(() => f.request(`projects/${ref}/skills/r237`, "PATCH", { enabled: true }), 404, "project_not_found")
        await f.deny(() => f.request("scheduled-tasks", "POST", r237Schedule(ref)), 404, "project_not_found")
        await f.deny(() => f.request(`projects/${ref}/scheduled-tasks`, "POST", r237Schedule(ref)), 404, "project_not_found")
      }
      await f.deny(
        () => f.request(`projects/${active.id}`, "PATCH", { instruction: "Cross tenant" }, { tenant: `${f.tenant}_other` }),
        403,
        "product_tenant_forbidden",
      )
      for (const ref of [active.id, active.slug]) {
        assert.equal((await f.request(`projects/${ref}`)).status, 200)
        assert.equal((await f.request(`projects/${ref}`, "PATCH", { instruction: `Allowed ${ref}` })).status, 200)
        assert.equal((await f.request(`projects/${ref}/skills/r237`, "PATCH", { enabled: true })).status, 200)
        assert.equal((await f.request(`projects/${ref}/instruction-revisions`)).status, 200)
        assert.equal((await f.request(`projects/${ref}/tasks`)).status, 200)
        assert.equal((await f.request("scheduled-tasks", "POST", r237Schedule(ref))).status, 200)
      }
      assert.equal((await f.pool.query("SELECT instruction FROM bff_project WHERE project_id=$1", [active.id])).rows[0].instruction, `Allowed ${active.slug}`)
    })
})

integrationTest("R237 HTTP Conversation collections and private operations exclude tombstoned and foreign Project references", async (t) => {
  for (const kind of ["deleted", "owner", "tenant"])
    for (const selector of ["id", "slug"])
      await t.test(`${kind} ${selector}`, async (t) => {
        const f = await r237Fixture(t)
        const active = await f.project()
        const hidden = await f.project(kind)
        const direct = await f.conversation()
        const permitted = await f.conversation(active[selector])
        const denied = await f.conversation(hidden[selector])
        const foreignConversation = await f.conversation(active[selector], "other_owner")
        const list = await f.request("sessions")
        assert.equal(list.status, 200)
        assert.deepEqual(list.body.data.sessions.map((item) => item.session_id).sort(), [direct, permitted].sort())
        const directList = await f.request("sessions?scope=direct")
        assert.deepEqual(
          directList.body.data.sessions.map((item) => item.session_id),
          [direct],
        )
        await f.deny(() => f.request(`sessions?project_ref=${hidden[selector]}`), 404, "project_not_found")
        for (const id of [denied, foreignConversation]) {
          for (const suffix of ["", "/messages", "/runs/r237-run/process?watermark=agui_00000000000000000000000000000000"])
            await f.deny(() => f.request(`sessions/${id}${suffix}`), 404, "session_not_found")
          for (const [suffix, method, body] of [
            ["/title", "PATCH", { title: "Denied" }],
            ["", "DELETE"],
            ["/share", "POST"],
            ["/share", "DELETE"],
            ["/messages", "POST", { content: "Denied" }],
          ]) {
            await f.deny(() => f.request(`sessions/${id}${suffix}`, method, body), 404, "session_not_found")
          }
        }
        await f.deny(() => f.request(`sessions/${permitted}`, "GET", undefined, { tenant: `${f.tenant}_other` }), 403, "product_tenant_forbidden")
        for (const id of [direct, permitted]) {
          assert.equal((await f.request(`sessions/${id}`)).status, 200)
          const messages = await f.request(`sessions/${id}/messages`)
          assert.equal(messages.status, 200)
          assert.equal(messages.body.data.messages.length, 1)
          assert.equal((await f.request(`sessions/${id}/title`, "PATCH", { title: "Allowed" })).status, 200)
          assert.equal((await f.request(`sessions/${id}/share`, "DELETE")).status, 200)
          assert.equal((await f.request(`sessions/${id}/share`, "POST")).status, 200)
          assert.equal((await f.request(`sessions/${id}`, "DELETE")).status, 200)
          assert.equal((await f.pool.query("SELECT status FROM bff_conversation WHERE conversation_id=$1", [id])).rows[0].status, "deleted")
        }
      })
})

integrationTest("R237 HTTP Move and Message reject inactive sources targets and stale receipts", async (t) => {
  const f = await r237Fixture(t)
  const active = await f.project()
  const deleted = await f.project("deleted")
  const foreign = await f.project("owner")
  const cross = await f.project("tenant")
  const direct = await f.conversation()
  for (const project of [deleted, foreign, cross]) {
    for (const ref of [project.id, project.slug]) {
      await f.deny(() => f.request(`sessions/conv_${randomUUID()}/messages`, "POST", { content: "Denied first turn", project_ref: ref }), 404)
      const source = await f.conversation(ref)
      await f.deny(() => f.request(`sessions/${source}/move`, "POST", { target_project_id: active.id }), 404, "session_not_found")
      await f.deny(() => f.request(`sessions/${source}/messages`, "POST", { content: "Denied existing turn" }), 404, "session_not_found")
    }
    await f.deny(() => f.request(`sessions/${direct}/move`, "POST", { target_project_id: project.id }), 404, "session_not_found")
  }
  assert.equal((await f.request(`sessions/${direct}/move`, "POST", { target_project_id: active.id }, { key: "r237-move" })).status, 200)
  assert.equal((await f.request(`sessions/${direct}/move`, "POST", { target_project_id: active.id }, { key: "r237-move" })).status, 200)
  await f.pool.query("UPDATE bff_project SET deleted_at=$2 WHERE project_id=$1", [active.id, r237Tombstone])
  await f.deny(() => f.request(`sessions/${direct}/move`, "POST", { target_project_id: active.id }, { key: "r237-move" }), 404, "session_not_found")
  const positive = await f.project()
  for (const projectRef of [undefined, positive.id, positive.slug]) {
    const id = `conv_${randomUUID()}`
    const body = { content: "Allowed first turn", ...(projectRef === undefined ? {} : { project_ref: projectRef }) }
    const first = await f.request(`sessions/${id}/messages`, "POST", body, { key: `r237-first-${id}` })
    assert.equal(first.status, 202, JSON.stringify(first.body))
    const committed = await f.facts()
    const replay = await f.request(`sessions/${id}/messages`, "POST", body, { key: `r237-first-${id}` })
    assert.equal(replay.status, 202)
    assert.deepEqual(replay.body.data, first.body.data)
    assert.deepEqual(await f.facts(), committed, "legal replay changed facts")
  }
})

// Forward every query to PostgreSQL unchanged; only schedule a real committed change
// between statements, so an outer successful lookup cannot mask an inner predicate.
function r237AfterQueryDatabase(pool, onQuery) {
  const run = async (target, args) => {
    const result = await target.query(...args)
    await onQuery(typeof args[0] === "string" ? args[0] : args[0].text, result)
    return result
  }
  return {
    pool: {
      query: (...args) => run(pool, args),
      connect: async () => {
        const client = await pool.connect()
        return new Proxy(client, {
          get(target, key) {
            if (key === "query") return (...args) => run(target, args)
            const value = Reflect.get(target, key)
            return typeof value === "function" ? value.bind(target) : value
          },
        })
      },
    },
  }
}

integrationTest("R237 real PG inner Project and Conversation predicates are not masked by HTTP preauthorization", async (t) => {
  await t.test("instruction UPDATE and Skill parent lock", async (t) => {
    const f = await r237Fixture(t)
    const project = await f.project("deleted")
    const repository = new PostgresProjectRepository({ pool: f.pool })
    const before = await f.facts()
    for (const ref of [project.id, project.slug]) {
      assert.equal(await repository.updateProjectInstruction(f.scope, ref, "Denied"), null)
      assert.equal(await repository.setProjectSkill(f.scope, ref, "r237", true), false)
    }
    assert.deepEqual(await f.facts(), before)
  })
  for (const operation of ["revisions", "tasks", "messages"])
    await t.test(`read-to-read committed tombstone ${operation}`, async (t) => {
      const f = await r237Fixture(t)
      const project = await f.project()
      const conversation = await f.conversation(project.slug)
      await f.pool.query(
        "INSERT INTO bff_project_instruction_revision(revision_id,tenant_id,project_id,instruction,actor_id,current) VALUES($1,$2,$3,'secret',$4,true)",
        [`revision_${randomUUID()}`, f.tenant, project.id, f.owner],
      )
      await f.pool.query("INSERT INTO bff_project_task(task_id,tenant_id,project_id,title,status) VALUES($1,$2,$3,'secret','todo')", [
        `task_${randomUUID()}`,
        f.tenant,
        project.id,
      ])
      let changed = false
      let expected
      const database = r237AfterQueryDatabase(f.pool, async (sql) => {
        const firstLookup = operation === "messages" ? /^SELECT conversation_id FROM bff_conversation/u.test(sql.trim()) : /FROM bff_project\s+WHERE/u.test(sql)
        if (!changed && firstLookup) {
          changed = true
          await f.pool.query("UPDATE bff_project SET deleted_at=$2 WHERE project_id=$1", [project.id, r237Tombstone])
          expected = await f.facts()
        }
      })
      if (operation === "messages") {
        const result = await new PostgresChatRepository(database).listMessages(f.tenant, f.owner, conversation, 20, null)
        assert.deepEqual(result, { messages: [], next_cursor: null })
      } else {
        const repository = new PostgresProjectRepository(database)
        const result =
          operation === "revisions" ? await repository.instructionRevisions(f.scope, project.id) : await repository.listTasks(f.scope, project.slug)
        assert.deepEqual(result, [])
      }
      assert.equal(changed, true, "real pre-read-to-read race must execute")
      assert.deepEqual(await f.facts(), expected)
    })
  for (const method of ["readSnapshot", "readRunProcessPage", "listMessages", "renameConversation", "deleteConversation", "createShare", "revokeShare"])
    await t.test(method, async (t) => {
      const f = await r237Fixture(t)
      const project = await f.project("deleted")
      const repository = new PostgresChatRepository({ pool: f.pool })
      for (const ref of [project.id, project.slug]) {
        const id = await f.conversation(ref)
        const before = await f.facts()
        let result
        if (method === "readRunProcessPage")
          result = await repository.readRunProcessPage(f.tenant, f.owner, id, "r237-run", undefined, "invalid-on-purpose", null, 20)
        else if (method === "listMessages") result = await repository.listMessages(f.tenant, f.owner, id, 20, null)
        else if (method === "renameConversation") result = await repository.renameConversation(f.tenant, f.owner, id, "Denied")
        else if (method === "deleteConversation") result = await repository.deleteConversation(f.tenant, f.owner, id, "r237-request")
        else result = await repository[method](f.tenant, f.owner, id, undefined)
        assert.equal(result, method === "deleteConversation" ? false : null)
        assert.deepEqual(await f.facts(), before)
      }
    })
  await t.test("ScheduledTask FOR SHARE rejects tombstone without task or outbox", async (t) => {
    const f = await r237Fixture(t)
    const project = await f.project("deleted")
    const repository = new PostgresScheduledTaskRepository({ pool: f.pool })
    for (const ref of [project.id, project.slug]) {
      const before = await f.facts()
      await assert.rejects(
        repository.createScheduledTask(
          f.scope,
          {
            projectId: ref,
            title: "Denied",
            prompt: "Denied",
            frequency: "daily",
            time: "08:00",
            timezone: "UTC",
            nextRunAt: new Date("2099-01-01T08:00:00.000Z"),
            autoApprove: false,
          },
          undefined,
          { tenantId: f.tenant, actorId: f.owner, requestId: "r237-request", idempotencyKey: `r237-${randomUUID()}` },
        ),
        /PROJECT_NOT_FOUND/u,
      )
      assert.deepEqual(await f.facts(), before)
    }
  })
})

async function r237Artifact(f, conversation) {
  const artifactId = `artifact_${randomUUID()}`
  await f.pool.query(
    `INSERT INTO bff_conversation_artifact
       (tenant_id,conversation_id,artifact_id,run_id,source_event_id,source_sequence,source_digest,
        source_asset_id,source_artifact_kind,source_content_sha256,source_title,source_mime,source_size_bytes,delivered_at)
     VALUES($1,$2,$3,'r237-run',$4,1,$5,'r237-asset','document',$5,'Private document','text/plain',1,CURRENT_TIMESTAMP(3))`,
    [f.tenant, conversation, artifactId, `event_${randomUUID()}`, "a".repeat(64)],
  )
  return artifactId
}

integrationTest("R237 Artifact relationship list and detail enforce Project eligibility before Storage", async (t) => {
  const f = await r237Fixture(t)
  const direct = await f.conversation()
  const active = await f.project()
  const permitted = await f.conversation(active.id)
  const directArtifact = await r237Artifact(f, direct)
  const activeArtifact = await r237Artifact(f, permitted)
  const hidden = []
  for (const kind of ["deleted", "owner", "tenant"]) {
    const project = await f.project(kind)
    for (const ref of [project.id, project.slug]) {
      const id = await f.conversation(ref)
      hidden.push([id, await r237Artifact(f, id)])
    }
  }
  const before = await f.facts()
  const candidates = await f.store.artifactLibrary.listCandidates(f.tenant, f.owner, null, 100)
  assert.deepEqual(candidates.map((item) => item.artifactId).sort(), [directArtifact, activeArtifact].sort())
  for (const [id, artifact] of hidden) {
    assert.equal(await f.store.artifactLibrary.findCandidate(f.tenant, f.owner, id, artifact), null)
    await f.deny(() => f.request(`library/artifacts/${id}/${artifact}`), 404, "library_artifact_not_found")
  }
  for (const [id, artifact] of [
    [direct, directArtifact],
    [permitted, activeArtifact],
  ])
    assert.equal((await f.store.artifactLibrary.findCandidate(f.tenant, f.owner, id, artifact)).artifactId, artifact)
  assert.deepEqual(await f.facts(), before)
  // Remove only this fixture's two allowed associations: empty HTTP library must not contact Storage.
  await f.pool.query("DELETE FROM bff_conversation_artifact WHERE tenant_id=$1 AND artifact_id=ANY($2::text[])", [f.tenant, [directArtifact, activeArtifact]])
  const emptyBefore = await f.facts()
  const empty = await f.request("library?kind=artifact")
  assert.equal(empty.status, 200, JSON.stringify(empty.body))
  assert.deepEqual(empty.body.data.items, [])
  assert.deepEqual(await f.facts(), emptyBefore)
})

integrationTest("R237 Move source resolution rechecks after winner lookup without changing facts", async (t) => {
  const f = await r237Fixture(t)
  const project = await f.project()
  const id = await f.conversation(project.slug)
  let changed = false
  let expected
  const database = r237AfterQueryDatabase(f.pool, async (sql) => {
    if (!changed && /SELECT project_id FROM bff_project/u.test(sql) && /LIMIT 2/u.test(sql)) {
      changed = true
      await f.pool.query("UPDATE bff_project SET deleted_at=$2 WHERE project_id=$1", [project.id, r237Tombstone])
      expected = await f.facts()
    }
  })
  const result = await new PostgresChatRepository(database).moveConversation({
    tenantId: f.tenant,
    subjectId: f.owner,
    conversationId: id,
    targetProjectId: null,
    scope: `${f.tenant}:r237-move-race`,
    fingerprint: "r237-fingerprint",
    signal: AbortSignal.timeout(4000),
  })
  assert.equal(changed, true)
  assert.deepEqual(result, { kind: "not_found" })
  assert.deepEqual(await f.facts(), expected)
})

integrationTest("R237 real Project row-lock races revalidate active before Message Move Skill and Task facts", async (t) => {
  for (const operation of ["first-message", "existing-message", "move-target", "move-source", "skill", "scheduled-task"])
    await t.test(operation, async (t) => {
      const f = await r237Fixture(t)
      const project = await f.project()
      const id = operation === "first-message" ? `conv_${randomUUID()}` : await f.conversation(operation === "move-target" ? null : project.slug)
      const expected = await f.facts()
      const tombstoneJson = (await f.pool.query("SELECT to_jsonb($1::timestamptz(3)) AS value", [r237Tombstone])).rows[0].value
      expected.bff_project.find((row) => row.project_id === project.id).deleted_at = tombstoneJson
      const blocker = await f.pool.connect()
      let pending
      try {
        await blocker.query("BEGIN")
        const blockerPid = (await blocker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid
        await blocker.query("UPDATE bff_project SET deleted_at=$2 WHERE project_id=$1", [project.id, r237Tombstone])
        // The earlier ordinary reads see the active committed version; parent row locks wait.
        if (operation.endsWith("message"))
          pending = f.request(`sessions/${id}/messages`, "POST", { content: "Must lose to tombstone", project_ref: project.slug })
        else if (operation.startsWith("move"))
          pending = f.request(`sessions/${id}/move`, "POST", { target_project_id: operation === "move-target" ? project.id : null })
        else if (operation === "skill") pending = new PostgresProjectRepository({ pool: f.pool }).setProjectSkill(f.scope, project.id, "r237", true)
        else
          pending = new PostgresScheduledTaskRepository({ pool: f.pool }).createScheduledTask(
            f.scope,
            {
              projectId: project.id,
              title: "Denied",
              prompt: "Denied",
              frequency: "daily",
              time: "08:00",
              timezone: "UTC",
              nextRunAt: new Date("2099-01-01T08:00:00.000Z"),
              autoApprove: false,
            },
            undefined,
            { tenantId: f.tenant, actorId: f.owner, requestId: "r237-request", idempotencyKey: "r237-lock" },
          )
        // Observe rejection as a value now, avoiding an unhandled rejection during PG observation.
        pending = pending.then(
          (value) => ({ value }),
          (error) => ({ error }),
        )
        await waitFor(async () => {
          const activity = await f.pool.query(
            `SELECT query FROM pg_stat_activity WHERE datname=current_database()
             AND $1=ANY(pg_blocking_pids(pid)) AND query LIKE '%bff_project%'`,
            [blockerPid],
          )
          return activity.rows.some((row) => /FOR (?:SHARE|UPDATE)/u.test(row.query))
        }, 800)
        await blocker.query("COMMIT")
        const result = await pending
        if (operation === "scheduled-task") assert.match(result.error?.message ?? "accepted", /PROJECT_NOT_FOUND/u)
        else if (operation === "skill") assert.equal(result.value, false)
        else {
          assert.equal(result.value?.status, 404, JSON.stringify(result.value ?? result.error))
          assert.equal(result.value.body.error.code, "session_not_found")
          assert.ok(result.value.requestId)
        }
        assert.deepEqual(await f.facts(), expected, "losing command wrote facts beyond the fixture tombstone")
      } finally {
        await blocker.query("ROLLBACK").catch(() => undefined)
        blocker.release()
        if (pending) await pending
      }
    })
})

integrationTest("R237 Message existing active and Direct positive controls and tombstone receipt replay", async (t) => {
  const f = await r237Fixture(t)
  const project = await f.project()
  let projectConversation
  for (const ref of [null, project.id, project.slug]) {
    const id = await f.conversation(ref)
    const response = await f.request(`sessions/${id}/messages`, "POST", { content: "Existing permitted conversation" }, { key: `r237-existing-${id}` })
    assert.equal(response.status, 202, JSON.stringify(response.body))
    const stored = await f.pool.query("SELECT role,status FROM bff_message WHERE tenant_id=$1 AND conversation_id=$2 ORDER BY message_seq", [f.tenant, id])
    assert.deepEqual(stored.rows, [
      { role: "user", status: "completed" },
      { role: "user", status: "completed" },
      { role: "assistant", status: "pending" },
    ])
    if (ref === project.id) projectConversation = id
  }
  await f.pool.query("UPDATE bff_project SET deleted_at=$2 WHERE project_id=$1", [project.id, r237Tombstone])
  await f.deny(
    () =>
      f.request(
        `sessions/${projectConversation}/messages`,
        "POST",
        { content: "Existing permitted conversation" },
        { key: `r237-existing-${projectConversation}` },
      ),
    404,
    "session_not_found",
  )
})
