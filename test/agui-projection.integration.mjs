import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { connect as connectTcp, createServer as createTcpServer } from "node:net"
import { test } from "node:test"

import { Pool } from "pg"
import { createClient } from "redis"

import { PostgresBffRepositories } from "../dist/infrastructure/postgres/repositories.js"
import { PostgresBffDatabase } from "../dist/infrastructure/postgres/client.js"
import { PostgresAgUiProjectionRepository } from "../dist/infrastructure/postgres/agui-projection-repository.js"
import { AgUiProjectionService } from "../dist/application/agui/project-session-events.js"
import { AgUiProjectorRunner } from "../dist/application/agui/projector.js"
import { agentEventPage, mapAgentEvent } from "../dist/infrastructure/clients/agent/projection.js"

const postgresUrl = process.env.KOKORO_TEST_POSTGRES_URL
const redisUrl = process.env.KOKORO_TEST_REDIS_URL
const integrationTest = postgresUrl && redisUrl ? test : test.skip

const TABLES = [
  "bff_agui_cursor_tombstone",
  "bff_agui_event",
  "bff_agui_source_event",
  "bff_agui_stream",
  "bff_agent_cancellation_outbox",
  "bff_agent_dispatch_outbox",
  "bff_message",
  "bff_conversation",
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

integrationTest("reconciles the BFF assistant Message with the committed Agent source ledger", async () => {
  const pool = new Pool({ connectionString: postgresUrl, options: "-c search_path=kokoro_bff -c timezone=UTC" })
  let store = null
  try {
    await pool.query("CREATE SCHEMA IF NOT EXISTS kokoro_bff")
    await pool.query(`DROP TABLE IF EXISTS ${TABLES.join(", ")} CASCADE`)
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    store = new PostgresBffRepositories(postgresUrl, redisUrl)
    await store.ready()
    const sessionId = "session_assistant_reconcile"
    await pool.query(
      "INSERT INTO bff_conversation (conversation_id, tenant_id, owner_id, title) VALUES ($1, $2, $3, $4)",
      [sessionId, "tenant_reconcile", "owner_reconcile", "Reconcile assistant"],
    )
    const receipt = await store.services.chatTurns.submit({
      tenantId: "tenant_reconcile",
      conversationId: sessionId,
      subjectId: "owner_reconcile",
      actorId: "owner_reconcile",
      requestId: "request_reconcile",
      idempotencyKey: "turn_reconcile",
      content: "Answer the question",
    })
    assert.ok(receipt)
    await pool.query(
      "INSERT INTO bff_conversation (conversation_id, tenant_id, owner_id, title) VALUES ($1, $2, $3, $4)",
      ["foreign_session_reconcile", "foreign_tenant_reconcile", "foreign_owner_reconcile", "Foreign"],
    )
    await pool.query(
      `INSERT INTO bff_message (message_id, tenant_id, conversation_id, run_id, role, content, status, message_seq)
       VALUES ($1, $2, $3, $4, 'assistant', $5, 'pending', 1)`,
      ["agent_seg_a", "foreign_tenant_reconcile", "foreign_session_reconcile", receipt.run_id, "foreign content"],
    )
    const source = (sequence, kind, payload, runId = receipt.run_id) => agentSource({
      id: `reconcile_${sequence}`,
      sequence,
      kind,
      payload,
      sessionId,
      runId,
    })
    const assistant = async () => {
      const result = await pool.query(
        "SELECT content, status FROM bff_message WHERE tenant_id = $1 AND conversation_id = $2 AND message_id = $3",
        ["tenant_reconcile", sessionId, receipt.assistant_message_id],
      )
      return result.rows[0]
    }
    await store.agUi.ingest("tenant_reconcile", sessionId, [
      source(1, "run.created", { run_id: receipt.run_id }),
      source(2, "message.delta", { segment_id: "agent_seg_a", delta: "Draft" }),
      source(3, "message.completed", { segment_id: "agent_seg_a", content: "Draft final" }),
    ])
    assert.deepEqual(await assistant(), { content: "Draft final", status: "streaming" })
    const beforeMalformed = await store.agUi.status("tenant_reconcile", sessionId)
    for (const [eventType, payload] of [
      ["assistant.delta", { delta: 42 }],
      ["assistant.completed", { content: 42 }],
    ]) {
      assert.throws(() => mapAgentEvent({
        chat_event_id: `malformed_${eventType}`, session_id: sessionId,
        run_id: receipt.run_id, chat_message_id: "agent_seg_a", event_type: eventType,
        payload_json: JSON.stringify(payload), seq: 4, created_at: 4000,
      }), /Agent chat projection field (delta|content) is invalid/u)
    }
    assert.deepEqual(await assistant(), { content: "Draft final", status: "streaming" })
    assert.deepEqual(await store.agUi.status("tenant_reconcile", sessionId), beforeMalformed)

    await store.agUi.ingest("tenant_reconcile", sessionId, [
      source(4, "tool.invoked", { segment_id: "agent_seg_a", tool_id: "tool_1", name: "lookup", args: {} }),
      source(5, "tool.returned", { segment_id: "agent_seg_a", tool_id: "tool_1", result: "evidence" }),
      source(6, "message.delta", { segment_id: "agent_seg_b", delta: "Final " }),
      source(7, "message.delta", { segment_id: "agent_seg_b", delta: "answer" }),
      source(8, "message.completed", { segment_id: "agent_seg_b", content: "Final answer." }),
    ])
    assert.deepEqual(await assistant(), { content: "Final answer.", status: "streaming" })
    await store.agUi.ingest("tenant_reconcile", sessionId, [source(9, "run.completed", { status: "completed" })])
    assert.deepEqual(await assistant(), { content: "Final answer.", status: "completed" })
    const foreign = await pool.query("SELECT content, status FROM bff_message WHERE message_id = 'agent_seg_a'")
    assert.deepEqual(foreign.rows[0], { content: "foreign content", status: "pending" })
    const current = await store.agUi.status("tenant_reconcile", sessionId)
    assert.equal(current.sourceHighWatermark, 9)
    assert.match(current.currentCursor, /^agui_/u)
    const snapshot = await store.services.chat.snapshot("tenant_reconcile", "owner_reconcile", sessionId, undefined)
    assert.equal(snapshot.event_watermark, current.currentCursor)
    assert.deepEqual(snapshot.messages.map(({ role, content, status }) => ({ role, content, status })), [
      { role: "user", content: "Answer the question", status: "completed" },
      { role: "assistant", content: "Final answer.", status: "completed" },
    ])
    assert.equal(await store.services.chat.snapshot("tenant_reconcile", "foreign_owner", sessionId, undefined), null)
    const duplicate = await store.agUi.ingest("tenant_reconcile", sessionId, [source(7, "message.delta", { segment_id: "agent_seg_b", delta: "answer" })])
    assert.equal(duplicate.insertedSources, 0)
    assert.deepEqual(await assistant(), { content: "Final answer.", status: "completed" })

    const failedTurn = await store.services.chatTurns.submit({
      tenantId: "tenant_reconcile", conversationId: sessionId,
      subjectId: "owner_reconcile", actorId: "owner_reconcile",
      requestId: "request_failed", idempotencyKey: "turn_failed", content: "Try again",
    })
    assert.ok(failedTurn)
    await store.agUi.ingest("tenant_reconcile", sessionId, [source(10, "message.delta", { segment_id: "late_old", delta: "late" })])
    assert.deepEqual(await assistant(), { content: "Final answer.", status: "completed" })
    const failedAssistant = async () => {
      const result = await pool.query("SELECT content, status FROM bff_message WHERE message_id = $1", [failedTurn.assistant_message_id])
      return result.rows[0]
    }
    assert.deepEqual(await failedAssistant(), { content: "", status: "pending" })
    await store.agUi.ingest("tenant_reconcile", sessionId, [
      source(11, "message.delta", { segment_id: "failed_seg", delta: "Partial" }, failedTurn.run_id),
      source(12, "run.failed", { code: "agent_error", message: "failed" }, failedTurn.run_id),
    ])
    assert.deepEqual(await failedAssistant(), { content: "Partial", status: "failed" })
    await store.agUi.ingest("tenant_reconcile", sessionId, [source(13, "message.delta", { segment_id: "late_failed", delta: "wrong" }, failedTurn.run_id)])
    assert.deepEqual(await failedAssistant(), { content: "Partial", status: "failed" })

    const cancelledTurn = await store.services.chatTurns.submit({
      tenantId: "tenant_reconcile", conversationId: sessionId,
      subjectId: "owner_reconcile", actorId: "owner_reconcile",
      requestId: "request_cancelled", idempotencyKey: "turn_cancelled", content: "Cancel this",
    })
    assert.ok(cancelledTurn)
    await store.agUi.ingest("tenant_reconcile", sessionId, [
      source(14, "message.delta", { segment_id: "cancel_seg", delta: "Partial cancel" }, cancelledTurn.run_id),
      source(15, "run.completed", { status: "cancelled" }, cancelledTurn.run_id),
    ])
    const cancelledAssistant = await pool.query("SELECT content, status FROM bff_message WHERE message_id = $1", [cancelledTurn.assistant_message_id])
    assert.deepEqual(cancelledAssistant.rows[0], { content: "Partial cancel", status: "failed" })

    const dispatchFailedTurn = await store.services.chatTurns.submit({
      tenantId: "tenant_reconcile", conversationId: sessionId,
      subjectId: "owner_reconcile", actorId: "owner_reconcile",
      requestId: "request_dispatch_failed", idempotencyKey: "turn_dispatch_failed", content: "Do not revive",
    })
    assert.ok(dispatchFailedTurn)
    await pool.query("UPDATE bff_agent_dispatch_outbox SET status = 'failed', completed_at = CURRENT_TIMESTAMP(3) WHERE tenant_id = $1 AND run_id = $2", ["tenant_reconcile", dispatchFailedTurn.run_id])
    await pool.query("UPDATE bff_message SET status = 'failed' WHERE message_id = $1", [dispatchFailedTurn.assistant_message_id])
    await store.agUi.ingest("tenant_reconcile", sessionId, [
      source(16, "message.delta", { segment_id: "after_dispatch_failure", delta: "wrong" }, dispatchFailedTurn.run_id),
      source(17, "run.completed", { status: "completed" }, dispatchFailedTurn.run_id),
    ])
    const dispatchFailedAssistant = await pool.query("SELECT content, status FROM bff_message WHERE message_id = $1", [dispatchFailedTurn.assistant_message_id])
    assert.deepEqual(dispatchFailedAssistant.rows[0], { content: "", status: "failed" })

    const rollbackTurn = await store.services.chatTurns.submit({
      tenantId: "tenant_reconcile", conversationId: sessionId,
      subjectId: "owner_reconcile", actorId: "owner_reconcile",
      requestId: "request_rollback", idempotencyKey: "turn_rollback", content: "Rollback on frame failure",
    })
    assert.ok(rollbackTurn)
    await pool.query("ALTER TABLE bff_agui_event ADD CONSTRAINT ck_test_reject_projection_frame CHECK (event_type <> 'TEXT_MESSAGE_CONTENT') NOT VALID")
    try {
      await assert.rejects(store.agUi.ingest("tenant_reconcile", sessionId, [
        source(18, "message.delta", { segment_id: "rollback_seg", delta: "must not commit" }, rollbackTurn.run_id),
      ]), { code: "23514" })
      const unchangedAssistant = await pool.query("SELECT content, status FROM bff_message WHERE message_id = $1", [rollbackTurn.assistant_message_id])
      assert.deepEqual(unchangedAssistant.rows[0], { content: "", status: "pending" })
      assert.equal((await store.agUi.status("tenant_reconcile", sessionId)).sourceHighWatermark, 17)
      const missingSource = await pool.query("SELECT 1 FROM bff_agui_source_event WHERE tenant_id = $1 AND session_id = $2 AND source_sequence = 18", ["tenant_reconcile", sessionId])
      assert.equal(missingSource.rowCount, 0)
    } finally {
      await pool.query("ALTER TABLE bff_agui_event DROP CONSTRAINT ck_test_reject_projection_frame")
    }
  } finally {
    if (store !== null) await store.close()
    await pool.end()
  }
})

integrationTest("replays an Agent draft, tool, and empty final completion into the durable BFF assistant snapshot", async () => {
  const pool = new Pool({ connectionString: postgresUrl, options: "-c search_path=kokoro_bff -c timezone=UTC" })
  let store = null
  let reopened = null
  try {
    await pool.query(`DROP TABLE IF EXISTS ${TABLES.join(", ")} CASCADE`)
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    store = new PostgresBffRepositories(postgresUrl, redisUrl)
    await store.ready()
    const tenantId = "tenant_empty_final"
    const subjectId = "owner_empty_final"
    const sessionId = "session_empty_final"
    await pool.query(
      "INSERT INTO bff_conversation (conversation_id, tenant_id, owner_id, title) VALUES ($1, $2, $3, 'Empty final')",
      [sessionId, tenantId, subjectId],
    )
    const turn = await store.services.chatTurns.submit({
      tenantId, conversationId: sessionId, subjectId, actorId: subjectId,
      requestId: "request_empty_final", idempotencyKey: "turn_empty_final", content: "Use the tool",
    })
    assert.ok(turn)
    const wire = (seq, eventType, payload, chatMessageId = null) => ({
      chat_event_id: `empty_source_${seq}`, session_id: sessionId, run_id: turn.run_id,
      source_index: seq - 1, event_type: eventType, payload_json: JSON.stringify(payload), seq,
      created_at: seq * 1000, chat_message_id: chatMessageId,
    })
    // This is the Agent owner's published v1 replay shape, including a completed
    // final segment with no preceding delta and authoritative content="".
    const page = agentEventPage({
      events: [
        wire(1, "run.started", { status: "running" }),
        wire(2, "assistant.delta", { delta: "draft" }, "draft-segment"),
        wire(3, "assistant.completed", { content: "draft" }, "draft-segment"),
        wire(4, "activity", { activity: "tool", status: "started", tool_id: "tool-1", segment_id: "draft-segment", name: "lookup" }),
        wire(5, "activity", { activity: "tool", status: "completed", tool_id: "tool-1", segment_id: "draft-segment", name: "lookup", result: "done" }),
        wire(6, "assistant.completed", { content: "" }, "final-segment"),
        wire(7, "run.completed", { status: "completed", token_usage: null }),
      ],
      next_seq: 7,
      watermark: 7,
    }, sessionId, 0, 20)
    assert.ok(page)
    const sources = page.events.map((event) => ({
      sourceEventId: event.chat_event_id,
      sourceSequence: event.seq,
      sourceOccurredAt: new Date(event.created_at).toISOString(),
      sourcePayload: event,
      event: mapAgentEvent(event),
    }))
    const assistant = async () => {
      const result = await pool.query("SELECT content, status FROM bff_message WHERE message_id = $1", [turn.assistant_message_id])
      return result.rows[0]
    }
    await store.agUi.ingest(tenantId, sessionId, sources.slice(0, 3))
    assert.deepEqual(await assistant(), { content: "draft", status: "streaming" })
    await store.agUi.ingest(tenantId, sessionId, sources.slice(3, 6))
    assert.deepEqual(await assistant(), { content: "", status: "streaming" })
    await store.agUi.ingest(tenantId, sessionId, sources.slice(6))
    assert.deepEqual(await assistant(), { content: "", status: "completed" })

    await store.close()
    store = null
    reopened = new PostgresBffRepositories(postgresUrl, redisUrl)
    await reopened.ready()
    const replay = await reopened.agUi.replay(tenantId, sessionId, null, 100)
    assert.equal(replay.kind, "page")
    assert.deepEqual(replay.frames.map((frame) => frame.eventType), [
      "RUN_STARTED", "TEXT_MESSAGE_START", "TEXT_MESSAGE_CONTENT", "TEXT_MESSAGE_END",
      "TOOL_CALL_START", "TOOL_CALL_ARGS", "TOOL_CALL_END", "TOOL_CALL_RESULT",
      "TEXT_MESSAGE_END", "RUN_FINISHED",
    ])
    const watermark = replay.frames.at(-1).cursor
    const snapshot = await reopened.services.chat.snapshot(tenantId, subjectId, sessionId, undefined)
    assert.equal(snapshot.event_watermark, watermark)
    assert.deepEqual(snapshot.messages.at(-1), {
      message_id: turn.assistant_message_id,
      role: "assistant",
      content: "",
      status: "completed",
      created_at: snapshot.messages.at(-1).created_at,
      run_id: turn.run_id,
    })
    const duplicate = await reopened.agUi.ingest(tenantId, sessionId, sources)
    assert.equal(duplicate.insertedSources, 0)
    assert.deepEqual(await assistant(), { content: "", status: "completed" })
    assert.equal((await reopened.services.chat.snapshot(tenantId, subjectId, sessionId, undefined)).event_watermark, watermark)
  } finally {
    if (store !== null) await store.close()
    if (reopened !== null) await reopened.close()
    await pool.end()
  }
})

integrationTest("rejects a current-run source when its active Conversation lacks the durable assistant binding", async () => {
  const pool = new Pool({ connectionString: postgresUrl, options: "-c search_path=kokoro_bff -c timezone=UTC" })
  let store = null
  try {
    await pool.query(`DROP TABLE IF EXISTS ${TABLES.join(", ")} CASCADE`)
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    store = new PostgresBffRepositories(postgresUrl, redisUrl)
    await store.ready()
    for (const damage of ["missing_message", "missing_outbox", "wrong_subject", "wrong_message_run"]) {
      const sessionId = `session_binding_${damage}`
      await pool.query(
        "INSERT INTO bff_conversation (conversation_id, tenant_id, owner_id, title) VALUES ($1, $2, $3, 'Binding test')",
        [sessionId, "tenant_binding", "owner_binding"],
      )
      const receipt = await store.services.chatTurns.submit({
        tenantId: "tenant_binding", conversationId: sessionId,
        subjectId: "owner_binding", actorId: "owner_binding",
        requestId: `request_${damage}`, idempotencyKey: `turn_${damage}`, content: "Check binding",
      })
      assert.ok(receipt)
      if (damage === "missing_message") {
        await pool.query("DELETE FROM bff_message WHERE message_id = $1", [receipt.assistant_message_id])
      } else if (damage === "missing_outbox") {
        await pool.query("DELETE FROM bff_agent_dispatch_outbox WHERE tenant_id = $1 AND run_id = $2", ["tenant_binding", receipt.run_id])
      } else if (damage === "wrong_subject") {
        await pool.query("UPDATE bff_agent_dispatch_outbox SET subject_id = 'intruder' WHERE tenant_id = $1 AND run_id = $2", ["tenant_binding", receipt.run_id])
      } else {
        await pool.query("UPDATE bff_message SET run_id = 'unrelated_run' WHERE message_id = $1", [receipt.assistant_message_id])
      }
      await assert.rejects(store.agUi.ingest("tenant_binding", sessionId, [agentSource({
        id: `source_${damage}`, sequence: 1, kind: "message.delta",
        payload: { segment_id: `segment_${damage}`, delta: "must roll back" },
        sessionId, runId: receipt.run_id,
      })]), /AGUI_ASSISTANT_BINDING_MISSING/u)
      assert.equal((await store.agUi.status("tenant_binding", sessionId)).sourceHighWatermark, 0)
      const source = await pool.query("SELECT 1 FROM bff_agui_source_event WHERE tenant_id = $1 AND session_id = $2", ["tenant_binding", sessionId])
      assert.equal(source.rowCount, 0)
    }
  } finally {
    if (store !== null) await store.close()
    await pool.end()
  }
})

integrationTest("loads the latest 100 Message facts in stable chronological order with the same AG-UI watermark", async () => {
  const pool = new Pool({ connectionString: postgresUrl, options: "-c search_path=kokoro_bff -c timezone=UTC" })
  let store = null
  try {
    await pool.query(`DROP TABLE IF EXISTS ${TABLES.join(", ")} CASCADE`)
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    store = new PostgresBffRepositories(postgresUrl, redisUrl)
    await store.ready()
    const sessionId = "session_latest_messages"
    await pool.query(
      "INSERT INTO bff_conversation (conversation_id, tenant_id, owner_id, title) VALUES ($1, $2, $3, 'Long chat')",
      [sessionId, "tenant_latest", "owner_latest"],
    )
    await pool.query(
      `INSERT INTO bff_message (message_id, tenant_id, conversation_id, role, content, status, message_seq)
       SELECT 'message_' || seq::text, 'tenant_latest', $1,
              CASE WHEN seq = 121 THEN 'assistant' ELSE 'user' END,
              CASE WHEN seq = 121 THEN 'Latest completed answer' ELSE 'Earlier message ' || seq::text END,
              'completed', seq
         FROM generate_series(1, 121) AS seq`,
      [sessionId],
    )
    await store.agUi.ingest("tenant_latest", sessionId, [agentSource({
      id: "latest_run", sequence: 1, kind: "run.created", payload: {}, sessionId, runId: "run_latest",
    })])
    const head = await store.agUi.status("tenant_latest", sessionId)
    const snapshot = await store.services.chat.snapshot("tenant_latest", "owner_latest", sessionId, undefined)
    assert.ok(snapshot)
    assert.equal(snapshot.messages.length, 100)
    assert.equal(snapshot.messages[0].message_id, "message_22")
    assert.equal(snapshot.messages.at(-1).message_id, "message_121")
    assert.equal(snapshot.messages.at(-1).role, "assistant")
    assert.equal(snapshot.messages.at(-1).content, "Latest completed answer")
    assert.equal(snapshot.messages.at(-1).status, "completed")
    assert.equal(snapshot.event_watermark, head.currentCursor)
  } finally {
    if (store !== null) await store.close()
    await pool.end()
  }
})

async function redisProxy(targetUrl) {
  const target = new URL(targetUrl)
  const sockets = new Set()
  const server = createTcpServer((client) => {
    const upstream = connectTcp(Number(target.port), target.hostname)
    sockets.add(client)
    sockets.add(upstream)
    const forget = (socket) => () => sockets.delete(socket)
    client.once("close", forget(client))
    upstream.once("close", forget(upstream))
    client.pipe(upstream).pipe(client)
  })
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  if (address === null || typeof address === "string") throw new Error("Redis proxy did not bind")
  return {
    url: `redis://127.0.0.1:${address.port}${target.pathname}`,
    disconnect: async () => {
      for (const socket of sockets) socket.destroy()
      await new Promise((resolve) => server.close(resolve))
    },
  }
}

integrationTest("keeps durable AG-UI replay lossless, idempotent, tenant-scoped, and independent of Redis state", async () => {
  const pool = new Pool({ connectionString: postgresUrl, options: "-c search_path=kokoro_bff -c timezone=UTC" })
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

integrationTest("keeps replay page boundaries and terminal state tied to the latest run identity", async () => {
  const pool = new Pool({ connectionString: postgresUrl, options: "-c search_path=kokoro_bff -c timezone=UTC" })
  let store = null
  try {
    await pool.query(`DROP TABLE IF EXISTS ${TABLES.join(", ")} CASCADE`)
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    store = new PostgresBffRepositories(postgresUrl, redisUrl)

    await store.agUi.ingest("tenant_a", "session_runs", [
      agentSource({ id: "run_1_started", sequence: 1, kind: "run.created", payload: { run_id: "run_1" }, sessionId: "session_runs", runId: "run_1" }),
      agentSource({ id: "run_1_finished", sequence: 2, kind: "run.completed", payload: { status: "completed" }, sessionId: "session_runs", runId: "run_1" }),
      agentSource({ id: "run_2_started", sequence: 3, kind: "run.created", payload: { run_id: "run_2" }, sessionId: "session_runs", runId: "run_2" }),
    ])

    const pageAtOldTerminal = await store.agUi.replay("tenant_a", "session_runs", null, 2)
    assert.equal(pageAtOldTerminal.kind, "page")
    assert.deepEqual(pageAtOldTerminal.frames.map((frame) => frame.eventType), ["RUN_STARTED", "RUN_FINISHED"])
    assert.equal(pageAtOldTerminal.atHead, false)
    assert.equal(pageAtOldTerminal.terminalRunId, null)

    const activeHead = await store.agUi.replay("tenant_a", "session_runs", pageAtOldTerminal.frames.at(-1).cursor, 2)
    assert.equal(activeHead.kind, "page")
    assert.deepEqual(activeHead.frames.map((frame) => frame.eventType), ["RUN_STARTED"])
    assert.equal(activeHead.atHead, true)
    assert.equal(activeHead.terminalRunId, null)

    await store.agUi.ingest("tenant_a", "session_runs", [
      agentSource({ id: "run_2_finished", sequence: 4, kind: "run.completed", payload: { status: "completed" }, sessionId: "session_runs", runId: "run_2" }),
    ])
    const terminalHead = await store.agUi.replay("tenant_a", "session_runs", activeHead.frames.at(-1).cursor, 1)
    assert.equal(terminalHead.kind, "page")
    assert.equal(terminalHead.atHead, true)
    assert.equal(terminalHead.terminalRunId, "run_2")

    const byteBounded = await store.agUi.replay("tenant_a", "session_runs", null, 100, 1)
    assert.equal(byteBounded.kind, "page")
    assert.equal(byteBounded.frames.length, 1)
    assert.equal(byteBounded.atHead, false)
  } finally {
    if (store !== null) await store.close().catch(() => undefined)
    await pool.end()
  }
})

integrationTest("returns a self-consistent replay snapshot while a new run is appended", async () => {
  const pool = new Pool({ connectionString: postgresUrl, options: "-c search_path=kokoro_bff -c timezone=UTC" })
  let store = null
  try {
    await pool.query(`DROP TABLE IF EXISTS ${TABLES.join(", ")} CASCADE`)
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    store = new PostgresBffRepositories(postgresUrl, redisUrl)
    await store.agUi.ingest("tenant_a", "session_append", [
      agentSource({ id: "old_started", sequence: 1, kind: "run.created", payload: { run_id: "run_old" }, sessionId: "session_append", runId: "run_old" }),
      agentSource({ id: "old_finished", sequence: 2, kind: "run.completed", payload: { status: "completed" }, sessionId: "session_append", runId: "run_old" }),
    ])

    for (let sequence = 3; sequence < 23; sequence += 1) {
      const runId = `run_${sequence}`
      const [page] = await Promise.all([
        store.agUi.replay("tenant_a", "session_append", null, 100),
        store.agUi.ingest("tenant_a", "session_append", [
          agentSource({ id: `started_${sequence}`, sequence, kind: "run.created", payload: { run_id: runId }, sessionId: "session_append", runId }),
        ]),
      ])
      assert.equal(page.kind, "page")
      const visibleRunIds = page.frames
        .filter((frame) => frame.eventType === "RUN_STARTED")
        .map((frame) => frame.payload.metadata.kokoro.run_id)
      const latestVisibleRun = visibleRunIds.at(-1)
      if (page.atHead && latestVisibleRun !== "run_old") assert.equal(page.terminalRunId, null)
    }
  } finally {
    if (store !== null) await store.close().catch(() => undefined)
    await pool.end()
  }
})

integrationTest("replays a committed projection immediately when Redis was never reachable", async () => {
  const pool = new Pool({ connectionString: postgresUrl, options: "-c search_path=kokoro_bff -c timezone=UTC" })
  let database = null
  try {
    await pool.query(`DROP TABLE IF EXISTS ${TABLES.join(", ")} CASCADE`)
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    database = new PostgresBffDatabase(postgresUrl, "redis://127.0.0.1:1/8")
    const projection = new AgUiProjectionService(new PostgresAgUiProjectionRepository(database))

    const outcome = await Promise.race([
      projection.ingest("tenant_a", "session_redis_down", [agentSource({
        id: "redis_down_source",
        sequence: 1,
        kind: "message.delta",
        payload: { segment_id: "message_redis_down", delta: "durable" },
        sessionId: "session_redis_down",
      })]).then(() => "committed"),
      new Promise((resolve) => setTimeout(() => resolve("blocked"), 500)),
    ])
    assert.equal(outcome, "committed")

    const replay = await projection.replay("tenant_a", "session_redis_down", null, 100)
    assert.equal(replay.kind, "page")
    assert.deepEqual(replay.frames.map((frame) => frame.eventType), ["TEXT_MESSAGE_START", "TEXT_MESSAGE_CONTENT"])
  } finally {
    if (database !== null) {
      if (database.redis.isOpen) database.redis.destroy()
      await database.pool.end().catch(() => undefined)
    }
    await pool.end()
  }
})

integrationTest("replays a committed projection immediately after the Redis notification connection drops", async () => {
  const pool = new Pool({ connectionString: postgresUrl, options: "-c search_path=kokoro_bff -c timezone=UTC" })
  const proxy = await redisProxy(redisUrl)
  let database = null
  try {
    await pool.query(`DROP TABLE IF EXISTS ${TABLES.join(", ")} CASCADE`)
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    database = new PostgresBffDatabase(postgresUrl, proxy.url)
    await database.ready()
    await proxy.disconnect()
    for (let attempt = 0; attempt < 50 && database.redis.isReady; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    assert.equal(database.redis.isReady, false)

    const projection = new AgUiProjectionService(new PostgresAgUiProjectionRepository(database))
    const outcome = await Promise.race([
      projection.ingest("tenant_a", "session_redis_drop", [agentSource({
        id: "redis_drop_source",
        sequence: 1,
        kind: "message.delta",
        payload: { segment_id: "message_redis_drop", delta: "durable" },
        sessionId: "session_redis_drop",
      })]).then(() => "committed"),
      new Promise((resolve) => setTimeout(() => resolve("blocked"), 500)),
    ])
    assert.equal(outcome, "committed")
    const replay = await projection.replay("tenant_a", "session_redis_drop", null, 100)
    assert.equal(replay.kind, "page")
    assert.deepEqual(replay.frames.map((frame) => frame.eventType), ["TEXT_MESSAGE_START", "TEXT_MESSAGE_CONTENT"])
  } finally {
    if (database !== null) await database.close().catch(() => undefined)
    await proxy.disconnect().catch(() => undefined)
    await pool.end()
  }
})

integrationTest("claims AG-UI consumers with fencing and never commits through a superseded lease", async () => {
  const pool = new Pool({ connectionString: postgresUrl, options: "-c search_path=kokoro_bff -c timezone=UTC" })
  let store = null
  try {
    await pool.query(`DROP TABLE IF EXISTS ${TABLES.join(", ")} CASCADE`)
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    await pool.query(
      `INSERT INTO bff_conversation (conversation_id, tenant_id, owner_id, title)
       VALUES ($1, $2, $3, $4)`,
      ["session_fenced", "tenant_a", "user_a", "Fenced projection"],
    )
    await pool.query(
      `INSERT INTO bff_message
         (message_id, tenant_id, conversation_id, run_id, role, content, status, message_seq)
       VALUES ($1, $2, $3, $4, 'user', $5, 'completed', 1)`,
      ["message_fenced", "tenant_a", "session_fenced", "run_fenced", "start"],
    )
    store = new PostgresBffRepositories(postgresUrl, redisUrl)

    assert.equal(await store.agUiConsumers.seedConsumers(10), 1)
    assert.equal(await store.agUiConsumers.seedConsumers(10), 0)
    const now = new Date()
    const leaseUntil = new Date(now.getTime() + 60_000).toISOString()
    const firstClaims = await store.agUiConsumers.claimConsumers({
      workerId: "worker_a",
      now: now.toISOString(),
      leaseUntil,
      limit: 10,
    })
    assert.equal(firstClaims.length, 1)
    assert.equal(firstClaims[0].failureCount, 0)
    assert.deepEqual(await store.agUiConsumers.claimConsumers({
      workerId: "worker_b",
      now: now.toISOString(),
      leaseUntil,
      limit: 10,
    }), [])
    const firstLease = firstClaims[0]
    await store.agUi.ingest("tenant_a", "session_fenced", [agentSource({
      id: "fenced_source_1",
      sequence: 1,
      kind: "run.created",
      payload: { run_id: "run_fenced" },
      sessionId: "session_fenced",
      runId: "run_fenced",
    })], firstLease)
    assert.equal(await store.agUiConsumers.markConsumerRetryable(
      firstLease,
      now.toISOString(),
      "source_gap",
      now.toISOString(),
    ), true)

    const secondClaims = await store.agUiConsumers.claimConsumers({
      workerId: "worker_b",
      now: new Date(now.getTime() + 1).toISOString(),
      leaseUntil: new Date(now.getTime() + 60_001).toISOString(),
      limit: 10,
    })
    assert.equal(secondClaims.length, 1)
    assert.ok(secondClaims[0].fence > firstLease.fence)
    assert.equal(secondClaims[0].failureCount, 1)
    await assert.rejects(
      store.agUi.ingest("tenant_a", "session_fenced", [agentSource({
        id: "fenced_source_2",
        sequence: 2,
        kind: "run.completed",
        payload: { status: "completed" },
        sessionId: "session_fenced",
        runId: "run_fenced",
      })], firstLease),
      /consumer lease was lost/u,
    )
    const committed = await store.agUi.ingest("tenant_a", "session_fenced", [agentSource({
      id: "fenced_source_2",
      sequence: 2,
      kind: "run.completed",
      payload: { status: "completed" },
      sessionId: "session_fenced",
      runId: "run_fenced",
    })], secondClaims[0])
    assert.equal(committed.sourceHighWatermark, 2)
    const settledAt = new Date(now.getTime() + 2)
    assert.equal(await store.agUiConsumers.markConsumerProgress(
      secondClaims[0],
      settledAt.toISOString(),
      settledAt.toISOString(),
    ), true)
    const recovered = await store.agUiConsumers.claimConsumers({
      workerId: "worker_c",
      now: new Date(now.getTime() + 3).toISOString(),
      leaseUntil: new Date(now.getTime() + 60_003).toISOString(),
      limit: 10,
    })
    assert.equal(recovered.length, 1)
    assert.equal(recovered[0].failureCount, 0)
  } finally {
    if (store !== null) await store.close().catch(() => undefined)
    await pool.end()
  }
})

integrationTest("expires reclaimed AG-UI cursors while retaining the latest run from RUN_STARTED through head", async () => {
  const pool = new Pool({ connectionString: postgresUrl, options: "-c search_path=kokoro_bff -c timezone=UTC" })
  let store = null
  try {
    await pool.query(`DROP TABLE IF EXISTS ${TABLES.join(", ")} CASCADE`)
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    store = new PostgresBffRepositories(postgresUrl, redisUrl)
    await store.agUi.ingest("tenant_a", "session_gc", [
      agentSource({ id: "gc_1", sequence: 1, kind: "run.created", payload: { run_id: "run_1" }, sessionId: "session_gc", runId: "run_1" }),
      agentSource({ id: "gc_2", sequence: 2, kind: "run.completed", payload: { status: "completed" }, sessionId: "session_gc", runId: "run_1" }),
      agentSource({ id: "gc_3", sequence: 3, kind: "run.created", payload: { run_id: "run_2" }, sessionId: "session_gc", runId: "run_2" }),
      agentSource({ id: "gc_4", sequence: 4, kind: "message.delta", payload: { segment_id: "message_2", delta: "hello" }, sessionId: "session_gc", runId: "run_2" }),
      agentSource({ id: "gc_5", sequence: 5, kind: "message.completed", payload: { segment_id: "message_2", content: "hello" }, sessionId: "session_gc", runId: "run_2" }),
      agentSource({ id: "gc_6", sequence: 6, kind: "run.completed", payload: { status: "completed" }, sessionId: "session_gc", runId: "run_2" }),
    ])
    const before = await store.agUi.replay("tenant_a", "session_gc", null, 100)
    assert.equal(before.kind, "page")
    assert.equal(before.frames.length, 7)
    const expiredCursor = before.frames[0].cursor
    const headCursor = before.frames.at(-1).cursor
    await pool.query(
      `UPDATE bff_agui_event
          SET recorded_at = CURRENT_TIMESTAMP(3) - INTERVAL '2 days'
        WHERE tenant_id = $1 AND session_id = $2`,
      ["tenant_a", "session_gc"],
    )

    const collected = await store.agUiConsumers.collectGarbage({
      now: new Date().toISOString(),
      retentionMs: 1,
      tombstoneRetentionMs: 24 * 60 * 60 * 1000,
      batchSize: 100,
    })
    assert.equal(collected.framesDeleted, 2)
    assert.equal(collected.tombstonesInserted, 2)
    assert.deepEqual(await store.agUi.replay("tenant_a", "session_gc", expiredCursor, 100), { kind: "expired_cursor" })
    const retained = await store.agUi.replay("tenant_a", "session_gc", null, 100)
    assert.equal(retained.kind, "page")
    assert.deepEqual(retained.frames.map((frame) => frame.eventType), [
      "RUN_STARTED",
      "TEXT_MESSAGE_START",
      "TEXT_MESSAGE_CONTENT",
      "TEXT_MESSAGE_END",
      "RUN_FINISHED",
    ])
    assert.equal(retained.frames.at(-1).cursor, headCursor)
    assert.equal((await store.agUi.status("tenant_a", "session_gc")).retentionFloorSequence, 2)

    await store.agUiConsumers.collectGarbage({
      now: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
      retentionMs: 1,
      tombstoneRetentionMs: 24 * 60 * 60 * 1000,
      batchSize: 100,
    })
    assert.deepEqual(await store.agUi.replay("tenant_a", "session_gc", expiredCursor, 100), { kind: "invalid_cursor" })
  } finally {
    if (store !== null) await store.close().catch(() => undefined)
    await pool.end()
  }
})

integrationTest("skips GC when interleaved runs would leave an event without its RUN_STARTED boundary", async () => {
  const pool = new Pool({ connectionString: postgresUrl, options: "-c search_path=kokoro_bff -c timezone=UTC" })
  let store = null
  try {
    await pool.query(`DROP TABLE IF EXISTS ${TABLES.join(", ")} CASCADE`)
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    store = new PostgresBffRepositories(postgresUrl, redisUrl)
    await store.agUi.ingest("tenant_a", "session_interleaved_gc", [
      agentSource({ id: "run_a_started", sequence: 1, kind: "run.created", payload: { run_id: "run_a" }, sessionId: "session_interleaved_gc", runId: "run_a" }),
      agentSource({ id: "run_b_started", sequence: 2, kind: "run.created", payload: { run_id: "run_b" }, sessionId: "session_interleaved_gc", runId: "run_b" }),
      agentSource({ id: "run_a_finished", sequence: 3, kind: "run.completed", payload: { status: "completed" }, sessionId: "session_interleaved_gc", runId: "run_a" }),
      agentSource({ id: "run_b_finished", sequence: 4, kind: "run.completed", payload: { status: "completed" }, sessionId: "session_interleaved_gc", runId: "run_b" }),
    ])
    await pool.query(
      `UPDATE bff_agui_event
          SET recorded_at = CURRENT_TIMESTAMP(3) - INTERVAL '2 days'
        WHERE tenant_id = $1 AND session_id = $2`,
      ["tenant_a", "session_interleaved_gc"],
    )

    const collected = await store.agUiConsumers.collectGarbage({
      now: new Date().toISOString(),
      retentionMs: 1,
      tombstoneRetentionMs: 24 * 60 * 60 * 1000,
      batchSize: 100,
    })

    assert.equal(collected.framesDeleted, 0)
    const retained = await store.agUi.replay("tenant_a", "session_interleaved_gc", null, 100)
    assert.equal(retained.kind, "page")
    assert.deepEqual(retained.frames.map((frame) => frame.eventType), [
      "RUN_STARTED",
      "RUN_STARTED",
      "RUN_FINISHED",
      "RUN_FINISHED",
    ])
  } finally {
    if (store !== null) await store.close().catch(() => undefined)
    await pool.end()
  }
})

integrationTest("garbage collection skips ineligible streams instead of starving eligible later streams", async () => {
  const pool = new Pool({ connectionString: postgresUrl, options: "-c search_path=kokoro_bff -c timezone=UTC" })
  let store = null
  try {
    await pool.query(`DROP TABLE IF EXISTS ${TABLES.join(", ")} CASCADE`)
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    await pool.query(
      `INSERT INTO bff_agui_stream (tenant_id, session_id, updated_at)
       SELECT 'tenant_a', 'inert_' || lpad(series::text, 3, '0'), CURRENT_TIMESTAMP(3) - INTERVAL '10 days'
         FROM generate_series(1, 100) AS series`,
    )
    store = new PostgresBffRepositories(postgresUrl, redisUrl)
    await store.agUi.ingest("tenant_a", "session_gc_later", [
      agentSource({ id: "gc_later_1", sequence: 1, kind: "run.created", payload: { run_id: "run_1" }, sessionId: "session_gc_later", runId: "run_1" }),
      agentSource({ id: "gc_later_2", sequence: 2, kind: "run.completed", payload: { status: "completed" }, sessionId: "session_gc_later", runId: "run_1" }),
      agentSource({ id: "gc_later_3", sequence: 3, kind: "run.created", payload: { run_id: "run_2" }, sessionId: "session_gc_later", runId: "run_2" }),
    ])
    await pool.query(
      `UPDATE bff_agui_event
          SET recorded_at = CURRENT_TIMESTAMP(3) - INTERVAL '2 days'
        WHERE tenant_id = $1 AND session_id = $2`,
      ["tenant_a", "session_gc_later"],
    )

    const collected = await store.agUiConsumers.collectGarbage({
      now: new Date().toISOString(),
      retentionMs: 1,
      tombstoneRetentionMs: 24 * 60 * 60 * 1000,
      batchSize: 100,
    })

    assert.equal(collected.streamsScanned, 1)
    assert.equal(collected.framesDeleted, 2)
  } finally {
    if (store !== null) await store.close().catch(() => undefined)
    await pool.end()
  }
})

integrationTest("consumer claims stop when the owning BFF conversation is deleted", async () => {
  const pool = new Pool({ connectionString: postgresUrl, options: "-c search_path=kokoro_bff -c timezone=UTC" })
  let store = null
  try {
    await pool.query(`DROP TABLE IF EXISTS ${TABLES.join(", ")} CASCADE`)
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    await pool.query(
      `INSERT INTO bff_conversation (conversation_id, tenant_id, owner_id, title)
       VALUES ('session_deleted', 'tenant_a', 'user_a', 'Deleted conversation')`,
    )
    store = new PostgresBffRepositories(postgresUrl, redisUrl)
    await store.agUiConsumers.registerConsumer("tenant_a", "session_deleted", "user_a")
    const now = new Date()
    const activeClaims = await store.agUiConsumers.claimConsumers({
      workerId: "worker_before_delete",
      now: now.toISOString(),
      leaseUntil: new Date(now.getTime() + 60_000).toISOString(),
      limit: 10,
    })
    assert.equal(activeClaims.length, 1)
    assert.equal(await store.services.chat.deleteConversation("tenant_a", "user_a", "session_deleted", "delete-conversation-integration"), true)
    await assert.rejects(
      store.agUi.ingest("tenant_a", "session_deleted", [agentSource({
        id: "deleted_source_1",
        sequence: 1,
        kind: "run.created",
        payload: { run_id: "run_deleted" },
        sessionId: "session_deleted",
        runId: "run_deleted",
      })], activeClaims[0]),
      /consumer lease was lost/u,
    )
    const claims = await store.agUiConsumers.claimConsumers({
      workerId: "worker_deleted",
      now: new Date(now.getTime() + 1).toISOString(),
      leaseUntil: new Date(now.getTime() + 60_001).toISOString(),
      limit: 10,
    })

    assert.deepEqual(claims, [])
  } finally {
    if (store !== null) await store.close().catch(() => undefined)
    await pool.end()
  }
})

integrationTest("registering a newer run clears the prior terminal before source events arrive", async () => {
  const pool = new Pool({ connectionString: postgresUrl, options: "-c search_path=kokoro_bff -c timezone=UTC" })
  let store = null
  try {
    await pool.query(`DROP TABLE IF EXISTS ${TABLES.join(", ")} CASCADE`)
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    await pool.query(
      `INSERT INTO bff_conversation (conversation_id, tenant_id, owner_id, title)
       VALUES ('session_next_run', 'tenant_a', 'user_a', 'Next run')`,
    )
    store = new PostgresBffRepositories(postgresUrl, redisUrl)
    await store.agUi.ingest("tenant_a", "session_next_run", [
      agentSource({ id: "old_run_started", sequence: 1, kind: "run.created", payload: { run_id: "run_old" }, sessionId: "session_next_run", runId: "run_old" }),
      agentSource({ id: "old_run_finished", sequence: 2, kind: "run.completed", payload: { status: "completed" }, sessionId: "session_next_run", runId: "run_old" }),
    ])
    const before = await store.agUi.replay("tenant_a", "session_next_run", null, 100)
    assert.equal(before.kind, "page")
    assert.equal(before.terminalRunId, "run_old")

    await store.agUiConsumers.registerConsumer("tenant_a", "session_next_run", "user_a", "run_new")

    const awaitingSource = await store.agUi.replay("tenant_a", "session_next_run", before.frames.at(-1).cursor, 100)
    assert.equal(awaitingSource.kind, "page")
    assert.equal(awaitingSource.terminalRunId, null)
  } finally {
    if (store !== null) await store.close().catch(() => undefined)
    await pool.end()
  }
})

integrationTest("registering a newer run fences a stale projector commit", async () => {
  const pool = new Pool({ connectionString: postgresUrl, options: "-c search_path=kokoro_bff -c timezone=UTC" })
  let store = null
  let database = null
  try {
    await pool.query(`DROP TABLE IF EXISTS ${TABLES.join(", ")} CASCADE`)
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    await pool.query(
      `INSERT INTO bff_conversation (conversation_id, tenant_id, owner_id, title)
       VALUES ('session_run_fence', 'tenant_a', 'user_a', 'Run fence')`,
    )
    store = new PostgresBffRepositories(postgresUrl, redisUrl)
    database = new PostgresBffDatabase(postgresUrl, redisUrl)
    const projection = new PostgresAgUiProjectionRepository(database)
    await store.agUiConsumers.registerConsumer("tenant_a", "session_run_fence", "user_a", "run_old")
    const now = new Date()
    const [lease] = await store.agUiConsumers.claimConsumers({
      workerId: "worker_stale_run",
      now: now.toISOString(),
      leaseUntil: new Date(now.getTime() + 60_000).toISOString(),
      limit: 1,
    })
    assert.ok(lease)
    const stale = await projection.readStream("tenant_a", "session_run_fence")

    await store.agUiConsumers.registerConsumer("tenant_a", "session_run_fence", "user_a", "run_new")

    const committed = await projection.commitProjection({
      tenantId: "tenant_a",
      sessionId: "session_run_fence",
      expectedVersion: stale.version,
      sourceHighWatermark: 1,
      projectionState: { textMessageIds: [], toolCallIds: [] },
      sources: [{
        sourceOwner: "kokoro-agent",
        sourceEventId: "stale_old_terminal",
        sourceSequence: 1,
        sourceDigest: "a".repeat(64),
        sourceOccurredAt: now.toISOString(),
        frames: [{
          type: "RUN_FINISHED",
          threadId: "session_run_fence",
          runId: "run_old",
          timestamp: now.getTime(),
          metadata: { kokoro: { event_id: "stale_old_terminal", seq: 1, run_id: "run_old" } },
        }],
      }],
      latestRunId: "run_old",
      terminalRunId: "run_old",
      consumerLease: lease,
    })
    assert.notEqual(committed, "committed")

    const current = await projection.readStream("tenant_a", "session_run_fence")
    assert.ok(current.version > stale.version)
    assert.equal(current.expectedRunId, "run_new")
    assert.equal(current.latestRunId, null)
    assert.equal(current.terminalRunId, null)
    const replay = await store.agUi.replay("tenant_a", "session_run_fence", null, 100)
    assert.equal(replay.kind, "page")
    assert.deepEqual(replay.frames, [])
  } finally {
    if (store !== null) await store.close().catch(() => undefined)
    if (database !== null) await database.close().catch(() => undefined)
    await pool.end()
  }
})

integrationTest("consumer claims use the PostgreSQL clock instead of a skewed worker clock", async () => {
  const pool = new Pool({ connectionString: postgresUrl, options: "-c search_path=kokoro_bff -c timezone=UTC" })
  let store = null
  try {
    await pool.query(`DROP TABLE IF EXISTS ${TABLES.join(", ")} CASCADE`)
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    await pool.query(
      `INSERT INTO bff_conversation (conversation_id, tenant_id, owner_id, title)
       VALUES ('session_clock_fence', 'tenant_a', 'user_a', 'Clock fence')`,
    )
    store = new PostgresBffRepositories(postgresUrl, redisUrl)
    await store.agUiConsumers.registerConsumer("tenant_a", "session_clock_fence", "user_a")
    const now = new Date()
    const first = await store.agUiConsumers.claimConsumers({
      workerId: "worker_clock_a",
      now: now.toISOString(),
      leaseUntil: new Date(now.getTime() + 60_000).toISOString(),
      limit: 1,
    })
    assert.equal(first.length, 1)

    const skewed = new Date(now.getTime() + 24 * 60 * 60 * 1000)
    const second = await store.agUiConsumers.claimConsumers({
      workerId: "worker_clock_b",
      now: skewed.toISOString(),
      leaseUntil: new Date(skewed.getTime() + 60_000).toISOString(),
      limit: 1,
    })
    assert.deepEqual(second, [])
  } finally {
    if (store !== null) await store.close().catch(() => undefined)
    await pool.end()
  }
})

integrationTest("a new lease cannot publish an old run terminal over the expected run", async () => {
  const pool = new Pool({ connectionString: postgresUrl, options: "-c search_path=kokoro_bff -c timezone=UTC" })
  let store = null
  try {
    await pool.query(`DROP TABLE IF EXISTS ${TABLES.join(", ")} CASCADE`)
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    await pool.query(
      `INSERT INTO bff_conversation (conversation_id, tenant_id, owner_id, title)
       VALUES ('session_expected_run', 'tenant_a', 'user_a', 'Expected run')`,
    )
    store = new PostgresBffRepositories(postgresUrl, redisUrl)
    const turn = await store.services.chatTurns.submit({
      tenantId: "tenant_a", conversationId: "session_expected_run", subjectId: "user_a", actorId: "user_a",
      requestId: "request_expected_run", idempotencyKey: "expected_run", content: "Finish the current run",
    })
    assert.ok(turn)
    const now = new Date()
    const [lease] = await store.agUiConsumers.claimConsumers({
      workerId: "worker_expected_run",
      now: now.toISOString(),
      leaseUntil: new Date(now.getTime() + 60_000).toISOString(),
      limit: 1,
    })
    assert.ok(lease)

    await store.agUi.ingest("tenant_a", "session_expected_run", [
      agentSource({ id: "catchup_old_start", sequence: 1, kind: "run.created", payload: { run_id: "run_old" }, sessionId: "session_expected_run", runId: "run_old" }),
      agentSource({ id: "catchup_old_end", sequence: 2, kind: "run.completed", payload: { status: "completed" }, sessionId: "session_expected_run", runId: "run_old" }),
    ], lease)
    const oldCatchup = await store.agUi.replay("tenant_a", "session_expected_run", null, 100)
    assert.equal(oldCatchup.kind, "page")
    assert.equal(oldCatchup.terminalRunId, null)

    await store.agUi.ingest("tenant_a", "session_expected_run", [
      agentSource({ id: "expected_new_start", sequence: 3, kind: "run.created", payload: { run_id: turn.run_id }, sessionId: "session_expected_run", runId: turn.run_id }),
      agentSource({ id: "expected_new_end", sequence: 4, kind: "run.completed", payload: { status: "completed" }, sessionId: "session_expected_run", runId: turn.run_id }),
    ], lease)
    const expected = await store.agUi.replay("tenant_a", "session_expected_run", null, 100)
    assert.equal(expected.kind, "page")
    assert.equal(expected.terminalRunId, turn.run_id)
  } finally {
    if (store !== null) await store.close().catch(() => undefined)
    await pool.end()
  }
})

integrationTest("the expected run can finish while source runs are interleaved", async () => {
  const pool = new Pool({ connectionString: postgresUrl, options: "-c search_path=kokoro_bff -c timezone=UTC" })
  let store = null
  try {
    await pool.query(`DROP TABLE IF EXISTS ${TABLES.join(", ")} CASCADE`)
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    await pool.query(
      `INSERT INTO bff_conversation (conversation_id, tenant_id, owner_id, title)
       VALUES ('session_expected_interleaved', 'tenant_a', 'user_a', 'Expected interleaved run')`,
    )
    store = new PostgresBffRepositories(postgresUrl, redisUrl)
    const turn = await store.services.chatTurns.submit({
      tenantId: "tenant_a", conversationId: "session_expected_interleaved", subjectId: "user_a", actorId: "user_a",
      requestId: "request_expected_interleaved", idempotencyKey: "expected_interleaved", content: "Finish interleaved run",
    })
    assert.ok(turn)
    const now = new Date()
    const [lease] = await store.agUiConsumers.claimConsumers({
      workerId: "worker_expected_interleaved",
      now: now.toISOString(),
      leaseUntil: new Date(now.getTime() + 60_000).toISOString(),
      limit: 1,
    })
    assert.ok(lease)

    await store.agUi.ingest("tenant_a", "session_expected_interleaved", [
      agentSource({ id: "expected_interleaved_start", sequence: 1, kind: "run.created", payload: { run_id: turn.run_id }, sessionId: "session_expected_interleaved", runId: turn.run_id }),
      agentSource({ id: "other_interleaved_start", sequence: 2, kind: "run.created", payload: { run_id: "run_other" }, sessionId: "session_expected_interleaved", runId: "run_other" }),
      agentSource({ id: "expected_interleaved_end", sequence: 3, kind: "run.completed", payload: { status: "completed" }, sessionId: "session_expected_interleaved", runId: turn.run_id }),
    ], lease)

    const replay = await store.agUi.replay("tenant_a", "session_expected_interleaved", null, 100)
    assert.equal(replay.kind, "page")
    assert.equal(replay.terminalRunId, turn.run_id)
  } finally {
    if (store !== null) await store.close().catch(() => undefined)
    await pool.end()
  }
})

integrationTest("a skewed worker can read and settle a database-clock lease", async () => {
  const pool = new Pool({ connectionString: postgresUrl, options: "-c search_path=kokoro_bff -c timezone=UTC" })
  let store = null
  try {
    await pool.query(`DROP TABLE IF EXISTS ${TABLES.join(", ")} CASCADE`)
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    await pool.query(
      `INSERT INTO bff_conversation (conversation_id, tenant_id, owner_id, title)
       VALUES ('session_clock_completion', 'tenant_a', 'user_a', 'Clock completion')`,
    )
    store = new PostgresBffRepositories(postgresUrl, redisUrl)
    await store.agUiConsumers.registerConsumer("tenant_a", "session_clock_completion", "user_a")
    let sourceReads = 0
    const skewedNow = new Date(Date.now() + 24 * 60 * 60 * 1000)
    const runner = new AgUiProjectorRunner(store.agUi, store.agUiConsumers, {
      read: async () => {
        sourceReads += 1
        return { events: [], nextSequence: 0, watermark: 0, exhausted: true }
      },
    }, {
      workerId: "worker_clock_completion",
      leaseDurationMs: 60_000,
      pollIntervalMs: 1_000,
      now: () => skewedNow,
    })

    const result = await runner.runOnce()

    assert.equal(sourceReads, 1)
    assert.equal(result.consumersSucceeded, 1)
  } finally {
    if (store !== null) await store.close().catch(() => undefined)
    await pool.end()
  }
})

integrationTest("a skewed worker releases a lease back to the PostgreSQL clock", async () => {
  const pool = new Pool({ connectionString: postgresUrl, options: "-c search_path=kokoro_bff -c timezone=UTC" })
  let store = null
  try {
    await pool.query(`DROP TABLE IF EXISTS ${TABLES.join(", ")} CASCADE`)
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    await pool.query(
      `INSERT INTO bff_conversation (conversation_id, tenant_id, owner_id, title)
       VALUES ('session_clock_release', 'tenant_a', 'user_a', 'Clock release')`,
    )
    store = new PostgresBffRepositories(postgresUrl, redisUrl)
    await store.agUiConsumers.registerConsumer("tenant_a", "session_clock_release", "user_a")
    const now = new Date()
    const [lease] = await store.agUiConsumers.claimConsumers({
      workerId: "worker_clock_release_a",
      now: now.toISOString(),
      leaseUntil: new Date(now.getTime() + 60_000).toISOString(),
      limit: 1,
    })
    assert.ok(lease)

    const skewedNow = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString()
    assert.equal(await store.agUiConsumers.releaseConsumer(lease, skewedNow), true)

    const reclaimed = await store.agUiConsumers.claimConsumers({
      workerId: "worker_clock_release_b",
      now: now.toISOString(),
      leaseUntil: new Date(now.getTime() + 60_000).toISOString(),
      limit: 1,
    })
    assert.equal(reclaimed.length, 1)
    assert.equal(reclaimed[0]?.leaseOwner, "worker_clock_release_b")
  } finally {
    if (store !== null) await store.close().catch(() => undefined)
    await pool.end()
  }
})
