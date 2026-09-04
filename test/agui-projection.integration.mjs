import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { test } from "node:test"

import { Pool } from "pg"
import { createClient } from "redis"

import { PostgresBffRepositories } from "../dist/infrastructure/postgres/repositories.js"

const postgresUrl = process.env.KOKORO_TEST_POSTGRES_URL
const redisUrl = process.env.KOKORO_TEST_REDIS_URL
const integrationTest = postgresUrl && redisUrl ? test : test.skip

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

function agentSource({ id, sequence, kind, payload, sessionId = "session_shared", runId = "run_1" }) {
  const occurredAt = new Date(sequence * 1000).toISOString()
  return {
    sourceEventId: id,
    sourceSequence: sequence,
    sourceOccurredAt: occurredAt,
    sourcePayload: {
      chat_event_id: id,
      session_id: sessionId,
      run_id: runId,
      seq: sequence,
      created_at: sequence * 1000,
      payload,
    },
    event: kind === null ? null : {
      event_id: id,
      seq: sequence,
      session_id: sessionId,
      run_id: runId,
      kind,
      timestamp: occurredAt,
      payload,
    },
  }
}

integrationTest("keeps durable AG-UI replay lossless, idempotent, tenant-scoped, and independent of Redis state", async () => {
  const pool = new Pool({ connectionString: postgresUrl })
  const redis = createClient({ url: redisUrl })
  let store = null
  try {
    await pool.query(`DROP TABLE IF EXISTS ${TABLES.join(", ")} CASCADE`)
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    await redis.connect()

    store = new PostgresBffRepositories(postgresUrl, redisUrl)
    await store.ready()

    const first = await store.agUi.ingest("tenant_a", "session_shared", [agentSource({
      id: "agent_event_1",
      sequence: 1,
      kind: "message.delta",
      payload: { segment_id: "message_1", delta: "Hello" },
    })])
    assert.deepEqual(first, {
      insertedSources: 1,
      insertedFrames: 2,
      sourceHighWatermark: 1,
    })

    const initial = await store.agUi.replay("tenant_a", "session_shared", null, 100)
    assert.equal(initial.kind, "page")
    assert.deepEqual(initial.frames.map((frame) => frame.publicSequence), [1, 2])
    assert.deepEqual(initial.frames.map((frame) => frame.eventType), ["TEXT_MESSAGE_START", "TEXT_MESSAGE_CONTENT"])
    assert.equal(new Set(initial.frames.map((frame) => frame.cursor)).size, 2)
    assert.ok(initial.frames.every((frame) => /^agui_[0-9a-f]{32}$/u.test(frame.cursor)))

    const afterExpandedStart = await store.agUi.replay("tenant_a", "session_shared", initial.frames[0].cursor, 100)
    assert.equal(afterExpandedStart.kind, "page")
    assert.deepEqual(afterExpandedStart.frames.map((frame) => frame.eventType), ["TEXT_MESSAGE_CONTENT"])

    const second = await store.agUi.ingest("tenant_a", "session_shared", [agentSource({
      id: "agent_event_2",
      sequence: 2,
      kind: "message.delta",
      payload: { segment_id: "message_1", delta: " world" },
    })])
    assert.deepEqual(second, {
      insertedSources: 1,
      insertedFrames: 1,
      sourceHighWatermark: 2,
    })
    const afterSecond = await store.agUi.replay("tenant_a", "session_shared", null, 100)
    assert.equal(afterSecond.kind, "page")
    const currentCursor = afterSecond.frames.at(-1).cursor

    const duplicate = await store.agUi.ingest("tenant_a", "session_shared", [agentSource({
      id: "agent_event_2",
      sequence: 2,
      kind: "message.delta",
      payload: { segment_id: "message_1", delta: " world" },
    })])
    assert.deepEqual(duplicate, {
      insertedSources: 0,
      insertedFrames: 0,
      sourceHighWatermark: 2,
    })

    await assert.rejects(
      store.agUi.ingest("tenant_a", "session_shared", [agentSource({
        id: "agent_event_2",
        sequence: 2,
        kind: "message.delta",
        payload: { segment_id: "message_1", delta: "mutated after commit" },
      })]),
      /AG-UI source identity conflict/u,
    )

    await assert.rejects(
      store.agUi.ingest("tenant_a", "session_shared", [agentSource({
        id: "agent_event_other",
        sequence: 2,
        kind: "message.delta",
        payload: { segment_id: "message_1", delta: "reused sequence" },
      })]),
      /AG-UI source identity conflict/u,
    )

    await assert.rejects(
      store.agUi.ingest("tenant_a", "session_shared", [agentSource({
        id: "agent_event_2",
        sequence: 3,
        kind: "message.delta",
        payload: { segment_id: "message_1", delta: "mutated" },
      })]),
      /AG-UI source identity conflict/u,
    )

    const unknown = await store.agUi.ingest("tenant_a", "session_shared", [agentSource({
      id: "agent_event_3",
      sequence: 3,
      kind: null,
      payload: { unsupported: true },
    })])
    assert.deepEqual(unknown, {
      insertedSources: 1,
      insertedFrames: 0,
      sourceHighWatermark: 3,
    })

    const isolatedTenant = await store.agUi.replay("tenant_b", "session_shared", null, 100)
    assert.equal(isolatedTenant.kind, "page")
    assert.deepEqual(isolatedTenant.frames, [])
    const foreignTenantCursor = await store.agUi.replay("tenant_b", "session_shared", initial.frames[0].cursor, 100)
    assert.deepEqual(foreignTenantCursor, { kind: "invalid_cursor" })
    const foreignSessionCursor = await store.agUi.replay("tenant_a", "session_other", initial.frames[0].cursor, 100)
    assert.deepEqual(foreignSessionCursor, { kind: "invalid_cursor" })

    const concurrentSource = agentSource({
      id: "agent_event_concurrent",
      sequence: 1,
      kind: "message.delta",
      payload: { segment_id: "message_concurrent", delta: "once" },
      sessionId: "session_concurrent",
    })
    const concurrent = await Promise.all([
      store.agUi.ingest("tenant_a", "session_concurrent", [concurrentSource]),
      store.agUi.ingest("tenant_a", "session_concurrent", [concurrentSource]),
    ])
    assert.equal(concurrent.reduce((count, result) => count + result.insertedSources, 0), 1)
    const concurrentReplay = await store.agUi.replay("tenant_a", "session_concurrent", null, 100)
    assert.equal(concurrentReplay.kind, "page")
    assert.deepEqual(concurrentReplay.frames.map((frame) => frame.publicSequence), [1, 2])

    const status = await store.agUi.status("tenant_a", "session_shared")
    assert.equal(status.sourceHighWatermark, 3)
    assert.equal(status.currentCursor, currentCursor)

    const rows = await pool.query(
      `SELECT
         (SELECT count(*)::integer FROM bff_agui_source_event WHERE tenant_id = $1 AND session_id = $2) AS source_count,
         (SELECT count(*)::integer FROM bff_agui_event WHERE tenant_id = $1 AND session_id = $2) AS frame_count,
         (SELECT array_agg(public_sequence ORDER BY public_sequence) FROM bff_agui_event WHERE tenant_id = $1 AND session_id = $2) AS sequences`,
      ["tenant_a", "session_shared"],
    )
    assert.deepEqual(rows.rows[0], { source_count: 3, frame_count: 3, sequences: ["1", "2", "3"] })

    const redisKeys = []
    for await (const keys of redis.scanIterator({ MATCH: "kokoro:bff:agui:*" })) redisKeys.push(...keys)
    assert.deepEqual(redisKeys, [])

    await store.close()
    store = new PostgresBffRepositories(postgresUrl, redisUrl)
    const afterRestart = await store.agUi.replay("tenant_a", "session_shared", initial.frames[0].cursor, 100)
    assert.equal(afterRestart.kind, "page")
    assert.deepEqual(afterRestart.frames.map((frame) => frame.publicSequence), [2, 3])
    assert.deepEqual(afterRestart.frames.map((frame) => frame.eventType), ["TEXT_MESSAGE_CONTENT", "TEXT_MESSAGE_CONTENT"])

    const resumedProjection = await store.agUi.ingest("tenant_a", "session_shared", [agentSource({
      id: "agent_event_4",
      sequence: 4,
      kind: "message.delta",
      payload: { segment_id: "message_1", delta: " after restart" },
    })])
    assert.deepEqual(resumedProjection, {
      insertedSources: 1,
      insertedFrames: 1,
      sourceHighWatermark: 4,
    })
    const resumedFrames = await store.agUi.replay("tenant_a", "session_shared", currentCursor, 100)
    assert.equal(resumedFrames.kind, "page")
    assert.deepEqual(resumedFrames.frames.map((frame) => frame.eventType), ["TEXT_MESSAGE_CONTENT"])
    assert.deepEqual(resumedFrames.frames.map((frame) => frame.publicSequence), [4])
  } finally {
    if (store !== null) await store.close().catch(() => undefined)
    if (redis.isOpen) await redis.quit().catch(() => undefined)
    await pool.end()
  }
})
