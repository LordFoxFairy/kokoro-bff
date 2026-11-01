import { ProjectService } from "../dist/application/project-service.js"
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
      "DROP TABLE IF EXISTS bff_scheduled_agent_source_event, bff_scheduled_agent_dispatch, bff_scheduled_agent_scope, bff_agui_cursor_tombstone, bff_agui_event, bff_agui_source_event, bff_conversation_artifact, bff_agui_stream, bff_agent_cancellation_outbox, bff_agent_dispatch_outbox, bff_share, bff_message, bff_conversation, bff_scheduled_task_outbox, bff_scheduled_task, bff_project_task, bff_idempotency_receipt, bff_project_instruction_revision, bff_project CASCADE",
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
      trigger_kind: "calendar",
      frequency: "daily",
      time: "08:00",
      timezone: "UTC",

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
  let schedulerCurrent
  const agentCalls = []
  let schedulerBase
  let agentBase
  let bff
  try {
    await schemaPool.query(
      "DROP TABLE IF EXISTS bff_scheduled_agent_source_event, bff_scheduled_agent_dispatch, bff_scheduled_agent_scope, bff_agui_cursor_tombstone, bff_agui_event, bff_agui_source_event, bff_conversation_artifact, bff_agui_stream, bff_agent_cancellation_outbox, bff_agent_dispatch_outbox, bff_share, bff_message, bff_conversation, bff_scheduled_task_outbox, bff_scheduled_task, bff_project_task, bff_idempotency_receipt, bff_project_instruction_revision, bff_project CASCADE",
    )
    await schemaPool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    await redis.connect()

    const scheduler = createServer((request, response) => {
      const chunks = []
      request.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
      request.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8")
        if (request.method === "GET") {
          response.setHeader("content-type", "application/json")
          response.setHeader("cache-control", "no-store")
          response.setHeader("x-request-id", request.headers["x-request-id"])
          response.end(
            JSON.stringify({
              data: {
                schedule: {
                  ...schedulerCurrent,
                  id: "00000000-0000-4000-8000-000000000001",
                  next_due_at: "2026-09-01T08:00:00.000Z",
                  version: 9,
                  status: schedulerCurrent.paused ? "paused" : "active",
                },
              },
            }),
          )
          return
        }
        schedulerCurrent = raw ? JSON.parse(raw) : null
        schedulerCalls.push({
          method: request.method,
          url: request.url,
          authorization: request.headers.authorization,
          service: request.headers["x-kokoro-service"],
          requestId: request.headers["x-request-id"],
          schedule: raw ? JSON.parse(raw) : null,
        })
        response.setHeader("content-type", "application/json")
        const schedule = raw ? JSON.parse(raw) : null
        response.end(
          JSON.stringify({
            data: {
              name: request.url?.split("/").at(-1),
              status: request.method === "POST" ? "registered" : "updated",
              schedule:
                schedule === null
                  ? undefined
                  : {
                      ...schedule,
                      id: "00000000-0000-4000-8000-000000000001",
                      next_due_at: "2026-09-01T08:00:00.000Z",
                      version: 9,
                    },
            },
            meta: { request_id: request.headers["x-request-id"] },
          }),
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
      trigger_kind: "calendar",
      frequency: "daily",
      time: "08:00",
      timezone: "UTC",

      auto_approve: true,
    }
    const created = await fetch(`${base}/v1/scheduled-tasks`, { method: "POST", headers: createHeaders, body: JSON.stringify(createPayload) })
    assert.equal(created.status, 200)
    const createdBody = await created.json()
    const taskId = createdBody.data.task.id
    assert.match(taskId, /^scheduled_[0-9a-f]{32}$/)
    assert.equal(Object.hasOwn(createdBody.data.task, "recurrence_anchor_at"), false)
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
    assert.equal(Object.hasOwn(patchedTask, "recurrence_anchor_at"), false)
    for (const path of ["/v1/scheduled-tasks", `/v1/scheduled-tasks/${taskId}`]) {
      const read = await fetch(`${base}${path}`, { headers: auth(namespace) })
      assert.equal(read.status, 200)
      const data = (await read.json()).data
      const stored = data.task ?? data.tasks.find((task) => task.id === taskId)
      assert.equal(Object.hasOwn(stored, "recurrence_anchor_at"), false)
    }
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
      body: JSON.stringify(schedulerCalls.at(-1).schedule.body),
    })
    assert.equal(pausedDispatch.status, 409)
    assert.equal((await pausedDispatch.json()).error.code, "scheduled_task_not_active")
    assert.equal(agentCalls.length, 1)

    const staleDispatch = await fetch(`${base}/internal/bff/scheduled-tasks/dispatch`, {
      method: "POST",
      headers: {
        ...dispatchHeaders,
        "x-kokoro-scheduler-occurrence": "2026-09-01T12:00:02.000000000Z",
        "idempotency-key": "stale-scheduler-key",
      },
      body: JSON.stringify(dispatchBody),
    })
    assert.equal(staleDispatch.status, 409)
    assert.equal((await staleDispatch.json()).error.code, "invalid_scheduler_dispatch")
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
    const currentTasks = (await listed.json()).data.tasks
    assert.deepEqual(
      currentTasks.map((task) => task.id),
      [taskId],
    )
    assert.equal(Object.hasOwn(currentTasks[0], "recurrence_anchor_at"), false)
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
    trigger_kind: "calendar",
    frequency: "daily",
    time: "08:00",
    timezone: "UTC",

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

integrationTest("explicit calendar HTTP persists selections, rejects retired input and replays once ACK after its due time", async (t) => {
  const fixture = await r73CreateFixture(t)
  for (const rule of [
    { frequency: "weekly", weekdays: [0, 3] },
    { frequency: "monthly", month_days: [18, 31] },
  ]) {
    const key = `calendar-${rule.frequency}-${fixture.suffix}`
    const created = await fixture.create(key, r73CreatePayload(rule))
    const id = await r73AssertCreated(fixture, created, key, null)
    const read = await fetch(`${fixture.base}/v1/scheduled-tasks/${id}`, { headers: auth(fixture.tenant, fixture.owner) })
    assert.equal(read.status, 200)
    const task = (await read.json()).data.task
    for (const [name, value] of Object.entries(rule)) assert.deepEqual(task[name], value)
    const foreign = await fetch(`${fixture.base}/v1/scheduled-tasks/${id}`, { headers: auth(fixture.tenant, fixture.otherOwner) })
    assert.equal(foreign.status, 404)
  }
  const due = new Date(Math.ceil(Date.now() / 60_000) * 60_000 + 120_000)
  const body = r73CreatePayload({ frequency: "once", local_date: due.toISOString().slice(0, 10), time: due.toISOString().slice(11, 16) })
  const key = `calendar-once-${fixture.suffix}`
  const original = await fixture.create(key, body)
  const onceId = await r73AssertCreated(fixture, original, key, null)
  await fixture.restart()
  try {
    // Only the clock is controlled; HTTP, canonical PostgreSQL and receipt replay are real.
    t.mock.timers.enable({ apis: ["Date"], now: due.getTime() + 60_000 })
    assert.deepEqual(await fixture.create(key, body), original)
    const before = await fixture.snapshot()
    const past = await fixture.create(`${key}-new`, body)
    assert.equal(past.status, 400)
    const after = await fixture.snapshot()
    assert.deepEqual(after.tasks, before.tasks)
    assert.deepEqual(after.outbox, before.outbox)
    const patch = async (commandKey, fields) => {
      const response = await fetch(`${fixture.base}/v1/scheduled-tasks/${onceId}`, {
        method: "PATCH",
        headers: { ...auth(fixture.tenant, fixture.owner), "content-type": "application/json", "idempotency-key": commandKey },
        body: JSON.stringify(fields),
      })
      return { status: response.status, body: await response.json() }
    }
    const sameRule = { trigger_kind: "calendar", frequency: body.frequency, time: body.time, timezone: body.timezone, local_date: body.local_date }
    const firstEdit = { title: "Edited after due" }
    const firstAck = await patch(`${key}-edit`, firstEdit)
    assert.equal(firstAck.status, 200)
    for (const [index, fields] of [sameRule, { enabled: false, status: "paused" }, { enabled: true, status: "active" }].entries()) {
      const result = await patch(`${key}-same-${index}`, fields)
      assert.equal(result.status, 200, JSON.stringify(result.body))
    }
    const beforeRejected = await fixture.snapshot()
    const changedPast = await patch(`${key}-different-past`, { ...sameRule, time: new Date(due.getTime() + 60_000).toISOString().slice(11, 16) })
    assert.equal(changedPast.status, 400)
    const afterRejected = await fixture.snapshot()
    assert.deepEqual(afterRejected.tasks, beforeRejected.tasks)
    assert.deepEqual(afterRejected.outbox, beforeRejected.outbox)
    assert.deepEqual(await patch(`${key}-edit`, firstEdit), firstAck, "replay must retain the original write ACK, not today's task")
    assert.deepEqual(await fixture.create(key, body), original, "editing must not rewrite the original create receipt")
  } finally {
    t.mock.timers.reset()
  }
  const before = await fixture.snapshot()
  for (const invalid of [r73CreatePayload({ recurrence_anchor_at: "2030-01-01T00:00:00Z" }), r73CreatePayload({ frequency: "weekly" })]) {
    const rejected = await fixture.create(`retired-${fixture.suffix}`, invalid)
    assert.equal(rejected.status, 400)
    assert.deepEqual(await fixture.snapshot(), before, "retired request shapes must never claim a receipt or create a task")
  }
})

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
    trigger_kind: "calendar",
    frequency: "daily",
    time: "08:00",
    timezone: "UTC",

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
        await f.deny(() => f.request(`projects/${ref}/skill-selection`, "PUT", { installation_ids: [] }), 404, "project_not_found")
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
        assert.equal((await f.request(`projects/${ref}/skill-selection`, "PUT", { installation_ids: [] })).status, 200)
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
      assert.deepEqual(await new ProjectService(repository).replaceSkillSelection(f.scope, ref, ["installation_r237"], "r237", new AbortController().signal), {
        kind: "not_found",
      })
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
            triggerKind: "calendar",
            frequency: "daily",
            time: "08:00",
            timezone: "UTC",

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
        else if (operation === "skill")
          pending = new ProjectService(new PostgresProjectRepository({ pool: f.pool })).replaceSkillSelection(
            f.scope,
            project.id,
            ["installation_r237"],
            "r237",
            new AbortController().signal,
          )
        else
          pending = new PostgresScheduledTaskRepository({ pool: f.pool }).createScheduledTask(
            f.scope,
            {
              projectId: project.id,
              title: "Denied",
              prompt: "Denied",
              triggerKind: "calendar",
              frequency: "daily",
              time: "08:00",
              timezone: "UTC",

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
        else if (operation === "skill") assert.deepEqual(result.value, { kind: "not_found" })
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
// R241: real HTTP / owner PostgreSQL rename acceptance. IAM alone is the boundary double.
// Root supplies the already-installed isolated database; no schema mutation or fake store here.
async function r241Fixture(t, observeDeletionSignal) {
  const pool = new Pool({ connectionString: postgresUrl, options: "-c search_path=kokoro_bff -c timezone=UTC" })
  const tenant = `r241_${randomUUID().replaceAll("-", "")}`
  const owner = "r241_owner"
  const admission = new SessionAdmissionDouble()
  const token = `r241-${randomUUID()}`
  admission.allow(token, { namespace: tenant, userId: owner })
  const headers = { "x-kokoro-service": "web-bff", "x-kokoro-internal-secret": "web-secret", authorization: `Bearer ${token}` }
  let store
  let server
  let base
  let tables = []
  const stop = async () => {
    if (server) {
      await server.shutdown(1000)
      server = undefined
    }
    if (store) {
      await store.close()
      store = undefined
    }
  }
  t.after(async () => {
    try {
      await stop()
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
  })
  tables = (
    await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='kokoro_bff' AND table_type='BASE TABLE'
    AND (table_name='bff_idempotency_receipt' OR table_name IN
      (SELECT table_name FROM information_schema.columns WHERE table_schema='kokoro_bff' AND column_name='tenant_id')) ORDER BY table_name`)
  ).rows.map((row) => row.table_name)
  assert.ok(tables.includes("bff_project") && tables.includes("bff_idempotency_receipt"), "Root must install the existing canonical schema")
  assert.ok(tables.every((name) => /^bff_[a-z_]+$/u.test(name)))
  const start = async (configTenant = tenant) => {
    store = new PostgresBffRepositories(postgresUrl, redisUrl)
    await store.ready()
    if (observeDeletionSignal !== undefined) {
      const readDeletion = store.services.projects.deletion.bind(store.services.projects)
      store.services.projects.deletion = (scope, projectId, signal) => {
        observeDeletionSignal(signal)
        return readDeletion(scope, projectId, signal)
      }
    }
    server = createBffServer(bffConfig({ tenantId: configTenant }), {
      businessStore: store,
      sessionAdmission: admission,
      agentDispatchDispatcher: r237IdleWorker,
      agentCancellationDispatcher: r237IdleWorker,
      agUiProjector: r237IdleWorker,
      scheduledTaskDispatcher: r237IdleWorker,
      scheduledAgentDispatcher: r237IdleWorker,
      scheduledAgentTerminalConsumer: r237IdleWorker,
    })
    base = await listen(server)
  }
  await start()
  const request = async (path, method = "GET", payload, extra = {}, signal) => {
    const response = await fetch(`${base}/v1/${path}`, {
      method,
      headers: { ...headers, "content-type": "application/json", ...extra },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
      signal: signal ?? AbortSignal.timeout(6000),
    })
    return { status: response.status, body: await response.json(), headers: response.headers }
  }
  const raw = async (path, body, rawExtra = []) => {
    const { request: httpRequest } = await import("node:http")
    const url = new URL(base)
    return new Promise((resolve, reject) => {
      const outgoing = httpRequest(
        {
          hostname: url.hostname,
          port: url.port,
          method: "PATCH",
          path: `/v1/${path}`,
          headers: ["Host", url.host, ...Object.entries(headers).flat(), ...rawExtra, "Content-Length", String(Buffer.byteLength(body))],
          signal: AbortSignal.timeout(6000),
        },
        (response) => {
          const chunks = []
          response.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
          response.once("error", reject)
          response.once("end", () => {
            try {
              resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString("utf8")), headers: new Headers(response.headers) })
            } catch (error) {
              reject(
                new Error(
                  `R241 raw JSON response diagnostic: ${JSON.stringify({
                    status: response.statusCode,
                    requestBytes: Buffer.byteLength(body),
                    rawExtra,
                    responseBytes: Buffer.concat(chunks).byteLength,
                  })}`,
                  { cause: error },
                ),
              )
            }
          })
        },
      )
      outgoing.once("error", reject)
      outgoing.end(body)
    })
  }
  const facts = async () => {
    const result = {}
    for (const table of tables)
      result[table] = (await pool.query(`SELECT to_jsonb(fact) AS row FROM ${table} fact ORDER BY to_jsonb(fact)::text`)).rows.map(({ row }) => row)
    return result
  }
  const project = async (name = "改名前项目") => {
    const result = await request("projects", "POST", { name }, { "idempotency-key": `create-${randomUUID()}` })
    assert.equal(result.status, 200, JSON.stringify(result.body))
    const value = result.body.data.project
    assert.match(value.id, /^project_[0-9a-f-]{36}$/u)
    return value
  }
  const rename = (id, name, key = `rename-${randomUUID()}`, signal) => request(`projects/${id}/name`, "PATCH", { name }, { "idempotency-key": key }, signal)
  const denied = async (run, status, code, retryable = false) => {
    const before = await facts()
    const result = await run()
    assert.equal(result.status, status, JSON.stringify(result.body))
    r241Headers(result)
    assert.deepEqual(Object.keys(result.body), ["error"])
    assert.deepEqual(Object.keys(result.body.error).sort(), ["code", "message", "retryable"])
    assert.equal(result.body.error.code, code)
    assert.equal(result.body.error.retryable, retryable)
    assert.equal(typeof result.body.error.message, "string")
    assert.ok(result.body.error.message.length > 0)
    assert.deepEqual(await facts(), before, "rejected request mutated owner facts/receipt")
  }
  return {
    get ownerPool() {
      return store.database.pool
    },
    pool,
    tenant,
    owner,
    token,
    admission,
    request,
    raw,
    facts,
    project,
    rename,
    denied,
    restart: async (configTenant = tenant) => {
      await stop()
      await start(configTenant)
    },
  }
}

function r241Headers(result) {
  const id = result.headers.get("x-request-id")
  assert.ok(id && id.length <= 128, "response requires bounded request ID")
  assert.equal(result.headers.get("cache-control"), "no-store")
}

function r241Ack(result, projectId, name) {
  assert.equal(result.status, 200, `valid rename requires real HTTP 200: ${JSON.stringify(result.body)}`)
  r241Headers(result)
  assert.deepEqual(result.body, { data: { project_id: projectId, name } })
}

integrationTest("R241 rename first legal HTTP ACK and authoritative GET list slug restart", async (t) => {
  const f = await r241Fixture(t)
  const project = await f.project()
  const before = (await f.pool.query("SELECT to_jsonb(p) AS row FROM bff_project p WHERE project_id=$1", [project.id])).rows[0].row
  r241Ack(await f.rename(project.id, "  中文项目 新名称  ", "r241-first"), project.id, "中文项目 新名称")
  const verify = async () => {
    for (const ref of [project.id, project.slug]) {
      const result = await f.request(`projects/${ref}`)
      assert.equal(result.status, 200)
      assert.equal(result.body.data.project.name, "中文项目 新名称")
      assert.equal(result.body.data.project.id, project.id)
      assert.equal(result.body.data.project.slug, project.slug)
    }
    const list = await f.request("projects")
    assert.equal(list.status, 200)
    assert.deepEqual(
      list.body.data.projects.map(({ id, name, slug }) => ({ id, name, slug })),
      [{ id: project.id, name: "中文项目 新名称", slug: project.slug }],
    )
    const after = (await f.pool.query("SELECT to_jsonb(p) AS row FROM bff_project p WHERE project_id=$1", [project.id])).rows[0].row
    const { name: oldName, updated_at: oldTime, ...oldRest } = before
    const { name, updated_at: newTime, ...rest } = after
    assert.equal(name, "中文项目 新名称")
    assert.deepEqual(rest, oldRest, "rename changed fields beyond name/updated_at")
  }
  await verify()
  await f.restart() // New actual repository pool and HTTP server, not a cached object read.
  await verify()
})

integrationTest("R241 rename no-op receipt equivalent trim conflict and delayed old-key replay", async (t) => {
  const f = await r241Fixture(t)
  const project = await f.project()
  r241Ack(await f.rename(project.id, "名称 A", "key-a"), project.id, "名称 A")
  const beforeNoop = await f.facts()
  r241Ack(await f.rename(project.id, " 名称 A ", "key-noop"), project.id, "名称 A")
  const afterNoop = await f.facts()
  const receiptRows = afterNoop.bff_idempotency_receipt
  assert.equal(receiptRows.length, beforeNoop.bff_idempotency_receipt.length + 1)
  assert.deepEqual(
    { ...afterNoop, bff_idempotency_receipt: [] },
    { ...beforeNoop, bff_idempotency_receipt: [] },
    "same-name new-key changed Project including updated_at",
  )
  for (const row of beforeNoop.bff_idempotency_receipt) assert.ok(receiptRows.some((value) => JSON.stringify(value) === JSON.stringify(row)))
  const beforeReplay = await f.facts()
  r241Ack(await f.rename(project.id, "\t名称 A\n", "key-a"), project.id, "名称 A")
  assert.deepEqual(await f.facts(), beforeReplay)
  await f.denied(() => f.rename(project.id, "其他名", "key-a"), 409, "idempotency_conflict")
  r241Ack(await f.rename(project.id, "名称 B", "key-b"), project.id, "名称 B")
  const beforeOld = await f.facts()
  r241Ack(await f.rename(project.id, "名称 A", "key-a"), project.id, "名称 A")
  assert.deepEqual(await f.facts(), beforeOld, "late old key rewrote later facts")
  assert.equal((await f.request(`projects/${project.id}`)).body.data.project.name, "名称 B")
})

integrationTest("R241 rename normalized name and raw input boundaries leave all facts unchanged", async (t) => {
  const f = await r241Fixture(t)
  const project = await f.project()
  for (const name of [" 中文  内部空白 ", "x".repeat(160), "😀".repeat(80), ` ${"x".repeat(160)} `, "e\u0301", "é"])
    r241Ack(await f.rename(project.id, name), project.id, name.trim())
  const other = await f.project("r241-second-project")
  r241Ack(await f.rename(project.id, other.name), project.id, other.name)
  for (const name of ["", " \t\n", null, 1, [], {}, "x".repeat(161), "😀".repeat(81), "a\u0000b"])
    await f.denied(() => f.rename(project.id, name), 400, "invalid_project_rename")
  const path = `projects/${project.id}/name`
  for (const payload of [{}, { name: "合法", owner_id: f.owner }, { name: "合法", instruction: "不要写入" }])
    await f.denied(() => f.request(path, "PATCH", payload, { "idempotency-key": randomUUID() }), 400, "invalid_project_rename")
  const rawKey = ["Content-Type", "application/json", "Idempotency-Key", "r241-raw"]
  const boundedJson = JSON.stringify({ name: "字节边界" })
  const exactBody = boundedJson + " ".repeat(65536 - Buffer.byteLength(boundedJson))
  r241Ack(await f.raw(path, exactBody, ["Content-Type", "application/json", "Idempotency-Key", "K".repeat(128)]), project.id, "字节边界")
  await f.denied(() => f.raw(path, exactBody + " ", rawKey), 400, "invalid_project_rename")
  for (const body of [
    '{"name":"a","name":"b"}',
    '{"name":"\\ud800"}',
    '{"name":',
    Buffer.from([123, 34, 110, 97, 109, 101, 34, 58, 34, 0xff, 34, 125]),
    JSON.stringify({ name: "x".repeat(65536) }),
  ])
    await f.denied(() => f.raw(path, body, rawKey), 400, "invalid_project_rename")
  await f.denied(() => f.raw(path, '{"name":"合法"}', ["Content-Type", "application/json"]), 400, "idempotency_key_required")
  for (const key of ["", "a,b", "a b", "a\tb", "x".repeat(129)])
    await f.denied(() => f.raw(path, '{"name":"合法"}', ["Content-Type", "application/json", "Idempotency-Key", key]), 400, "invalid_project_rename")
  await f.denied(() => f.raw(path, '{"name":"合法"}', [...rawKey, "Idempotency-Key", "duplicate"]), 400, "invalid_project_rename")
  await f.denied(() => f.raw(path, '{"name":"合法"}', [...rawKey, "Content-Type", "application/json"]), 400, "invalid_project_rename")
  await f.denied(() => f.raw(path, '{"name":"合法"}', ["Content-Type", "text/plain", "Idempotency-Key", "plain"]), 400, "invalid_project_rename")
  for (const ref of [project.slug, "project_bad"]) await f.denied(() => f.rename(ref, "合法"), 400, "invalid_project_rename")
  for (const suffix of ["?", "?extra=1"]) await f.denied(() => f.raw(path + suffix, '{"name":"合法"}', rawKey), 400, "invalid_project_rename")
})

integrationTest("R241 rename current owner tenant active and IAM admission precede replay", async (t) => {
  const f = await r241Fixture(t)
  const project = await f.project()
  r241Ack(await f.rename(project.id, "已提交", "replay-key"), project.id, "已提交")
  const path = `projects/${project.id}/name`
  for (const [label, identity, status, code] of [
    ["foreign", { namespace: f.tenant, userId: "other_owner" }, 404, "project_not_found"],
    ["tenant", { namespace: `${f.tenant}_other`, userId: f.owner }, 403, "product_tenant_forbidden"],
  ]) {
    const token = `r241-${label}-${randomUUID()}`
    f.admission.allow(token, identity)
    await f.denied(() => f.request(path, "PATCH", { name: "已提交" }, { authorization: `Bearer ${token}`, "idempotency-key": "replay-key" }), status, code)
  }
  await f.denied(() => f.rename(`project_${randomUUID()}`, "合法"), 404, "project_not_found")
  for (const [status, code] of [
    [401, "session_invalid"],
    [403, "session_forbidden"],
    [429, "session_rate_limited"],
    [503, "iam_admission_unavailable"],
  ]) {
    f.admission.deny(f.token, { ok: false, status, code })
    await f.denied(() => f.rename(project.id, "已提交", "replay-key"), status, code, status === 429 || status === 503)
  }
  f.admission.allow(f.token, { namespace: f.tenant, userId: f.owner })
  await f.denied(
    () => f.request(path, "PATCH", { name: "合法" }, { authorization: "", "idempotency-key": "missing-session" }),
    401,
    "session_authentication_required",
  )
  await f.denied(
    () => f.request(path, "PATCH", { name: "合法" }, { "x-kokoro-internal-secret": "wrong", "idempotency-key": "wrong-service" }),
    403,
    "service_auth_failed",
  )
  await f.pool.query("UPDATE bff_project SET deleted_at=$2 WHERE project_id=$1", [project.id, r237Tombstone])
  await f.denied(() => f.rename(project.id, "已提交", "replay-key"), 404, "project_not_found")
  await f.denied(() => f.rename(project.id, "新名称"), 404, "project_not_found")
})

integrationTest("R241 rename missing configured tenant returns closed 503 before IAM without facts", async (t) => {
  const f = await r241Fixture(t)
  const project = await f.project()
  r241Ack(await f.rename(project.id, "已提交配置前置", "tenant-config-key"), project.id, "已提交配置前置")
  const beforeRestart = await f.facts()
  const calls = f.admission.calls.length
  await f.restart("") // Empty is intentional: null falls back to the default tenant in bffConfig.
  for (const key of ["tenant-config-key", "tenant-config-new-key"]) {
    await f.denied(() => f.rename(project.id, "已提交配置前置", key), 503, "product_tenant_not_configured", true)
    assert.equal(f.admission.calls.length, calls, "missing configured tenant must reject before IAM verification")
  }
  assert.deepEqual(await f.facts(), beforeRestart, "configuration failure changed owner facts across restart")
})
// R241 lifecycle: scheduling/fault seams forward every SQL to the real owned PG client.
async function r241Until(read, timeout = 800) {
  const end = performance.now() + timeout
  while (performance.now() < end) {
    const value = await read()
    if (value) return value
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error("R241 real PostgreSQL phase was not observed before deadline")
}

function r241ObservePool(pool, afterQuery = async () => {}) {
  const connect = pool.connect
  const originals = new Map()
  const leases = []
  let sequence = 0
  let restored = false
  pool.connect = async function (...args) {
    assert.equal(args.length, 0, "this seam observes production promise-based checkouts, not callback pool queries")
    const client = await connect.apply(this, args)
    if (!originals.has(client)) originals.set(client, { query: client.query, release: client.release, fixtureErrors: [] })
    const original = originals.get(client)
    original.release = client.release // pg-pool replaces this closure for every checkout.
    const release = client.release
    const lease = {
      client,
      acquiredAt: performance.now(),
      pid: client.processID,
      events: [],
      releases: [],
      listeners: [],
      fixtureErrors: original.fixtureErrors,
    }
    leases.push(lease)
    client.query = async function (...queryArgs) {
      const [sql, values] = queryArgs
      const event = { sql, values, started: performance.now(), result: null, order: null }
      lease.events.push(event)
      if (sql === "BEGIN") lease.listeners = this.listeners("error")
      let result
      try {
        result = await original.query.apply(this, queryArgs)
      } catch (error) {
        event.errorCode = error.code
        event.finished = performance.now()
        throw error
      }
      event.finished = performance.now()
      event.result = result
      event.order = ++sequence
      await afterQuery(lease, event)
      return result
    }
    client.release = function (destroy) {
      lease.releases.push({ destroy: destroy === true, listeners: this.listeners("error") })
      return release.call(this, destroy)
    }
    return client
  }
  return {
    leases,
    restore() {
      if (restored) return
      restored = true
      pool.connect = connect
      for (const [client, original] of originals) {
        client.query = original.query
        client.release = original.release
        for (const listener of original.fixtureErrors) client.removeListener("error", listener)
      }
      process.stdout.write(
        `# R241_LEASE_OBSERVATION ${JSON.stringify({
          pool: { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount },
          leases: leases.map((lease) => ({
            pid: lease.pid,
            phases: lease.events.map((event) => ({
              sql: event.sql.slice(0, 65),
              completed: event.result !== null,
              order: event.order,
              elapsedMs: event.finished === undefined ? null : event.finished - event.started,
            })),
            releases: lease.releases.map((value) => value.destroy),
            productionListeners: lease.listeners.length,
            productionListenersAfter: lease.listeners.filter((listener) => lease.client.listeners("error").includes(listener)).length,
          })),
        })}\n`,
      )
      for (const [client, original] of originals) {
        assert.equal(client.query, original.query)
        for (const lease of leases.filter((item) => item.client === client))
          for (const listener of lease.listeners)
            assert.equal(client.listeners("error").includes(listener), false, "production lease listener survived release")
      }
      assert.equal(pool.connect, connect)
    },
  }
}

function r241StorageError(result) {
  assert.equal(result.status, 503, JSON.stringify(result.body))
  r241Headers(result)
  assert.deepEqual(Object.keys(result.body), ["error"])
  assert.deepEqual(Object.keys(result.body.error).sort(), ["code", "message", "retryable"])
  assert.equal(result.body.error.code, "business_store_unavailable")
  assert.equal(result.body.error.retryable, true)
  assert.ok(typeof result.body.error.message === "string" && result.body.error.message.length > 0)
}

const r241Scope = (f, project, key) => JSON.stringify([f.tenant, f.owner, "project.rename:v1", project.id, key])
const r241Observed = (promise) =>
  promise.then(
    (value) => ({ value }),
    (error) => ({ error }),
  )
function r241Value(result) {
  assert.equal(result.error, undefined, String(result.error))
  return result.value
}

async function r241CommittedFacts(f, before, project, name, receipts) {
  const { createHash } = await import("node:crypto")
  const after = await f.facts()
  const { bff_project: oldProjects, bff_idempotency_receipt: oldReceipts, ...oldOther } = before
  const { bff_project: projects, bff_idempotency_receipt: stored, ...other } = after
  assert.deepEqual(other, oldOther, "rename changed unrelated owner facts")
  assert.deepEqual(
    projects.filter((row) => row.project_id !== project.id),
    oldProjects.filter((row) => row.project_id !== project.id),
  )
  const { name: oldName, updated_at: oldTime, ...oldRest } = oldProjects.find((row) => row.project_id === project.id)
  const { name: currentName, updated_at: currentTime, ...rest } = projects.find((row) => row.project_id === project.id)
  assert.equal(currentName, name)
  assert.deepEqual(rest, oldRest)
  assert.equal(stored.length, oldReceipts.length + receipts.length)
  for (const old of oldReceipts) assert.ok(stored.some((row) => JSON.stringify(row) === JSON.stringify(old)))
  for (const [key, receiptName] of receipts) {
    const rows = stored.filter((row) => row.scope === r241Scope(f, project, key))
    assert.equal(rows.length, 1)
    assert.deepEqual(rows[0], {
      scope: r241Scope(f, project, key),
      fingerprint: createHash("sha256")
        .update(JSON.stringify(["project.rename:v1", project.id, receiptName]), "utf8")
        .digest("hex"),
      status: 200,
      response_body: { data: { project_id: project.id, name: receiptName } },
      created_at: rows[0].created_at,
    })
    assert.equal(typeof rows[0].created_at, "string")
  }
  return after
}

async function r241Block(f, project, change) {
  const client = await f.pool.connect()
  try {
    await client.query("BEGIN")
    if (change === "tombstone")
      await client.query("UPDATE bff_project SET deleted_at=$2 WHERE project_id=$1 AND tenant_id=$3", [project.id, r237Tombstone, f.tenant])
    else if (change === "owner")
      await client.query("UPDATE bff_project SET owner_id='r241_reassigned' WHERE project_id=$1 AND tenant_id=$2", [project.id, f.tenant])
    else await client.query("SELECT project_id FROM bff_project WHERE tenant_id=$1 AND project_id=$2 FOR UPDATE", [f.tenant, project.id])
    return client
  } catch (error) {
    client.release(true)
    throw error
  }
}

async function r241Blocked(f, blocker, expected = 1) {
  return r241Until(async () => {
    const rows = (
      await f.pool.query(
        `WITH RECURSIVE waiting AS (
      SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid))
      UNION SELECT a.pid FROM pg_stat_activity a JOIN waiting w ON w.pid=ANY(pg_blocking_pids(a.pid))
      WHERE a.datname=current_database())
      SELECT a.pid FROM pg_stat_activity a JOIN waiting w USING(pid)
      WHERE a.query LIKE '%bff_project%' AND a.query LIKE '%FOR UPDATE%'`,
        [blocker.processID ?? blocker],
      )
    ).rows
    return rows.length === expected ? rows.map((row) => row.pid) : null
  })
}

async function r241Fault(f, scope, mode, seconds = 10) {
  const name = `r241_${randomUUID().replaceAll("-", "")}`
  const escaped = scope.replaceAll("'", "''")
  const action =
    mode === "raise"
      ? "RAISE EXCEPTION 'R241_RECEIPT_SQL_FAULT' USING ERRCODE='P0001';"
      : `PERFORM set_config('application_name','${name}',true); PERFORM pg_sleep(${seconds});`
  await f.pool.query(
    `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.scope='${escaped}' THEN ${action} END IF; RETURN NEW; END $$`,
  )
  try {
    await f.pool.query(`CREATE TRIGGER ${name} BEFORE INSERT ON bff_idempotency_receipt FOR EACH ROW EXECUTE FUNCTION ${name}()`)
  } catch (error) {
    await f.pool.query(`DROP FUNCTION ${name}()`)
    throw error
  }
  let removed = false
  return {
    name,
    async sleeping() {
      return r241Until(async () => {
        const rows = (
          await f.pool.query("SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND application_name=$1 AND wait_event='PgSleep'", [name])
        ).rows
        assert.ok(rows.length <= 1)
        return rows[0]?.pid
      }, 1500)
    },
    async remove() {
      if (removed) return
      await f.pool.query(`DROP TRIGGER ${name} ON bff_idempotency_receipt`)
      await f.pool.query(`DROP FUNCTION ${name}()`)
      assert.equal((await f.pool.query("SELECT count(*)::int AS n FROM pg_trigger WHERE tgname=$1", [name])).rows[0].n, 0)
      assert.equal((await f.pool.query("SELECT to_regprocedure($1) AS fn", [`kokoro_bff.${name}()`])).rows[0].fn, null)
      removed = true
    },
  }
}

async function r241Released(f, observer, pid, destroyed) {
  const lease = observer.leases.find((item) => item.pid === pid)
  assert.ok(lease, "fault PID must be the exact observed checkout")
  await r241Until(() => lease.releases.length === 1, 1500)
  assert.deepEqual(
    lease.releases.map((item) => item.destroy),
    [destroyed],
  )
  assert.equal(lease.listeners.length, 1, "checked-out transaction has exactly one production error listener")
  assert.ok(lease.releases[0].listeners.includes(lease.listeners[0]), "production listener remains through release")
  assert.equal(lease.client.listeners("error").includes(lease.listeners[0]), false)
  if (destroyed) await r241Until(async () => (await f.pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE pid=$1", [pid])).rows[0].n === 0, 1500)
  return lease
}

async function r241PoolUsable(pool, brokenPid) {
  const client = await pool.connect()
  try {
    const pid = (await client.query("SELECT pg_backend_pid() AS pid")).rows[0].pid
    if (brokenPid !== undefined) assert.notEqual(pid, brokenPid)
  } finally {
    client.release()
  }
  await r241Until(() => pool.waitingCount === 0 && pool.totalCount === pool.idleCount, 1500)
  process.stdout.write(`# R241_POOL_QUIESCENT ${JSON.stringify({ total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount })}\n`)
}

