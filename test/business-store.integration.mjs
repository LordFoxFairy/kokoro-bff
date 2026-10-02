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
