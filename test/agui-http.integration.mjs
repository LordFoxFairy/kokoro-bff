import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { createServer } from "node:http"
import { test } from "node:test"

import { EventSchemas } from "@ag-ui/core"
import { Pool } from "pg"

import { createBffServer } from "../dist/main.js"
import { PostgresBffRepositories } from "../dist/infrastructure/postgres/repositories.js"
import { AgUiSessionRuntime } from "../dist/application/agui/session-runtime.js"
import { SessionAdmissionDouble } from "./doubles/session-admission.ts"

const postgresUrl = process.env.KOKORO_TEST_POSTGRES_URL
const redisUrl = process.env.KOKORO_TEST_REDIS_URL
const integrationTest = postgresUrl && redisUrl ? test : test.skip
const servers = []
const sessionAdmission = new SessionAdmissionDouble()

const TABLES = [
  "bff_agui_cursor_tombstone",
  "bff_share",
  "bff_message",
  "bff_conversation",
  "bff_agent_cancellation_outbox",
  "bff_agent_dispatch_outbox",
  "bff_agui_event",
  "bff_agui_source_event",
  "bff_agui_stream",
  "bff_scheduled_task",
  "bff_project_task",
  "bff_idempotency_receipt",
  "bff_project_instruction_revision",
  "bff_project_skill",
  "bff_project",
]

async function listen(server) {
  servers.push(server)
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  if (address === null || typeof address === "string") throw new Error("server did not bind")
  return `http://127.0.0.1:${address.port}`
}

async function close(server) {
  await new Promise((resolve) => server.close(resolve))
  await new Promise((resolve) => setTimeout(resolve, 30))
}

function auth(tenantId) {
  const token = `session-${tenantId}-user_integration`
  sessionAdmission.allow(token, { namespace: tenantId, userId: "user_integration" })
  return {
    "x-kokoro-service": "web-bff",
    "x-kokoro-internal-secret": "web-secret",
    authorization: `Bearer ${token}`,
  }
}

async function insertConversation(pool, sessionId, title) {
  await pool.query(
    `INSERT INTO bff_conversation (conversation_id, tenant_id, owner_id, title)
     VALUES ($1, $2, $3, $4)`,
    [sessionId, "tenant_a", "user_integration", title],
  )
}

function bffConfig({ agentEnabled, agentBase, agUi }) {
  return {
    host: "127.0.0.1",
    port: 4300,
    mode: "live",
    domain: "dev.kokoro.localhost",
    tenantId: "tenant_test",
    iamBaseUrl: null,
    sharedSecret: "web-secret",
    upstreamSecret: "bff-secret",
    upstreamTimeoutMs: 5000,
    upstreamMaxResponseBytes: 1024 * 1024,
    agentEnabled,
    schedulerServiceToken: null,
    schedulerTargetUrl: null,
    postgresUrl,
    redisUrl,
    agUi: agUi ?? {
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
      scheduler: null,
      agents: agentBase,
      billing: null,
      music: null,
    },
  }
}

function parseSse(body) {
  return body.split(/\n\n/u).flatMap((block) => {
    const lines = block.split("\n")
    const id = lines.find((line) => line.startsWith("id: "))?.slice(4)
    const data = lines.find((line) => line.startsWith("data: "))?.slice(6)
    if (id === undefined || data === undefined) return []
    return [{ id, event: JSON.parse(data) }]
  })
}