integrationTest("R241 lifecycle C1 C2 same-key concurrent rename uses two real clients and one write", async (t) => {
  for (const different of [false, true])
    await t.test(different ? "C2 different bodies" : "C1 same bodies", async (t) => {
      const f = await r241Fixture(t)
      const project = await f.project()
      const before = await f.facts()
      const blocker = await r241Block(f, project)
      const observer = r241ObservePool(f.ownerPool)
      const names = different ? ["并发 A", "并发 B"] : ["并发同名", "并发同名"]
      const pending = names.map((name) => r241Observed(f.rename(project.id, name, "same-key")))
      try {
        const pids = await r241Blocked(f, blocker, 2)
        assert.equal(new Set(pids).size, 2)
        await blocker.query("COMMIT")
        const responses = (await Promise.all(pending)).map(r241Value)
        assert.deepEqual(responses.map((result) => result.status).sort(), different ? [200, 409] : [200, 200])
        const winner = responses.find((result) => result.status === 200).body.data.name
        for (const result of responses) {
          if (result.status === 200) r241Ack(result, project.id, winner)
          else {
            r241Headers(result)
            assert.deepEqual(Object.keys(result.body), ["error"])
            assert.deepEqual(Object.keys(result.body.error).sort(), ["code", "message", "retryable"])
            assert.equal(result.body.error.code, "idempotency_conflict")
            assert.equal(result.body.error.retryable, false)
          }
        }
        assert.equal(
          observer.leases.flatMap((lease) => lease.events).filter((event) => event.sql.startsWith("UPDATE bff_project") && event.result?.rowCount === 1).length,
          1,
        )
        await r241CommittedFacts(f, before, project, winner, [["same-key", winner]])
        for (const pid of pids) await r241Released(f, observer, pid, false)
      } finally {
        await blocker.query("ROLLBACK")
        blocker.release()
        await Promise.all(pending)
        observer.restore()
      }
      await r241PoolUsable(f.ownerPool)
    })
})

integrationTest("R241 lifecycle C3 different-key LWW follows real Project lock order both ways", async (t) => {
  for (const names of [
    ["A", "B"],
    ["B", "A"],
  ])
    await t.test(names.join(" then "), async (t) => {
      const f = await r241Fixture(t)
      const project = await f.project()
      const before = await f.facts()
      let firstPid
      let releaseGate
      const gate = new Promise((resolve) => {
        releaseGate = resolve
      })
      const observer = r241ObservePool(f.ownerPool, async (lease, event) => {
        if (firstPid === undefined && event.sql.includes("FOR UPDATE") && event.result.rowCount === 1) {
          firstPid = lease.pid
          await gate
        }
      })
      const first = r241Observed(f.rename(project.id, names[0], "first"))
      let second
      try {
        await r241Until(() => firstPid)
        second = r241Observed(f.rename(project.id, names[1], "second"))
        const [secondPid] = await r241Blocked(f, firstPid)
        releaseGate()
        r241Ack(r241Value(await first), project.id, names[0])
        r241Ack(r241Value(await second), project.id, names[1])
        const firstLease = await r241Released(f, observer, firstPid, false)
        const secondLease = await r241Released(f, observer, secondPid, false)
        assert.ok(firstLease.events.find((e) => e.sql === "COMMIT").order < secondLease.events.find((e) => e.sql === "COMMIT").order)
        await r241CommittedFacts(f, before, project, names[1], [
          ["first", names[0]],
          ["second", names[1]],
        ])
      } finally {
        releaseGate()
        await first
        if (second) await second
        observer.restore()
      }
      await r241PoolUsable(f.ownerPool)
    })
})

integrationTest("R241 lifecycle Q1-Q4 current locked owner and tombstone beat new or replay receipt", async (t) => {
  for (const change of ["tombstone", "owner"])
    for (const replay of [false, true])
      await t.test(`${change} ${replay ? "old" : "new"} key`, async (t) => {
        const f = await r241Fixture(t)
        const project = await f.project()
        r241Ack(await f.rename(project.id, "原ACK", "old"), project.id, "原ACK")
        const before = await f.facts()
        const blocker = await r241Block(f, project, change)
        const fixtureRow = (await blocker.query("SELECT to_jsonb(p) AS row FROM bff_project p WHERE project_id=$1", [project.id])).rows[0].row
        const observer = r241ObservePool(f.ownerPool)
        const pending = r241Observed(f.rename(project.id, "原ACK", replay ? "old" : "new"))
        try {
          const [pid] = await r241Blocked(f, blocker)
          await blocker.query("COMMIT")
          const result = r241Value(await pending)
          assert.equal(result.status, 404)
          r241Headers(result)
          assert.deepEqual(Object.keys(result.body), ["error"])
          assert.deepEqual(Object.keys(result.body.error).sort(), ["code", "message", "retryable"])
          assert.equal(result.body.error.code, "project_not_found")
          assert.equal(result.body.error.retryable, false)
          const expected = structuredClone(before)
          const index = expected.bff_project.findIndex((row) => row.project_id === project.id)
          expected.bff_project[index] = fixtureRow
          const actual = await f.facts()
          const byId = (a, b) => a.project_id.localeCompare(b.project_id)
          expected.bff_project.sort(byId)
          actual.bff_project.sort(byId)
          assert.deepEqual(actual, expected)
          await r241Released(f, observer, pid, false)
          assert.equal(
            observer.leases.flatMap((l) => l.events).some((e) => e.sql.startsWith("SELECT fingerprint")),
            false,
            "qualification must precede receipt lookup",
          )
        } finally {
          await blocker.query("ROLLBACK")
          blocker.release()
          await pending
          observer.restore()
        }
        await r241PoolUsable(f.ownerPool)
      })
})

integrationTest("R241 lifecycle F1 receipt SQL exception rolls back Project and permits same-key recovery", async (t) => {
  const f = await r241Fixture(t)
  const project = await f.project()
  const before = await f.facts()
  const fault = await r241Fault(f, r241Scope(f, project, "fault"), "raise")
  const observer = r241ObservePool(f.ownerPool)
  try {
    r241StorageError(await f.rename(project.id, "回滚后新名", "fault"))
    assert.deepEqual(await f.facts(), before)
    const lease = observer.leases[0]
    assert.ok(lease.events.some((e) => e.sql.startsWith("UPDATE bff_project") && e.result?.rowCount === 1))
    assert.ok(lease.events.some((e) => e.sql === "ROLLBACK" && e.result?.command === "ROLLBACK"))
    assert.ok(
      lease.events.some((e) => e.sql.startsWith("INSERT INTO bff_idempotency_receipt") && e.errorCode === "P0001"),
      "precise receipt trigger must raise real PG error",
    )
    await r241Released(f, observer, lease.pid, false)
  } finally {
    try {
      await fault.remove()
    } finally {
      observer.restore()
    }
  }
  r241Ack(await f.rename(project.id, "回滚后新名", "fault"), project.id, "回滚后新名")
  await r241CommittedFacts(f, before, project, "回滚后新名", [["fault", "回滚后新名"]])
  await r241PoolUsable(f.ownerPool)
})

integrationTest("R241 lifecycle F2 real receipt backend termination destroys exact client and fully rolls back", async (t) => {
  const f = await r241Fixture(t)
  const project = await f.project()
  const before = await f.facts()
  const fault = await r241Fault(f, r241Scope(f, project, "terminate"), "sleep")
  const observer = r241ObservePool(f.ownerPool)
  const started = performance.now()
  const pending = r241Observed(f.rename(project.id, "终止恢复", "terminate"))
  let pid
  try {
    pid = await fault.sleeping()
    const lease = observer.leases.find((l) => l.pid === pid)
    assert.ok(lease)
    assert.ok(lease.events.some((e) => e.sql.startsWith("UPDATE bff_project") && e.result?.rowCount === 1))
    assert.equal((await f.pool.query("SELECT pg_terminate_backend($1) AS done", [pid])).rows[0].done, true)
    r241StorageError(r241Value(await pending))
    assert.ok(performance.now() - started < 5000)
    await r241Released(f, observer, pid, true)
    assert.deepEqual(await f.facts(), before)
  } finally {
    await pending
    try {
      await fault.remove()
    } finally {
      observer.restore()
    }
  }
  await r241PoolUsable(f.ownerPool, pid)
  r241Ack(await f.rename(project.id, "终止恢复", "terminate"), project.id, "终止恢复")
  await r241CommittedFacts(f, before, project, "终止恢复", [["terminate", "终止恢复"]])
})

integrationTest("R241 lifecycle F4 real COMMIT result lost ACK reconciles once and never overwrites later B", async (t) => {
  for (const laterB of [false, true])
    await t.test(laterB ? "B then old A" : "same-key A recovery", async (t) => {
      const f = await r241Fixture(t)
      const project = await f.project()
      const before = await f.facts()
      let brokenPid
      const observer = r241ObservePool(f.ownerPool, async (lease, event) => {
        if (event.sql.startsWith("INSERT INTO bff_idempotency_receipt") && event.values[0] === r241Scope(f, project, "A") && event.result.rowCount === 1)
          lease.inserted = true
        if (lease.inserted && brokenPid === undefined && event.sql === "COMMIT") {
          assert.equal(event.result.command, "COMMIT")
          brokenPid = lease.pid
          const absorb = () => {}
          lease.fixtureErrors.push(absorb)
          lease.client.on("error", absorb)
          lease.client.connection.stream.destroy()
          throw new Error("R241_REAL_COMMIT_ACK_LOST")
        }
      })
      try {
        r241StorageError(await f.rename(project.id, "A", "A"))
        assert.ok(brokenPid)
        const lease = await r241Released(f, observer, brokenPid, true)
        assert.equal(
          lease.events.some((e) => e.sql === "ROLLBACK"),
          false,
        )
        await r241CommittedFacts(f, before, project, "A", [["A", "A"]])
      } finally {
        observer.restore()
      }
      await r241PoolUsable(f.ownerPool, brokenPid)
      if (laterB) r241Ack(await f.rename(project.id, "B", "B"), project.id, "B")
      const beforeReplay = await f.facts()
      const calls = f.admission.calls.length
      r241Ack(await f.rename(project.id, "A", "A"), project.id, "A")
      assert.equal(f.admission.calls.length, calls + 1)
      assert.deepEqual(await f.facts(), beforeReplay)
      await r241CommittedFacts(
        f,
        before,
        project,
        laterB ? "B" : "A",
        laterB
          ? [
              ["A", "A"],
              ["B", "B"],
            ]
          : [["A", "A"]],
      )
      await f.restart()
      assert.equal((await f.request(`projects/${project.id}`)).body.data.project.name, laterB ? "B" : "A")
    })
})

integrationTest("R241 lifecycle L1 saturated max10 pool spends one budget and normally returns late unbegun client", { timeout: 12000 }, async (t) => {
  const f = await r241Fixture(t)
  const project = await f.project()
  const before = await f.facts()
  const pool = f.ownerPool
  assert.equal(pool.options.max, 10)
  const held = []
  let pending
  let observer
  try {
    for (let i = 0; i < 10; i++) held.push(await pool.connect())
    assert.equal(pool.totalCount, 10)
    assert.equal(pool.idleCount, 0)
    observer = r241ObservePool(pool)
    const started = performance.now()
    pending = r241Observed(f.rename(project.id, "等待恢复", "pool"))
    await r241Until(() => pool.waitingCount === 1, 1500)
    r241StorageError(r241Value(await pending))
    const elapsed = performance.now() - started
    t.diagnostic(`L1 elapsed_ms=${elapsed}`)
    assert.ok(elapsed >= 4200 && elapsed < 5000, `single acquire budget elapsed ${elapsed}`)
    assert.deepEqual(await f.facts(), before)
    assert.equal(observer.leases.length, 0, "no acquired client means no BEGIN")
    held.shift().release()
    await r241Until(() => observer.leases.length === 1 && observer.leases[0].releases.length === 1 && pool.waitingCount === 0, 1500)
    assert.deepEqual(observer.leases[0].events, [])
    assert.deepEqual(
      observer.leases[0].releases.map((x) => x.destroy),
      [false],
    )
    assert.equal(pool.totalCount, 10)
    assert.equal(pool.idleCount, 1, "late client returns normally while nine slots remain held")
    assert.deepEqual(await f.facts(), before)
  } finally {
    for (const client of held) client.release()
    if (pending) await pending
    if (observer) observer.restore()
  }
  await r241PoolUsable(pool)
  r241Ack(await f.rename(project.id, "等待恢复", "pool"), project.id, "等待恢复")
  await r241CommittedFacts(f, before, project, "等待恢复", [["pool", "等待恢复"]])
})

