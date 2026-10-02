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
  "bff_agui_run_interaction",
  "bff_agui_cursor_tombstone",
  "bff_share",
  "bff_message",
  "bff_conversation",
  "bff_agent_cancellation_outbox",
  "bff_agent_dispatch_outbox",
  "bff_agui_event",
  "bff_conversation_artifact",
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

function auth(tenantId, subjectId = "user_integration") {
  const token = `session-${tenantId}-${subjectId}`
  sessionAdmission.allow(token, { namespace: tenantId, userId: subjectId })
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
    tenantId: "tenant_a",
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
  const pool = new Pool({ connectionString: postgresUrl, options: "-c search_path=kokoro_bff -c timezone=UTC" })
  let bff = null
  let agent = null
  let admissionStore = null
  try {
    await pool.query("CREATE SCHEMA IF NOT EXISTS kokoro_bff")
    await pool.query(`DROP TABLE IF EXISTS ${TABLES.join(", ")} CASCADE`)
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))

    const events = [
      { chat_event_id: "source_run", session_id: "session_live", run_id: "run_1", source_index: 0, event_type: "run.started", payload_json: '{"status":"running"}', seq: 1, created_at: 1000 },
      { chat_event_id: "source_delta", session_id: "session_live", run_id: "run_1", chat_message_id: "message_1", source_index: 1, event_type: "assistant.delta", payload_json: '{"delta":"hello"}', seq: 2, created_at: 2000 },
      { chat_event_id: "source_message_end", session_id: "session_live", run_id: "run_1", chat_message_id: "message_1", source_index: 2, event_type: "assistant.completed", payload_json: '{"content":"hello"}', seq: 3, created_at: 3000 },
      { chat_event_id: "source_terminal", session_id: "session_live", run_id: "run_1", source_index: 3, event_type: "run.completed", payload_json: '{"status":"completed","token_usage":null}', seq: 4, created_at: 4000 },
    ]
    await insertConversation(pool, "session_live", "Live Chat")
    await pool.query(
      `INSERT INTO bff_message (message_id, tenant_id, conversation_id, run_id, role, content, status, message_seq)
       VALUES ('assistant_run_1', 'tenant_a', 'session_live', 'run_1', 'assistant', '', 'pending', 1)`,
    )
    await pool.query(
      `INSERT INTO bff_agent_dispatch_outbox
         (outbox_id, tenant_id, conversation_id, conversation_dispatch_seq, subject_id, actor_id,
          request_id, idempotency_key, request_digest, run_id, user_message_id, assistant_message_id,
          identity_assertion_ref, payload, status, admitted_at)
       VALUES ('dispatch_run_1', 'tenant_a', 'session_live', 1, 'user_integration', 'user_integration',
               'request_run_1', 'turn_run_1', $1, 'run_1', 'user_run_1', 'assistant_run_1',
               'assertion_run_1', '{}'::jsonb, 'admitted', CURRENT_TIMESTAMP(3))`,
      ["a".repeat(64)],
    )
    admissionStore = new PostgresBffRepositories(postgresUrl, redisUrl)
    await admissionStore.ready()
    await admissionStore.agUiConsumers.registerConsumer("tenant_a", "session_live", "user_integration", "run_1")
    const eventRequests = []
    const launchRequests = []
    agent = createServer((request, response) => {
      response.setHeader("content-type", "application/json")
      if (request.url === "/v1/runs" && request.method === "POST") {
        const chunks = []
        request.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
        request.on("end", () => {
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8"))
          launchRequests.push({ body, tenant: request.headers["x-kokoro-tenant-ref"], subject: request.headers["x-kokoro-subject-ref"], assertion: request.headers["x-kokoro-identity-assertion-ref"] })
          response.statusCode = 202
          response.end(JSON.stringify({ data: { run_id: body.run_id, session_id: body.session_id, replayed: false }, meta: { request_id: request.headers["x-request-id"] ?? body.request_id } }))
        })
        return
      }
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

    const secondTurn = await admissionStore.services.chatTurns.submit({
      tenantId: "tenant_a", conversationId: "session_live", subjectId: "user_integration", actorId: "user_integration",
      requestId: "request_run_2", idempotencyKey: "turn_run_2", content: "Second run",
    })
    assert.ok(secondTurn)
    const admissionDeadline = Date.now() + 3000
    let admitted = false
    while (!admitted && Date.now() < admissionDeadline) {
      const result = await pool.query("SELECT status FROM bff_agent_dispatch_outbox WHERE tenant_id='tenant_a' AND conversation_id='session_live' AND run_id=$1", [secondTurn.run_id])
      admitted = result.rows[0]?.status === "admitted"
      if (!admitted) await new Promise((resolve) => setTimeout(resolve, 10))
    }
    assert.equal(admitted, true)
    assert.equal(launchRequests.length, 1)
    assert.equal(launchRequests[0].body.run_id, secondTurn.run_id)
    assert.equal(launchRequests[0].body.session_id, "session_live")
    assert.equal(launchRequests[0].tenant, "tenant_a")
    assert.equal(launchRequests[0].subject, "user_integration")
    assert.match(launchRequests[0].assertion, /^bff:[0-9a-f]{64}$/u)
    const streamMarker = await pool.query("SELECT expected_run_id,latest_run_id FROM bff_agui_stream WHERE tenant_id='tenant_a' AND session_id='session_live'")
    assert.equal(streamMarker.rows[0].expected_run_id, secondTurn.run_id)
    assert.equal(streamMarker.rows[0].latest_run_id, "run_1")
    const admittedDetail = await fetch(`${base}/v1/sessions/session_live`, { headers: auth("tenant_a") })
    assert.equal(admittedDetail.status, 200)
    const admittedSnapshot = (await admittedDetail.json()).data
    assert.equal(admittedSnapshot.active_run, undefined)
    assert.deepEqual(admittedSnapshot.execution_head, {
      run_id: secondTurn.run_id,
      state: "queued",
      pending_pauses: [],
    })
    events.push(
      { chat_event_id: "source_run_2", session_id: "session_live", run_id: secondTurn.run_id, source_index: 4, event_type: "run.started", payload_json: '{"status":"running"}', seq: 5, created_at: 5000 },
      { chat_event_id: "source_terminal_2", session_id: "session_live", run_id: secondTurn.run_id, source_index: 5, event_type: "run.completed", payload_json: '{"status":"completed","token_usage":null}', seq: 6, created_at: 6000 },
    )
    const nextRun = await fetch(`${base}/v1/sessions/session_live/events`, {
      headers: { ...auth("tenant_a"), "last-event-id": originalFrames.at(-1).id },
    })
    assert.equal(nextRun.status, 200)
    const nextRunFrames = parseSse(await nextRun.text())
    assert.deepEqual(nextRunFrames.map((frame) => frame.event.type), ["CUSTOM", "RUN_STARTED", "RUN_FINISHED"])
    assert.equal(nextRunFrames[0].event.name, "kokoro.run.queued")
    assert.deepEqual(nextRunFrames[0].event.value, { run_id: secondTurn.run_id, dispatch_sequence: "2" })
    assert.deepEqual(nextRunFrames.map((frame) => frame.event.metadata.kokoro.run_id), [secondTurn.run_id, secondTurn.run_id, secondTurn.run_id])
    assert.equal(nextRunFrames[1].event.runId, secondTurn.run_id)
    assert.equal(nextRunFrames[2].event.runId, secondTurn.run_id)
    assert.equal(new Set(nextRunFrames.map((frame) => frame.id)).size, 3)
    for (const frame of nextRunFrames) assert.doesNotThrow(() => EventSchemas.parse(frame.event))
    assert.ok(nextRunFrames.every((frame) => /^agui_[0-9a-f]{32}$/u.test(frame.id)))
    const terminalMarker = await pool.query("SELECT expected_run_id,latest_run_id,terminal_run_id FROM bff_agui_stream WHERE tenant_id='tenant_a' AND session_id='session_live'")
    assert.deepEqual(terminalMarker.rows, [{ expected_run_id: null, latest_run_id: secondTurn.run_id, terminal_run_id: secondTurn.run_id }])

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
    assert.equal(foreignTenant.status, 403)
    assert.equal((await foreignTenant.json()).error.code, "product_tenant_forbidden")

    const sameTenantOtherSubject = await fetch(`${restartedBase}/v1/sessions/session_live/events`, {
      headers: { ...auth("tenant_a", "other_user"), "last-event-id": originalFrames[1].id },
    })
    assert.equal(sameTenantOtherSubject.status, 404)
    assert.equal((await sameTenantOtherSubject.json()).error.code, "session_not_found")
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
  const pool = new Pool({ connectionString: postgresUrl, options: "-c search_path=kokoro_bff -c timezone=UTC" })
  let bff = null
  let agent = null
  let admissionStore = null
  try {
    await pool.query("CREATE SCHEMA IF NOT EXISTS kokoro_bff")
    await pool.query(`DROP TABLE IF EXISTS ${TABLES.join(", ")} CASCADE`)
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    await insertConversation(pool, "session_boundary", "Boundary Chat")
    admissionStore = new PostgresBffRepositories(postgresUrl, redisUrl)
    const turn = await admissionStore.services.chatTurns.submit({
      tenantId: "tenant_a", conversationId: "session_boundary", subjectId: "user_integration", actorId: "user_integration",
      requestId: "request_boundary", idempotencyKey: "turn_boundary", content: "Boundary",
    })
    assert.ok(turn)
    const [claim] = await admissionStore.agentDispatchOutbox.claimAgentDispatchOutbox({ workerId: "worker_boundary", limit: 1, leaseDurationMs: 5000, maxAttempts: 8 })
    assert.equal(claim.runId, turn.run_id)
    assert.equal(await admissionStore.agentDispatchOutbox.markAgentDispatchAdmitted(claim), true)
    const events = [
      { chat_event_id: "run_started", session_id: "session_boundary", run_id: turn.run_id, source_index: 0, event_type: "run.started", payload_json: '{"status":"running"}', seq: 1, created_at: 1000 },
      { chat_event_id: "run_finished", session_id: "session_boundary", run_id: turn.run_id, source_index: 1, event_type: "run.completed", payload_json: '{"status":"completed"}', seq: 2, created_at: 2000 },
    ]
    const requestedAfter = []
    agent = createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://agent.local")
      const afterSequence = Number(url.searchParams.get("after_seq") ?? "0")
      requestedAfter.push(afterSequence)
      const page = events.filter((candidate) => candidate.seq > afterSequence).slice(0, 1)
      response.setHeader("content-type", "application/json")
      response.end(JSON.stringify({
        data: { events: page, next_seq: page.at(-1)?.seq ?? afterSequence, watermark: 2 },
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
      ["CUSTOM", turn.run_id],
      ["RUN_STARTED", turn.run_id],
      ["RUN_FINISHED", turn.run_id],
    ])
    assert.equal(frames[0].event.name, "kokoro.run.queued")
    assert.deepEqual(frames[0].event.value, { run_id: turn.run_id, dispatch_sequence: "1" })
    assert.equal(frames[1].event.runId, turn.run_id)
    assert.equal(frames[2].event.runId, turn.run_id)
    assert.equal(new Set(frames.map((frame) => frame.id)).size, 3)
    for (const frame of frames) {
      assert.match(frame.id, /^agui_[0-9a-f]{32}$/u)
      assert.doesNotThrow(() => EventSchemas.parse(frame.event))
    }
    assert.deepEqual(requestedAfter.slice(0, 2), [0, 1])
    assert.ok(requestedAfter.slice(2).every((sequence) => sequence === 2))
  } finally {
    if (admissionStore !== null) await admissionStore.close().catch(() => undefined)
    if (bff !== null) await close(bff)
    if (agent !== null) await close(agent)
    for (const server of servers.splice(0)) {
      if (server.listening) await close(server)
    }
    await pool.end()
  }
})

integrationTest("fails loudly when Agent event pagination metadata disagrees with the events", async () => {
  const pool = new Pool({ connectionString: postgresUrl, options: "-c search_path=kokoro_bff -c timezone=UTC" })
  let bff = null
  let agent = null
  try {
    await pool.query("CREATE SCHEMA IF NOT EXISTS kokoro_bff")
    await pool.query(`DROP TABLE IF EXISTS ${TABLES.join(", ")} CASCADE`)
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    await insertConversation(pool, "session_invalid_page", "Invalid Source Chat")
    agent = createServer((_request, response) => {
      response.setHeader("content-type", "application/json")
      response.end(JSON.stringify({
        data: {
          events: [
            { chat_event_id: "started", session_id: "session_invalid_page", run_id: "run_1", source_index: 0, event_type: "run.started", payload_json: '{"status":"running"}', seq: 1, created_at: 1000 },
            { chat_event_id: "terminal", session_id: "session_invalid_page", run_id: "run_1", source_index: 1, event_type: "run.completed", payload_json: '{"status":"completed"}', seq: 2, created_at: 2000 },
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
  const pool = new Pool({ connectionString: postgresUrl, options: "-c search_path=kokoro_bff -c timezone=UTC" })
  let bff = null
  let agent = null
  let admissionStore = null
  try {
    await pool.query("CREATE SCHEMA IF NOT EXISTS kokoro_bff")
    await pool.query(`DROP TABLE IF EXISTS ${TABLES.join(", ")} CASCADE`)
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    await insertConversation(pool, "session_budget", "Budget Chat")
    admissionStore = new PostgresBffRepositories(postgresUrl, redisUrl)
    const currentTurn = await admissionStore.services.chatTurns.submit({
      tenantId: "tenant_a", conversationId: "session_budget", subjectId: "user_integration", actorId: "user_integration",
      requestId: "request_budget", idempotencyKey: "turn_budget", content: "Budget current run",
    })
    assert.ok(currentTurn)
    const [currentClaim] = await admissionStore.agentDispatchOutbox.claimAgentDispatchOutbox({ workerId: "worker_budget", limit: 1, leaseDurationMs: 5000, maxAttempts: 8 })
    assert.equal(currentClaim.runId, currentTurn.run_id)
    assert.equal(await admissionStore.agentDispatchOutbox.markAgentDispatchAdmitted(currentClaim), true)
    const events = [
      { chat_event_id: "budget_history_started", session_id: "session_budget", run_id: "run_history", source_index: 0, event_type: "run.started", payload_json: '{"status":"running"}', seq: 1, created_at: 1000 },
      { chat_event_id: "budget_history_finished", session_id: "session_budget", run_id: "run_history", source_index: 1, event_type: "run.completed", payload_json: '{"status":"completed"}', seq: 2, created_at: 2000 },
      { chat_event_id: "budget_current_started", session_id: "session_budget", run_id: currentTurn.run_id, source_index: 2, event_type: "run.started", payload_json: '{"status":"running"}', seq: 3, created_at: 3000 },
      { chat_event_id: "budget_current_finished", session_id: "session_budget", run_id: currentTurn.run_id, source_index: 3, event_type: "run.completed", payload_json: '{"status":"completed"}', seq: 4, created_at: 4000 },
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
    assert.deepEqual(firstFrames.map((frame) => [frame.event.type, frame.event.metadata.kokoro.run_id]), [
      ["CUSTOM", currentTurn.run_id],
      ["RUN_STARTED", "run_history"],
    ])
    assert.equal(firstFrames[0].event.name, "kokoro.run.queued")
    assert.deepEqual(firstFrames[0].event.value, { run_id: currentTurn.run_id, dispatch_sequence: "1" })
    assert.equal(firstFrames[1].event.runId, "run_history")

    const resumed = await fetch(`${base}/v1/sessions/session_budget/events`, {
      headers: { ...auth("tenant_a"), "last-event-id": firstFrames.at(-1).id },
    })
    assert.equal(resumed.status, 200)
    const resumedFrames = parseSse(await resumed.text())
    assert.deepEqual(resumedFrames.map((frame) => [frame.event.type, frame.event.metadata.kokoro.run_id]), [
      ["RUN_FINISHED", "run_history"],
      ["RUN_STARTED", currentTurn.run_id],
    ])
    assert.equal(resumedFrames[0].event.runId, "run_history")
    assert.equal(resumedFrames[1].event.runId, currentTurn.run_id)
    const finalPage = await fetch(`${base}/v1/sessions/session_budget/events`, {
      headers: { ...auth("tenant_a"), "last-event-id": resumedFrames.at(-1).id },
    })
    assert.equal(finalPage.status, 200)
    const finalFrames = parseSse(await finalPage.text())
    assert.deepEqual(finalFrames.map((frame) => [frame.event.type, frame.event.metadata.kokoro.run_id]), [["RUN_FINISHED", currentTurn.run_id]])
    assert.equal(finalFrames[0].event.runId, currentTurn.run_id)
    const allFrames = [...firstFrames, ...resumedFrames, ...finalFrames]
    assert.equal(new Set(allFrames.map((frame) => frame.id)).size, 5)
    for (const frame of allFrames) {
      assert.match(frame.id, /^agui_[0-9a-f]{32}$/u)
      assert.doesNotThrow(() => EventSchemas.parse(frame.event))
    }
    const ledger = await pool.query(
      "SELECT cursor FROM bff_agui_event WHERE tenant_id=$1 AND session_id=$2 ORDER BY public_sequence", ["tenant_a", "session_budget"],
    )
    assert.deepEqual(allFrames.map((frame) => frame.id), ledger.rows.map((row) => row.cursor))
    assert.deepEqual((await pool.query(
      "SELECT expected_run_id,latest_run_id,terminal_run_id FROM bff_agui_stream WHERE tenant_id=$1 AND session_id=$2", ["tenant_a", "session_budget"],
    )).rows, [{ expected_run_id: null, latest_run_id: currentTurn.run_id, terminal_run_id: currentTurn.run_id }])
  } finally {
    if (admissionStore !== null) await admissionStore.close().catch(() => undefined)
    if (bff !== null) await close(bff)
    if (agent !== null) await close(agent)
    for (const server of servers.splice(0)) {
      if (server.listening) await close(server)
    }
    await pool.end()
  }
})

integrationTest("bounds same-session connections and coalesces their Agent and PostgreSQL polling", async () => {
  const pool = new Pool({ connectionString: postgresUrl, options: "-c search_path=kokoro_bff -c timezone=UTC" })
  let bff = null
  let agent = null
  try {
    await pool.query("CREATE SCHEMA IF NOT EXISTS kokoro_bff")
    await pool.query(`DROP TABLE IF EXISTS ${TABLES.join(", ")} CASCADE`)
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    await insertConversation(pool, "session_capacity", "Capacity Chat")
    let agentCalls = 0
    const source = { chat_event_id: "capacity_started", session_id: "session_capacity", run_id: "run_capacity", source_index: 0, event_type: "run.started", payload_json: '{"status":"running"}', seq: 1, created_at: 1000 }
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


integrationTest("R43 resumes queued B opaque cursor after restart without historical A terminal EOF before dispatcher-backed B source", { timeout: 30_000 }, async () => {
  const { randomUUID } = await import("node:crypto")
  const { AgentDispatchOutboxDispatcher } = await import("../dist/application/agent-dispatch-outbox-dispatcher.js")
  const { AgentOutboxDelivery } = await import("../dist/infrastructure/clients/agent/outbox-delivery.js")
  const pool = new Pool({ connectionString: postgresUrl, options: "-c search_path=kokoro_bff -c timezone=UTC" })
  const suffix = randomUUID()
  const tenantId = "r43_restart_" + suffix
  const sessionId = "conv_" + randomUUID()
  const ownerId = "r43_restart_owner"
  const controller = new AbortController()
  const requestDeadline = setTimeout(() => controller.abort(new Error("R43 bounded SSE deadline")), 15_000)
  let store = null
  let bff = null
  let agent = null
  let dispatcher = null
  let textPromise = null
  let resolveLaunch
  const launched = new Promise((resolve) => { resolveLaunch = resolve })
  let resolveWaiting
  const waiting = new Promise((resolve) => { resolveWaiting = resolve })
  const bounded = async (promise, label) => {
    let timer
    try {
      return await Promise.race([promise, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(label)), 5000)
      })])
    } finally { clearTimeout(timer) }
  }
  try {
    await pool.query("CREATE SCHEMA IF NOT EXISTS kokoro_bff")
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    store = new PostgresBffRepositories(postgresUrl, redisUrl)
    await store.ready()
    const submit = (name) => store.services.chatTurns.submit({
      tenantId, conversationId: sessionId, subjectId: ownerId, actorId: ownerId,
      requestId: "r43_restart_request_" + name + suffix,
      idempotencyKey: "r43_restart_key_" + name + suffix, content: "Restart turn " + name,
    })
    const a = await submit("A")
    const b = await submit("B")
    assert.ok(a && b)
    const claims = await store.agentDispatchOutbox.claimAgentDispatchOutbox({
      workerId: "r43_restart_A_" + suffix, limit: 1, leaseDurationMs: 5000, maxAttempts: 8,
    })
    assert.equal(claims[0]?.runId, a.run_id)
    assert.equal(await store.agentDispatchOutbox.markAgentDispatchAdmitted(claims[0]), true)
    await store.agUi.ingest(tenantId, sessionId, [1, 2].map((seq) => {
      const id = "r43_restart_source_" + suffix + "_" + seq
      const timestamp = new Date(seq * 1000).toISOString()
      const payload = seq === 1 ? { run_id: a.run_id } : { status: "completed" }
      return {
        sourceRunId: a.run_id, sourceEventId: id, sourceSequence: seq,
        sourceOccurredAt: timestamp, sourcePayload: payload,
        event: { event_id: id, seq, session_id: sessionId, run_id: a.run_id,
          kind: seq === 1 ? "run.created" : "run.completed", timestamp, payload },
      }
    }))
    bff = createBffServer({ ...bffConfig({ agentEnabled: false, agentBase: null }), tenantId }, { businessStore: store, sessionAdmission })
    const originalBase = await listen(bff)
    const originalDetail = await fetch(originalBase + "/v1/sessions/" + sessionId, { headers: auth(tenantId, ownerId), signal: controller.signal })
    assert.equal(originalDetail.status, 200)
    const originalSnapshot = (await originalDetail.json()).data
    assert.match(originalSnapshot.event_watermark, /^agui_[0-9a-f]{32}$/u)
    await bff.shutdown(1000)
    bff = null
    await store.close()
    store = new PostgresBffRepositories(postgresUrl, redisUrl)
    await store.ready()

    const launchRequests = []
    const eventRequests = []
    let publishB = false
    agent = createServer((request, response) => {
      response.setHeader("content-type", "application/json")
      if (request.method === "POST" && request.url === "/v1/runs") {
        const chunks = []
        request.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
        request.on("end", () => {
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8"))
          launchRequests.push({ body, tenant: request.headers["x-kokoro-tenant-ref"],
            subject: request.headers["x-kokoro-subject-ref"], key: request.headers["idempotency-key"],
            assertion: request.headers["x-kokoro-identity-assertion-ref"] })
          response.statusCode = 202
          response.end(JSON.stringify({ data: { run_id: body.run_id, session_id: body.session_id, replayed: false },
            meta: { request_id: request.headers["x-request-id"] ?? body.request_id } }))
          resolveLaunch(body)
        })
        return
      }
      if (request.method === "GET" && request.url?.includes("/events")) {
        const afterSequence = Number(new URL(request.url, "http://agent.local").searchParams.get("after_seq") ?? "0")
        eventRequests.push({ afterSequence, publishB, launchCount: launchRequests.length })
        const events = publishB ? [3, 4].map((seq) => ({
          chat_event_id: "r43_restart_source_" + suffix + "_" + seq,
          session_id: sessionId, run_id: b.run_id, source_index: seq - 1,
          event_type: seq === 3 ? "run.started" : "run.completed",
          payload_json: JSON.stringify(seq === 3 ? { status: "running" } : { status: "completed", token_usage: null }),
          seq, created_at: seq * 1000,
        })).filter((event) => event.seq > afterSequence) : []
        response.end(JSON.stringify({ data: { events, next_seq: events.at(-1)?.seq ?? afterSequence, watermark: publishB ? 4 : 2 },
          meta: { request_id: "r43_restart_agent" } }))
        return
      }
      response.statusCode = 404
      response.end(JSON.stringify({ error: { code: "not_found", message: "not found" }, meta: { request_id: "r43_restart_agent" } }))
    })
    const agentBase = await listen(agent)
    const runtimeConfig = { ...bffConfig({ agentEnabled: true, agentBase }), tenantId }
    const runtime = new AgUiSessionRuntime({
      connections: { global: runtimeConfig.agUi.maxConnectionsGlobal, perTenant: runtimeConfig.agUi.maxConnectionsPerTenant,
        perSession: runtimeConfig.agUi.maxConnectionsPerSession },
      ledgerWait: { baseDelayMs: runtimeConfig.agUi.ledgerPollBaseDelayMs, maxDelayMs: runtimeConfig.agUi.ledgerPollMaxDelayMs,
        jitterRatio: runtimeConfig.agUi.ledgerPollJitterPercent / 100 },
      replayCacheTtlMs: runtimeConfig.agUi.replayCacheTtlMs,
    })
    const actualWait = runtime.ledgerWaits.wait.bind(runtime.ledgerWaits)
    runtime.ledgerWaits.wait = (tenant, session) => {
      const result = actualWait(tenant, session)
      if (tenant === tenantId && session === sessionId) resolveWaiting("waiting")
      return result
    }
    dispatcher = new AgentDispatchOutboxDispatcher(store.agentDispatchOutbox, new AgentOutboxDelivery(runtimeConfig), {
      workerId: "r43_restart_B_" + suffix,
    })
    bff = createBffServer(runtimeConfig, {
      businessStore: store, sessionAdmission, agUiRuntime: runtime,
      // Gate only the genuine runner's start; its SQL, claims, receipts and network results stay real.
      agentDispatchDispatcher: { start() {}, stop: () => dispatcher.stop() },
    })
    const restartedBase = await listen(bff)
    const restartedDetail = await fetch(restartedBase + "/v1/sessions/" + sessionId, { headers: auth(tenantId, ownerId), signal: controller.signal })
    assert.equal(restartedDetail.status, 200)
    const restartedSnapshot = (await restartedDetail.json()).data
    assert.equal(restartedSnapshot.event_watermark, originalSnapshot.event_watermark)
    const stream = await fetch(restartedBase + "/v1/sessions/" + sessionId + "/events", {
      headers: { ...auth(tenantId, ownerId), "last-event-id": originalSnapshot.event_watermark }, signal: controller.signal,
    })
    assert.equal(stream.status, 200)
    textPromise = stream.text()
    void textPromise.catch(() => undefined)
    const boundary = await bounded(Promise.race([waiting, textPromise.then(() => "eof")]), "SSE neither waited nor ended")
    assert.equal(boundary, "waiting", "historical A terminal must not cause EOF while B is durable queued and unclaimed")
    assert.equal(launchRequests.length, 0)
    assert.deepEqual(originalSnapshot.execution_head, { run_id: b.run_id, state: "queued", pending_pauses: [] })
    assert.deepEqual(restartedSnapshot.execution_head, originalSnapshot.execution_head)
    const queuedQuery = "SELECT cursor,event_payload FROM bff_agui_event WHERE tenant_id=$1 AND session_id=$2 AND event_type='CUSTOM' AND event_payload->>'name'='kokoro.run.queued' ORDER BY public_sequence"
    const queuedBefore = await pool.query(queuedQuery, [tenantId, sessionId])
    assert.deepEqual(queuedBefore.rows.map(({ event_payload }) => event_payload.value.run_id), [a.run_id, b.run_id])
    assert.equal(queuedBefore.rows.at(-1).cursor, originalSnapshot.event_watermark)
    dispatcher.start()
    const command = await bounded(launched, "production dispatcher did not launch B")
    assert.equal(command.run_id, b.run_id)
    assert.equal(command.session_id, sessionId)
    assert.equal(launchRequests[0].tenant, tenantId)
    assert.equal(launchRequests[0].subject, ownerId)
    assert.equal(launchRequests[0].key, "r43_restart_key_B" + suffix)
    assert.match(launchRequests[0].assertion, /^bff:[0-9a-f]{64}$/u)
    // Release formal Agent source only after the genuine launch has been received and ACKed.
    publishB = true
    const frames = parseSse(await textPromise)
    assert.deepEqual(frames.map(({ event }) => event.type), ["RUN_STARTED", "RUN_FINISHED"])
    assert.ok(frames.every(({ event }) => event.runId === b.run_id))
    assert.ok(frames.every(({ id }) => /^agui_[0-9a-f]{32}$/u.test(id) && id !== originalSnapshot.event_watermark))
    assert.equal(new Set(frames.map(({ id }) => id)).size, 2)
    for (const { event } of frames) assert.doesNotThrow(() => EventSchemas.parse(event))
    assert.equal(launchRequests.length, 1)
    assert.ok(eventRequests.some(({ publishB: released, launchCount }) => released && launchCount === 1))
    const finalSnapshot = await store.services.chat.snapshot(tenantId, ownerId, sessionId, undefined)
    assert.equal(finalSnapshot.execution_head, undefined)
    assert.equal(finalSnapshot.event_watermark, frames.at(-1).id)
    const replay = await store.agUi.replay(tenantId, sessionId, originalSnapshot.event_watermark, 100)
    assert.equal(replay.kind, "page")
    assert.deepEqual(replay.frames.map(({ cursor }) => cursor), frames.map(({ id }) => id))
    assert.deepEqual((await pool.query(queuedQuery, [tenantId, sessionId])).rows, queuedBefore.rows)
    const dispatches = await pool.query(
      "SELECT run_id,status FROM bff_agent_dispatch_outbox WHERE tenant_id=$1 AND conversation_id=$2 ORDER BY conversation_dispatch_seq,outbox_id",
      [tenantId, sessionId],
    )
    assert.deepEqual(dispatches.rows, [{ run_id: a.run_id, status: "terminal" }, { run_id: b.run_id, status: "terminal" }])
    const assistants = finalSnapshot.messages.filter(({ role }) => role === "assistant")
    assert.equal(assistants.length, 2)
    assert.ok(assistants.every(({ status }) => status === "completed"))
  } finally {
    clearTimeout(requestDeadline)
    controller.abort()
    if (textPromise !== null) await textPromise.catch(() => undefined)
    if (dispatcher !== null) await dispatcher.stop()
    if (bff !== null) await bff.shutdown(1000)
    if (agent !== null && agent.listening) await close(agent)
    if (store !== null) await store.close()
    for (const [table, column] of [
      ["bff_agui_event", "session_id"], ["bff_agui_source_event", "session_id"],
      ["bff_agui_run_interaction", "session_id"], ["bff_agui_stream", "session_id"], ["bff_agent_dispatch_outbox", "conversation_id"],
      ["bff_message", "conversation_id"], ["bff_conversation", "conversation_id"],
    ]) {
      await pool.query("DELETE FROM " + table + " WHERE tenant_id=$1 AND " + column + "=$2", [tenantId, sessionId])
    }
    await pool.end()
  }
})


// R57: real production BFF HTTP + SQL; the Agent HTTP fixture represents admission only.

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

async function r57HttpBounded(promise, label) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(label)), 5000)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}
function r57Canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(r57Canonical).join(",") + "]"
  if (value !== null && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map((key) => JSON.stringify(key) + ":" + r57Canonical(value[key]))
        .join(",") +
      "}"
    )
  return JSON.stringify(value)
}
async function r57OwnerReceiptDigest(runId, body) {
  // Independent published RunResume normalization, not the BFF digest function under test.
  const { createHash } = await import("node:crypto")
  const material = {
    kind: body.kind,
    run_id: runId,
    session_id: body.session_id,
    expected_pause_revision: body.expected_pause_revision,
    pause_ref: body.pause_ref,
    decisions: body.decisions.map((decision) => {
      const normalized = { ...decision }
      if (decision.type === "approve" && normalized.args === null) delete normalized.args
      if (decision.type === "reject" && normalized.reason === null) delete normalized.reason
      return normalized
    }),
  }
  return "sha256:" + createHash("sha256").update(r57Canonical(material), "utf8").digest("hex")
}
async function r57HttpContext(context) {
  const { randomUUID } = await import("node:crypto")
  const { AgentDispatchOutboxDispatcher } = await import("../dist/application/agent-dispatch-outbox-dispatcher.js")
  const { AgentOutboxDelivery } = await import("../dist/infrastructure/clients/agent/outbox-delivery.js")
  const { AgUiProjectorRunner } = await import("../dist/application/agui/projector.js")
  const { AgentAgUiSourceReader } = await import("../dist/infrastructure/clients/agent/projector-source.js")
  const suffix = randomUUID().replaceAll("-", ""),
    tenantId = "r57_http_" + suffix
  const sessionId = "r57_http_session_" + suffix,
    ownerId = "r57_http_owner_" + suffix
  const pool = new Pool({ connectionString: postgresUrl, options: "-c search_path=kokoro_bff -c timezone=UTC", statement_timeout: 5000 })
  let store = null,
    bff = null,
    agent = null
  const requests = [],
    streams = new Set()
  context.after(async () => {
    const failures = []
    for (const controller of streams) controller.abort()
    if (bff !== null) {
      try {
        await bff.shutdown(1000)
      } catch (error) {
        failures.push(error)
      }
    }
    if (agent !== null && agent.listening) {
      try {
        await close(agent)
      } catch (error) {
        failures.push(error)
      }
    }
    if (store !== null) {
      try {
        await store.close()
      } catch (error) {
        failures.push(error)
      }
    }
    for (const [table, column] of [
      ["bff_agui_run_interaction", "session_id"],
      ["bff_agui_cursor_tombstone", "session_id"],
      ["bff_agui_event", "session_id"],
      ["bff_conversation_artifact", "conversation_id"],
      ["bff_agui_source_event", "session_id"],
      ["bff_agui_stream", "session_id"],
      ["bff_agent_cancellation_outbox", "conversation_id"],
      ["bff_agent_dispatch_outbox", "conversation_id"],
      ["bff_share", "conversation_id"],
      ["bff_message", "conversation_id"],
      ["bff_conversation", "conversation_id"],
    ]) {
      try {
        if (
          table === "bff_agui_run_interaction" &&
          (await pool.query("SELECT to_regclass('kokoro_bff.bff_agui_run_interaction') AS name")).rows[0].name === null
        )
          continue
        await pool.query("DELETE FROM " + table + " WHERE tenant_id=$1 AND " + column + "=$2", [tenantId, sessionId])
      } catch (error) {
        failures.push(error)
      }
    }
    try {
      await pool.query("DELETE FROM bff_idempotency_receipt WHERE left(scope,length($1))=$1", [JSON.stringify([tenantId, ownerId]).slice(0, -1) + ","])
    } catch (error) {
      failures.push(error)
    }
    try {
      await pool.end()
    } catch (error) {
      failures.push(error)
    }
    if (failures.length) throw new AggregateError(failures, "R57 owned HTTP cleanup failed")
  })
  await pool.query("CREATE SCHEMA IF NOT EXISTS kokoro_bff")
  await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
  store = new PostgresBffRepositories(postgresUrl, redisUrl)
  await store.ready()
  await pool.query("INSERT INTO bff_conversation (conversation_id,tenant_id,owner_id,title) VALUES ($1,$2,$3,'R57 control')", [sessionId, tenantId, ownerId])
  const turn = await store.services.chatTurns.submit({
    tenantId,
    conversationId: sessionId,
    subjectId: ownerId,
    actorId: ownerId,
    requestId: "r57_http_turn_" + suffix,
    idempotencyKey: "r57_http_turn_key_" + suffix,
    content: "R57 decision collection",
  })
  assert.ok(turn)
  const [claim] = await store.agentDispatchOutbox.claimAgentDispatchOutbox({
    workerId: "r57_http_worker_" + suffix,
    limit: 1,
    leaseDurationMs: 5000,
    maxAttempts: 8,
  })
  assert.equal(claim?.runId, turn.run_id)
  assert.equal(await store.agentDispatchOutbox.markAgentDispatchAdmitted(claim), true)
  const runId = turn.run_id
  const source = (sequence, payload, kind = "interaction.state") => {
    const id = "r57_http_source_" + suffix + "_" + sequence,
      timestamp = new Date(sequence * 1000).toISOString()
    return {
      sourceRunId: runId,
      sourceEventId: id,
      sourceSequence: sequence,
      sourceOccurredAt: timestamp,
      sourcePayload: {
        chat_event_id: id,
        session_id: sessionId,
        run_id: runId,
        source_index: sequence - 1,
        event_type: kind === "run.created" ? "run.started" : kind,
        payload_json: JSON.stringify(payload),
        seq: sequence,
        created_at: sequence * 1000,
      },
      event: { event_id: id, seq: sequence, session_id: sessionId, run_id: runId, timestamp, kind, payload },
    }
  }
  await store.agUi.ingest(tenantId, sessionId, [source(1, { run_id: runId }, "run.created"), source(2, r57Waiting())])
  agent = createServer((request, response) => {
    const chunks = []
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
    request.on("end", () => {
      void (async () => {
        const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null
        if (request.method !== "POST" || request.url !== "/v1/runs/" + encodeURIComponent(runId) + "/control") {
          response.statusCode = 404
          response.end(JSON.stringify({ error: { code: "not_found", message: "Unexpected fixture route" }, meta: { request_id: "r57_agent" } }))
          return
        }
        requests.push({ body, headers: request.headers })
        response.statusCode = 202
        response.setHeader("content-type", "application/json")
        response.end(
          JSON.stringify({
            data: {
              command_id: request.headers["idempotency-key"],
              request_digest: await r57OwnerReceiptDigest(runId, body),
              status: "succeeded",
              replayed: false,
            },
            meta: { request_id: "r57_agent" },
          }),
        )
      })().catch((error) => {
        response.statusCode = 500
        response.end(JSON.stringify({ fixture_error: error.message }))
      })
    })
  })
  const agentBase = await listen(agent)
  const config = { ...bffConfig({ agentEnabled: true, agentBase }), tenantId }
  const start = async () => {
    const dispatcher = new AgentDispatchOutboxDispatcher(store.agentDispatchOutbox, new AgentOutboxDelivery(config), {
      workerId: "r57_http_dispatch_" + suffix,
    })
    const projector = new AgUiProjectorRunner(store.agUi, store.agUiConsumers, new AgentAgUiSourceReader(config, agentBase), {
      workerId: "r57_http_projector_" + suffix,
    })
    // Existing timer-start seam only: real production SQL/HTTP methods are never replaced.
    // No background source poll may race the explicitly committed owner revisions in this test.
    bff = createBffServer(config, {
      businessStore: store,
      sessionAdmission,
      agentDispatchDispatcher: { start() {}, stop: () => dispatcher.stop() },
      agUiProjector: { start() {}, stop: () => projector.stop() },
    })
    return listen(bff)
  }
  let base = await start()
  const detail = async () => {
    const response = await fetch(base + "/v1/sessions/" + sessionId, { headers: auth(tenantId, ownerId), signal: AbortSignal.timeout(5000) })
    assert.equal(response.status, 200)
    return (await response.json()).data
  }
  const control = async (body, key, targetRun = runId) => {
    const response = await fetch(base + "/v1/sessions/" + sessionId + "/runs/" + targetRun + "/control", {
      method: "POST",
      headers: { ...auth(tenantId, ownerId), "content-type": "application/json", "idempotency-key": key },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    })
    return { status: response.status, body: await response.json() }
  }
  const facts = async () => {
    const state = {}
    for (const [table, column, order] of [
      ["bff_agui_source_event", "session_id", "source_sequence"],
      ["bff_agui_event", "session_id", "public_sequence"],
      ["bff_agui_stream", "session_id", "session_id"],
      ["bff_agent_dispatch_outbox", "conversation_id", "outbox_id"],
      ["bff_message", "conversation_id", "message_id"],
      ["bff_agui_run_interaction", "session_id", "run_id"],
    ]) {
      if (
        table === "bff_agui_run_interaction" &&
        (await pool.query("SELECT to_regclass('kokoro_bff.bff_agui_run_interaction') AS name")).rows[0].name === null
      ) {
        state[table] = null
        continue
      }
      state[table] = (await pool.query("SELECT * FROM " + table + " WHERE tenant_id=$1 AND " + column + "=$2 ORDER BY " + order, [tenantId, sessionId])).rows
    }
    return state
  }
  return {
    pool,
    tenantId,
    sessionId,
    ownerId,
    runId,
    requests,
    streams,
    detail,
    control,
    facts,
    ingest: (sequence, payload, kind) => store.agUi.ingest(tenantId, sessionId, [source(sequence, payload, kind)]),
    replay: (cursor) => store.agUi.replay(tenantId, sessionId, cursor, 100),
    restart: async () => {
      await bff.shutdown(1000)
      await store.close()
      store = new PostgresBffRepositories(postgresUrl, redisUrl)
      await store.ready()
      base = await start()
    },
    stream: async (cursor, controller) => {
      streams.add(controller)
      return fetch(base + "/v1/sessions/" + sessionId + "/events", {
        headers: { ...auth(tenantId, ownerId), "last-event-id": cursor },
        signal: controller.signal,
      })
    },
  }
}
integrationTest(
  "R57 HTTP ACK succeeded is not consumption and durable accepted unknown consumed alone change full head",
  { timeout: 30_000 },
  async (context) => {
    const c = await r57HttpContext(context),
      body = r57Control(),
      key = "r57_resume"
    const before = await c.detail(),
      facts = await c.facts()
    const result = await c.control(body, key)
    assert.equal(result.status, 202, "published locator and five decisions must reach real owner control adapter")
    assert.equal(result.body.data.status, "succeeded")
    assert.equal(c.requests.length, 1)
    assert.deepEqual(c.requests[0].body, { ...body, session_id: c.sessionId })
    assert.deepEqual(before.execution_head, { run_id: c.runId, state: "waiting", pending_pauses: [r57Waiting()] })
    assert.deepEqual(await c.detail(), before, "even succeeded ACK must not clear pending or advance cursor")
    assert.deepEqual(await c.facts(), facts)
    const replay = await c.control(body, key)
    assert.equal(replay.status, 202)
    assert.deepEqual(replay.body, result.body)
    assert.equal(c.requests.length, 1, "same-key durable BFF receipt replay cannot send another command")
    const nullableDifferentBody = structuredClone(body)
    nullableDifferentBody.decisions[0].args = null
    const bodyConflict = await c.control(nullableDifferentBody, key)
    assert.equal(bodyConflict.status, 409)
    assert.equal(bodyConflict.body.error.code, "idempotency_conflict", "owner normalization equivalence does not rewrite the outer BFF fingerprint")
    assert.equal(c.requests.length, 1)
    const accepted = { ...r57Waiting(), interaction_revision: 8, phase: "resuming", action_result: { command_id: key, pause_revision: 7, kind: "accepted" } }
    await c.ingest(3, accepted)
    let current = await c.detail()
    assert.deepEqual(current.execution_head, { run_id: c.runId, state: "resuming", pending_pauses: [accepted] })
    assert.notEqual(current.event_watermark, before.event_watermark)
    const newKey = await c.control(body, "r57_repeat_new_key")
    assert.equal(newKey.status, 409)
    assert.equal(newKey.body.error.code, "run_control_conflict")
    assert.equal(c.requests.length, 1)
    assert.equal((await c.control(body, key)).status, 202)
    const unknown = { ...accepted, interaction_revision: 9, action_result: { ...accepted.action_result, kind: "unknown" } }
    await c.ingest(4, unknown)
    assert.deepEqual((await c.detail()).execution_head, { run_id: c.runId, state: "resuming", pending_pauses: [unknown] })
    const consumed = { ...unknown, interaction_revision: 10, phase: "active", groups: [], action_result: { ...unknown.action_result, kind: "native_consumed" } }
    await c.ingest(5, consumed)
    current = await c.detail()
    assert.deepEqual(current.execution_head, { run_id: c.runId, state: "active", pending_pauses: [] })
    const ledger = await c.replay(before.event_watermark)
    assert.equal(ledger.kind, "page")
    assert.deepEqual(
      ledger.frames.map((frame) => frame.payload.value),
      [accepted, unknown, consumed],
    )
    assert.equal(ledger.frames.at(-1).cursor, current.event_watermark)
  },
)
integrationTest(
  "R57 HTTP rejects missing stale partial extra duplicate disallowed and wrong-Run controls before owner with no projection effect",
  { timeout: 30_000 },
  async (context) => {
    const c = await r57HttpContext(context),
      valid = r57Control(),
      before = await c.facts()
    const cases = [
      ["missing locator", { kind: valid.kind, decisions: valid.decisions }, 400, "invalid_run_control"],
      ["stale revision", { ...valid, expected_pause_revision: 6 }, 409, "run_control_conflict"],
      ["wrong pause ref", { ...valid, pause_ref: "other-pause" }, 409, "run_control_conflict"],
      ["partial collection", { ...valid, decisions: valid.decisions.slice(0, 4) }, 400, "invalid_run_control"],
      ["extra item", { ...valid, decisions: [...valid.decisions, { type: "approve", item_id: "not-pending" }] }, 400, "invalid_run_control"],
      ["duplicate item", { ...valid, decisions: [...valid.decisions, valid.decisions[0]] }, 400, "invalid_run_control"],
      [
        "disallowed decision",
        {
          ...valid,
          decisions: valid.decisions.map((decision) => (decision.item_id === "item_submit" ? { type: "reject", item_id: "item_submit" } : decision)),
        },
        400,
        "invalid_run_control",
      ],
      ["self reported session", { ...valid, session_id: c.sessionId }, 400, "invalid_run_control"],
    ]
    for (const [name, body, status, code] of cases) {
      const response = await c.control(body, "r57_invalid_" + name)
      assert.equal(response.status, status, name)
      assert.equal(response.body.error.code, code, name)
      assert.equal(c.requests.length, 0, name + " must not issue owner HTTP")
      assert.deepEqual(await c.facts(), before, name + " must not mutate any projection/FIFO/message/cursor")
    }
    const wrongRun = await c.control(valid, "r57_wrong_run", "run_not_owned")
    assert.equal(wrongRun.status, 404)
    assert.equal(wrongRun.body.error.code, "run_not_found")
    assert.equal(c.requests.length, 0)
    assert.deepEqual(await c.facts(), before)
    const positive = await c.control(valid, "r57_valid_after_negatives")
    assert.equal(positive.status, 202, "negative checks must not block the complete valid control")
    assert.equal(c.requests.length, 1)
  },
)
integrationTest(
  "R57 restarted HTTP snapshot and nonzero SSE replay retain the same full optional-preserving pause and opaque watermark",
  { timeout: 30_000 },
  async (context) => {
    const c = await r57HttpContext(context)
    const before = await c.detail()
    assert.deepEqual(before.execution_head, { run_id: c.runId, state: "waiting", pending_pauses: [r57Waiting()] })
    await c.restart()
    assert.deepEqual(await c.detail(), before)
    const accepted = {
      ...r57Waiting(),
      interaction_revision: 8,
      phase: "resuming",
      action_result: { command_id: "r57_restart_resume", pause_revision: 7, kind: "accepted" },
    }
    await c.ingest(3, accepted)
    const current = await c.detail()
    assert.deepEqual(current.execution_head, { run_id: c.runId, state: "resuming", pending_pauses: [accepted] })
    assert.notEqual(current.event_watermark, before.event_watermark)
    const controller = new AbortController()
    const response = await r57HttpBounded(c.stream(before.event_watermark, controller), "R57 SSE headers timeout")
    assert.equal(response.status, 200)
    const reader = response.body.getReader()
    try {
      const decoder = new TextDecoder()
      let body = "",
        frames = []
      while (frames.length === 0) {
        const chunk = await r57HttpBounded(reader.read(), "R57 SSE revision replay timeout")
        assert.equal(chunk.done, false, "waiting/resuming is not a Run terminal or EOF")
        body += decoder.decode(chunk.value, { stream: true })
        frames = parseSse(body)
      }
      assert.equal(frames.length, 1)
      assert.equal(frames[0].id, current.event_watermark)
      assert.equal(frames[0].event.type, "CUSTOM")
      assert.equal(frames[0].event.name, "kokoro.interaction.state")
      assert.deepEqual(frames[0].event.value, accepted)
      assert.doesNotThrow(() => EventSchemas.parse(frames[0].event))
      assert.equal(Object.hasOwn(frames[0].event.value.groups[0].items[0].display, "result_preview"), true)
      assert.equal(Object.hasOwn(frames[0].event.value.groups[1].items[1].display, "result_preview"), false)
      const replay = await c.replay(before.event_watermark)
      assert.equal(replay.kind, "page")
      assert.deepEqual(
        replay.frames.map((frame) => frame.cursor),
        [current.event_watermark],
      )
    } finally {
      controller.abort()
      await reader.cancel().catch(() => undefined)
      reader.releaseLock()
    }
    await c.restart()
    assert.deepEqual(await c.detail(), current)
  },
)