integrationTest("serves live and restarted replay only from the tenant-scoped PostgreSQL AG-UI ledger", async () => {
  const pool = new Pool({ connectionString: postgresUrl })
  let bff = null
  let agent = null
  let admissionStore = null
  try {
    await pool.query(`DROP TABLE IF EXISTS ${TABLES.join(", ")} CASCADE`)
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))

    const events = [
      { chat_event_id: "source_run", session_id: "session_live", run_id: "run_1", event_type: "run.started", payload_json: '{"status":"running"}', seq: 1, created_at: 1000 },
      { chat_event_id: "source_delta", session_id: "session_live", run_id: "run_1", chat_message_id: "message_1", event_type: "assistant.delta", payload_json: '{"delta":"hello"}', seq: 2, created_at: 2000 },
      { chat_event_id: "source_message_end", session_id: "session_live", run_id: "run_1", chat_message_id: "message_1", event_type: "assistant.completed", payload_json: '{"content":"hello"}', seq: 3, created_at: 3000 },
      { chat_event_id: "source_terminal", session_id: "session_live", run_id: "run_1", event_type: "run.completed", payload_json: '{"status":"completed","token_usage":null}', seq: 4, created_at: 4000 },
    ]
    await insertConversation(pool, "session_live", "Live Chat")
    const eventRequests = []
    agent = createServer((request, response) => {
      response.setHeader("content-type", "application/json")
      if (request.url?.includes("/events") && request.method === "GET") {
        const url = new URL(request.url, "http://agent.local")
        const afterSequence = Number(url.searchParams.get("after_seq") ?? "0")
        eventRequests.push(afterSequence)
        const page = afterSequence < 2 ? events.slice(0, 2) : events.filter((event) => event.seq > afterSequence)
        response.end(JSON.stringify({ data: { events: page, next_seq: page.at(-1)?.seq ?? afterSequence, watermark: events.at(-1)?.seq ?? afterSequence }, meta: { request_id: "agent" } }))
        return
      }
      if (request.url?.includes("/messages") && request.method === "GET") {
        response.end(JSON.stringify({
          data: {
            messages: [{ chat_message_id: "user_1", session_id: "session_live", run_id: "run_1", role: "user", content: "hello", status: "completed", seq: 1, created_at: 1000, updated_at: 1000 }],
            next_seq: 1,
          },
          meta: { request_id: "agent" },
        }))
        return
      }
      response.statusCode = 404
      response.end(JSON.stringify({ error: { code: "not_found", message: "not found" }, meta: { request_id: "agent" } }))
    })
    const agentBase = await listen(agent)
    bff = createBffServer(bffConfig({ agentEnabled: true, agentBase }), { sessionAdmission })
    const base = await listen(bff)

    const streamed = await fetch(`${base}/v1/sessions/session_live/events`, { headers: auth("tenant_a") })
    assert.equal(streamed.status, 200)
    assert.match(streamed.headers.get("content-type") ?? "", /^text\/event-stream/u)
    const originalFrames = parseSse(await streamed.text())
    assert.deepEqual(originalFrames.map((frame) => frame.event.type), [
      "RUN_STARTED",
      "TEXT_MESSAGE_START",
      "TEXT_MESSAGE_CONTENT",
      "TEXT_MESSAGE_END",
      "RUN_FINISHED",
    ])
    assert.equal(new Set(originalFrames.map((frame) => frame.id)).size, 5)
    assert.ok(originalFrames.every((frame) => /^agui_[0-9a-f]{32}$/u.test(frame.id)))
    for (const frame of originalFrames) assert.doesNotThrow(() => EventSchemas.parse(frame.event))
    assert.deepEqual(eventRequests.slice(0, 2), [0, 2])

    const detail = await fetch(`${base}/v1/sessions/session_live`, { headers: auth("tenant_a") })
    assert.equal(detail.status, 200)
    const detailBody = await detail.json()
    assert.equal(detailBody.data.event_watermark, originalFrames.at(-1).id)
    assert.equal(detailBody.data.active_run, undefined)
    assert.deepEqual(eventRequests.slice(0, 2), [0, 2])
    assert.ok(eventRequests.slice(2).every((sequence) => sequence === 4))

    const ledger = await pool.query(
      `SELECT public_sequence, cursor, event_type
         FROM bff_agui_event
        WHERE tenant_id = $1 AND session_id = $2
        ORDER BY public_sequence`,
      ["tenant_a", "session_live"],
    )
    assert.deepEqual(ledger.rows.map((row) => row.cursor), originalFrames.map((frame) => frame.id))

    admissionStore = new PostgresBffRepositories(postgresUrl, redisUrl)
    await admissionStore.agUiConsumers.registerConsumer("tenant_a", "session_live", "user_integration", "run_2")
    events.push(
      { chat_event_id: "source_run_2", session_id: "session_live", run_id: "run_2", event_type: "run.started", payload_json: '{"status":"running"}', seq: 5, created_at: 5000 },
      { chat_event_id: "source_terminal_2", session_id: "session_live", run_id: "run_2", event_type: "run.completed", payload_json: '{"status":"completed","token_usage":null}', seq: 6, created_at: 6000 },
    )
    const nextRun = await fetch(`${base}/v1/sessions/session_live/events`, {
      headers: { ...auth("tenant_a"), "last-event-id": originalFrames.at(-1).id },
    })
    assert.equal(nextRun.status, 200)
    const nextRunFrames = parseSse(await nextRun.text())
    assert.deepEqual(nextRunFrames.map((frame) => frame.event.type), ["RUN_STARTED", "RUN_FINISHED"])
    assert.ok(nextRunFrames.every((frame) => /^agui_[0-9a-f]{32}$/u.test(frame.id)))

    await close(bff)
    bff = null
    await close(agent)
    agent = null

    bff = createBffServer(bffConfig({ agentEnabled: false, agentBase: null }), { sessionAdmission })
    const restartedBase = await listen(bff)
    const replayed = await fetch(`${restartedBase}/v1/sessions/session_live/events`, {
      headers: { ...auth("tenant_a"), "last-event-id": originalFrames[1].id },
    })
    assert.equal(replayed.status, 200)
    const replayedFrames = parseSse(await replayed.text())
    assert.deepEqual(
      replayedFrames.map((frame) => frame.id),
      [...originalFrames.slice(2), ...nextRunFrames].map((frame) => frame.id),
    )

    const invalid = await fetch(`${restartedBase}/v1/sessions/session_live/events`, {
      headers: { ...auth("tenant_a"), "last-event-id": "4" },
    })
    assert.equal(invalid.status, 400)
    assert.equal((await invalid.json()).error.code, "invalid_event_cursor")

    const foreignTenant = await fetch(`${restartedBase}/v1/sessions/session_live/events`, {
      headers: { ...auth("tenant_b"), "last-event-id": originalFrames[1].id },
    })
    assert.equal(foreignTenant.status, 404)
    assert.equal((await foreignTenant.json()).error.code, "session_not_found")
  } finally {
    if (bff !== null) await close(bff)
    if (agent !== null) await close(agent)
    for (const server of servers.splice(0)) {
      if (server.listening) await close(server)
    }
    if (admissionStore !== null) await admissionStore.close()
    await pool.end()
  }
})