integrationTest("R241 lifecycle L2 real Project lock expires within one second and same key recovers", async (t) => {
  const f = await r241Fixture(t)
  const project = await f.project()
  const before = await f.facts()
  const blocker = await r241Block(f, project)
  const observer = r241ObservePool(f.ownerPool)
  const started = performance.now()
  const pending = r241Observed(f.rename(project.id, "锁恢复", "lock"))
  try {
    const [pid] = await r241Blocked(f, blocker)
    r241StorageError(r241Value(await pending))
    const elapsed = performance.now() - started
    t.diagnostic(`L2 elapsed_ms=${elapsed}`)
    assert.ok(elapsed >= 800 && elapsed < 2000, `lock timeout elapsed ${elapsed}`)
    assert.deepEqual(await f.facts(), before)
    await r241Released(f, observer, pid, false)
    assert.equal((await blocker.query("SELECT 1 AS value")).rows[0].value, 1, "unrelated owned blocker is not killed")
  } finally {
    await blocker.query("ROLLBACK")
    blocker.release()
    await pending
    observer.restore()
  }
  await r241PoolUsable(f.ownerPool)
  r241Ack(await f.rename(project.id, "锁恢复", "lock"), project.id, "锁恢复")
  await r241CommittedFacts(f, before, project, "锁恢复", [["lock", "锁恢复"]])
})

integrationTest("R241 lifecycle L3 acquire lock and real PgSleep share one cumulative 4.5 second deadline", { timeout: 12000 }, async (t) => {
  const f = await r241Fixture(t)
  const project = await f.project()
  const before = await f.facts()
  const pool = f.ownerPool
  const fault = await r241Fault(f, r241Scope(f, project, "cumulative"), "sleep", 3)
  const blocker = await r241Block(f, project)
  const held = []
  let observer
  let pending
  let pid
  try {
    assert.equal(pool.options.max, 10)
    for (let i = 0; i < 10; i++) held.push(await pool.connect())
    observer = r241ObservePool(pool)
    const started = performance.now()
    pending = r241Observed(f.rename(project.id, "累计恢复", "cumulative"))
    await r241Until(() => pool.waitingCount === 1, 1500)
    await new Promise((resolve) => setTimeout(resolve, 1500))
    held.shift().release()
    ;[pid] = await r241Blocked(f, blocker)
    await new Promise((resolve) => setTimeout(resolve, 500))
    await blocker.query("COMMIT")
    assert.equal(await fault.sleeping(), pid)
    r241StorageError(r241Value(await pending))
    const elapsed = performance.now() - started
    t.diagnostic(`L3 elapsed_ms=${elapsed}`)
    assert.ok(elapsed >= 4200 && elapsed < 5000, `cumulative deadline elapsed ${elapsed}`)
    const lease = await r241Released(f, observer, pid, true)
    assert.ok(lease.acquiredAt - started >= 1400, "real pool phase consumed the shared budget")
    const lock = lease.events.find((e) => e.sql.includes("FOR UPDATE"))
    assert.ok(lock.finished - lock.started >= 400 && lock.finished - lock.started < 1000, "real parent lock phase consumed the same budget")
    assert.ok(lease.events.some((e) => e.sql.startsWith("UPDATE bff_project") && e.result?.rowCount === 1))
    assert.equal(
      lease.events.some((e) => e.sql === "COMMIT"),
      false,
    )
    assert.deepEqual(await f.facts(), before)
  } finally {
    await blocker.query("ROLLBACK")
    blocker.release()
    for (const client of held) client.release()
    if (pending) await pending
    try {
      await fault.remove()
    } finally {
      if (observer) observer.restore()
    }
  }
  await r241PoolUsable(pool, pid)
  assert.deepEqual(await f.facts(), before, "no late SQL write after real sleeping backend disappearance")
  r241Ack(await f.rename(project.id, "累计恢复", "cumulative"), project.id, "累计恢复")
  await r241CommittedFacts(f, before, project, "累计恢复", [["cumulative", "累计恢复"]])
})

integrationTest("R241 lifecycle L6 HTTP abort during real Project lock or receipt SQL kills exact backend", async (t) => {
  for (const phase of ["lock", "receipt"])
    await t.test(phase, async (t) => {
      const f = await r241Fixture(t)
      const project = await f.project()
      const before = await f.facts()
      const blocker = phase === "lock" ? await r241Block(f, project) : null
      const fault = phase === "receipt" ? await r241Fault(f, r241Scope(f, project, "abort"), "sleep") : null
      const observer = r241ObservePool(f.ownerPool)
      const controller = new AbortController()
      const pending = r241Observed(f.rename(project.id, "取消恢复", "abort", controller.signal))
      let pid
      try {
        pid = blocker ? (await r241Blocked(f, blocker))[0] : await fault.sleeping()
        const started = performance.now()
        controller.abort()
        const result = await pending
        assert.ok(result.error, "aborted HTTP must not receive a successful response")
        assert.ok(performance.now() - started < 1500)
        const lease = await r241Released(f, observer, pid, true)
        if (phase === "receipt") assert.ok(lease.events.some((e) => e.sql.startsWith("UPDATE bff_project") && e.result?.rowCount === 1))
        assert.deepEqual(await f.facts(), before)
        observer.restore()
        await r241PoolUsable(f.ownerPool, pid) // Replacement succeeds before the parent blocker is released.
      } finally {
        controller.abort()
        if (blocker) {
          await blocker.query("ROLLBACK")
          blocker.release()
        }
        await pending
        try {
          if (fault) await fault.remove()
        } finally {
          observer.restore()
        }
      }
      r241Ack(await f.rename(project.id, "取消恢复", "abort"), project.id, "取消恢复")
      await r241CommittedFacts(f, before, project, "取消恢复", [["abort", "取消恢复"]])
    })
})

// R257: real BFF HTTP / owner PostgreSQL; IAM admission remains the existing boundary double.
// Root installs the current canonical schema in its isolated fixture before running this case.
// Reuse the owned-tenant lifecycle; do not add schema DDL, global deletion, or a fake store.
integrationTest("R257 personalization ordinary Session reads absent saves four fields and reads committed snapshot", async (t) => {
  const f = await r241Fixture(t)
  const currentUser = await f.request("me")
  assert.equal(currentUser.status, 200, "existing ordinary Session admission must succeed before personalization RED")
  assert.deepEqual(currentUser.body.data, { user_id: f.owner, tenant_id: f.tenant, platform_admin: false })

  const initial = await f.request("preferences/personalization")
  assert.equal(initial.status, 200, "an admitted ordinary user must read the absent personalization resource")
  r241Headers(initial)
  assert.deepEqual(initial.body, { data: { personalization: null, revision: 0 } })

  const personalization = {
    nickname: "R257 本人昵称 🌿",
    occupation: "测试职业",
    about: "仅用于本测试的非敏感介绍。\n第二行保留。",
    instructions: "本测试保存四项内容，不声明 Agent 已应用。",
  }
  const saved = await f.request("preferences/personalization", "PUT", { expected_revision: 0, ...personalization })
  assert.equal(saved.status, 200, "explicit conditional save must return a committed HTTP ACK without an Idempotency-Key")
  r241Headers(saved)
  assert.deepEqual(saved.body, { data: { personalization, revision: 1 } })

  const readBack = await f.request("preferences/personalization")
  assert.equal(readBack.status, 200, "a new HTTP read must recover the complete saved snapshot")
  r241Headers(readBack)
  assert.deepEqual(readBack.body, saved.body)
})

function r257PersonalizationFields(label = "A") {
  return { nickname: label, occupation: "测试职业", about: "自有测试介绍", instructions: "保留这段非敏感测试文本" }
}

function r257PersonalizationError(result, status, code) {
  assert.equal(result.status, status)
  r241Headers(result)
  assert.deepEqual(Object.keys(result.body), ["error"])
  assert.deepEqual(Object.keys(result.body.error).sort(), ["code", "message", "retryable"])
  assert.equal(result.body.error.code, code)
  assert.equal(result.body.error.retryable, false)
}

integrationTest("R257 personalization absent read is read-only and current owner survives restart and clear", async (t) => {
  const f = await r241Fixture(t)
  const path = "preferences/personalization"
  assert.deepEqual((await f.request(path)).body, { data: { personalization: null, revision: 0 } })
  assert.equal((await f.pool.query("SELECT count(*)::int AS n FROM bff_personalization WHERE tenant_id=$1", [f.tenant])).rows[0].n, 0)
  const fields = r257PersonalizationFields("本人 🌿")
  assert.equal((await f.request(path, "PUT", { expected_revision: 0, ...fields })).status, 200)
  const otherToken = `r257-other-${randomUUID()}`
  f.admission.allow(otherToken, { namespace: f.tenant, userId: "r257_other" })
  const other = await f.request(path, "GET", undefined, { authorization: `Bearer ${otherToken}` })
  assert.deepEqual(other.body, { data: { personalization: null, revision: 0 } })
  const otherFields = r257PersonalizationFields("另一本人")
  const otherSave = await f.request(path, "PUT", { expected_revision: 0, ...otherFields }, { authorization: `Bearer ${otherToken}` })
  assert.equal(otherSave.status, 200)
  const crossToken = `r257-cross-${randomUUID()}`
  f.admission.allow(crossToken, { namespace: `${f.tenant}_other`, userId: f.owner })
  r257PersonalizationError(await f.request(path, "GET", undefined, { authorization: `Bearer ${crossToken}` }), 403, "product_tenant_forbidden")
  await f.restart()
  assert.deepEqual((await f.request(path)).body, { data: { personalization: fields, revision: 1 } })
  const empty = { nickname: "", occupation: "", about: "", instructions: "" }
  assert.deepEqual((await f.request(path, "PUT", { expected_revision: 1, ...empty })).body, { data: { personalization: empty, revision: 2 } })
  assert.deepEqual((await f.request(path)).body, { data: { personalization: empty, revision: 2 } })
  assert.deepEqual((await f.request(path, "GET", undefined, { authorization: `Bearer ${otherToken}` })).body, {
    data: { personalization: otherFields, revision: 1 },
  })
  assert.equal((await f.pool.query("SELECT count(*)::int AS n FROM bff_idempotency_receipt WHERE position($1 in scope)>0", [f.tenant])).rows[0].n, 0)
})

integrationTest("R257 personalization first and subsequent concurrent CAS each have one winner without lost update", async (t) => {
  const f = await r241Fixture(t)
  const path = "preferences/personalization"
  for (const expected of [0, 1]) {
    const inputs = ["A", "B"].map((label) => ({ expected_revision: expected, ...r257PersonalizationFields(`${expected}-${label}`) }))
    const results = await Promise.all(inputs.map((body) => f.request(path, "PUT", body)))
    assert.deepEqual(results.map((result) => result.status).sort(), [200, 409])
    const winner = results.findIndex((result) => result.status === 200)
    const { expected_revision: ignored, ...fields } = inputs[winner]
    assert.equal(ignored, expected)
    assert.deepEqual(results[winner].body, { data: { personalization: fields, revision: expected + 1 } })
    r257PersonalizationError(results[1 - winner], 409, "personalization_revision_conflict")
    assert.deepEqual((await f.request(path)).body, results[winner].body)
    r257PersonalizationError(await f.request(path, "PUT", inputs[winner]), 409, "personalization_revision_conflict")
    assert.deepEqual((await f.request(path)).body, results[winner].body)
  }
  assert.equal((await f.pool.query("SELECT count(*)::int AS n FROM bff_personalization WHERE tenant_id=$1", [f.tenant])).rows[0].n, 1)
})

integrationTest("R257 personalization rejects malformed requests without inserting private facts or receipts", async (t) => {
  const f = await r241Fixture(t)
  const path = "preferences/personalization"
  const valid = { expected_revision: 0, ...r257PersonalizationFields() }
  for (const body of [
    { ...valid, tenant_id: f.tenant },
    { ...valid, subject_id: f.owner },
    { ...valid, extra: true },
    { ...valid, nickname: null },
    { ...valid, expected_revision: "0" },
    { ...valid, expected_revision: -1 },
    { ...valid, instructions: "🌿".repeat(8001) },
    { nickname: "missing" },
    [],
  ])
    r257PersonalizationError(await f.request(path, "PUT", body), 400, "invalid_personalization_request")
  for (const query of ["?unknown=x", "?owner_id=x&owner_id=y"]) r257PersonalizationError(await f.request(path + query), 400, "invalid_personalization_request")
  const retired = await f.request(path, "PATCH", valid)
  r257PersonalizationError(retired, 405, "method_not_allowed")
  assert.equal(retired.headers.get("allow"), "GET, PUT")
  r257PersonalizationError(await f.request(path, "PUT", valid, { "content-type": "text/plain" }), 400, "invalid_personalization_request")
  r257PersonalizationError(await f.request(path, "PUT", { ...valid, instructions: "x".repeat(70000) }), 413, "request_body_too_large")
  assert.equal((await f.pool.query("SELECT count(*)::int AS n FROM bff_personalization WHERE tenant_id=$1", [f.tenant])).rows[0].n, 0)
  assert.equal((await f.pool.query("SELECT count(*)::int AS n FROM bff_idempotency_receipt WHERE position($1 in scope)>0", [f.tenant])).rows[0].n, 0)
  const denied = `r257-denied-${randomUUID()}`
  f.admission.deny(denied, { ok: false, status: 403, code: "session_forbidden" })
  r257PersonalizationError(await f.request(path, "PUT", valid, { authorization: `Bearer ${denied}` }), 403, "session_forbidden")
  assert.equal((await f.request(path, "PUT", valid)).status, 200, "a later valid save must still work")
})

integrationTest("R257 personalization real row lock times out without commit and later CAS recovers", async (t) => {
  const f = await r241Fixture(t)
  const path = "preferences/personalization"
  const original = r257PersonalizationFields("A")
  assert.equal((await f.request(path, "PUT", { expected_revision: 0, ...original })).status, 200)
  const blocker = await f.pool.connect()
  const observer = r241ObservePool(f.ownerPool)
  try {
    await blocker.query("BEGIN")
    await blocker.query("SELECT 1 FROM bff_personalization WHERE tenant_id=$1 AND owner_id=$2 FOR UPDATE", [f.tenant, f.owner])
    const started = performance.now()
    r257PersonalizationError(await f.request(path, "PUT", { expected_revision: 1, ...r257PersonalizationFields("B") }), 503, "personalization_unavailable")
    assert.ok(performance.now() - started < 2500, "the row lock uses its one-second bound, not the full route budget")
    assert.ok(
      observer.leases.some((lease) => lease.events.some((event) => event.errorCode === "55P03")),
      "real PG lock_timeout must fire",
    )
    assert.equal(
      observer.leases.some((lease) => lease.events.some((event) => event.sql === "COMMIT")),
      false,
    )
  } finally {
    await blocker.query("ROLLBACK")
    blocker.release()
    observer.restore()
  }
  assert.deepEqual((await f.request(path)).body, { data: { personalization: original, revision: 1 } })
  assert.equal((await f.request(path, "PUT", { expected_revision: 1, ...r257PersonalizationFields("B") })).status, 200)
})

integrationTest("R257 personalization pool saturation exhausts one deadline and retires late acquisition before SQL", { timeout: 14000 }, async (t) => {
  const f = await r241Fixture(t)
  const held = []
  let observer
  let pending
  try {
    for (let i = 0; i < f.ownerPool.options.max; i++) held.push(await f.ownerPool.connect())
    observer = r241ObservePool(f.ownerPool)
    const started = performance.now()
    pending = r241Observed(f.request("preferences/personalization", "PUT", { expected_revision: 0, ...r257PersonalizationFields() }))
    await r241Until(() => f.ownerPool.waitingCount === 1, 1500)
    r257PersonalizationError(r241Value(await pending), 503, "personalization_unavailable")
    const elapsed = performance.now() - started
    assert.ok(elapsed >= 4700 && elapsed < 5800, `single route budget elapsed ${elapsed}`)
    held.shift().release()
    await r241Until(() => observer.leases.length === 1 && observer.leases[0].releases.length === 1, 1500)
    assert.deepEqual(observer.leases[0].events, [])
    assert.deepEqual(
      observer.leases[0].releases.map((item) => item.destroy),
      [false],
    )
  } finally {
    for (const client of held) client.release()
    if (pending) await pending
    observer?.restore()
  }
  assert.deepEqual((await f.request("preferences/personalization")).body, { data: { personalization: null, revision: 0 } })
  assert.equal((await f.request("preferences/personalization", "PUT", { expected_revision: 0, ...r257PersonalizationFields() })).status, 200)
})

integrationTest("R257 personalization real committed SQL with observed ACK rejection reconciles without overwriting later save", async (t) => {
  const f = await r241Fixture(t)
  const path = "preferences/personalization"
  let brokenPid
  const observer = r241ObservePool(f.ownerPool, async (lease, event) => {
    if (event.sql.startsWith("INSERT INTO bff_personalization") && event.result.rowCount === 1) lease.personalizationSaved = true
    if (lease.personalizationSaved && brokenPid === undefined && event.sql === "COMMIT") {
      assert.equal(event.result.command, "COMMIT")
      brokenPid = lease.pid
      const absorb = () => {}
      lease.fixtureErrors.push(absorb)
      lease.client.on("error", absorb)
      lease.client.connection.stream.destroy()
      // Observation hook rejects after PostgreSQL acknowledged COMMIT; this is not a TCP ACK suppression test.
      throw new Error("R257_OBSERVED_COMMIT_ACK_REJECTED")
    }
  })
  const a = r257PersonalizationFields("A")
  try {
    r257PersonalizationError(await f.request(path, "PUT", { expected_revision: 0, ...a }), 503, "personalization_save_unknown")
    assert.ok(brokenPid)
    const lease = await r241Released(f, observer, brokenPid, true)
    assert.equal(
      lease.events.some((event) => event.sql === "ROLLBACK"),
      false,
      "unknown commit is not guessed rolled back",
    )
  } finally {
    observer.restore()
  }
  assert.deepEqual((await f.request(path)).body, { data: { personalization: a, revision: 1 } })
  const b = r257PersonalizationFields("B")
  assert.equal((await f.request(path, "PUT", { expected_revision: 1, ...b })).status, 200)
  r257PersonalizationError(await f.request(path, "PUT", { expected_revision: 0, ...a }), 409, "personalization_revision_conflict")
  await f.restart()
  assert.deepEqual((await f.request(path)).body, { data: { personalization: b, revision: 2 } })
})

integrationTest("R257 personalization HTTP cancellation during real PG lock retires exact client without a late write", async (t) => {
  const f = await r241Fixture(t)
  const path = "preferences/personalization"
  const original = r257PersonalizationFields("A")
  assert.equal((await f.request(path, "PUT", { expected_revision: 0, ...original })).status, 200)
  const blocker = await f.pool.connect()
  const observer = r241ObservePool(f.ownerPool)
  const abort = new AbortController()
  let pending
  try {
    await blocker.query("BEGIN")
    await blocker.query("SELECT 1 FROM bff_personalization WHERE tenant_id=$1 AND owner_id=$2 FOR UPDATE", [f.tenant, f.owner])
    pending = r241Observed(f.request(path, "PUT", { expected_revision: 1, ...r257PersonalizationFields("B") }, {}, abort.signal))
    const pid = await r241Until(async () => {
      const result = await blocker.query("SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid))", [
        blocker.processID,
      ])
      return result.rows[0]?.pid
    }, 1500)
    abort.abort()
    assert.ok((await pending).error)
    await r241Released(f, observer, pid, true)
  } finally {
    abort.abort()
    await blocker.query("ROLLBACK")
    blocker.release()
    if (pending) await pending
    observer.restore()
  }
  assert.deepEqual((await f.request(path)).body, { data: { personalization: original, revision: 1 } })
  assert.equal((await f.request(path, "PUT", { expected_revision: 1, ...r257PersonalizationFields("C") })).status, 200)
})

async function r257RawPersonalization(f, { method = "PUT", suffix = "", raw = "", headers = [], incomplete = false } = {}) {
  const { request: httpRequest } = await import("node:http")
  const address = servers.at(-1).address()
  assert.ok(address && typeof address !== "string", "the current owned fixture server must be listening")
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest(
      {
        hostname: "127.0.0.1",
        port: address.port,
        path: `/v1/preferences/personalization${suffix}`,
        method,
        signal: AbortSignal.timeout(6500),
        headers: [
          "Host",
          `127.0.0.1:${address.port}`,
          "x-kokoro-service",
          "web-bff",
          "x-kokoro-internal-secret",
          "web-secret",
          "authorization",
          `Bearer ${f.token}`,
          "Content-Type",
          "application/json",
          "Content-Length",
          String(incomplete ? 100 : Buffer.byteLength(raw)),
          ...headers,
        ],
      },
      (response) => {
        const chunks = []
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
        response.once("error", reject)
        response.once("end", () => {
          try {
            resolve({ status: response.statusCode, headers: new Headers(response.headers), body: JSON.parse(Buffer.concat(chunks).toString("utf8")) })
          } catch (error) {
            reject(error)
          } finally {
            outgoing.destroy()
          }
        })
      },
    )
    outgoing.once("error", reject)
    if (incomplete) {
      outgoing.flushHeaders()
      outgoing.write(raw)
    } else outgoing.end(raw)
  })
}

integrationTest("R257 personalization real raw HTTP rejects ambiguous JSON headers query and GET bodies", async (t) => {
  const f = await r241Fixture(t)
  const raw = JSON.stringify({ expected_revision: 0, ...r257PersonalizationFields() })
  for (const options of [
    { raw: raw.replace('"expected_revision":0', '"expected_revision":0,"expected_revision":0') },
    { raw, headers: ["Content-Type", "application/json"] },
    { method: "GET", raw: "{}" },
    { method: "GET", suffix: "?" },
  ])
    r257PersonalizationError(await r257RawPersonalization(f, options), 400, "invalid_personalization_request")
  assert.deepEqual((await f.request("preferences/personalization")).body, { data: { personalization: null, revision: 0 } })
})

