import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { createServer } from "node:http"
import { test } from "node:test"

import { Pool } from "pg"
import { createClient } from "redis"

import { createBffServer } from "../dist/main.js"

const postgresUrl = process.env.KOKORO_TEST_POSTGRES_URL
const redisUrl = process.env.KOKORO_TEST_REDIS_URL
const servers = []

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
  return {
    "x-kokoro-service": "web-bff",
    "x-kokoro-internal-secret": "web-secret",
    "x-kokoro-namespace": namespace,
    "x-kokoro-principal-id": principal,
  }
}

function bffConfig(overrides = {}) {
  return {
    host: "127.0.0.1",
    port: 4300,
    mode: "live",
    domain: "dev.kokoro.localhost",
    tenantId: "tenant_test",
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

integrationTest("persists BFF facts, registers Scheduler, and replays Agent dispatch across restart", async () => {
  const schemaPool = new Pool({ connectionString: postgresUrl })
  const redis = createClient({ url: redisUrl })
  const namespace = `integration_${Date.now()}`
  const schedulerCalls = []
  const agentCalls = []
  let schedulerBase
  let agentBase
  let bff
  try {
    await schemaPool.query(
      "DROP TABLE IF EXISTS bff_agui_cursor_tombstone, bff_agui_event, bff_agui_source_event, bff_agui_stream, bff_agent_cancellation_outbox, bff_agent_dispatch_outbox, bff_share, bff_message, bff_conversation, bff_scheduled_task_outbox, bff_scheduled_task, bff_project_task, bff_idempotency_receipt, bff_project_instruction_revision, bff_project_skill, bff_project CASCADE",
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
    bff = createBffServer(bffConfig({ schedulerBase, agentBase, agentEnabled: true, schedulerTargetUrl: targetUrl }))
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
    assert.deepEqual((await otherTenant.json()).data.tasks, [])

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
    assert.equal(agentCalls.length, 1)
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
    bff = createBffServer(bffConfig({ schedulerBase, agentBase, agentEnabled: true, schedulerTargetUrl: targetUrl }))
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