integrationTest("drains the complete Agent source snapshot before ending at a run terminal", async () => {
  const pool = new Pool({ connectionString: postgresUrl })
  let bff = null
  let agent = null
  try {
    await pool.query(`DROP TABLE IF EXISTS ${TABLES.join(", ")} CASCADE`)
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    await insertConversation(pool, "session_boundary", "Boundary Chat")
    const events = [
      { chat_event_id: "run_1_started", session_id: "session_boundary", run_id: "run_1", event_type: "run.started", payload_json: '{"status":"running"}', seq: 1, created_at: 1000 },
      { chat_event_id: "run_1_finished", session_id: "session_boundary", run_id: "run_1", event_type: "run.completed", payload_json: '{"status":"completed"}', seq: 2, created_at: 2000 },
      { chat_event_id: "run_2_started", session_id: "session_boundary", run_id: "run_2", event_type: "run.started", payload_json: '{"status":"running"}', seq: 3, created_at: 3000 },
      { chat_event_id: "run_2_finished", session_id: "session_boundary", run_id: "run_2", event_type: "run.completed", payload_json: '{"status":"completed"}', seq: 4, created_at: 4000 },
    ]
    const requestedAfter = []
    agent = createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://agent.local")
      const afterSequence = Number(url.searchParams.get("after_seq") ?? "0")
      requestedAfter.push(afterSequence)
      const page = events.filter((candidate) => candidate.seq > afterSequence).slice(0, 2)
      response.setHeader("content-type", "application/json")
      response.end(JSON.stringify({
        data: { events: page, next_seq: page.at(-1)?.seq ?? afterSequence, watermark: 4 },
        meta: { request_id: "agent" },
      }))
    })
    const agentBase = await listen(agent)
    bff = createBffServer(bffConfig({ agentEnabled: true, agentBase }), { sessionAdmission })
    const base = await listen(bff)

    const streamed = await fetch(`${base}/v1/sessions/session_boundary/events`, { headers: auth("tenant_a") })
    assert.equal(streamed.status, 200)
    const frames = parseSse(await streamed.text())
    assert.deepEqual(frames.map((frame) => [frame.event.type, frame.event.metadata.kokoro.run_id]), [
      ["RUN_STARTED", "run_1"],
      ["RUN_FINISHED", "run_1"],
      ["RUN_STARTED", "run_2"],
      ["RUN_FINISHED", "run_2"],
    ])
    assert.deepEqual(requestedAfter.slice(0, 2), [0, 2])
    assert.ok(requestedAfter.slice(2).every((sequence) => sequence === 4))
  } finally {
    if (bff !== null) await close(bff)
    if (agent !== null) await close(agent)
    for (const server of servers.splice(0)) {
      if (server.listening) await close(server)
    }
    await pool.end()
  }
})