integrationTest("R257 terminal Scheduler rejection is projected by authoritative ScheduledTask HTTP reads", async () => {
  const suffix = `${Date.now()}_${Math.random().toString(16).slice(2)}`
  const tenant = `schedule_failure_http_${suffix}`
  const subject = `schedule_failure_user_${suffix}`
  const pool = new Pool({ connectionString: postgresUrl, options: "-c search_path=kokoro_bff -c timezone=UTC" })
  const redis = createClient({ url: redisUrl })
  const schedulerCalls = []
  let scheduler
  let bff
  try {
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    await redis.connect()
    scheduler = createServer((request, response) => {
      const chunks = []
      request.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
      request.on("end", () => {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"))
        schedulerCalls.push({
          method: request.method,
          url: request.url,
          authorization: request.headers.authorization,
          service: request.headers["x-kokoro-service"],
          tenant: request.headers["x-kokoro-tenant-id"],
          requestId: request.headers["x-request-id"],
          idempotencyKey: request.headers["idempotency-key"],
          body,
        })
        response.statusCode = 400
        response.setHeader("content-type", "application/json")
        response.end(
          JSON.stringify({
            error: { code: "invalid_schedule", message: "Schedule target is invalid" },
            meta: { request_id: request.headers["x-request-id"] },
          }),
        )
      })
    })
    const schedulerBase = await listen(scheduler)
    const targetUrl = "http://bff.test/internal/bff/scheduled-tasks/dispatch"
    bff = createBffServer(bffConfig({ tenantId: tenant, schedulerBase, schedulerTargetUrl: targetUrl }), { sessionAdmission })
    const base = await listen(bff)
    const response = await fetch(`${base}/v1/scheduled-tasks`, {
      method: "POST",
      headers: {
        ...auth(tenant, subject),
        "content-type": "application/json",
        "idempotency-key": `schedule-failure-${suffix}`,
      },
      body: JSON.stringify({
        title: "Terminal failure projection",
        prompt: "Do not execute this integration fixture.",
        trigger_kind: "calendar",
        frequency: "daily",
        time: "08:00",
        timezone: "UTC",

        auto_approve: false,
      }),
      signal: AbortSignal.timeout(5000),
    })
    assert.equal(response.status, 200)
    const created = (await response.json()).data.task
    assert.equal(created.status, "active")
    assert.equal(created.enabled, true)
    assert.equal(created.next_run_at, null)

    await waitFor(async () => {
      const result = await pool.query("SELECT status,last_error_code FROM bff_scheduled_task_outbox WHERE tenant_id=$1 AND task_id=$2", [tenant, created.id])
      return result.rows.length === 1 && result.rows[0].status === "failed" && result.rows[0].last_error_code === "invalid_schedule"
    })
    const ownSchedulerCalls = schedulerCalls.filter((call) => call.tenant === tenant && call.body.body.task_id === created.id)
    assert.equal(ownSchedulerCalls.length, 1)
    assert.equal(ownSchedulerCalls[0].method, "POST")
    assert.match(ownSchedulerCalls[0].url ?? "", /^\/internal\/scheduler\/v1\/schedules\/kokoro[.]scheduled[.]/u)
    assert.equal(ownSchedulerCalls[0].authorization, "Bearer scheduler-secret")
    assert.equal(ownSchedulerCalls[0].service, "web-bff")
    assert.equal(ownSchedulerCalls[0].tenant, tenant)
    assert.equal(typeof ownSchedulerCalls[0].requestId, "string")
    assert.equal(typeof ownSchedulerCalls[0].idempotencyKey, "string")
    assert.equal(ownSchedulerCalls[0].body.url, targetUrl)
    assert.equal(ownSchedulerCalls[0].body.body.task_id, created.id)
    assert.equal(ownSchedulerCalls[0].body.body.owner_id, subject)

    const detail = await fetch(`${base}/v1/scheduled-tasks/${created.id}`, {
      headers: auth(tenant, subject),
      signal: AbortSignal.timeout(5000),
    })
    assert.equal(detail.status, 200)
    const authoritative = (await detail.json()).data.task
    assert.equal(authoritative.id, created.id)
    assert.equal(authoritative.status, "failed")
    assert.equal(authoritative.enabled, true)
    assert.equal("revision" in authoritative, false)
    assert.equal(authoritative.next_run_at, null)

    const persisted = await pool.query(
      `SELECT task.status AS task_status,task.enabled,task.revision,
              command.status AS command_status,command.last_error_code,command.completed_at,
              command.lease_owner,command.lease_token,command.lease_until
         FROM bff_scheduled_task AS task
         JOIN bff_scheduled_task_outbox AS command
           ON command.tenant_id=task.tenant_id AND command.task_id=task.task_id
        WHERE task.tenant_id=$1 AND task.task_id=$2`,
      [tenant, created.id],
    )
    assert.equal(persisted.rows.length, 1)
    assert.equal(persisted.rows[0].task_status, "failed")
    assert.equal(persisted.rows[0].enabled, true)
    assert.equal(Number(persisted.rows[0].revision), 1)
    assert.equal(persisted.rows[0].command_status, "failed")
    assert.equal(persisted.rows[0].last_error_code, "invalid_schedule")
    assert.ok(persisted.rows[0].completed_at)
    assert.equal(persisted.rows[0].lease_owner, null)
    assert.equal(persisted.rows[0].lease_token, null)
    assert.equal(persisted.rows[0].lease_until, null)
  } finally {
    if (bff) await close(bff)
    if (scheduler?.listening) await close(scheduler)
    await pool.query("DELETE FROM bff_scheduled_task_outbox WHERE tenant_id=$1", [tenant]).catch(() => undefined)
    await pool.query("DELETE FROM bff_scheduled_task WHERE tenant_id=$1", [tenant]).catch(() => undefined)
    await pool.query("DELETE FROM bff_idempotency_receipt WHERE starts_with(scope,$1)", [`${JSON.stringify([tenant]).slice(0, -1)},`]).catch(() => undefined)
    await redis.quit().catch(() => undefined)
    await pool.end()
  }
})

integrationTest("R257 personalization an unfinished request body spends the route deadline before any SQL checkout", { timeout: 10000 }, async (t) => {
  const f = await r241Fixture(t)
  const observer = r241ObservePool(f.ownerPool)
  try {
    const started = performance.now()
    r257PersonalizationError(await r257RawPersonalization(f, { raw: "{", incomplete: true }), 503, "personalization_unavailable")
    const elapsed = performance.now() - started
    assert.ok(elapsed >= 4700 && elapsed < 5900, `body belongs to the same bounded operation: ${elapsed}`)
    assert.equal(observer.leases.length, 0, "no database lease before a complete valid body")
  } finally {
    observer.restore()
  }
  assert.deepEqual((await f.request("preferences/personalization")).body, { data: { personalization: null, revision: 0 } })
})

integrationTest("R257 personalization real catalog and terminal revision preserve singleton invariants", async (t) => {
  const f = await r241Fixture(t)
  const columns = await f.pool.query(
    "SELECT column_name,data_type,is_nullable,datetime_precision FROM information_schema.columns WHERE table_schema='kokoro_bff' AND table_name='bff_personalization' ORDER BY ordinal_position",
  )
  assert.deepEqual(
    columns.rows.map((row) => row.column_name),
    ["tenant_id", "owner_id", "nickname", "occupation", "about", "instructions", "revision", "created_at", "updated_at"],
  )
  assert.ok(columns.rows.every((row) => row.is_nullable === "NO"))
  assert.equal(columns.rows.find((row) => row.column_name === "revision").data_type, "bigint")
  for (const row of columns.rows.filter((item) => item.column_name.endsWith("_at"))) assert.equal(row.datetime_precision, 3)
  const constraints = (
    await f.pool.query("SELECT contype,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='kokoro_bff.bff_personalization'::regclass")
  ).rows
  assert.equal(constraints.filter((row) => row.contype === "p").length, 1)
  assert.match(constraints.find((row) => row.contype === "p").definition, /PRIMARY KEY \(tenant_id, owner_id\)/u)
  assert.equal(
    constraints.some((row) => row.contype === "f"),
    false,
  )
  const fields = r257PersonalizationFields()
  assert.equal((await f.request("preferences/personalization", "PUT", { expected_revision: 0, ...fields })).status, 200)
  await f.pool.query("UPDATE bff_personalization SET revision=9007199254740991 WHERE tenant_id=$1 AND owner_id=$2", [f.tenant, f.owner])
  r257PersonalizationError(
    await f.request("preferences/personalization", "PUT", { expected_revision: Number.MAX_SAFE_INTEGER, ...r257PersonalizationFields("not written") }),
    409,
    "personalization_revision_exhausted",
  )
  assert.deepEqual((await f.request("preferences/personalization")).body, { data: { personalization: fields, revision: Number.MAX_SAFE_INTEGER } })
})

async function r278CreateScheduledTask(f, projectId, label) {
  const created = await f.request("scheduled-tasks", "POST", r73CreatePayload(projectId === null ? {} : { project_id: projectId }), {
    "idempotency-key": `r278-create-${label}-${randomUUID()}`,
  })
  assert.equal(created.status, 200, JSON.stringify(created.body))
  return created.body.data.task
}

async function r278TaskSnapshot(f, taskId) {
  const [task, outbox, receipts] = await Promise.all([
    f.pool.query("SELECT to_jsonb(task) AS row FROM bff_scheduled_task AS task WHERE tenant_id=$1 AND task_id=$2", [f.tenant, taskId]),
    f.pool.query("SELECT to_jsonb(command) AS row FROM bff_scheduled_task_outbox AS command WHERE tenant_id=$1 AND task_id=$2 ORDER BY created_at,outbox_id", [
      f.tenant,
      taskId,
    ]),
    f.pool.query("SELECT to_jsonb(receipt) AS row FROM bff_idempotency_receipt AS receipt WHERE position($1 in scope)>0 ORDER BY scope", [f.tenant]),
  ])
  return {
    task: task.rows.map(({ row }) => row),
    outbox: outbox.rows.map(({ row }) => row),
    receipts: receipts.rows.map(({ row }) => row),
  }
}

function r278AssertProjectNotFound(result) {
  assert.equal(result.status, 404, JSON.stringify(result.body))
  r241Headers(result)
  assert.deepEqual(Object.keys(result.body).sort(), ["error", "meta"])
  assert.deepEqual(Object.keys(result.body.error).sort(), ["code", "message"])
  assert.equal(result.body.error.code, "project_not_found")
  assert.deepEqual(Object.keys(result.body.meta), ["request_id"])
  assert.equal(result.body.meta.request_id, result.headers.get("x-request-id"))
}

function r278AssertRejectedMutation(before, after, result, expectedScope) {
  assert.deepEqual(after.task, before.task, "rejected Project-bound intent changed the ScheduledTask")
  assert.deepEqual(after.outbox, before.outbox, "rejected Project-bound intent appended or changed Scheduler outbox state")
  const original = new Map(before.receipts.map((receipt) => [receipt.scope, receipt]))
  for (const [scope, receipt] of original)
    assert.deepEqual(
      after.receipts.find((candidate) => candidate.scope === scope),
      receipt,
    )
  const added = after.receipts.filter((receipt) => !original.has(receipt.scope))
  assert.equal(added.length, 1, "a closed HTTP rejection must complete exactly its own durable receipt")
  assert.equal(added[0].scope, expectedScope)
  assert.equal(added[0].status, 404)
  assert.deepEqual(added[0].response_body, result.body)
}

async function r278CommitTombstoneAndPause(f, projectId, taskId) {
  const client = await f.pool.connect()
  try {
    await client.query("BEGIN")
    assert.equal(
      (
        await client.query("UPDATE bff_project SET deleted_at=CURRENT_TIMESTAMP(3),updated_at=CURRENT_TIMESTAMP(3) WHERE tenant_id=$1 AND project_id=$2", [
          f.tenant,
          projectId,
        ])
      ).rowCount,
      1,
    )
    // Materialize the same paused revision AND command as the real project deletion transaction.
    // A direct task UPDATE alone creates an impossible current-read readiness fixture.
    const { pauseProjectScheduledTasks } = await import("../dist/infrastructure/postgres/scheduled-task-repository.js")
    await pauseProjectScheduledTasks(client, { tenantId: f.tenant, subjectId: f.owner }, projectId, `r278-delete-${taskId}`, `r278-delete-${taskId}`)
    await client.query("COMMIT")
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  } finally {
    client.release()
  }
}

integrationTest("R278 tombstoned Project rejects new ScheduledTask enable and retry intent without durable writes", async (t) => {
  const f = await r241Fixture(t)
  for (const operation of ["enable", "retry"]) {
    await t.test(operation, async () => {
      const project = await f.project(`R278 ${operation}`)
      const task = await r278CreateScheduledTask(f, project.id, operation)
      await r278CommitTombstoneAndPause(f, project.id, task.id)
      const before = await r278TaskSnapshot(f, task.id)
      const idempotencyKey = `r278-${operation}-${randomUUID()}`
      const result =
        operation === "enable"
          ? await f.request(`scheduled-tasks/${task.id}`, "PATCH", { status: "active", enabled: true }, { "idempotency-key": idempotencyKey })
          : await f.request(`scheduled-tasks/${task.id}/retry`, "POST", undefined, { "idempotency-key": idempotencyKey })
      r278AssertProjectNotFound(result)
      r278AssertRejectedMutation(
        before,
        await r278TaskSnapshot(f, task.id),
        result,
        JSON.stringify([
          f.tenant,
          f.owner,
          operation === "enable" ? "PATCH" : "POST",
          operation === "enable" ? `/scheduled-tasks/${task.id}` : `/scheduled-tasks/${task.id}/retry`,
          idempotencyKey,
        ]),
      )
    })
  }
})

integrationTest("R278 independent and active-Project ScheduledTasks retain legal update behavior", async (t) => {
  const f = await r241Fixture(t)
  const project = await f.project("R278 active control")
  for (const [label, projectId] of [
    ["independent", null],
    ["active-project", project.id],
  ]) {
    const task = await r278CreateScheduledTask(f, projectId, label)
    const updated = await f.request(
      `scheduled-tasks/${task.id}`,
      "PATCH",
      { prompt: `R278 ${label} update remains legal` },
      { "idempotency-key": `r278-update-${label}-${randomUUID()}` },
    )
    assert.equal(updated.status, 200, JSON.stringify(updated.body))
    r241Headers(updated)
    assert.equal(updated.body.data.task.prompt, `R278 ${label} update remains legal`)
  }
})

integrationTest("R278 completed HTTP receipt replays its original ACK after Project tombstone without restoring the task", async (t) => {
  const f = await r241Fixture(t)
  const project = await f.project("R278 completed receipt")
  const task = await r278CreateScheduledTask(f, project.id, "completed-receipt")
  const key = `r278-complete-${randomUUID()}`
  const patch = { prompt: "R278 completed response remains replayable" }
  const original = await f.request(`scheduled-tasks/${task.id}`, "PATCH", patch, { "idempotency-key": key })
  assert.equal(original.status, 200, JSON.stringify(original.body))
  assert.equal(original.body.data.task.status, "active")
  assert.equal(original.body.data.task.enabled, true)
  await r278CommitTombstoneAndPause(f, project.id, task.id)
  const before = await r278TaskSnapshot(f, task.id)
  const replay = await f.request(`scheduled-tasks/${task.id}`, "PATCH", patch, { "idempotency-key": key })
  assert.deepEqual(replay.body, original.body)
  assert.equal(replay.status, original.status)
  r241Headers(replay)
  assert.deepEqual(await r278TaskSnapshot(f, task.id), before, "terminal HTTP receipt replay must not execute another mutation")
  const current = await f.request(`scheduled-tasks/${task.id}`)
  assert.equal(current.status, 200, JSON.stringify(current.body))
  assert.equal(current.body.data.task.status, "paused")
  assert.equal(current.body.data.task.enabled, false)
  assert.equal(current.body.data.task.prompt, patch.prompt)
})

integrationTest("R278 committed replace outbox recovers before Project active check when the HTTP receipt is absent", async (t) => {
  const f = await r241Fixture(t)
  const project = await f.project("R278 repository recovery")
  const task = await r278CreateScheduledTask(f, project.id, "repository-recovery")
  const repository = new PostgresScheduledTaskRepository({ pool: f.pool })
  const scope = { tenantId: f.tenant, subjectId: f.owner }
  const lineage = {
    tenantId: f.tenant,
    actorId: f.owner,
    requestId: `r278-repository-${randomUUID()}`,
    idempotencyKey: `r278-repository-${randomUUID()}`,
  }
  const first = await repository.updateScheduledTask(scope, task.id, { prompt: "R278 outbox committed before receipt" }, lineage)
  assert.equal(first?.prompt, "R278 outbox committed before receipt")
  await r278CommitTombstoneAndPause(f, project.id, task.id)
  const before = await r278TaskSnapshot(f, task.id)
  const recovered = await repository.updateScheduledTask(scope, task.id, { prompt: "R278 outbox committed before receipt" }, lineage)
  assert.equal(recovered?.status, "paused")
  assert.equal(recovered?.enabled, false)
  assert.equal(recovered?.revision, before.task[0].revision)
  assert.deepEqual(await r278TaskSnapshot(f, task.id), before, "outbox recovery must return current facts without another write")
})

