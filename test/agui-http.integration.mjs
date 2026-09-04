import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { createServer } from "node:http"
import { test } from "node:test"

import { EventSchemas } from "@ag-ui/core"
import { Pool } from "pg"

import { createBffServer } from "../dist/main.js"

const postgresUrl = process.env.KOKORO_TEST_POSTGRES_URL
const redisUrl = process.env.KOKORO_TEST_REDIS_URL
const integrationTest = postgresUrl && redisUrl ? test : test.skip
const servers = []

const TABLES = [
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
  return {
    "x-kokoro-service": "web-bff",
    "x-kokoro-internal-secret": "web-secret",
    "x-kokoro-namespace": tenantId,
    "x-kokoro-principal-id": "user_integration",
  }
}

function bffConfig({ agentEnabled, agentBase }) {
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
    agentEnabled,
    schedulerServiceToken: null,
    schedulerTargetUrl: null,
    postgresUrl,
    redisUrl,
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
  try {
    await pool.query(`DROP TABLE IF EXISTS ${TABLES.join(", ")} CASCADE`)
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))

    const events = [
      { chat_event_id: "source_run", session_id: "session_live", run_id: "run_1", event_type: "run.started", payload_json: '{"status":"running"}', seq: 1, created_at: 1000 },
      { chat_event_id: "source_delta", session_id: "session_live", run_id: "run_1", chat_message_id: "message_1", event_type: "assistant.delta", payload_json: '{"delta":"hello"}', seq: 2, created_at: 2000 },
      { chat_event_id: "source_message_end", session_id: "session_live", run_id: "run_1", chat_message_id: "message_1", event_type: "assistant.completed", payload_json: '{"content":"hello"}', seq: 3, created_at: 3000 },
      { chat_event_id: "source_terminal", session_id: "session_live", run_id: "run_1", event_type: "run.completed", payload_json: '{"status":"completed","token_usage":null}', seq: 4, created_at: 4000 },
    ]
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
    bff = createBffServer(bffConfig({ agentEnabled: true, agentBase }))
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
    assert.deepEqual(eventRequests.slice(0, 4), [0, 2, 0, 2])

    const ledger = await pool.query(
      `SELECT public_sequence, cursor, event_type
         FROM bff_agui_event
        WHERE tenant_id = $1 AND session_id = $2
        ORDER BY public_sequence`,
      ["tenant_a", "session_live"],
    )
    assert.deepEqual(ledger.rows.map((row) => row.cursor), originalFrames.map((frame) => frame.id))

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

    bff = createBffServer(bffConfig({ agentEnabled: false, agentBase: null }))
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
    assert.equal(foreignTenant.status, 400)
    assert.equal((await foreignTenant.json()).error.code, "invalid_event_cursor")
  } finally {
    if (bff !== null) await close(bff)
    if (agent !== null) await close(agent)
    for (const server of servers.splice(0)) {
      if (server.listening) await close(server)
    }
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
    bff = createBffServer(bffConfig({ agentEnabled: true, agentBase }))
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
    assert.deepEqual(requestedAfter, [0, 2])
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
    bff = createBffServer(bffConfig({ agentEnabled: true, agentBase }))
    const base = await listen(bff)

    const streamed = await fetch(`${base}/v1/sessions/session_invalid_page/events`, { headers: auth("tenant_a") })
    assert.equal(streamed.status, 502)
    assert.equal((await streamed.json()).error.code, "upstream_response_invalid")
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