integrationTest("fails loudly when Agent event pagination metadata disagrees with the events", async () => {
  const pool = new Pool({ connectionString: postgresUrl })
  let bff = null
  let agent = null
  try {
    await pool.query(`DROP TABLE IF EXISTS ${TABLES.join(", ")} CASCADE`)
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    await insertConversation(pool, "session_invalid_page", "Invalid Source Chat")
    agent = createServer((_request, response) => {
      response.setHeader("content-type", "application/json")
      response.end(JSON.stringify({
        data: {
          events: [
            { chat_event_id: "started", session_id: "session_invalid_page", run_id: "run_1", event_type: "run.started", payload_json: '{"status":"running"}', seq: 1, created_at: 1000 },
            { chat_event_id: "terminal", session_id: "session_invalid_page", run_id: "run_1", event_type: "run.completed", payload_json: '{"status":"completed"}', seq: 2, created_at: 2000 },
          ],
          next_seq: 1,
          watermark: 2,
        },
        meta: { request_id: "agent" },
      }))
    })
    const agentBase = await listen(agent)
    bff = createBffServer(bffConfig({ agentEnabled: true, agentBase }), { sessionAdmission })
    const base = await listen(bff)

    const streamed = await fetch(`${base}/v1/sessions/session_invalid_page/events`, { headers: auth("tenant_a") })
    assert.equal(streamed.status, 200)
    const streamedBody = await streamed.text()
    const comments = streamedBody.split("\n").filter((line) => line.startsWith(": "))
    assert.ok(comments.length >= 1)
    assert.ok(comments.every((line) => line === ": keep-alive"), streamedBody)

    const blocked = await fetch(`${base}/v1/sessions/session_invalid_page/events`, { headers: auth("tenant_a") })
    assert.equal(blocked.status, 502)
    assert.equal((await blocked.json()).error.code, "agui_projection_blocked")
    const sourceCount = await pool.query(
      "SELECT count(*)::integer AS count FROM bff_agui_source_event WHERE tenant_id = $1 AND session_id = $2",
      ["tenant_a", "session_invalid_page"],
    )
    assert.equal(sourceCount.rows[0].count, 0)
  } finally {
    if (bff !== null) await close(bff)
    if (agent !== null) await close(agent)
    for (const server of servers.splice(0)) {
      if (server.listening) await close(server)
    }
    await pool.end()
  }
})

integrationTest("ends at the SSE frame budget and resumes strictly after the last written cursor", async () => {
  const pool = new Pool({ connectionString: postgresUrl })
  let bff = null
  let agent = null
  try {
    await pool.query(`DROP TABLE IF EXISTS ${TABLES.join(", ")} CASCADE`)
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    await insertConversation(pool, "session_budget", "Budget Chat")
    const events = [
      { chat_event_id: "budget_run_1_started", session_id: "session_budget", run_id: "run_1", event_type: "run.started", payload_json: '{"status":"running"}', seq: 1, created_at: 1000 },
      { chat_event_id: "budget_run_1_finished", session_id: "session_budget", run_id: "run_1", event_type: "run.completed", payload_json: '{"status":"completed"}', seq: 2, created_at: 2000 },
      { chat_event_id: "budget_run_2_started", session_id: "session_budget", run_id: "run_2", event_type: "run.started", payload_json: '{"status":"running"}', seq: 3, created_at: 3000 },
      { chat_event_id: "budget_run_2_finished", session_id: "session_budget", run_id: "run_2", event_type: "run.completed", payload_json: '{"status":"completed"}', seq: 4, created_at: 4000 },
    ]
    agent = createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://agent.local")
      const afterSequence = Number(url.searchParams.get("after_seq") ?? "0")
      const page = events.filter((candidate) => candidate.seq > afterSequence)
      response.setHeader("content-type", "application/json")
      response.end(JSON.stringify({ data: { events: page, next_seq: page.at(-1)?.seq ?? afterSequence, watermark: 4 }, meta: { request_id: "agent" } }))
    })
    const agentBase = await listen(agent)
    bff = createBffServer(bffConfig({
      agentEnabled: true,
      agentBase,
      agUi: {
        replayPageFrames: 128,
        replayPageBytes: 1024 * 1024,
        streamMaxFrames: 2,
        streamMaxBytes: 1024 * 1024,
        streamMaxDurationMs: 30_000,
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
    }), { sessionAdmission })
    const base = await listen(bff)

    const first = await fetch(`${base}/v1/sessions/session_budget/events`, { headers: auth("tenant_a") })
    assert.equal(first.status, 200)
    const firstFrames = parseSse(await first.text())
    assert.deepEqual(firstFrames.map((frame) => frame.event.type), ["RUN_STARTED", "RUN_FINISHED"])

    const resumed = await fetch(`${base}/v1/sessions/session_budget/events`, {
      headers: { ...auth("tenant_a"), "last-event-id": firstFrames.at(-1).id },
    })
    assert.equal(resumed.status, 200)
    const resumedFrames = parseSse(await resumed.text())
    assert.deepEqual(resumedFrames.map((frame) => frame.event.type), ["RUN_STARTED", "RUN_FINISHED"])
    assert.equal(new Set([...firstFrames, ...resumedFrames].map((frame) => frame.id)).size, 4)
  } finally {
    if (bff !== null) await close(bff)
    if (agent !== null) await close(agent)
    for (const server of servers.splice(0)) {
      if (server.listening) await close(server)
    }
    await pool.end()
  }
})

