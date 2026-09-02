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
    if (predicate()) return
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
    sharedSecret: "web-secret",
    upstreamSecret: "bff-secret",
    upstreamTimeoutMs: 5000,
    upstreamMaxResponseBytes: 1024 * 1024,
    iamServiceToken: null,
    schedulerServiceToken: "scheduler-secret",
    schedulerTargetUrl: overrides.schedulerTargetUrl,
    postgresUrl,
    redisUrl,
    upstreams: {
      iam: null,
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
    await schemaPool.query("DROP TABLE IF EXISTS bff_scheduled_task, bff_project_task, bff_idempotency_receipt, bff_project_instruction_revision, bff_project_skill, bff_project CASCADE")
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
          job: raw ? JSON.parse(raw) : null,
        })
        response.setHeader("content-type", "application/json")
        response.end(JSON.stringify({ data: { name: request.url?.split("/").at(-1), status: "registered" }, meta: { request_id: request.headers["x-request-id"] } }))
      })
    })
    schedulerBase = await listen(scheduler)

    const agent = createServer((request, response) => {
      const chunks = []
      request.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
      request.on("end", () => {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"))
        agentCalls.push({ body, authorization: request.headers.authorization, service: request.headers["x-kokoro-service"], tenant: request.headers["x-kokoro-tenant-id"] })
        response.setHeader("content-type", "application/json")
        response.end(JSON.stringify({ data: { run_id: body.run_id }, meta: { request_id: request.headers["x-kokoro-request-id"] } }))
      })
    })
    agentBase = await listen(agent)

    const targetUrl = "http://kokoro-bff:4300/internal/bff/scheduled-tasks/dispatch"
    bff = createBffServer(bffConfig({ schedulerBase, agentBase, schedulerTargetUrl: targetUrl }))
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
    assert.equal(schedulerCalls.length, 1)
    assert.equal(schedulerCalls[0].method, "POST")
    assert.equal(schedulerCalls[0].authorization, "Bearer scheduler-secret")
    assert.equal(schedulerCalls[0].service, "web-bff")
    assert.equal(schedulerCalls[0].job.url, targetUrl)
    assert.equal(schedulerCalls[0].job.body.owner_id, "user_integration")

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
    assert.equal(schedulerCalls.at(-1).method, "PUT")

    const dispatchBody = schedulerCalls.at(-1).job.body
    const dispatchHeaders = {
      authorization: "Bearer scheduler-secret",
      "content-type": "application/json",
      "x-kokoro-scheduler-job": schedulerCalls.at(-1).url.split("/").at(-1),
      "x-kokoro-scheduler-occurrence": "20260901T120000Z",
      "x-request-id": "sched_integration_delivery_1",
      "idempotency-key": `schedule:${schedulerCalls.at(-1).url.split("/").at(-1)}:20260901T120000Z`,
    }
    const mismatchedOccurrence = await fetch(`${base}/internal/bff/scheduled-tasks/dispatch`, {
      method: "POST",
      headers: { ...dispatchHeaders, "x-kokoro-scheduler-occurrence": "20260901T120001Z" },
      body: JSON.stringify(dispatchBody),
    })
    assert.equal(mismatchedOccurrence.status, 400)
    const dispatched = await fetch(`${base}/internal/bff/scheduled-tasks/dispatch`, { method: "POST", headers: dispatchHeaders, body: JSON.stringify(dispatchBody) })
    assert.equal(dispatched.status, 202)
    assert.equal(agentCalls.length, 1)
    assert.equal(agentCalls[0].authorization, "Bearer bff-secret")
    assert.equal(agentCalls[0].service, "kokoro-bff")
    assert.equal(agentCalls[0].tenant, undefined)
    assert.equal(agentCalls[0].body.execution_identity.tenant_ref, namespace)
    const replayedDispatch = await fetch(`${base}/internal/bff/scheduled-tasks/dispatch`, { method: "POST", headers: dispatchHeaders, body: JSON.stringify(dispatchBody) })
    assert.equal(replayedDispatch.status, 202)
    assert.equal(agentCalls.length, 1)

    const paused = await fetch(`${base}/v1/scheduled-tasks/${taskId}`, {
      method: "PATCH",
      headers: { ...auth(namespace), "content-type": "application/json", "idempotency-key": "schedule-pause-integration" },
      body: JSON.stringify({ status: "paused", enabled: false }),
    })
    assert.equal(paused.status, 200)
    const pausedDispatch = await fetch(`${base}/internal/bff/scheduled-tasks/dispatch`, {
      method: "POST",
      headers: {
        ...dispatchHeaders,
        "x-kokoro-scheduler-occurrence": "20260901T120001Z",
        "x-request-id": "sched_integration_delivery_paused",
        "idempotency-key": `schedule:${schedulerCalls.at(-1).url.split("/").at(-1)}:20260901T120001Z`,
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

    await close(bff)
    bff = createBffServer(bffConfig({ schedulerBase, agentBase, schedulerTargetUrl: targetUrl }))
    const restartedBase = await listen(bff)
    await waitFor(() => schedulerCalls.length === 5)
    const listed = await fetch(`${restartedBase}/v1/scheduled-tasks`, { headers: auth(namespace) })
    assert.deepEqual((await listed.json()).data.tasks.map((task) => task.id), [taskId])
    const replayedCreate = await fetch(`${restartedBase}/v1/scheduled-tasks`, { method: "POST", headers: createHeaders, body: JSON.stringify(createPayload) })
    assert.equal(replayedCreate.status, 200)
    assert.deepEqual((await replayedCreate.json()).data.task, createdBody.data.task)
    assert.equal(schedulerCalls.length, 5)
    assert.equal(schedulerCalls.at(-1).method, "POST")

    const deleted = await fetch(`${restartedBase}/v1/scheduled-tasks/${taskId}`, {
      method: "DELETE",
      headers: { ...auth(namespace), "idempotency-key": "schedule-delete-integration" },
    })
    assert.equal(deleted.status, 200)
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