integrationTest("R278 Project then ScheduledTask lock order makes deletion and update races deterministic", async (t) => {
  await t.test("deletion lock wins before a new enable intent", async (t) => {
    const f = await r241Fixture(t)
    const project = await f.project("R278 deletion wins")
    const task = await r278CreateScheduledTask(f, project.id, "delete-wins")
    const blocker = await f.pool.connect()
    let pending
    try {
      await blocker.query("BEGIN")
      const blockerPid = (await blocker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid
      await blocker.query("UPDATE bff_project SET deleted_at=CURRENT_TIMESTAMP(3),updated_at=CURRENT_TIMESTAMP(3) WHERE tenant_id=$1 AND project_id=$2", [
        f.tenant,
        project.id,
      ])
      await blocker.query(
        "UPDATE bff_scheduled_task SET status='paused',enabled=false,revision=revision+1,updated_at=CURRENT_TIMESTAMP(3) WHERE tenant_id=$1 AND task_id=$2",
        [f.tenant, task.id],
      )
      pending = f
        .request(`scheduled-tasks/${task.id}`, "PATCH", { status: "active", enabled: true }, { "idempotency-key": `r278-delete-wins-${randomUUID()}` })
        .then(
          (value) => ({ value }),
          (error) => ({ error }),
        )
      let blockedQuery = ""
      await waitFor(async () => {
        const activity = await f.pool.query(
          `SELECT query FROM pg_stat_activity
            WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid)) AND state='active'`,
          [blockerPid],
        )
        blockedQuery = activity.rows[0]?.query ?? ""
        return blockedQuery.length > 0
      }, 1000)
      assert.match(blockedQuery, /bff_project/u, "ScheduledTask mutation must first wait on the Project deletion fence")
      await blocker.query("COMMIT")
      const result = await pending
      assert.equal(result.error, undefined)
      r278AssertProjectNotFound(result.value)
    } finally {
      await blocker.query("ROLLBACK").catch(() => undefined)
      blocker.release()
      if (pending) await pending
    }
  })

  await t.test("update holding the Project fence completes before a later tombstone", async (t) => {
    const f = await r241Fixture(t)
    const project = await f.project("R278 update wins")
    const task = await r278CreateScheduledTask(f, project.id, "update-wins")
    const taskBlocker = await f.pool.connect()
    const deleter = await f.pool.connect()
    let pendingUpdate
    let pendingDelete
    try {
      await taskBlocker.query("BEGIN")
      const taskBlockerPid = (await taskBlocker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid
      await taskBlocker.query("SELECT task_id FROM bff_scheduled_task WHERE tenant_id=$1 AND task_id=$2 FOR UPDATE", [f.tenant, task.id])
      pendingUpdate = f
        .request(
          `scheduled-tasks/${task.id}`,
          "PATCH",
          { prompt: "R278 update acquired Project before task" },
          { "idempotency-key": `r278-update-wins-${randomUUID()}` },
        )
        .then(
          (value) => ({ value }),
          (error) => ({ error }),
        )
      let updaterPid
      await waitFor(async () => {
        const activity = await f.pool.query(
          `SELECT pid FROM pg_stat_activity
            WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid)) AND query LIKE '%bff_scheduled_task%'`,
          [taskBlockerPid],
        )
        updaterPid = activity.rows[0]?.pid
        return updaterPid !== undefined
      }, 1000)
      await deleter.query("BEGIN")
      pendingDelete = deleter.query(
        "UPDATE bff_project SET deleted_at=CURRENT_TIMESTAMP(3),updated_at=CURRENT_TIMESTAMP(3) WHERE tenant_id=$1 AND project_id=$2",
        [f.tenant, project.id],
      )
      let deletionBlocked = false
      const winner = await Promise.race([
        pendingDelete.then(() => "deleted"),
        waitFor(async () => {
          const activity = await f.pool.query(
            "SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND $1=ANY(pg_blocking_pids(pid)) AND query LIKE '%bff_project%'",
            [updaterPid],
          )
          deletionBlocked = activity.rowCount === 1
          return deletionBlocked
        }, 1000).then(() => "blocked"),
      ])
      assert.equal(winner, "blocked", "later tombstone must wait behind the update's Project fence")
      assert.equal(deletionBlocked, true)
      await taskBlocker.query("COMMIT")
      const updated = await pendingUpdate
      assert.equal(updated.error, undefined)
      assert.equal(updated.value.status, 200, JSON.stringify(updated.value.body))
      assert.equal(updated.value.body.data.task.prompt, "R278 update acquired Project before task")
      await pendingDelete
      await deleter.query("ROLLBACK")
    } finally {
      await taskBlocker.query("ROLLBACK").catch(() => undefined)
      await deleter.query("ROLLBACK").catch(() => undefined)
      taskBlocker.release()
      deleter.release()
      if (pendingUpdate) await pendingUpdate
      if (pendingDelete) await pendingDelete.catch(() => undefined)
    }
  })
})

function r279AssertProjectDeletionResource(result, projectId, status) {
  assert.equal(result.status, status, JSON.stringify(result.body))
  r241Headers(result)
  assert.deepEqual(result.body, {
    data: {
      project_id: projectId,
      logical_release_state: "pending",
      physical_cleanup_state: "pending",
    },
  })
}

async function r279DeleteProject(f, projectId, key) {
  return f.request(`projects/${projectId}`, "DELETE", undefined, { "idempotency-key": key })
}

async function r279CreateConversation(f, repositories, projectId, label) {
  const conversationId = `conv_${randomUUID()}`
  const receipt = await repositories.services.chatTurns.submit({
    tenantId: f.tenant,
    conversationId,
    projectRef: projectId,
    subjectId: f.owner,
    actorId: f.owner,
    requestId: `r279-${label}-${randomUUID()}`,
    idempotencyKey: `r279-${label}-${randomUUID()}`,
    content: `R279 ${label} durable member`,
  })
  assert.ok(receipt, "the real chat-turn repository must establish the Project member")
  return conversationId
}

async function r279DeletionSnapshot(f, projectId) {
  const [project, conversations, tasks, schedulerOutbox, deletion, releaseOutbox] = await Promise.all([
    f.pool.query("SELECT to_jsonb(row) AS value FROM bff_project AS row WHERE tenant_id=$1 AND project_id=$2", [f.tenant, projectId]),
    f.pool.query("SELECT to_jsonb(row) AS value FROM bff_conversation AS row WHERE tenant_id=$1 AND project_ref=$2 ORDER BY conversation_id", [
      f.tenant,
      projectId,
    ]),
    f.pool.query("SELECT to_jsonb(row) AS value FROM bff_scheduled_task AS row WHERE tenant_id=$1 AND project_id=$2 ORDER BY task_id", [f.tenant, projectId]),
    f.pool.query(
      "SELECT to_jsonb(row) AS value FROM bff_scheduled_task_outbox AS row WHERE tenant_id=$1 AND task_id IN (SELECT task_id FROM bff_scheduled_task WHERE tenant_id=$1 AND project_id=$2) ORDER BY created_at,outbox_id",
      [f.tenant, projectId],
    ),
    f.pool.query("SELECT to_jsonb(row) AS value FROM bff_project_deletion AS row WHERE tenant_id=$1 AND project_id=$2", [f.tenant, projectId]),
    f.pool.query(
      "SELECT to_jsonb(row) AS value FROM bff_project_scope_release_outbox AS row WHERE tenant_id=$1 AND project_id=$2 ORDER BY scope_kind,scope_id",
      [f.tenant, projectId],
    ),
  ])
  return {
    project: project.rows.map(({ value }) => value),
    conversations: conversations.rows.map(({ value }) => value),
    tasks: tasks.rows.map(({ value }) => value),
    schedulerOutbox: schedulerOutbox.rows.map(({ value }) => value),
    deletion: deletion.rows.map(({ value }) => value),
    releaseOutbox: releaseOutbox.rows.map(({ value }) => value),
  }
}

integrationTest("R279 DELETE and status expose pending logical release for an empty Project", async (t) => {
  const f = await r241Fixture(t)
  const project = await f.project("R279 empty Project")
  const key = `r279-empty-${randomUUID()}`
  const deleted = await r279DeleteProject(f, project.id, key)
  r279AssertProjectDeletionResource(deleted, project.id, 202)
  assert.equal(deleted.headers.get("location"), `/v1/projects/${project.id}/deletion`)

  const status = await f.request(`projects/${project.id}/deletion`)
  r279AssertProjectDeletionResource(status, project.id, 200)
  const persisted = await r279DeletionSnapshot(f, project.id)
  assert.equal(persisted.deletion.length, 1)
  assert.equal(persisted.deletion[0].conversation_count, 0)
  assert.equal(persisted.deletion[0].release_command_count, 1)
  assert.equal(persisted.deletion[0].response_status, 202)
  assert.equal(persisted.releaseOutbox.length, 1)
  assert.deepEqual(
    persisted.releaseOutbox.map((row) => [row.scope_kind, row.scope_id, row.state]),
    [["project", project.id, "pending"]],
  )
})

integrationTest("R279 aggregate deletion freezes active and deleted members and pauses associated ScheduledTasks", async (t) => {
  const f = await r241Fixture(t)
  const project = await f.project("R279 aggregate Project")
  const repositories = new PostgresBffRepositories(postgresUrl, redisUrl)
  await repositories.ready()
  let activeConversation
  let deletedConversation
  try {
    activeConversation = await r279CreateConversation(f, repositories, project.id, "active-conversation")
    deletedConversation = await r279CreateConversation(f, repositories, project.id, "deleted-conversation")
    assert.equal(
      await repositories.services.chat.deleteConversation(f.tenant, f.owner, deletedConversation, `r279-delete-member-${randomUUID()}`, project.id),
      true,
    )
  } finally {
    await repositories.close()
  }
  const task = await r278CreateScheduledTask(f, project.id, "aggregate")
  const beforeTask = (await f.pool.query("SELECT to_jsonb(row) AS value FROM bff_scheduled_task AS row WHERE tenant_id=$1 AND task_id=$2", [f.tenant, task.id]))
    .rows[0].value
  const deletedMemberBefore = (
    await f.pool.query("SELECT deleted_at FROM bff_conversation WHERE tenant_id=$1 AND conversation_id=$2", [f.tenant, deletedConversation])
  ).rows[0].deleted_at
  const beforeHistory = await f.pool.query(
    "SELECT to_jsonb(row) AS value FROM bff_agui_event AS row WHERE tenant_id=$1 AND session_id=$2 ORDER BY public_sequence",
    [f.tenant, activeConversation],
  )
  assert.ok(beforeHistory.rowCount > 0, "the real chat ledger must provide immutable AG-UI history")
  const beforeMessages = await f.pool.query(
    "SELECT conversation_id,message_id,role,content FROM bff_message WHERE tenant_id=$1 AND conversation_id=ANY($2::text[]) ORDER BY conversation_id,message_id",
    [f.tenant, [activeConversation, deletedConversation]],
  )

  const deleted = await r279DeleteProject(f, project.id, `r279-aggregate-${randomUUID()}`)
  r279AssertProjectDeletionResource(deleted, project.id, 202)
  const persisted = await r279DeletionSnapshot(f, project.id)
  assert.equal(persisted.project[0].deleted_at === null, false)
  assert.equal(persisted.deletion[0].conversation_count, 2)
  assert.equal(persisted.deletion[0].release_command_count, 3)
  assert.deepEqual(
    persisted.releaseOutbox.map((row) => [row.scope_kind, row.scope_id, row.state]),
    [
      ["conversation", activeConversation, "pending"],
      ["conversation", deletedConversation, "pending"],
      ["project", project.id, "pending"],
    ].sort(([leftKind, leftId], [rightKind, rightId]) => leftKind.localeCompare(rightKind) || leftId.localeCompare(rightId)),
  )
  assert.deepEqual(
    new Date(persisted.conversations.find((row) => row.conversation_id === deletedConversation)?.deleted_at).toISOString(),
    new Date(deletedMemberBefore).toISOString(),
    "already-deleted member tombstone changed",
  )
  assert.deepEqual(
    persisted.conversations.map((row) => [row.conversation_id, row.status, row.project_ref]),
    [
      [activeConversation, "deleted", project.id],
      [deletedConversation, "deleted", project.id],
    ].sort(([leftId], [rightId]) => leftId.localeCompare(rightId)),
  )
  assert.deepEqual(
    (
      await f.pool.query(
        "SELECT conversation_id,message_id,role,content FROM bff_message WHERE tenant_id=$1 AND conversation_id=ANY($2::text[]) ORDER BY conversation_id,message_id",
        [f.tenant, [activeConversation, deletedConversation]],
      )
    ).rows,
    beforeMessages.rows,
    "Project deletion must retain existing Message rows",
  )
  assert.deepEqual(
    (
      await f.pool.query("SELECT to_jsonb(row) AS value FROM bff_agui_event AS row WHERE tenant_id=$1 AND session_id=$2 ORDER BY public_sequence", [
        f.tenant,
        activeConversation,
      ])
    ).rows,
    beforeHistory.rows,
    "Project deletion must retain immutable AG-UI history",
  )
  assert.equal(persisted.tasks.length, 1)
  assert.equal(persisted.tasks[0].task_id, task.id)
  assert.equal(persisted.tasks[0].project_id, project.id)
  assert.equal(persisted.tasks[0].status, "paused")
  assert.equal(persisted.tasks[0].enabled, false)
  assert.equal(Object.hasOwn(persisted.tasks[0], "next_run_at"), false)
  assert.equal(Number(persisted.tasks[0].revision), Number(beforeTask.revision) + 1)
  for (const field of ["title", "prompt", "frequency", "task_time", "timezone", "weekdays", "month_days", "local_date", "run_at", "expires_at", "auto_approve"])
    assert.deepEqual(persisted.tasks[0][field], beforeTask[field], `ScheduledTask ${field} changed during Project deletion`)
  const taskCommands = persisted.schedulerOutbox.filter((row) => row.task_id === task.id)
  assert.equal(taskCommands.length, 2)
  assert.deepEqual(
    taskCommands.map((row) => [row.command_type, Number(row.aggregate_revision)]),
    [
      ["scheduler.register", Number(beforeTask.revision)],
      ["scheduler.replace", Number(beforeTask.revision) + 1],
    ],
  )
})

integrationTest("R279 deletion receipt replays original pending while new keys and revoked sessions fail closed", async (t) => {
  const f = await r241Fixture(t)
  const project = await f.project("R279 replay Project")
  const key = `r279-replay-${randomUUID()}`
  const original = await r279DeleteProject(f, project.id, key)
  r279AssertProjectDeletionResource(original, project.id, 202)
  const before = await r279DeletionSnapshot(f, project.id)

  const replay = await r279DeleteProject(f, project.id, key)
  r279AssertProjectDeletionResource(replay, project.id, 202)
  assert.deepEqual(replay.body, original.body)
  assert.equal(replay.headers.get("location"), original.headers.get("location"))
  assert.notEqual(replay.headers.get("x-request-id"), original.headers.get("x-request-id"))
  assert.deepEqual(await r279DeletionSnapshot(f, project.id), before, "same-key replay appended or changed deletion facts")

  const newKey = await r279DeleteProject(f, project.id, `r279-new-${randomUUID()}`)
  assert.equal(newKey.status, 404, JSON.stringify(newKey.body))
  r241Headers(newKey)
  assert.deepEqual(newKey.body.error, { code: "project_not_found", message: newKey.body.error.message, retryable: false })
  assert.deepEqual(await r279DeletionSnapshot(f, project.id), before, "new-key tombstone request changed deletion facts")

  f.admission.deny(f.token, { ok: false, status: 401, code: "session_invalid" })
  const denied = await r279DeleteProject(f, project.id, key)
  assert.equal(denied.status, 401, JSON.stringify(denied.body))
  r241Headers(denied)
  assert.equal(denied.body.error.code, "session_invalid")
  assert.equal(denied.body.error.retryable, false)
  assert.deepEqual(await r279DeletionSnapshot(f, project.id), before, "current admission denial replayed or changed deletion facts")
})

async function r279TenantAuthoritySnapshot(f) {
  const tables = await f.pool.query(
    `SELECT table_name FROM information_schema.columns
      WHERE table_schema='kokoro_bff' AND column_name='tenant_id'
      ORDER BY table_name`,
  )
  const snapshot = {}
  for (const { table_name: table } of tables.rows) {
    if (!/^bff_[a-z0-9_]+$/u.test(table)) throw new Error(`unsafe canonical table ${table}`)
    const rows = await f.pool.query(`SELECT to_jsonb(row) AS value FROM ${table} AS row WHERE tenant_id=$1 ORDER BY to_jsonb(row)::text`, [f.tenant])
    snapshot[table] = rows.rows.map(({ value }) => value)
  }
  snapshot.bff_idempotency_receipt = (
    await f.pool.query("SELECT to_jsonb(row) AS value FROM bff_idempotency_receipt AS row WHERE position($1 in scope)>0 ORDER BY scope", [f.tenant])
  ).rows.map(({ value }) => value)
  return snapshot
}

async function r279InstallFault(f, label, projectId, secondConversationId) {
  const suffix = randomUUID().replaceAll("-", "")
  const functionName = `r279_fault_${suffix}`
  const triggerName = `r279_trigger_${suffix}`
  const target = label === "second-conversation" ? "bff_message" : label === "receipt" ? "bff_project_deletion" : "bff_project_scope_release_outbox"
  const event = label === "second-conversation" ? "UPDATE" : "INSERT"
  const predicate =
    label === "second-conversation"
      ? `OLD.tenant_id=${"'"}${f.tenant}${"'"} AND OLD.conversation_id=${"'"}${secondConversationId}${"'"} AND OLD.role='assistant' AND OLD.status IN ('pending','streaming')`
      : label === "last-scope"
        ? `NEW.tenant_id=${"'"}${f.tenant}${"'"} AND NEW.project_id=${"'"}${projectId}${"'"} AND NEW.scope_kind='project' AND NEW.scope_id=${"'"}${projectId}${"'"}`
        : `NEW.tenant_id=${"'"}${f.tenant}${"'"} AND NEW.project_id=${"'"}${projectId}${"'"}`
  let functionCreated = false
  let triggerCreated = false
  try {
    await f.pool.query(
      `CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${predicate} THEN RAISE EXCEPTION 'r279 ${label}'; END IF; RETURN NEW; END $$`,
    )
    functionCreated = true
    await f.pool.query(`CREATE TRIGGER ${triggerName} BEFORE ${event} ON ${target} FOR EACH ROW EXECUTE FUNCTION ${functionName}()`)
    triggerCreated = true
  } catch (error) {
    if (triggerCreated) await f.pool.query(`DROP TRIGGER IF EXISTS ${triggerName} ON ${target}`).catch(() => undefined)
    if (functionCreated) await f.pool.query(`DROP FUNCTION IF EXISTS ${functionName}()`).catch(() => undefined)
    throw error
  }
  return async () => {
    await f.pool.query(`DROP TRIGGER IF EXISTS ${triggerName} ON ${target}`)
    await f.pool.query(`DROP FUNCTION IF EXISTS ${functionName}()`)
  }
}

for (const fault of ["second-conversation", "last-scope", "receipt"]) {
  integrationTest(`R279 ${fault} failure rolls back every tenant fact and same-key retry commits once`, async (t) => {
    const f = await r241Fixture(t)
    const project = await f.project(`R279 rollback ${fault}`)
    const repositories = new PostgresBffRepositories(postgresUrl, redisUrl)
    await repositories.ready()
    let secondConversationId
    try {
      await r279CreateConversation(f, repositories, project.id, `${fault}-first`)
      secondConversationId = await r279CreateConversation(f, repositories, project.id, `${fault}-second`)
    } finally {
      await repositories.close()
    }
    await r278CreateScheduledTask(f, project.id, `${fault}-task`)
    const key = `r279-${fault}-${randomUUID()}`
    const before = await r279TenantAuthoritySnapshot(f)
    const uninstall = await r279InstallFault(f, fault, project.id, secondConversationId)
    try {
      const failed = await r279DeleteProject(f, project.id, key)
      assert.equal(failed.status, 503, JSON.stringify(failed.body))
      assert.equal(failed.body.error.code, "business_store_unavailable")
      assert.deepEqual(await r279TenantAuthoritySnapshot(f), before, `${fault} left partial tenant facts`)
    } finally {
      await uninstall()
    }
    const retried = await r279DeleteProject(f, project.id, key)
    r279AssertProjectDeletionResource(retried, project.id, 202)
    const committed = await r279TenantAuthoritySnapshot(f)
    const replay = await r279DeleteProject(f, project.id, key)
    r279AssertProjectDeletionResource(replay, project.id, 202)
    assert.deepEqual(await r279TenantAuthoritySnapshot(f), committed, `${fault} replay appended durable facts`)
  })
}

async function r279RawHttp(f, method, path, rawHeaders = [], body = "") {
  const { request } = await import("node:http")
  const server = servers.at(-1)
  const address = server?.address()
  if (!address || typeof address === "string") throw new Error("R279 HTTP fixture is not listening")
  const url = new URL(`http://127.0.0.1:${address.port}`)
  return new Promise((resolve, reject) => {
    const outgoing = request(
      {
        hostname: url.hostname,
        port: url.port,
        method,
        path: `/v1/${path}`,
        headers: [
          "Host",
          url.host,
          "x-kokoro-service",
          "web-bff",
          "x-kokoro-internal-secret",
          "web-secret",
          "authorization",
          `Bearer ${f.token}`,
          ...rawHeaders,
        ],
        signal: AbortSignal.timeout(6000),
      },
      (response) => {
        const chunks = []
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
        response.once("error", reject)
        response.once("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8")
          resolve({ status: response.statusCode, body: JSON.parse(raw), headers: new Headers(response.headers) })
        })
      },
    )
    outgoing.once("error", reject)
    outgoing.end(body)
  })
}

integrationTest("R279 raw DELETE and status ingress is closed without inventing conditional-read semantics", async (t) => {
  const f = await r241Fixture(t)
  const project = await f.project("R279 ingress")
  const path = `projects/${project.id}`
  const before = await r279TenantAuthoritySnapshot(f)
  for (const [suffix, headers, body, code] of [
    ["/", ["Idempotency-Key", "valid"], "", "invalid_project_deletion_request"],
    ["?x=1", ["Idempotency-Key", "valid"], "", "invalid_project_deletion_request"],
    ["", [], "", "idempotency_key_required"],
    ["", ["Idempotency-Key", "a", "Idempotency-Key", "b"], "", "invalid_idempotency_key"],
    ["", ["Idempotency-Key", "a,b"], "", "invalid_idempotency_key"],
    ["", ["Idempotency-Key", "bad key"], "", "invalid_idempotency_key"],
    ["", ["Idempotency-Key", "x".repeat(129)], "", "invalid_idempotency_key"],
    ["", ["Idempotency-Key", "valid", "Content-Length", "2"], "{}", "invalid_project_deletion_request"],
  ]) {
    const result = await r279RawHttp(f, "DELETE", path + suffix, headers, body)
    assert.equal(result.status, 400, JSON.stringify(result.body))
    assert.equal(result.body.error.code, code)
    assert.equal(result.body.error.retryable, false)
    r241Headers(result)
  }
  assert.deepEqual(await r279TenantAuthoritySnapshot(f), before)
  const key1 = "x"
  const key128 = "K".repeat(128)
  const first = await r279RawHttp(f, "DELETE", path, ["Idempotency-Key", key1, "Content-Type", "application/json", "Content-Length", "0"])
  r279AssertProjectDeletionResource(first, project.id, 202)
  const statusPath = `${path}/deletion`
  for (const conditional of [[], ["If-Match", '"opaque"'], ["If-None-Match", '"opaque"'], ["Content-Type", "application/json"]]) {
    const status = await r279RawHttp(f, "GET", statusPath, conditional)
    r279AssertProjectDeletionResource(status, project.id, 200)
  }
  for (const headers of [
    ["Idempotency-Key", key128],
    ["Content-Length", "0"],
  ]) {
    const invalid = await r279RawHttp(f, "GET", statusPath, headers)
    assert.equal(invalid.status, 400)
    assert.equal(invalid.body.error.code, "invalid_project_deletion_request")
  }
  const another = await f.project("R279 128-byte key")
  const maxKey = await r279RawHttp(f, "DELETE", `projects/${another.id}`, ["Idempotency-Key", key128])
  r279AssertProjectDeletionResource(maxKey, another.id, 202)
})

integrationTest("R279 Project deletion preserves admitted-unknown recovery and fails only never-attempted dispatch", async (t) => {
  const f = await r241Fixture(t)
  const project = await f.project("R279 dispatch recovery")
  const repositories = new PostgresBffRepositories(postgresUrl, redisUrl)
  await repositories.ready()
  let unknownConversation
  let pendingConversation
  try {
    unknownConversation = await r279CreateConversation(f, repositories, project.id, "unknown-dispatch")
    pendingConversation = await r279CreateConversation(f, repositories, project.id, "pending-dispatch")
  } finally {
    await repositories.close()
  }
  await f.pool.query(
    `UPDATE bff_agent_dispatch_outbox SET status='retryable',attempt_count=1,admission_unknown_seen=TRUE,last_error_code='transport_unknown',last_error_at=CURRENT_TIMESTAMP(3)
      WHERE tenant_id=$1 AND conversation_id=$2`,
    [f.tenant, unknownConversation],
  )
  const key = `r279-dispatch-${randomUUID()}`
  r279AssertProjectDeletionResource(await r279DeleteProject(f, project.id, key), project.id, 202)
  const dispatch = await f.pool.query(
    `SELECT conversation_id,status,attempt_count,admission_unknown_seen,last_error_code FROM bff_agent_dispatch_outbox
      WHERE tenant_id=$1 AND conversation_id=ANY($2::text[]) ORDER BY conversation_id`,
    [f.tenant, [unknownConversation, pendingConversation]],
  )
  const byConversation = new Map(dispatch.rows.map((row) => [row.conversation_id, row]))
  assert.deepEqual(
    [
      byConversation.get(unknownConversation).status,
      Number(byConversation.get(unknownConversation).attempt_count),
      byConversation.get(unknownConversation).admission_unknown_seen,
    ],
    ["retryable", 1, true],
  )
  assert.deepEqual(
    [
      byConversation.get(pendingConversation).status,
      Number(byConversation.get(pendingConversation).attempt_count),
      byConversation.get(pendingConversation).admission_unknown_seen,
    ],
    ["failed", 0, false],
  )
  const cancellations = await f.pool.query(
    "SELECT conversation_id,run_id,command_id FROM bff_agent_cancellation_outbox WHERE tenant_id=$1 ORDER BY conversation_id,run_id",
    [f.tenant],
  )
  assert.deepEqual(
    cancellations.rows.map((row) => row.conversation_id),
    [unknownConversation],
  )
  const beforeReplay = await r279TenantAuthoritySnapshot(f)
  r279AssertProjectDeletionResource(await r279DeleteProject(f, project.id, key), project.id, 202)
  assert.deepEqual(await r279TenantAuthoritySnapshot(f), beforeReplay, "replay duplicated cancellation or changed unknown recovery")
})

integrationTest("R279 replay rejects a restored active Project instead of trusting a terminal deletion receipt", async (t) => {
  const f = await r241Fixture(t)
  const project = await f.project("R279 restored receipt")
  const key = `r279-restored-${randomUUID()}`
  r279AssertProjectDeletionResource(await r279DeleteProject(f, project.id, key), project.id, 202)
  await f.pool.query("UPDATE bff_project SET deleted_at=NULL,updated_at=CURRENT_TIMESTAMP(3) WHERE tenant_id=$1 AND project_id=$2", [f.tenant, project.id])
  const before = await r279TenantAuthoritySnapshot(f)
  const replay = await r279DeleteProject(f, project.id, key)
  assert.equal(replay.status, 503, JSON.stringify(replay.body))
  r241Headers(replay)
  assert.equal(replay.body.error.code, "business_store_unavailable")
  assert.equal(replay.body.error.retryable, true)
  assert.deepEqual(await r279TenantAuthoritySnapshot(f), before, "invalid active-Project replay changed facts")
})

for (const corruption of ["missing-member", "zero-scope", "wrong-project-scope"]) {
  integrationTest(`R279 status fails closed for ${corruption} release-set corruption`, async (t) => {
    const f = await r241Fixture(t)
    const project = await f.project(`R279 integrity ${corruption}`)
    const repositories = new PostgresBffRepositories(postgresUrl, redisUrl)
    await repositories.ready()
    let conversationId
    try {
      conversationId = await r279CreateConversation(f, repositories, project.id, `${corruption}-member`)
    } finally {
      await repositories.close()
    }
    r279AssertProjectDeletionResource(await r279DeleteProject(f, project.id, `r279-integrity-${randomUUID()}`), project.id, 202)
    if (corruption !== "wrong-project-scope")
      await f.pool.query("UPDATE bff_project_scope_release_outbox SET state='released',released_at=CURRENT_TIMESTAMP(3) WHERE tenant_id=$1 AND project_id=$2", [
        f.tenant,
        project.id,
      ])
    if (corruption === "missing-member")
      await f.pool.query("DELETE FROM bff_project_scope_release_outbox WHERE tenant_id=$1 AND project_id=$2 AND scope_kind='conversation' AND scope_id=$3", [
        f.tenant,
        project.id,
        conversationId,
      ])
    else if (corruption === "zero-scope")
      await f.pool.query("DELETE FROM bff_project_scope_release_outbox WHERE tenant_id=$1 AND project_id=$2", [f.tenant, project.id])
    else {
      const beforeConstraint = await r279TenantAuthoritySnapshot(f)
      await assert.rejects(
        f.pool.query("UPDATE bff_project_scope_release_outbox SET scope_id=$3 WHERE tenant_id=$1 AND project_id=$2 AND scope_kind='project'", [
          f.tenant,
          project.id,
          `project_${randomUUID()}`,
        ]),
        (error) => error?.code === "23514" && error?.constraint === "ck_bff_project_release_project_scope",
      )
      assert.deepEqual(await r279TenantAuthoritySnapshot(f), beforeConstraint, "rejected Project scope corruption changed facts")
      r279AssertProjectDeletionResource(await f.request(`projects/${project.id}/deletion`), project.id, 200)
      return
    }
    const before = await r279TenantAuthoritySnapshot(f)
    const status = await f.request(`projects/${project.id}/deletion`)
    assert.equal(status.status, 503, JSON.stringify(status.body))
    r241Headers(status)
    assert.equal(status.body.error.code, "business_store_unavailable")
    assert.equal(status.body.error.retryable, true)
    assert.deepEqual(await r279TenantAuthoritySnapshot(f), before, "integrity read mutated corrupted facts")
  })
}