integrationTest("bounds same-session connections and coalesces their Agent and PostgreSQL polling", async () => {
  const pool = new Pool({ connectionString: postgresUrl })
  let bff = null
  let agent = null
  try {
    await pool.query(`DROP TABLE IF EXISTS ${TABLES.join(", ")} CASCADE`)
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    await insertConversation(pool, "session_capacity", "Capacity Chat")
    let agentCalls = 0
    const source = { chat_event_id: "capacity_started", session_id: "session_capacity", run_id: "run_capacity", event_type: "run.started", payload_json: '{"status":"running"}', seq: 1, created_at: 1000 }
    agent = createServer((request, response) => {
      agentCalls += 1
      const url = new URL(request.url ?? "/", "http://agent.local")
      const afterSequence = Number(url.searchParams.get("after_seq") ?? "0")
      const events = afterSequence === 0 ? [source] : []
      response.setHeader("content-type", "application/json")
      response.end(JSON.stringify({ data: { events, next_seq: events.at(-1)?.seq ?? afterSequence, watermark: 1 }, meta: { request_id: "agent" } }))
    })
    const agentBase = await listen(agent)
    const agUi = {
      replayPageFrames: 128,
      replayPageBytes: 1024 * 1024,
      streamMaxFrames: 100,
      streamMaxBytes: 1024 * 1024,
      streamMaxDurationMs: 150,
      maxConnectionsGlobal: 4,
      maxConnectionsPerTenant: 4,
      maxConnectionsPerSession: 4,
      ledgerPollBaseDelayMs: 40,
      ledgerPollMaxDelayMs: 160,
      ledgerPollJitterPercent: 0,
      replayCacheTtlMs: 25,
      projectorMaxConsumersPerCycle: 32,
      projectorSourcePageSize: 256,
      projectorMaxPagesPerConsumer: 8,
      projectorSourceMaxAttempts: 3,
      projectorLeaseDurationMs: 15_000,
      projectorLeaseSettlementReserveMs: 500,
      projectorPollIntervalMs: 40,
      projectorErrorBackoffMs: 160,
      projectorErrorBackoffMaxMs: 5000,
      projectorErrorBackoffJitterPercent: 20,
      retentionMs: 7 * 24 * 60 * 60 * 1000,
      gcIntervalMs: 15 * 60 * 1000,
      gcBatchSize: 100,
      cursorTombstoneRetentionMs: 30 * 24 * 60 * 60 * 1000,
    }
    const runtime = new AgUiSessionRuntime({
      connections: { global: 4, perTenant: 4, perSession: 4 },
      ledgerWait: { baseDelayMs: 40, maxDelayMs: 160, jitterRatio: 0 },
      replayCacheTtlMs: 25,
    })
    bff = createBffServer(bffConfig({ agentEnabled: true, agentBase, agUi }), { agUiRuntime: runtime, sessionAdmission })
    const base = await listen(bff)

    const clients = await Promise.all(Array.from({ length: 4 }, () => (
      fetch(`${base}/v1/sessions/session_capacity/events`, { headers: auth("tenant_a") })
    )))
    assert.ok(clients.every((response) => response.status === 200))
    const rejected = await fetch(`${base}/v1/sessions/session_capacity/events`, { headers: auth("tenant_a") })
    assert.equal(rejected.status, 429)
    assert.equal((await rejected.json()).error.code, "agui_connection_limit_exceeded")

    const bodies = await Promise.all(clients.map((response) => response.text()))
    assert.ok(bodies.every((body) => parseSse(body).some((frame) => frame.event.type === "RUN_STARTED")))
    const metrics = runtime.snapshot()
    assert.ok(agentCalls <= 4, `expected at most 4 shared Agent polls, received ${agentCalls}`)
    assert.ok(metrics.ledgerWaits.waits <= 4)
    assert.ok(metrics.replays.loads <= 6, `expected at most 6 shared PostgreSQL replay loads, received ${metrics.replays.loads}`)
    assert.equal(metrics.connections.global, 0)
  } finally {
    if (bff !== null) await close(bff)
    if (agent !== null) await close(agent)
    for (const server of servers.splice(0)) {
      if (server.listening) await close(server)
    }
    await pool.end()
  }
})