integrationTest("R279 cancelled status lock wait retires the leased query and a later read succeeds", async (t) => {
  const f = await r241Fixture(t)
  const project = await f.project("R279 status cancellation")
  r279AssertProjectDeletionResource(await r279DeleteProject(f, project.id, `r279-cancel-${randomUUID()}`), project.id, 202)
  const blocker = await f.pool.connect()
  const abort = new AbortController()
  let pending
  try {
    await blocker.query("BEGIN")
    await blocker.query("LOCK TABLE bff_project_scope_release_outbox IN ACCESS EXCLUSIVE MODE")
    const blockerPid = (await blocker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid
    pending = f.request(`projects/${project.id}/deletion`, "GET", undefined, {}, abort.signal).then(
      (value) => ({ value }),
      (error) => ({ error }),
    )
    let blockedPid
    await waitFor(async () => {
      const blocked = await f.pool.query(
        `SELECT pid FROM pg_stat_activity
          WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid))`,
        [blockerPid],
      )
      blockedPid = blocked.rows[0]?.pid
      return blocked.rowCount === 1 && blockedPid !== undefined
    }, 1500)
    abort.abort()
    const cancelled = await pending
    assert.ok(cancelled.error, "the HTTP caller must observe cancellation while the exact status query is lock-waiting")
    await waitFor(async () => {
      const remaining = await f.pool.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid=$1", [blockedPid])
      return remaining.rowCount === 0
    }, 1500)
    await blocker.query("ROLLBACK")
    r279AssertProjectDeletionResource(await f.request(`projects/${project.id}/deletion`), project.id, 200)
  } finally {
    abort.abort()
    await blocker.query("ROLLBACK").catch(() => undefined)
    blocker.release()
    if (pending) await pending
  }
})

integrationTest("R280 equal-count substituted Conversation scope fails closed", async (t) => {
  const f = await r241Fixture(t)
  const project = await f.project("R280 substituted scope")
  const otherProject = await f.project("R280 other owned scope")
  const repositories = new PostgresBffRepositories(postgresUrl, redisUrl)
  await repositories.ready()
  let conversationId
  let otherConversationId
  try {
    conversationId = await r279CreateConversation(f, repositories, project.id, "substituted-scope")
    otherConversationId = await r279CreateConversation(f, repositories, otherProject.id, "other-valid-scope")
  } finally {
    await repositories.close()
  }
  r279AssertProjectDeletionResource(await r279DeleteProject(f, project.id, `r280-substitute-${randomUUID()}`), project.id, 202)
  await f.pool.query("UPDATE bff_project_scope_release_outbox SET state='released',released_at=CURRENT_TIMESTAMP(3) WHERE tenant_id=$1 AND project_id=$2", [
    f.tenant,
    project.id,
  ])
  await f.pool.query(
    "UPDATE bff_project_scope_release_outbox SET scope_id=$4 WHERE tenant_id=$1 AND project_id=$2 AND scope_kind='conversation' AND scope_id=$3",
    [f.tenant, project.id, conversationId, otherConversationId],
  )
  const before = await r279TenantAuthoritySnapshot(f)
  const result = await f.request(`projects/${project.id}/deletion`)
  assert.equal(result.status, 503, JSON.stringify(result.body))
  r241Headers(result)
  assert.equal(result.body.error.code, "business_store_unavailable")
  assert.deepEqual(await r279TenantAuthoritySnapshot(f), before)
})

integrationTest("R280 cancellation after status SELECT ACK cannot leave cleanup waiting for a ROLLBACK ACK", async (t) => {
  let observeSignal = () => {}
  const f = await r241Fixture(t, (signal) => observeSignal(signal))
  for (const phase of ["before-rollback", "during-rollback"]) {
    const project = await f.project(`R280 post-ACK cancellation ${phase}`)
    r279AssertProjectDeletionResource(await r279DeleteProject(f, project.id, `r280-ack-${randomUUID()}`), project.id, 202)
    const abort = new AbortController()
    let serverSignal
    let signalCancelled
    const serverCancelled = new Promise((resolve) => {
      signalCancelled = resolve
    })
    observeSignal = (signal) => {
      serverSignal = signal
      if (signal.aborted) signalCancelled()
      else signal.addEventListener("abort", signalCancelled, { once: true })
    }
    let releaseSelect
    const selectGate = new Promise((resolve) => {
      releaseSelect = resolve
    })
    let releaseRollback
    const rollbackGate = new Promise((resolve) => {
      releaseRollback = resolve
    })
    let selectAck = false
    let rollbackAckWithheld = false
    const observer = r241ObservePool(f.ownerPool, async (_lease, event) => {
      if (typeof event.sql === "string" && event.sql.includes("FROM bff_project_deletion d")) {
        selectAck = true
        await selectGate
      }
      if (selectAck && event.sql === "ROLLBACK") {
        rollbackAckWithheld = true
        await rollbackGate
      }
    })
    let pending
    try {
      pending = r241Observed(f.request(`projects/${project.id}/deletion`, "GET", undefined, {}, abort.signal))
      await r241Until(() => selectAck, 1500)
      if (phase === "during-rollback") {
        releaseSelect()
        await r241Until(() => rollbackAckWithheld, 1500)
      }
      abort.abort()
      // Client intent is not server cancellation. Hold the real SQL ACK until the
      // unchanged route has propagated HTTP close to the actual repository signal.
      await r241Until(() => serverSignal?.aborted === true, 1500)
      await serverCancelled
      releaseSelect()
      await r241Until(() => observer.leases.some((lease) => lease.releases.length > 0), 1500)
      if (phase === "before-rollback") assert.equal(rollbackAckWithheld, false, "cleanup incorrectly depends on a post-cancellation ROLLBACK ACK")
      else assert.equal(rollbackAckWithheld, true, "fixture must hold an in-flight ROLLBACK ACK before cancellation")
      const lease = observer.leases.find((candidate) =>
        candidate.events.some((event) => typeof event.sql === "string" && event.sql.includes("FROM bff_project_deletion d")),
      )
      assert.ok(lease)
      assert.equal(lease.releases.length, 1)
      assert.deepEqual(
        lease.releases.map((entry) => entry.destroy),
        [true],
        `${phase}: destroy must complete before releasing either ACK gate`,
      )
    } finally {
      abort.abort()
      releaseSelect?.()
      releaseRollback?.()
      if (pending) await pending
      observer.restore()
    }
    r279AssertProjectDeletionResource(await f.request(`projects/${project.id}/deletion`), project.id, 200)
  }
})

integrationTest("R281 Project deletion tables enforce closed receipt, identity, digest and lease invariants", async (t) => {
  const f = await r241Fixture(t)
  const client = await f.pool.connect()
  const projectId = `project_${randomUUID()}`
  const owner = `r281_owner_${randomUUID()}`
  const key = "R281-valid-key"
  const digest = "a".repeat(64)
  const data = { project_id: projectId, logical_release_state: "pending", physical_cleanup_state: "pending" }
  let savepoint = 0
  const rejected = async (sql, values, constraint) => {
    const name = `r281_bad_${++savepoint}`
    await client.query(`SAVEPOINT ${name}`)
    try {
      await assert.rejects(client.query(sql, values), (error) => error?.code === "23514" && error?.constraint === constraint)
    } finally {
      await client.query(`ROLLBACK TO SAVEPOINT ${name}`)
      await client.query(`RELEASE SAVEPOINT ${name}`)
    }
  }
  try {
    await client.query("BEGIN")
    await client.query(
      `INSERT INTO bff_project_deletion
       (tenant_id,project_id,owner_subject_id,operation,idempotency_key,request_fingerprint,response_data,response_status,location,conversation_count,release_command_count)
       VALUES ($1,$2,$3,'project.delete:v1',$4,$5,$6::jsonb,202,$7,0,1)`,
      [f.tenant, projectId, owner, key, digest, JSON.stringify(data), `/v1/projects/${projectId}/deletion`],
    )
    await client.query(
      `INSERT INTO bff_project_scope_release_outbox
       (command_id,tenant_id,project_id,owner_subject_id,actor_id,scope_kind,scope_id,request_digest,state,attempt_count,available_at,fence)
       VALUES ($1,$2,$3,$4,$4,'project',$3,$5,'pending',0,CURRENT_TIMESTAMP(3),0)`,
      [`r281_${randomUUID()}`, f.tenant, projectId, owner, digest],
    )
    await rejected(
      "UPDATE bff_project_deletion SET idempotency_key='bad key' WHERE tenant_id=$1 AND project_id=$2",
      [f.tenant, projectId],
      "ck_bff_project_deletion_key",
    )
    await rejected(
      "UPDATE bff_project_deletion SET request_fingerprint=$3 WHERE tenant_id=$1 AND project_id=$2",
      [f.tenant, projectId, `${"b".repeat(63)}Z`],
      "ck_bff_project_deletion_fingerprint",
    )
    await rejected(
      "UPDATE bff_project_deletion SET response_data=$3::jsonb WHERE tenant_id=$1 AND project_id=$2",
      [f.tenant, projectId, JSON.stringify({ project_id: projectId })],
      "ck_bff_project_deletion_response_data",
    )
    await rejected(
      "UPDATE bff_project_deletion SET response_data=$3::jsonb WHERE tenant_id=$1 AND project_id=$2",
      [f.tenant, projectId, JSON.stringify({ ...data, project_id: `project_${randomUUID()}` })],
      "ck_bff_project_deletion_response_data",
    )
    await rejected(
      "UPDATE bff_project_deletion SET location=$3 WHERE tenant_id=$1 AND project_id=$2",
      [f.tenant, projectId, `/v1/projects/project_${randomUUID()}/deletion`],
      "ck_bff_project_deletion_location",
    )
    await rejected(
      "UPDATE bff_project_scope_release_outbox SET actor_id='other' WHERE tenant_id=$1 AND project_id=$2",
      [f.tenant, projectId],
      "ck_bff_project_release_actor",
    )
    await rejected(
      "UPDATE bff_project_scope_release_outbox SET scope_id=$3 WHERE tenant_id=$1 AND project_id=$2",
      [f.tenant, projectId, `project_${randomUUID()}`],
      "ck_bff_project_release_project_scope",
    )
    await rejected(
      "UPDATE bff_project_scope_release_outbox SET request_digest=$3 WHERE tenant_id=$1 AND project_id=$2",
      [f.tenant, projectId, "A".repeat(64)],
      "ck_bff_project_release_digest",
    )
    await rejected(
      "UPDATE bff_project_scope_release_outbox SET lease_owner='worker' WHERE tenant_id=$1 AND project_id=$2",
      [f.tenant, projectId],
      "ck_bff_project_release_lease",
    )
    await rejected(
      "UPDATE bff_project_scope_release_outbox SET lease_expires_at=CURRENT_TIMESTAMP(3) WHERE tenant_id=$1 AND project_id=$2",
      [f.tenant, projectId],
      "ck_bff_project_release_lease",
    )
    assert.equal(
      (await client.query("SELECT count(*)::int AS n FROM bff_project_deletion WHERE tenant_id=$1 AND project_id=$2", [f.tenant, projectId])).rows[0].n,
      1,
    )
    assert.equal(
      (await client.query("SELECT count(*)::int AS n FROM bff_project_scope_release_outbox WHERE tenant_id=$1 AND project_id=$2", [f.tenant, projectId]))
        .rows[0].n,
      1,
    )
  } finally {
    await client.query("ROLLBACK").catch(() => undefined)
    client.release()
  }
})

async function r285ReleaseFixture(t, release) {
  const { ConnectError, Code } = await import("@connectrpc/connect")
  const { connectNodeAdapter } = await import("@connectrpc/connect-node")
  const { StorageService } = await import("../dist/generated/storage-connect/kokoro/storage/v3/storage_pb.js")
  const ownerCalls = []
  let replayEnabled = false
  const dispatch = async (kind, request, context) => {
    const call = {
      kind,
      commandId: request.command?.commandId,
      requestDigest: request.command?.requestDigest,
      service: context.requestHeader.get("x-kokoro-service"),
      secret: context.requestHeader.get("x-kokoro-internal-secret"),
      tenant: context.requestHeader.get("x-kokoro-tenant-id"),
      subject: context.requestHeader.get("x-kokoro-subject-id"),
      requestId: context.requestHeader.get("x-kokoro-request-id"),
      scopeKind: context.requestHeader.get("x-kokoro-scope-kind"),
      scopeId: context.requestHeader.get("x-kokoro-scope-id"),
      actor: context.requestHeader.get("x-kokoro-actor-id"),
    }
    ownerCalls.push(call)
    const outcome = await release({ call, calls: ownerCalls, replayEnabled, ConnectError, Code })
    if (outcome instanceof Error) throw outcome
    return {
      scopeReleased: true,
      replayed: outcome?.replayed ?? false,
      abortedUploadCount: 0n,
      releasedAssetCount: 0n,
      queuedObjectCleanupCount: 0n,
    }
  }
  const storage = createServer(
    connectNodeAdapter({
      routes(router) {
        router.service(StorageService, {
          releaseProjectScope: (request, context) => dispatch("project", request, context),
          releaseConversationScope: (request, context) => dispatch("conversation", request, context),
        })
      },
    }),
  )
  const storageBase = await listen(storage)
  const pool = new Pool({ connectionString: postgresUrl, options: "-c search_path=kokoro_bff -c timezone=UTC" })
  const tenant = `r285_${randomUUID().replaceAll("-", "")}`
  const owner = "r285_owner"
  const admission = new SessionAdmissionDouble()
  const token = `r285-${randomUUID()}`
  admission.allow(token, { namespace: tenant, userId: owner })
  const headers = { "x-kokoro-service": "web-bff", "x-kokoro-internal-secret": "web-secret", authorization: `Bearer ${token}` }
  let store
  let bff
  let base
  let tables = []
  const stop = async () => {
    const errors = []
    try {
      if (bff) await bff.shutdown(1500)
    } catch (error) {
      errors.push(error)
    } finally {
      bff = undefined
    }
    try {
      if (store) await store.close()
    } catch (error) {
      errors.push(error)
    } finally {
      store = undefined
    }
    if (errors.length > 0) throw errors[0]
  }
  const start = async () => {
    store = new PostgresBffRepositories(postgresUrl, redisUrl)
    await store.ready()
    const config = {
      ...bffConfig({ tenantId: tenant }),
      storage: { baseUrl: storageBase, secret: "r285-storage-secret", objectOrigin: storageBase },
      storageObjectOrigin: storageBase,
    }
    bff = createBffServer(config, {
      businessStore: store,
      sessionAdmission: admission,
      agentDispatchDispatcher: r237IdleWorker,
      agentCancellationDispatcher: r237IdleWorker,
      agUiProjector: r237IdleWorker,
      scheduledTaskDispatcher: r237IdleWorker,
      scheduledAgentDispatcher: r237IdleWorker,
      scheduledAgentTerminalConsumer: r237IdleWorker,
    })
    base = await listen(bff)
  }
  t.after(async () => {
    const errors = []
    try {
      await stop()
    } catch (error) {
      errors.push(error)
    } finally {
      try {
        if (storage.listening) await close(storage)
      } catch (error) {
        errors.push(error)
      } finally {
        try {
          for (const table of tables) {
            if (table === "bff_idempotency_receipt") await pool.query(`DELETE FROM ${table} WHERE position($1 in scope)>0`, [tenant])
            else await pool.query(`DELETE FROM ${table} WHERE tenant_id=$1`, [tenant])
          }
        } catch (error) {
          errors.push(error)
        } finally {
          try {
            await pool.end()
          } catch (error) {
            errors.push(error)
          }
        }
      }
    }
    if (errors.length > 0) throw errors[0]
  })
  tables = (
    await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='kokoro_bff' AND table_type='BASE TABLE'
      AND (table_name='bff_idempotency_receipt' OR table_name IN
        (SELECT table_name FROM information_schema.columns WHERE table_schema='kokoro_bff' AND column_name='tenant_id')) ORDER BY table_name`)
  ).rows.map((row) => row.table_name)
  assert.ok(tables.includes("bff_project_scope_release_outbox") && tables.includes("bff_project_deletion"))
  await start()
  const request = async (path, method = "GET", payload, extra = {}) => {
    const response = await fetch(`${base}/v1/${path}`, {
      method,
      headers: { ...headers, "content-type": "application/json", ...extra },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
      signal: AbortSignal.timeout(7000),
    })
    return { status: response.status, body: await response.json(), headers: response.headers }
  }
  const project = async (name) => {
    const result = await request("projects", "POST", { name }, { "idempotency-key": `r285-create-${randomUUID()}` })
    assert.equal(result.status, 200, JSON.stringify(result.body))
    return result.body.data.project
  }
  return {
    get ownerPool() {
      return store.database.pool
    },
    pool,
    tenant,
    owner,
    request,
    project,
    ownerCalls,
    restart: async () => {
      await stop()
      replayEnabled = true
      await start()
    },
  }
}

function r285AssertStorageCall(call, fixture, kind, scopeId) {
  assert.equal(call.kind, kind)
  assert.equal(call.service, "web-bff")
  assert.equal(call.secret, "r285-storage-secret")
  assert.equal(call.tenant, fixture.tenant)
  assert.equal(call.subject, fixture.owner)
  assert.equal(call.actor, null, "trusted Storage metadata must not invent an actor header")
  assert.equal(call.scopeKind, kind)
  assert.equal(call.scopeId, scopeId)
  assert.match(call.requestId ?? "", /^[^\x00-\x20\x7f]{1,128}$/u)
  assert.match(call.commandId ?? "", /^release_[a-f0-9]{48}$/u)
  assert.match(call.requestDigest ?? "", /^[a-f0-9]{64}$/u)
}

integrationTest(
  "R285 Project deletion releases the frozen active and deleted Conversation scopes through fixed Storage Connect",
  { timeout: 15000 },
  async (t) => {
    const f = await r285ReleaseFixture(t, async () => ({ replayed: false }))
    const project = await f.project("R285 release all frozen scopes")
    const repositories = new PostgresBffRepositories(postgresUrl, redisUrl)
    await repositories.ready()
    let activeConversation
    let deletedConversation
    try {
      activeConversation = await r279CreateConversation(f, repositories, project.id, "release-active")
      deletedConversation = await r279CreateConversation(f, repositories, project.id, "release-deleted")
      assert.equal(
        await repositories.services.chat.deleteConversation(f.tenant, f.owner, deletedConversation, `r285-single-delete-${randomUUID()}`, project.id),
        true,
      )
    } finally {
      await repositories.close()
    }
    const key = `r285-release-${randomUUID()}`
    const original = await r279DeleteProject(f, project.id, key)
    r279AssertProjectDeletionResource(original, project.id, 202)
    const originalBody = structuredClone(original.body)
    const originalLocation = original.headers.get("location")

    await waitFor(async () => {
      const result = await f.request(`projects/${project.id}/deletion`)
      return result.status === 200 && result.body.data.logical_release_state === "released"
    }, 7000)
    const status = await f.request(`projects/${project.id}/deletion`)
    assert.equal(status.status, 200, JSON.stringify(status.body))
    r241Headers(status)
    assert.deepEqual(status.body, {
      data: { project_id: project.id, logical_release_state: "released", physical_cleanup_state: "pending" },
    })
    assert.equal(f.ownerCalls.length, 3)
    const persistedCommands = await f.pool.query(
      "SELECT scope_kind,scope_id,command_id,request_digest FROM bff_project_scope_release_outbox WHERE tenant_id=$1 AND project_id=$2",
      [f.tenant, project.id],
    )
    const expectedCommands = new Map(persistedCommands.rows.map((row) => [`${row.scope_kind}:${row.scope_id}`, row]))
    const calls = new Map(f.ownerCalls.map((call) => [`${call.scopeKind}:${call.scopeId}`, call]))
    for (const [kind, scopeId] of [
      ["project", project.id],
      ["conversation", activeConversation],
      ["conversation", deletedConversation],
    ]) {
      const call = calls.get(`${kind}:${scopeId}`)
      const persisted = expectedCommands.get(`${kind}:${scopeId}`)
      assert.ok(persisted, `missing persisted ${kind} command for ${scopeId}`)
      r285AssertStorageCall(call, f, kind, scopeId)
      assert.equal(call.commandId, persisted.command_id)
      assert.equal(call.requestDigest, persisted.request_digest)
    }

    const replay = await r279DeleteProject(f, project.id, key)
    assert.equal(replay.status, 202)
    assert.deepEqual(replay.body, originalBody, "worker settlement must not rewrite the original pending receipt")
    assert.equal(replay.headers.get("location"), originalLocation)
    assert.equal(f.ownerCalls.length, 3, "HTTP receipt replay must not append or redeliver released commands")
  },
)

integrationTest("R285 lost Storage ACK restarts with the same command and owner replay before logical release", { timeout: 20000 }, async (t) => {
  const seen = new Map()
  const f = await r285ReleaseFixture(t, async ({ call, replayEnabled, ConnectError, Code }) => {
    const prior = seen.get(call.commandId)
    if (prior) {
      assert.equal(call.requestDigest, prior.requestDigest)
      assert.equal(call.scopeKind, prior.scopeKind)
      assert.equal(call.scopeId, prior.scopeId)
    } else seen.set(call.commandId, call)
    if (!replayEnabled) return new ConnectError("ACK lost after durable owner commit", Code.Unavailable)
    return { replayed: true }
  })
  const project = await f.project("R285 recover lost Storage ACK")
  const key = `r285-lost-ack-${randomUUID()}`
  const original = await r279DeleteProject(f, project.id, key)
  r279AssertProjectDeletionResource(original, project.id, 202)
  await waitFor(async () => {
    if (f.ownerCalls.length < 1) return false
    const result = await f.pool.query(
      "SELECT state,lease_owner,lease_expires_at,released_at FROM bff_project_scope_release_outbox WHERE tenant_id=$1 AND project_id=$2",
      [f.tenant, project.id],
    )
    return result.rows.length === 1 && result.rows[0].state === "pending" && result.rows[0].lease_owner === null
  }, 7000)
  const first = f.ownerCalls[0]
  r285AssertStorageCall(first, f, "project", project.id)
  const beforeRestart = await f.pool.query(
    "SELECT command_id,request_digest,state,lease_owner,lease_expires_at,released_at FROM bff_project_scope_release_outbox WHERE tenant_id=$1 AND project_id=$2",
    [f.tenant, project.id],
  )
  assert.equal(beforeRestart.rows.length, 1)
  assert.equal(first.commandId, beforeRestart.rows[0].command_id)
  assert.equal(first.requestDigest, beforeRestart.rows[0].request_digest)
  assert.equal(beforeRestart.rows[0].state, "pending")
  assert.equal(beforeRestart.rows[0].lease_owner, null)
  assert.equal(beforeRestart.rows[0].lease_expires_at, null)
  assert.equal(beforeRestart.rows[0].released_at, null)

  const preRestartCallCount = f.ownerCalls.length
  await f.restart()
  await waitFor(async () => {
    const result = await f.request(`projects/${project.id}/deletion`)
    return result.status === 200 && result.body.data.logical_release_state === "released"
  }, 7000)
  const callsAfterRestart = f.ownerCalls.slice(preRestartCallCount)
  const matching = callsAfterRestart.filter((call) => call.commandId === first.commandId)
  assert.ok(matching.length >= 1, "the new BFF instance must retry the original command after the lost ACK")
  for (const call of matching) {
    assert.equal(call.requestDigest, first.requestDigest)
    assert.equal(call.scopeId, first.scopeId)
  }
  const status = await f.request(`projects/${project.id}/deletion`)
  assert.equal(status.status, 200, JSON.stringify(status.body))
  r241Headers(status)
  assert.deepEqual(status.body, {
    data: { project_id: project.id, logical_release_state: "released", physical_cleanup_state: "pending" },
  })
  const replay = await r279DeleteProject(f, project.id, key)
  assert.deepEqual(replay.body, original.body)
  assert.equal(replay.status, 202)
})

function r285WorkerCommand(commandId, leaseRemainingMs = 1000, leaseObservedAtMs = performance.now()) {
  return {
    commandId,
    tenantId: "tenant-r285-worker",
    projectId: "11111111-1111-4111-8111-111111111111",
    ownerSubjectId: "subject-r285-worker",
    actorId: "subject-r285-worker",
    scopeKind: "project",
    scopeId: "11111111-1111-4111-8111-111111111111",
    requestDigest: "a".repeat(64),
    attemptCount: 1,
    leaseOwner: "worker-r285",
    fence: 1,
    leaseObservedAtMs,
    leaseRemainingMs,
  }
}

function r285WorkerRepository(claim) {
  const writes = []
  return {
    writes,
    claimProjectScopeReleases: claim,
    markProjectScopeReleased: async (lease) => {
      writes.push(["released", lease])
      return true
    },
    markProjectScopeRetryable: async (lease, delayMs, errorCode) => {
      writes.push(["retryable", lease, delayMs, errorCode])
      return true
    },
    markProjectScopeBlocked: async (lease, errorCode) => {
      writes.push(["blocked", lease, errorCode])
      return true
    },
  }
}

test("R285 stopping during a pending claim never dispatches the returned batch", async () => {
  const { ProjectScopeReleaseOutboxDispatcher } = await import("../dist/application/project-scope-release-outbox-dispatcher.js")
  let releaseClaim
  let claimEntered
  const entered = new Promise((resolve) => {
    claimEntered = resolve
  })
  const repository = r285WorkerRepository(async () => {
    claimEntered()
    return new Promise((resolve) => {
      releaseClaim = resolve
    })
  })
  const calls = []
  const dispatcher = new ProjectScopeReleaseOutboxDispatcher(
    repository,
    { release: async (command) => (calls.push(command.commandId), { outcome: "released" }) },
    { workerId: "worker-r285", pollIntervalMs: 60_000 },
  )
  const cycle = dispatcher.runOnce()
  await entered
  const stopped = dispatcher.stop()
  releaseClaim([r285WorkerCommand("release_" + "1".repeat(48)), r285WorkerCommand("release_" + "2".repeat(48))])
  await stopped
  await cycle
  assert.deepEqual(calls, [])
  assert.deepEqual(repository.writes, [])
})

test("R285 one claimed batch shares each lease's original monotonic deadline", async () => {
  const { ProjectScopeReleaseOutboxDispatcher } = await import("../dist/application/project-scope-release-outbox-dispatcher.js")
  let now = 100
  const repository = r285WorkerRepository(async () => [
    r285WorkerCommand("release_" + "3".repeat(48), 2000, now),
    r285WorkerCommand("release_" + "4".repeat(48), 1000, now),
  ])
  const calls = []
  const dispatcher = new ProjectScopeReleaseOutboxDispatcher(
    repository,
    {
      release: async (command) => {
        calls.push(command.commandId)
        if (calls.length === 1) now += 950
        return { outcome: "released" }
      },
    },
    { workerId: "worker-r285", settlementReserveMs: 100, monotonicNow: () => now },
  )
  await dispatcher.runOnce()
  assert.deepEqual(calls, ["release_" + "3".repeat(48)])
  assert.equal(repository.writes.length, 1)
  assert.equal(repository.writes[0][0], "released")
})

test("R285 timeout or cancellation after owner dispatch performs no settlement write", async () => {
  const { ProjectScopeReleaseOutboxDispatcher } = await import("../dist/application/project-scope-release-outbox-dispatcher.js")
  let now = 500
  const repository = r285WorkerRepository(async () => [r285WorkerCommand("release_" + "5".repeat(48), 1000, now)])
  const dispatcher = new ProjectScopeReleaseOutboxDispatcher(
    repository,
    {
      release: async () => {
        now += 950
        throw new Error("owner result arrived after the usable lease budget")
      },
    },
    { workerId: "worker-r285", settlementReserveMs: 100, monotonicNow: () => now },
  )
  await dispatcher.runOnce()
  assert.deepEqual(repository.writes, [])
})

integrationTest("R285 Project settlement retires its exact PG lease while a Project lock crosses expiry", { timeout: 10000 }, async (t) => {
  const { PostgresProjectScopeReleaseOutboxRepository } = await import("../dist/infrastructure/postgres/project-scope-release-outbox-repository.js")
  const f = await r241Fixture(t)
  const project = await f.project("R285 bounded settlement lock")
  const deletion = await r279DeleteProject(f, project.id, `r285-lock-${randomUUID()}`)
  r279AssertProjectDeletionResource(deletion, project.id, 202)
  const repository = new PostgresProjectScopeReleaseOutboxRepository({ pool: f.ownerPool })
  const claimed = await repository.claimProjectScopeReleases(
    {
      workerId: "worker-r285-lock",
      limit: 1,
      leaseDurationMs: 1000,
      includeOneCredentialRecovery: false,
    },
    AbortSignal.timeout(1000),
    1000,
  )
  assert.equal(claimed.length, 1)
  const command = claimed[0]
  const observer = r241ObservePool(f.ownerPool)
  const blocker = await f.pool.connect()
  let transaction = false
  let settlement
  try {
    await blocker.query("BEGIN")
    transaction = true
    await blocker.query("SELECT project_id FROM bff_project_deletion WHERE tenant_id=$1 AND project_id=$2 FOR UPDATE", [f.tenant, project.id])
    settlement = repository.markProjectScopeReleased(
      {
        commandId: command.commandId,
        tenantId: command.tenantId,
        projectId: command.projectId,
        leaseOwner: command.leaseOwner,
        fence: command.fence,
      },
      AbortSignal.timeout(1000),
      1000,
    )
    const [blockedPid] = await r241Blocked(f, blocker.processID)
    const observedLease = observer.leases.find((lease) => lease.pid === blockedPid)
    assert.ok(observedLease, "the blocked backend must be the exact observed settlement checkout")
    const result = await Promise.race([
      settlement,
      new Promise((resolve) => {
        const timer = setTimeout(() => resolve("r285-pg-settlement-timeout"), 1400)
        timer.unref?.()
      }),
    ])
    assert.equal(result, false, "settlement must retire its own blocked query when the exact lease expires")
    await r241Released(f, observer, blockedPid, true)
  } finally {
    if (transaction) await blocker.query("ROLLBACK").catch(() => undefined)
    blocker.release()
    await settlement?.catch(() => undefined)
    observer.restore()
  }
  const row = await f.pool.query(
    "SELECT state,released_at,lease_owner,lease_expires_at FROM bff_project_scope_release_outbox WHERE tenant_id=$1 AND command_id=$2",
    [f.tenant, command.commandId],
  )
  assert.equal(row.rows.length, 1)
  assert.notEqual(row.rows[0].state, "released")
  assert.equal(row.rows[0].released_at, null)
})

test("R285 absolute ten second attempt budget fences late result and throw before timer delivery", async (t) => {
  const { ProjectScopeReleaseOutboxDispatcher } = await import("../dist/application/project-scope-release-outbox-dispatcher.js")
  for (const outcome of ["result", "throw"]) {
    await t.test(outcome, async () => {
      let now = 1000
      const repository = r285WorkerRepository(async () => [r285WorkerCommand(`release_${outcome === "result" ? "6" : "7"}`.padEnd(56, "0"), 30000, now)])
      const dispatcher = new ProjectScopeReleaseOutboxDispatcher(
        repository,
        {
          release: async () => {
            now += 11000
            if (outcome === "throw") throw new Error("owner completed after the absolute attempt budget")
            return { outcome: "released" }
          },
        },
        { workerId: "worker-r285", settlementReserveMs: 500, monotonicNow: () => now },
      )
      await dispatcher.runOnce()
      assert.deepEqual(repository.writes, [], `${outcome} after ten seconds must not settle before a delayed timer callback runs`)
    })
  }
})

integrationTest("R285 releasing a Project lock after lease expiry cannot commit a late ACK", { timeout: 10000 }, async (t) => {
  const { PostgresProjectScopeReleaseOutboxRepository } = await import("../dist/infrastructure/postgres/project-scope-release-outbox-repository.js")
  const f = await r241Fixture(t)
  const project = await f.project("R285 expired settlement")
  r279AssertProjectDeletionResource(await r279DeleteProject(f, project.id, `r285-expired-${randomUUID()}`), project.id, 202)
  const repository = new PostgresProjectScopeReleaseOutboxRepository({ pool: f.ownerPool })
  const [command] = await repository.claimProjectScopeReleases(
    {
      workerId: "worker-r285-expired",
      limit: 1,
      leaseDurationMs: 1000,
      includeOneCredentialRecovery: false,
    },
    AbortSignal.timeout(1000),
    1000,
  )
  assert.ok(command)
  const blocker = await f.pool.connect()
  const observer = r241ObservePool(f.ownerPool)
  let transaction = false
  let settlement
  try {
    await blocker.query("BEGIN")
    transaction = true
    await blocker.query("SELECT project_id FROM bff_project_deletion WHERE tenant_id=$1 AND project_id=$2 FOR UPDATE", [f.tenant, project.id])
    settlement = repository.markProjectScopeReleased(
      {
        commandId: command.commandId,
        tenantId: command.tenantId,
        projectId: command.projectId,
        leaseOwner: command.leaseOwner,
        fence: command.fence,
      },
      AbortSignal.timeout(3000),
      3000,
    )
    const [blockedPid] = await r241Blocked(f, blocker.processID)
    const settlementLease = observer.leases.find((lease) => lease.pid === blockedPid)
    assert.ok(settlementLease, "the same observed transaction must wait on the Project aggregate lock")
    await r241Until(() => settlementLease.events.some((event) => event.sql === "BEGIN" && event.result !== null))
    const timing = await f.pool.query(
      `SELECT a.xact_start,o.lease_expires_at,clock_timestamp() AS observed_at
         FROM pg_stat_activity a,bff_project_scope_release_outbox o
        WHERE a.pid=$1 AND o.tenant_id=$2 AND o.command_id=$3`,
      [blockedPid, f.tenant, command.commandId],
    )
    assert.equal(timing.rows.length, 1)
    assert.ok(new Date(timing.rows[0].xact_start).getTime() < new Date(timing.rows[0].lease_expires_at).getTime())
    await r241Until(
      async () =>
        (
          await f.pool.query(
            "SELECT clock_timestamp()>lease_expires_at AS expired FROM bff_project_scope_release_outbox WHERE tenant_id=$1 AND command_id=$2",
            [f.tenant, command.commandId],
          )
        ).rows[0]?.expired === true,
      1800,
    )
    await blocker.query("ROLLBACK")
    transaction = false
    assert.equal(await settlement, false)
  } finally {
    if (transaction) await blocker.query("ROLLBACK").catch(() => undefined)
    blocker.release()
    await settlement?.catch(() => undefined)
    observer.restore()
  }
  const row = await f.pool.query("SELECT state,released_at FROM bff_project_scope_release_outbox WHERE tenant_id=$1 AND command_id=$2", [
    f.tenant,
    command.commandId,
  ])
  assert.notEqual(row.rows[0]?.state, "released")
  assert.equal(row.rows[0]?.released_at, null)
})

integrationTest("R285 pool saturation cancellation does not leave a late settlement checkout", { timeout: 10000 }, async (t) => {
  const { PostgresProjectScopeReleaseOutboxRepository } = await import("../dist/infrastructure/postgres/project-scope-release-outbox-repository.js")
  const f = await r241Fixture(t)
  const project = await f.project("R285 saturated settlement")
  r279AssertProjectDeletionResource(await r279DeleteProject(f, project.id, `r285-saturated-${randomUUID()}`), project.id, 202)
  const repository = new PostgresProjectScopeReleaseOutboxRepository({ pool: f.ownerPool })
  const [command] = await repository.claimProjectScopeReleases(
    {
      workerId: "worker-r285-saturated",
      limit: 1,
      leaseDurationMs: 1000,
      includeOneCredentialRecovery: false,
    },
    AbortSignal.timeout(1000),
    1000,
  )
  assert.ok(command)
  const held = []
  const observer = r241ObservePool(f.ownerPool)
  let settlement
  try {
    for (let index = 0; index < f.ownerPool.options.max; index += 1) held.push(await f.ownerPool.connect())
    const leasesBeforeSettlement = observer.leases.length
    settlement = repository.markProjectScopeReleased(
      {
        commandId: command.commandId,
        tenantId: command.tenantId,
        projectId: command.projectId,
        leaseOwner: command.leaseOwner,
        fence: command.fence,
      },
      AbortSignal.timeout(500),
      500,
    )
    await r241Until(() => f.ownerPool.waitingCount === 1)
    const result = await Promise.race([
      settlement,
      new Promise((resolve) => {
        const timer = setTimeout(() => resolve("r285-pool-acquire-timeout"), 800)
        timer.unref?.()
      }),
    ])
    assert.equal(result, false)
    const firstHeld = held.shift()
    assert.ok(firstHeld)
    firstHeld.release()
    await r241Until(() => observer.leases.length === leasesBeforeSettlement + 1)
    const lateLease = observer.leases.at(-1)
    assert.ok(lateLease)
    await r241Until(() => lateLease.releases.length === 1)
    assert.deepEqual(lateLease.events, [], "a late checkout after cancellation must execute no SQL")
    assert.deepEqual(
      lateLease.releases.map((release) => release.destroy),
      [false],
    )
    assert.equal(f.ownerPool.waitingCount, 0)
  } finally {
    for (const client of held) client.release()
    await settlement?.catch(() => undefined)
    observer.restore()
  }
  await r241PoolUsable(f.ownerPool)
})

integrationTest("R287 a delayed event loop after the real COMMIT ACK reports unknown and retires the exact lease", { timeout: 10000 }, async (t) => {
  const { PostgresProjectScopeReleaseOutboxRepository } = await import("../dist/infrastructure/postgres/project-scope-release-outbox-repository.js")
  const f = await r241Fixture(t)
  const project = await f.project("R287 committed ACK beyond budget")
  r279AssertProjectDeletionResource(await r279DeleteProject(f, project.id, `r287-commit-${randomUUID()}`), project.id, 202)
  const repository = new PostgresProjectScopeReleaseOutboxRepository({ pool: f.ownerPool })
  const [command] = await repository.claimProjectScopeReleases(
    {
      workerId: "worker-r287-commit",
      limit: 1,
      leaseDurationMs: 3000,
      includeOneCredentialRecovery: false,
    },
    AbortSignal.timeout(1000),
    1000,
  )
  assert.ok(command)

  let stalledCommit = false
  const observer = r241ObservePool(f.ownerPool, async (_lease, event) => {
    if (event.sql !== "COMMIT" || stalledCommit) return
    stalledCommit = true
    const stalledUntil = performance.now() + 650
    while (performance.now() < stalledUntil) {
      // The real PostgreSQL ACK is already recorded; only timer delivery is delayed.
    }
  })
  let settlement
  try {
    settlement = repository.markProjectScopeReleased(
      {
        commandId: command.commandId,
        tenantId: command.tenantId,
        projectId: command.projectId,
        leaseOwner: command.leaseOwner,
        fence: command.fence,
      },
      AbortSignal.timeout(500),
      500,
    )
    await assert.rejects(settlement, (error) => {
      assert.equal(error?.message, "PROJECT_SCOPE_RELEASE_COMMIT_UNKNOWN")
      return true
    })
    assert.equal(stalledCommit, true, "the seam must delay only after the real COMMIT result")
    const lease = observer.leases.find((candidate) => candidate.events.some((event) => event.sql === "COMMIT"))
    assert.ok(lease)
    await r241Released(f, observer, lease.pid, true)
    const commitIndex = lease.events.findIndex((event) => event.sql === "COMMIT")
    assert.ok(commitIndex >= 0)
    assert.deepEqual(lease.events.slice(commitIndex + 1), [], "an unknown committed result must not guess ROLLBACK or issue another write")
  } finally {
    await settlement?.catch(() => undefined)
    observer.restore()
  }

  const committed = await f.pool.query("SELECT state,released_at,updated_at FROM bff_project_scope_release_outbox WHERE tenant_id=$1 AND command_id=$2", [
    f.tenant,
    command.commandId,
  ])
  assert.equal(committed.rows.length, 1)
  assert.equal(committed.rows[0].state, "released", "unknown transport outcome does not mean PostgreSQL rolled the durable commit back")
  assert.ok(committed.rows[0].released_at)
  const beforeReplay = structuredClone(committed.rows[0])
  assert.equal(
    await repository.markProjectScopeReleased(
      {
        commandId: command.commandId,
        tenantId: command.tenantId,
        projectId: command.projectId,
        leaseOwner: command.leaseOwner,
        fence: command.fence,
      },
      AbortSignal.timeout(1000),
      1000,
    ),
    false,
  )
  const afterReplay = await f.pool.query("SELECT state,released_at,updated_at FROM bff_project_scope_release_outbox WHERE tenant_id=$1 AND command_id=$2", [
    f.tenant,
    command.commandId,
  ])
  assert.deepEqual(afterReplay.rows, [beforeReplay], "the original consumed lease cannot append another released write")
})

integrationTest("R288 PostgreSQL lock_timeout is a normal unconfirmed settlement and preserves the lease for retry", { timeout: 12000 }, async (t) => {
  const { PostgresProjectScopeReleaseOutboxRepository } = await import("../dist/infrastructure/postgres/project-scope-release-outbox-repository.js")
  const f = await r241Fixture(t)
  const project = await f.project("R288 settlement lock timeout")
  r279AssertProjectDeletionResource(await r279DeleteProject(f, project.id, `r288-lock-${randomUUID()}`), project.id, 202)
  const repository = new PostgresProjectScopeReleaseOutboxRepository({ pool: f.ownerPool })
  const [command] = await repository.claimProjectScopeReleases(
    {
      workerId: "worker-r288-lock",
      limit: 1,
      leaseDurationMs: 8000,
      includeOneCredentialRecovery: false,
    },
    AbortSignal.timeout(1000),
    1000,
  )
  assert.ok(command)
  const authoritative = async () =>
    (
      await f.pool.query(
        `SELECT state,attempt_count,fence,lease_owner,lease_expires_at,released_at,last_error_code
           FROM bff_project_scope_release_outbox WHERE tenant_id=$1 AND command_id=$2`,
        [f.tenant, command.commandId],
      )
    ).rows
  const before = await authoritative()
  assert.equal(before.length, 1)
  assert.equal(before[0].state, "leased")
  assert.equal(Number(before[0].attempt_count), 1)
  assert.equal(Number(before[0].fence), command.fence)

  const blocker = await f.pool.connect()
  const observer = r241ObservePool(f.ownerPool)
  let blockerTransaction = false
  let settlement
  let outcome
  try {
    await blocker.query("BEGIN")
    blockerTransaction = true
    await blocker.query("SELECT project_id FROM bff_project_deletion WHERE tenant_id=$1 AND project_id=$2 FOR UPDATE", [f.tenant, project.id])
    settlement = repository.markProjectScopeReleased(
      {
        commandId: command.commandId,
        tenantId: command.tenantId,
        projectId: command.projectId,
        leaseOwner: command.leaseOwner,
        fence: command.fence,
      },
      AbortSignal.timeout(3000),
      3000,
    )
    outcome = await settlement.then(
      (value) => ({ value }),
      (error) => ({ error }),
    )
    const lease = observer.leases.find((candidate) => candidate.events.some((event) => event.errorCode === "55P03"))
    assert.ok(lease, "the real PostgreSQL lock_timeout must expose server code 55P03")
    assert.equal(lease.events.filter((event) => event.errorCode === "55P03").length, 1)
    assert.ok(lease.events.some((event) => event.sql === "ROLLBACK" && event.result !== null))
    assert.equal(
      lease.events.some((event) => event.sql === "COMMIT"),
      false,
    )
    await r241Released(f, observer, lease.pid, false)
  } finally {
    if (blockerTransaction) await blocker.query("ROLLBACK").catch(() => undefined)
    blocker.release()
    await settlement?.catch(() => undefined)
    observer.restore()
  }

  assert.equal(outcome?.error, undefined, `lock_timeout escaped instead of returning false: ${outcome?.error?.message ?? "unknown"}`)
  assert.equal(outcome?.value, false)
  assert.deepEqual(await authoritative(), before, "a lock_timeout must not consume the lease or confirm any release")
  await r241PoolUsable(f.ownerPool)
  assert.equal(
    await repository.markProjectScopeReleased(
      {
        commandId: command.commandId,
        tenantId: command.tenantId,
        projectId: command.projectId,
        leaseOwner: command.leaseOwner,
        fence: command.fence,
      },
      AbortSignal.timeout(3000),
      3000,
    ),
    true,
    "the unchanged legal lease must settle after the independent blocker is gone",
  )
  const released = await authoritative()
  assert.equal(released[0].state, "released")
  assert.equal(Number(released[0].attempt_count), 1)
  assert.equal(Number(released[0].fence), command.fence)
  assert.ok(released[0].released_at)
})

integrationTest("R290 credential recovery occupies one total batch slot without starving behind ordinary due work", { timeout: 12000 }, async (t) => {
  const { PostgresProjectScopeReleaseOutboxRepository } = await import("../dist/infrastructure/postgres/project-scope-release-outbox-repository.js")
  const f = await r241Fixture(t)
  const repository = new PostgresProjectScopeReleaseOutboxRepository({ pool: f.ownerPool })
  const seed = async (label, state, errorCode, ageSeconds) => {
    const project = await f.project(`R290 ${label}`)
    r279AssertProjectDeletionResource(await r279DeleteProject(f, project.id, `r290-${label}-${randomUUID()}`), project.id, 202)
    const command = (
      await f.pool.query("SELECT command_id FROM bff_project_scope_release_outbox WHERE tenant_id=$1 AND project_id=$2 AND scope_kind='project'", [
        f.tenant,
        project.id,
      ])
    ).rows[0]
    assert.ok(command)
    await f.pool.query(
      `UPDATE bff_project_scope_release_outbox
          SET state=$3,last_error_code=$4,available_at=clock_timestamp()-INTERVAL '1 second',
              updated_at=clock_timestamp()-($5::double precision*INTERVAL '1 second'),lease_owner=NULL,lease_expires_at=NULL,released_at=NULL
        WHERE tenant_id=$1 AND command_id=$2`,
      [f.tenant, command.command_id, state, errorCode, ageSeconds],
    )
    return command.command_id
  }

  const oneOrdinary = await seed("limit-one-ordinary", "pending", null, 10)
  const oneRecovery = await seed("limit-one-recovery", "blocked", "storage_unauthenticated", 700)
  const oneRecoveryLater = await seed("limit-one-recovery-later", "blocked", "storage_unauthenticated", 600)
  const one = await repository.claimProjectScopeReleases(
    { workerId: "worker-r290-one", limit: 1, leaseDurationMs: 60_000, includeOneCredentialRecovery: true },
    AbortSignal.timeout(2000),
    2000,
  )
  assert.deepEqual(
    one.map((command) => command.commandId),
    [oneRecovery],
    "one cooled credential recovery must occupy the sole batch slot even when ordinary work is due",
  )
  assert.equal(new Set(one.map((command) => command.commandId)).size, one.length)
  const phaseOne = await f.pool.query(
    "SELECT command_id,state,last_error_code FROM bff_project_scope_release_outbox WHERE tenant_id=$1 AND command_id=ANY($2::text[]) ORDER BY command_id",
    [f.tenant, [oneOrdinary, oneRecovery, oneRecoveryLater]],
  )
  assert.equal(phaseOne.rows.find((row) => row.command_id === oneOrdinary)?.state, "pending")
  assert.equal(phaseOne.rows.find((row) => row.command_id === oneRecovery)?.state, "leased")
  assert.equal(phaseOne.rows.find((row) => row.command_id === oneRecoveryLater)?.state, "blocked")

  const manyOrdinaries = [oneOrdinary]
  for (let index = 0; index < 9; index += 1) manyOrdinaries.push(await seed(`many-ordinary-${index}`, "pending", null, 10))
  const manyRecovery = await seed("many-recovery", "blocked", "storage_unauthenticated", 900)
  const manyRecoveryLater = await seed("many-recovery-later", "blocked", "storage_unauthenticated", 800)
  const permissionDenied = await seed("permission-denied", "blocked", "storage_terminal_3", 900)
  const many = await repository.claimProjectScopeReleases(
    { workerId: "worker-r290-many", limit: 10, leaseDurationMs: 60_000, includeOneCredentialRecovery: true },
    AbortSignal.timeout(2000),
    2000,
  )
  assert.equal(many.length, 10)
  assert.equal(many.filter((command) => manyOrdinaries.includes(command.commandId)).length, 9)
  assert.equal(many.filter((command) => command.commandId === manyRecovery).length, 1)
  const ordinaryRows = await f.pool.query(
    "SELECT command_id,state FROM bff_project_scope_release_outbox WHERE tenant_id=$1 AND command_id=ANY($2::text[]) ORDER BY command_id",
    [f.tenant, manyOrdinaries],
  )
  assert.equal(ordinaryRows.rows.filter((row) => row.state === "leased").length, 9)
  assert.equal(ordinaryRows.rows.filter((row) => row.state === "pending").length, 1)
  const remainingOrdinary = ordinaryRows.rows.find((row) => row.state === "pending")?.command_id
  assert.ok(remainingOrdinary)
  const manyRows = await f.pool.query(
    "SELECT command_id,state,last_error_code FROM bff_project_scope_release_outbox WHERE tenant_id=$1 AND command_id=ANY($2::text[]) ORDER BY command_id",
    [f.tenant, [manyRecovery, manyRecoveryLater, permissionDenied]],
  )
  assert.equal(manyRows.rows.find((row) => row.command_id === manyRecovery)?.state, "leased")
  assert.equal(manyRows.rows.find((row) => row.command_id === manyRecoveryLater)?.state, "blocked")
  assert.equal(manyRows.rows.find((row) => row.command_id === permissionDenied)?.state, "blocked")
  assert.equal(manyRows.rows.find((row) => row.command_id === permissionDenied)?.last_error_code, "storage_terminal_3")

  const disabledOrdinary = await seed("recovery-disabled-ordinary", "pending", null, 10)
  const disabledRecovery = await seed("recovery-disabled-blocked", "blocked", "storage_unauthenticated", 900)
  const disabled = await repository.claimProjectScopeReleases(
    { workerId: "worker-r290-disabled", limit: 10, leaseDurationMs: 5000, includeOneCredentialRecovery: false },
    AbortSignal.timeout(2000),
    2000,
  )
  assert.deepEqual(new Set(disabled.map((command) => command.commandId)), new Set([remainingOrdinary, disabledOrdinary]))
  assert.equal(
    (await f.pool.query("SELECT state FROM bff_project_scope_release_outbox WHERE tenant_id=$1 AND command_id=$2", [f.tenant, disabledRecovery])).rows[0]
      ?.state,
    "blocked",
  )
})

integrationTest(
  "R290 dispatcher anchors a real delayed claim to the database lease window without double charging checkout wait",
  { timeout: 12000 },
  async (t) => {
    const { ProjectScopeReleaseOutboxDispatcher } = await import("../dist/application/project-scope-release-outbox-dispatcher.js")
    const { PostgresProjectScopeReleaseOutboxRepository } = await import("../dist/infrastructure/postgres/project-scope-release-outbox-repository.js")
    const f = await r241Fixture(t)
    const project = await f.project("R290 delayed claim lease anchor")
    r279AssertProjectDeletionResource(await r279DeleteProject(f, project.id, `r290-anchor-${randomUUID()}`), project.id, 202)
    const repository = new PostgresProjectScopeReleaseOutboxRepository({ pool: f.ownerPool })
    const held = []
    const ownerCalls = []
    let cycle
    try {
      for (let index = 0; index < f.ownerPool.options.max; index += 1) held.push(await f.ownerPool.connect())
      const dispatcher = new ProjectScopeReleaseOutboxDispatcher(
        repository,
        {
          release: async (command) => {
            const timing = await f.pool.query(
              `SELECT state,lease_expires_at,clock_timestamp() AS observed_at,
                    FLOOR(EXTRACT(EPOCH FROM (lease_expires_at-clock_timestamp()))*1000)::integer AS remaining_ms
               FROM bff_project_scope_release_outbox WHERE tenant_id=$1 AND command_id=$2`,
              [f.tenant, command.commandId],
            )
            assert.equal(timing.rows.length, 1)
            assert.equal(timing.rows[0].state, "leased")
            assert.ok(timing.rows[0].lease_expires_at > timing.rows[0].observed_at)
            assert.ok(timing.rows[0].remaining_ms > 100, `database lease had no usable execution window: ${timing.rows[0].remaining_ms}`)
            ownerCalls.push(command.commandId)
            return { outcome: "released" }
          },
        },
        { workerId: "worker-r290-anchor", batchSize: 1, leaseDurationMs: 1000, settlementReserveMs: 100, pollIntervalMs: 60_000 },
      )
      cycle = dispatcher.runOnce()
      await r241Until(() => f.ownerPool.waitingCount === 1, 1500)
      const waitStarted = performance.now()
      const harnessDeadline = waitStarted + 1200
      while (performance.now() - waitStarted < 600) {
        assert.ok(performance.now() < harnessDeadline, "test harness did not observe the real checkout delay")
        await new Promise((resolve) => setImmediate(resolve))
      }
      const released = held.shift()
      assert.ok(released)
      released.release()
      const result = await Promise.race([
        cycle,
        new Promise((_, reject) => {
          const timer = setTimeout(() => reject(new Error("R290 delayed real claim did not finish")), 5000)
          timer.unref?.()
        }),
      ])
      assert.equal(result, 1)
      assert.equal(ownerCalls.length, 1)
      const authoritative = await f.pool.query(
        "SELECT state,attempt_count,fence,released_at FROM bff_project_scope_release_outbox WHERE tenant_id=$1 AND project_id=$2",
        [f.tenant, project.id],
      )
      assert.equal(authoritative.rows.length, 1)
      assert.equal(authoritative.rows[0].state, "released")
      assert.equal(Number(authoritative.rows[0].attempt_count), 1)
      assert.equal(Number(authoritative.rows[0].fence), 1)
      assert.ok(authoritative.rows[0].released_at)
    } finally {
      for (const client of held) client.release()
      await cycle?.catch(() => undefined)
    }
    await r241PoolUsable(f.ownerPool)
  },
)

integrationTest("current scheduled HTTP reads authoritative next, rechecks admission, and never writes receipts", async () => {
  const { PostgresScheduledTaskRepository } = await import("../dist/infrastructure/postgres/scheduled-task-repository.js")
  const pool = new Pool({ connectionString: postgresUrl, options: "-c search_path=kokoro_bff", max: 3 })
  const suffix = `live_current_${Date.now()}_${Math.random().toString(16).slice(2)}`
  const subject = "owner_current"
  const target = "http://bff.test/internal/bff/scheduled-tasks/dispatch"
  let definition,
    lifecycle = "active",
    next = "2030-01-01T08:15:00Z",
    action = async () => {},
    gets = 0,
    writes = 0,
    bff,
    owner
  const headers = auth(suffix, subject)
  const token = headers.authorization.slice(7)
  const repository = new PostgresScheduledTaskRepository({ pool })
  const isolation = await pool.connect()
  try {
    // Other cases deliberately retain pending commands in this owned test database.
    // Keep their rows untouched and locked out of this fixture's real SKIP LOCKED claims.
    await isolation.query("BEGIN")
    await isolation.query("SET LOCAL lock_timeout = '2s'")
    await isolation.query("SELECT outbox_id FROM bff_scheduled_task_outbox WHERE tenant_id<>$1 FOR UPDATE", [suffix])
    owner = createServer((request, response) => {
      const chunks = []
      request.on("data", (chunk) => chunks.push(chunk))
      request.on("end", async () => {
        response.setHeader("content-type", "application/json")
        response.setHeader("cache-control", "no-store")
        response.setHeader("x-request-id", request.headers["x-request-id"])
        if (request.method === "GET") {
          gets++
          await action(request, response)
          if (!response.destroyed)
            response.end(
              JSON.stringify({
                data: {
                  schedule: {
                    ...definition,
                    id: "00000000-0000-4000-8000-000000000001",
                    version: 1,
                    status: lifecycle,
                    paused: lifecycle === "exhausted" ? false : definition.paused,
                    next_due_at: lifecycle === "exhausted" ? null : next,
                  },
                },
              }),
            )
        } else {
          writes++
          definition = JSON.parse(Buffer.concat(chunks).toString("utf8"))
          response.end(
            JSON.stringify({
              data: {
                name: definition.name,
                status: "registered",
                schedule: { ...definition, id: "00000000-0000-4000-8000-000000000001", version: 1, next_due_at: definition.run_at ?? next },
              },
              meta: { request_id: request.headers["x-request-id"] },
            }),
          )
        }
      })
    })
    const schedulerBase = await listen(owner)
    bff = createBffServer(
      { ...bffConfig({ tenantId: suffix, schedulerBase, schedulerTargetUrl: target }), upstreamTimeoutMs: 150 },
      { sessionAdmission, scheduledTaskDispatcher: { start() {}, async stop() {} } },
    )
    const base = await listen(bff)
    const createBody = {
      trigger_kind: "calendar",
      title: "Current",
      prompt: "No execution",
      frequency: "daily",
      time: "08:15",
      timezone: "UTC",
      auto_approve: false,
    }
    const mutationHeaders = { ...headers, "content-type": "application/json", "idempotency-key": "current-create" }
    const created = await fetch(`${base}/v1/scheduled-tasks`, { method: "POST", headers: mutationHeaders, body: JSON.stringify(createBody) })
    assert.equal(created.status, 200)
    const original = (await created.json()).data.task
    const read = () => fetch(`${base}/v1/scheduled-tasks/${original.id}`, { headers })
    const pending = await read()
    assert.equal(pending.status, 200)
    assert.equal((await pending.json()).data.task.scheduling_state, "pending")
    assert.equal(gets, 0)
    const [command] = await repository.claimScheduledTaskOutbox({ workerId: suffix, limit: 1, leaseDurationMs: 30000, now: new Date() })
    assert.equal(command.tenantId, suffix, "this fixture must not deliver another test's pending command")
    const { SchedulerOutboxDelivery } = await import("../dist/infrastructure/clients/scheduler/outbox-delivery.js")
    const delivered = await new SchedulerOutboxDelivery(bffConfig({ tenantId: suffix, schedulerBase, schedulerTargetUrl: target })).deliver(command)
    assert.equal(delivered.outcome, "succeeded", JSON.stringify(delivered))
    await repository.markScheduledTaskOutboxSucceeded(command, new Date())
    const counts = async () =>
      (
        await pool.query(
          "SELECT (SELECT count(*) FROM bff_scheduled_task_outbox WHERE tenant_id=$1) AS commands,(SELECT count(*) FROM bff_idempotency_receipt WHERE starts_with(scope,$2)) AS receipts",
          [suffix, `${JSON.stringify([suffix]).slice(0, -1)},`],
        )
      ).rows[0]
    const before = await counts()
    next = "2030-01-02T08:15:00Z"
    const active = await read()
    assert.equal(active.status, 200)
    assert.equal(active.headers.get("cache-control"), "no-store")
    const live = (await active.json()).data.task
    assert.equal(live.next_run_at, "2030-01-02T08:15:00.000Z")
    assert.equal(live.scheduling_state, "active")
    const listed = await fetch(`${base}/v1/scheduled-tasks`, { headers })
    assert.equal(listed.status, 200)
    assert.equal((await listed.json()).data.tasks[0].next_run_at, live.next_run_at)
    assert.deepEqual(await counts(), before)
    assert.equal(writes, 1)
    const saved = definition
    definition = { ...saved, body: { ...saved.body, owner_id: "foreign" } }
    assert.equal((await read()).status, 503)
    definition = saved
    action = async () => {
      sessionAdmission.deny(token, { ok: false, status: 401, code: "session_invalid" })
    }
    assert.equal((await read()).status, 401)
    sessionAdmission.allow(token, { namespace: suffix, userId: subject })
    action = async () => {
      sessionAdmission.allow(token, { namespace: suffix, userId: "foreign-subject" })
    }
    assert.equal((await read()).status, 403, "a subject change during owner I/O is not a fresh successful read")
    sessionAdmission.allow(token, { namespace: suffix, userId: subject })
    action = async (_request, response) => {
      await new Promise((resolve) => response.once("close", resolve))
    }
    const started = performance.now()
    assert.equal((await read()).status, 503, "the whole read lifetime is bounded")
    assert.ok(performance.now() - started < 1000)
    let entered, closed
    const ownerEntered = new Promise((resolve) => {
      entered = resolve
    })
    const ownerClosed = new Promise((resolve) => {
      closed = resolve
    })
    action = async (_request, response) => {
      entered()
      await new Promise((resolve) =>
        response.once("close", () => {
          closed()
          resolve()
        }),
      )
    }
    const controller = new AbortController()
    const disconnected = fetch(`${base}/v1/scheduled-tasks/${original.id}`, { headers, signal: controller.signal })
    const rejected = assert.rejects(disconnected)
    await ownerEntered
    controller.abort()
    await rejected
    let watchdog
    try {
      await Promise.race([
        ownerClosed,
        new Promise((_, reject) => {
          watchdog = setTimeout(() => reject(Error("disconnect did not close the owner query")), 1000)
        }),
      ])
    } finally {
      clearTimeout(watchdog)
    }
    action = async () => {
      await repository.updateScheduledTask(
        { tenantId: suffix, subjectId: subject },
        original.id,
        { title: "Changed in flight" },
        { tenantId: suffix, actorId: subject, requestId: "req-race", idempotencyKey: "race-update" },
      )
    }
    assert.equal((await read()).status, 503)
    action = async () => {}
    const replay = await fetch(`${base}/v1/scheduled-tasks`, { method: "POST", headers: mutationHeaders, body: JSON.stringify(createBody) })
    assert.equal(replay.status, 200)
    assert.deepEqual((await replay.json()).data.task, original)
    await repository.updateScheduledTask(
      { tenantId: suffix, subjectId: subject },
      original.id,
      { triggerKind: "calendar", frequency: "once", localDate: "2030-01-01", time: "08:15", timezone: "UTC", enabled: false, status: "paused" },
      { tenantId: suffix, actorId: subject, requestId: "req-consumed", idempotencyKey: "paused-once-current" },
    )
    // One aggregate is delivered serially: settle the earlier race edit before the once replacement.
    for (let round = 0; round < 3; round++) {
      const pendingCommands = await repository.claimScheduledTaskOutbox({
        workerId: suffix,
        limit: 10,
        leaseDurationMs: 30000,
        now: new Date(Date.now() + 1000),
      })
      if (!pendingCommands.length) break
      for (const pending of pendingCommands) {
        assert.equal(pending.tenantId, suffix)
        const result = await new SchedulerOutboxDelivery(bffConfig({ tenantId: suffix, schedulerBase, schedulerTargetUrl: target })).deliver(pending)
        assert.equal(result.outcome, "succeeded", JSON.stringify(result))
        assert.equal(await repository.markScheduledTaskOutboxSucceeded(pending, new Date()), true)
      }
    }
    lifecycle = "exhausted"
    const beforeConsumedRead = await counts()
    const consumed = await read()
    assert.equal(consumed.status, 200)
    const consumedTask = (await consumed.json()).data.task
    assert.equal(consumedTask.scheduling_state, "exhausted")
    assert.equal(consumedTask.next_run_at, null)
    assert.deepEqual(await counts(), beforeConsumedRead)
    const consumedDefinition = definition
    definition = { ...definition, body: { ...definition.body, task_revision: definition.body.task_revision - 1 } }
    assert.equal((await read()).status, 503, "consumption must not excuse a stale task revision")
    definition = consumedDefinition
  } finally {
    try {
      if (bff) await bff.shutdown()
      if (owner) {
        owner.closeAllConnections()
        await close(owner)
      }
      for (const table of ["bff_scheduled_task_outbox", "bff_scheduled_task"]) await pool.query(`DELETE FROM ${table} WHERE tenant_id=$1`, [suffix])
      await pool.query("DELETE FROM bff_idempotency_receipt WHERE starts_with(scope,$1)", [`${JSON.stringify([suffix]).slice(0, -1)},`])
    } finally {
      try {
        await isolation.query("ROLLBACK")
      } finally {
        isolation.release()
        await pool.end()
      }
    }
  }
})

async function i3R285SqlCancellationFixture({
  failAt = "project",
  code = "57014",
  message = "canceling statement due to statement timeout",
  kind = "database",
  rollbackFailure = false,
} = {}) {
  const [{ EventEmitter }, { DatabaseError }, { tsImport }] = await Promise.all([import("node:events"), import("pg"), import("tsx/esm/api")])
  const { PostgresProjectScopeReleaseOutboxRepository } = await tsImport(
    "../src/infrastructure/postgres/project-scope-release-outbox-repository.ts",
    import.meta.url,
  )
  const original = kind === "database" ? new DatabaseError(message, 0, "error") : kind === "object" ? { message } : new Error(message)
  original.code = code
  const rollbackError = new Error("independent rollback failure")
  const controller = new AbortController()
  const calls = [],
    releases = [],
    failures = []
  const startedAt = performance.now()
  const client = Object.assign(new EventEmitter(), {
    async query(text, values) {
      const stage =
        text === "BEGIN"
          ? "begin"
          : text === "COMMIT"
            ? "commit"
            : text === "ROLLBACK"
              ? "rollback"
              : text.includes("set_config('lock_timeout'")
                ? "settings"
                : text.startsWith("WITH credential_recovery")
                  ? "claim"
                  : text.startsWith("SELECT release_command_count")
                    ? "project"
                    : text.trimStart().startsWith("SELECT count(o.command_id)")
                      ? "aggregate"
                      : text.trimStart().startsWith("UPDATE bff_project_scope_release_outbox")
                        ? "command"
                        : "projection"
      calls.push({ stage, text, values })
      if (stage === failAt) {
        failures.push({ stage, elapsedMs: performance.now() - startedAt, aborted: controller.signal.aborted })
        throw original
      }
      if (stage === "rollback" && rollbackFailure) throw rollbackError
      if (stage === "project") return { rows: [{ release_command_count: 1 }], rowCount: 1 }
      if (stage === "aggregate")
        return {
          rows: [{ total: 1, released: 1, blocked: 0, conversations: 0, matched_conversations: 0, expected_conversations: 0, projects: 1, trusted: true }],
          rowCount: 1,
        }
      return { rows: [], rowCount: 1 }
    },
    release(destroy) {
      releases.push({ client, destroy: destroy === true })
    },
  })
  const database = { pool: { connect: async () => client } }
  const repository = new PostgresProjectScopeReleaseOutboxRepository(database)
  const lease = { commandId: "release_i3_r285", tenantId: "tenant_i3_r285", projectId: "project_i3_r285", leaseOwner: "worker_i3_r285", fence: 1 }
  const invoke = {
    claim: () =>
      repository.claimProjectScopeReleases(
        { workerId: lease.leaseOwner, limit: 1, leaseDurationMs: 1000, includeOneCredentialRecovery: false },
        controller.signal,
        10000,
      ),
    released: () => repository.markProjectScopeReleased(lease, controller.signal, 10000),
    retryable: () => repository.markProjectScopeRetryable(lease, 1000, "storage_release_unknown", controller.signal, 10000),
    blocked: () => repository.markProjectScopeBlocked(lease, "storage_terminal", controller.signal, 10000),
  }
  return { client, calls, releases, failures, original, rollbackError, controller, database, invoke }
}

function i3R285AssertRetired(f, stage) {
  assert.deepEqual(
    f.failures.map((failure) => failure.stage),
    [stage],
  )
  assert.equal(f.failures[0].aborted, false, "the server cancellation must arrive before caller abort")
  assert.ok(f.failures[0].elapsedMs < 5000, "the server cancellation must arrive while the ten-second JS budget remains")
  assert.equal(f.calls.at(-1).stage, stage, "cancellation must start no rollback, commit or later SQL")
  assert.equal(f.releases.length, 1)
  assert.equal(f.releases[0].client, f.client)
  assert.equal(f.releases[0].destroy, true)
  assert.equal(f.client.listenerCount("error"), 0)
  assert.equal(f.controller.signal.aborted, false)
}

for (const method of ["claim", "released", "retryable", "blocked"])
  test(`I3 R285 SQL cancellation before the JS timer retires the exact ${method} checkout`, async () => {
    const stage = method === "claim" ? "claim" : "project"
    const f = await i3R285SqlCancellationFixture({ failAt: stage })
    assert.deepEqual(await f.invoke[method](), method === "claim" ? [] : false)
    const settings = f.calls.find((call) => call.stage === "settings")
    assert.ok(Number.parseInt(settings.values[1]) > 0)
    assert.ok(Number.parseInt(settings.values[1]) <= 10000)
    i3R285AssertRetired(f, stage)
  })

test("I3 R285 genuine query cancellation is independent of English text and SQL stage", async (t) => {
  for (const stage of ["begin", "settings", "command", "aggregate", "projection"])
    await t.test(stage, async () => {
      const f = await i3R285SqlCancellationFixture({ failAt: stage, message: "取消来源未由 SQLSTATE 区分" })
      assert.equal(await f.invoke.released(), false)
      i3R285AssertRetired(f, stage)
    })
})

test("I3 R285 other SQL errors and same-code impostors preserve their original failure", async (t) => {
  for (const descriptor of [{ code: "42601" }, { code: "42501" }, { code: "08006" }, { kind: "error" }, { kind: "object" }])
    await t.test(`${descriptor.kind ?? "database"}:${descriptor.code ?? "57014"}`, async () => {
      const f = await i3R285SqlCancellationFixture(descriptor)
      await assert.rejects(f.invoke.released(), (error) => error === f.original)
      assert.deepEqual(
        f.calls.slice(-2).map((call) => call.stage),
        ["project", "rollback"],
      )
      assert.equal(f.releases.length, 1)
      assert.equal(f.releases[0].client, f.client)
      assert.equal(f.releases[0].destroy, false)
      assert.equal(f.client.listenerCount("error"), 0)
    })
})

test("I3 R285 a query error remains primary if its rollback also fails", async () => {
  const f = await i3R285SqlCancellationFixture({ code: "42601", rollbackFailure: true })
  await assert.rejects(f.invoke.released(), (error) => error === f.original && error !== f.rollbackError)
  assert.deepEqual(
    f.calls.slice(-2).map((call) => call.stage),
    ["project", "rollback"],
  )
  assert.equal(f.releases.length, 1)
  assert.equal(f.releases[0].client, f.client)
  assert.equal(f.releases[0].destroy, true)
  assert.equal(f.client.listenerCount("error"), 0)
})

test("I3 R285 lock timeout retains its known rollback and normal release semantics", async () => {
  const f = await i3R285SqlCancellationFixture({ code: "55P03" })
  assert.equal(await f.invoke.released(), false)
  assert.deepEqual(
    f.calls.slice(-2).map((call) => call.stage),
    ["project", "rollback"],
  )
  assert.equal(f.releases.length, 1)
  assert.equal(f.releases[0].client, f.client)
  assert.equal(f.releases[0].destroy, false)
  assert.equal(f.client.listenerCount("error"), 0)
})

test("I3 R285 COMMIT cancellation remains unknown with the original cause and no guessed rollback", async (t) => {
  for (const method of ["claim", "released"])
    for (const code of ["57014", "42601"])
      await t.test(`${method}:${code}`, async () => {
        const f = await i3R285SqlCancellationFixture({ failAt: "commit", code })
        await assert.rejects(f.invoke[method](), (error) => {
          assert.equal(error.message, "PROJECT_SCOPE_RELEASE_COMMIT_UNKNOWN")
          if (code === "57014") {
            assert.equal(error.cause.message, "PROJECT_SCOPE_RELEASE_CANCELLED")
            assert.equal(error.cause.cause, f.original)
          } else assert.equal(error.cause, f.original)
          return true
        })
        i3R285AssertRetired(f, "commit")
      })
})

test("I3 R285 checkout failure with the cancellation code is outside the private SQL classifier", async () => {
  const f = await i3R285SqlCancellationFixture()
  let connects = 0
  f.database.pool.connect = async () => {
    connects++
    throw f.original
  }
  await assert.rejects(f.invoke.released(), (error) => error === f.original)
  assert.equal(connects, 1)
  assert.deepEqual(f.calls, [])
  assert.deepEqual(f.releases, [])
  assert.equal(f.client.listenerCount("error"), 0)
})
