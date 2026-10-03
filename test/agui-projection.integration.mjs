import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { connect as connectTcp, createServer as createTcpServer } from "node:net"
import { test } from "node:test"

import { Pool } from "pg"
import { createClient } from "redis"

import { PostgresBffRepositories } from "../dist/infrastructure/postgres/repositories.js"
import { PostgresBffDatabase } from "../dist/infrastructure/postgres/client.js"
import { PostgresAgUiProjectionRepository } from "../dist/infrastructure/postgres/agui-projection-repository.js"
import { PostgresAgUiConsumerRepository } from "../dist/infrastructure/postgres/agui-consumer-repository.js"
import { PostgresChatRepository } from "../dist/infrastructure/postgres/chat-repository.js"
import { projectRunProcessFrame } from "../dist/infrastructure/postgres/agui-process-projection.js"
import { AgUiProjectionService } from "../dist/application/agui/project-session-events.js"
import { AgUiProjectorRunner } from "../dist/application/agui/projector.js"
import { agentEventPage, mapAgentEvent } from "../dist/infrastructure/clients/agent/projection.js"

const postgresUrl = process.env.KOKORO_TEST_POSTGRES_URL
const redisUrl = process.env.KOKORO_TEST_REDIS_URL
const integrationTest = postgresUrl && redisUrl ? test : test.skip

const TABLES = [
  "bff_agui_run_activity",
  "bff_agui_run_process",
  "bff_agui_run_interaction",
  "bff_agui_cursor_tombstone",
  "bff_agui_event",
  "bff_conversation_artifact",
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
    sourceRunId: runId,
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
    event:
      kind === null
        ? null
        : {
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

async function submitAndAdmit(store, pool, { tenantId, sessionId, ownerId, suffix }) {
  await pool.query(
    `INSERT INTO bff_conversation (conversation_id, tenant_id, owner_id, title)
     VALUES ($1, $2, $3, 'Projection fixture') ON CONFLICT (conversation_id) DO NOTHING`,
    [sessionId, tenantId, ownerId],
  )
  const turn = await store.services.chatTurns.submit({
    tenantId,
    conversationId: sessionId,
    subjectId: ownerId,
    actorId: ownerId,
    requestId: `request_${suffix}`,
    idempotencyKey: `turn_${suffix}`,
    content: `Turn ${suffix}`,
  })
  assert.ok(turn)
  const [claim] = await store.agentDispatchOutbox.claimAgentDispatchOutbox({
    workerId: `worker_${suffix}`,
    limit: 1,
    leaseDurationMs: 5000,
    maxAttempts: 8,
  })
  assert.equal(claim.runId, turn.run_id)
  assert.equal(await store.agentDispatchOutbox.markAgentDispatchAdmitted(claim), true)
  return turn.run_id
}

integrationTest("persists admitted Artifact deliveries with source frames and removes links on Conversation deletion", async () => {
  const pool = new Pool({
    connectionString: postgresUrl,
    options: "-c search_path=kokoro_bff -c timezone=UTC",
  })
  let store = null
  try {
    await pool.query("CREATE SCHEMA IF NOT EXISTS kokoro_bff")
    await pool.query(`DROP TABLE IF EXISTS ${TABLES.join(", ")} CASCADE`)
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    store = new PostgresBffRepositories(postgresUrl, redisUrl)
    await store.ready()
    const tenantId = "tenant_artifact_projection"
    const sessionId = "session_artifact_projection"
    const ownerId = "owner_artifact_projection"
    await pool.query("INSERT INTO bff_conversation (conversation_id, tenant_id, owner_id, title) VALUES ($1, $2, $3, 'Artifact projection')", [
      sessionId,
      tenantId,
      ownerId,
    ])
    const submit = (number) =>
      store.services.chatTurns.submit({
        tenantId,
        conversationId: sessionId,
        subjectId: ownerId,
        actorId: ownerId,
        requestId: `request_artifact_${number}`,
        idempotencyKey: `turn_artifact_${number}`,
        content: `Turn ${number}`,
      })
    const firstRun = await submit(1)
    const secondRun = await submit(2)
    assert.ok(firstRun && secondRun)
    const [firstClaim] = await store.agentDispatchOutbox.claimAgentDispatchOutbox({
      workerId: "worker_artifact_first",
      limit: 1,
      leaseDurationMs: 5000,
      maxAttempts: 8,
    })
    assert.equal(firstClaim.runId, firstRun.run_id)
    assert.equal(await store.agentDispatchOutbox.markAgentDispatchAdmitted(firstClaim), true)
    const payload = (artifactId, hash = "a".repeat(64)) => ({
      tool_call_id: "tool_artifact",
      artifact_id: artifactId,
      asset_id: `asset_${artifactId}`,
      artifact_kind: "document",
      content_hash: hash,
      path: "/report.md",
      title: "Report",
      mime: "text/markdown",
      size: 12,
    })
    const source = (sequence, artifactId, runId = firstRun.run_id) =>
      agentSource({
        id: `artifact_source_${sequence}`,
        sequence,
        kind: "delivery.created",
        payload: payload(artifactId),
        sessionId,
        runId,
      })
    const first = source(1, "artifact_first")
    // expected_run_id now points at turn 2, but the immutable first dispatch still admits its late delivery.
    assert.equal((await store.agUi.ingest(tenantId, sessionId, [first])).insertedSources, 1)
    const linked = async () =>
      (
        await pool.query(
          "SELECT artifact_id, run_id, source_event_id, source_artifact_kind, source_content_sha256, source_title, source_mime, source_size_bytes FROM bff_conversation_artifact WHERE tenant_id = $1 AND conversation_id = $2 ORDER BY artifact_id",
          [tenantId, sessionId],
        )
      ).rows
    assert.deepEqual(await linked(), [
      {
        artifact_id: "artifact_first",
        run_id: firstRun.run_id,
        source_event_id: "artifact_source_1",
        source_artifact_kind: "document",
        source_content_sha256: "a".repeat(64),
        source_title: "Report",
        source_mime: "text/markdown",
        source_size_bytes: "12",
      },
    ])
    const snapshot = await store.services.chat.snapshot(tenantId, ownerId, sessionId, undefined)
    assert.deepEqual(snapshot.deliveries, [
      {
        conversation_id: sessionId,
        artifact_id: "artifact_first",
        asset_id: "asset_artifact_first",
        artifact_kind: "document",
        title: "Report",
        mime: "text/markdown",
        size: 12,
        run_id: firstRun.run_id,
        created_at: first.sourceOccurredAt,
      },
    ])
    assert.equal(snapshot.deliveries_has_more, false)
    assert.equal(snapshot.event_watermark, (await store.agUi.status(tenantId, sessionId)).currentCursor)
    assert.equal(await store.services.chat.snapshot(tenantId, "other_member", sessionId, undefined), null)
    const secondConversation = "session_artifact_second"
    await pool.query("INSERT INTO bff_conversation (conversation_id, tenant_id, owner_id, title) VALUES ($1, $2, $3, 'Second conversation')", [
      secondConversation,
      tenantId,
      ownerId,
    ])
    await pool.query(
      `INSERT INTO bff_conversation_artifact
       (tenant_id, conversation_id, artifact_id, run_id, source_event_id, source_sequence, source_digest,
        source_asset_id, source_artifact_kind, source_content_sha256,
        source_title, source_mime, source_size_bytes, delivered_at)
       VALUES ($1, $2, 'artifact_second', 'run_second', 'source_second', 1, $3, 'asset_second', 'document', $3,
               'Second report', 'text/markdown', 12, $4)`,
      [tenantId, secondConversation, "b".repeat(64), new Date(1000)],
    )
    const candidates = await store.artifactLibrary.listCandidates(tenantId, ownerId, null, 2)
    assert.deepEqual(
      candidates.map(({ conversationId, artifactId }) => [conversationId, artifactId]),
      [
        [sessionId, "artifact_first"],
        [secondConversation, "artifact_second"],
      ],
    )
    assert.deepEqual(
      (
        await store.artifactLibrary.listCandidates(
          tenantId,
          ownerId,
          {
            deliveredAt: candidates[0].deliveredAt,
            conversationId: candidates[0].conversationId,
            artifactId: candidates[0].artifactId,
          },
          2,
        )
      ).map(({ artifactId }) => artifactId),
      ["artifact_second"],
    )
    assert.equal((await store.artifactLibrary.listCandidates(tenantId, "other_member", null, 2)).length, 0)
    assert.equal(await store.artifactLibrary.findCandidate(tenantId, "other_member", sessionId, "artifact_first"), null)
    assert.equal(await store.artifactLibrary.findCandidate("other_tenant", ownerId, sessionId, "artifact_first"), null)
    assert.equal(await store.artifactLibrary.findCandidate(tenantId, ownerId, secondConversation, "artifact_first"), null)
    await pool.query("UPDATE bff_conversation SET project_ref = 'missing_project' WHERE conversation_id = $1", [secondConversation])
    assert.equal(await store.artifactLibrary.findCandidate(tenantId, ownerId, secondConversation, "artifact_second"), null)
    assert.deepEqual(
      (await store.artifactLibrary.listCandidates(tenantId, ownerId, null, 2)).map(({ artifactId }) => artifactId),
      ["artifact_first"],
    )
    assert.equal((await store.agUi.ingest(tenantId, sessionId, [first])).insertedSources, 0)
    await assert.rejects(store.agUi.ingest(tenantId, sessionId, [source(1, "artifact_changed")]), /source identity conflict/u)
    await assert.rejects(
      store.agUi.ingest(tenantId, sessionId, [
        agentSource({
          id: "artifact_source_1_renamed",
          sequence: 1,
          kind: "delivery.created",
          payload: payload("artifact_first"),
          sessionId,
          runId: firstRun.run_id,
        }),
      ]),
      /source identity conflict/u,
    )
    assert.equal((await linked()).length, 1)
    await pool.query("DELETE FROM bff_agui_event WHERE tenant_id = $1 AND session_id = $2", [tenantId, sessionId])
    assert.equal((await linked()).length, 1)

    // The first source/frame/link in this page must roll back when the second
    // source reuses an already associated Artifact identity.
    await assert.rejects(
      store.agUi.ingest(tenantId, sessionId, [source(2, "artifact_provisional", secondRun.run_id), source(3, "artifact_first", secondRun.run_id)]),
      /source identity conflict/u,
    )
    assert.equal((await store.agUi.status(tenantId, sessionId)).sourceHighWatermark, 1)
    assert.equal(
      (await pool.query("SELECT 1 FROM bff_agui_source_event WHERE tenant_id = $1 AND session_id = $2 AND source_sequence >= 2", [tenantId, sessionId]))
        .rowCount,
      0,
    )
    assert.equal((await pool.query("SELECT 1 FROM bff_agui_event WHERE tenant_id = $1 AND session_id = $2", [tenantId, sessionId])).rowCount, 0)
    assert.deepEqual(
      (await linked()).map((row) => row.artifact_id),
      ["artifact_first"],
    )

    for (const [label, runId] of [
      ["never_dispatched", "run_not_dispatched"],
      ["wrong_subject", secondRun.run_id],
    ]) {
      if (label === "wrong_subject") {
        await pool.query("UPDATE bff_agent_dispatch_outbox SET subject_id = 'other_member' WHERE tenant_id = $1 AND run_id = $2", [tenantId, runId])
      }
      await assert.rejects(store.agUi.ingest(tenantId, sessionId, [source(2, `artifact_${label}`, runId)]), /AGUI_ARTIFACT_BINDING_MISSING/u)
      assert.equal((await store.agUi.status(tenantId, sessionId)).sourceHighWatermark, 1)
      assert.equal(
        (await pool.query("SELECT 1 FROM bff_agui_source_event WHERE tenant_id = $1 AND session_id = $2 AND source_sequence = 2", [tenantId, sessionId]))
          .rowCount,
        0,
      )
      if (label === "wrong_subject") {
        await pool.query("UPDATE bff_agent_dispatch_outbox SET subject_id = $3 WHERE tenant_id = $1 AND run_id = $2", [tenantId, runId, ownerId])
      }
    }
    await assert.rejects(store.agUi.ingest(tenantId, sessionId, [source(2, "artifact_first", secondRun.run_id)]), /source identity conflict/u)
    assert.equal((await store.agUi.status(tenantId, sessionId)).sourceHighWatermark, 1)
    await store.agUi.ingest(tenantId, sessionId, [source(2, "artifact_second", secondRun.run_id)])
    assert.equal((await linked()).length, 2)
    assert.deepEqual(
      (await store.services.chat.snapshot(tenantId, ownerId, sessionId, undefined)).deliveries.map(({ artifact_id }) => artifact_id),
      ["artifact_second", "artifact_first"],
    )
    assert.equal(await store.services.chat.deleteConversation(tenantId, ownerId, sessionId, "delete-artifact-projection"), true)
    assert.deepEqual(await linked(), [])
    await assert.rejects(store.agUi.ingest(tenantId, sessionId, [source(3, "artifact_late", secondRun.run_id)]), /AGUI_ARTIFACT_BINDING_MISSING/u)
    assert.deepEqual(await linked(), [])
  } finally {
    if (store !== null) await store.close()
    await pool.end()
  }
})

integrationTest("bounds Chat deliveries independently of Messages and reapplies owner and Project visibility", async () => {
  const pool = new Pool({
    connectionString: postgresUrl,
    options: "-c search_path=kokoro_bff -c timezone=UTC",
  })
  let store = null
  try {
    await pool.query("CREATE SCHEMA IF NOT EXISTS kokoro_bff")
    await pool.query(`DROP TABLE IF EXISTS ${TABLES.join(", ")} CASCADE`)
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    store = new PostgresBffRepositories(postgresUrl, redisUrl)
    await store.ready()
    const tenantId = "tenant_snapshot_limit"
    const sessionId = "session_snapshot_limit"
    const ownerId = "owner_snapshot_limit"
    await pool.query("INSERT INTO bff_conversation (conversation_id, tenant_id, owner_id, title) VALUES ($1, $2, $3, 'Bounded snapshot')", [
      sessionId,
      tenantId,
      ownerId,
    ])
    await pool.query(
      `INSERT INTO bff_conversation_artifact
         (tenant_id, conversation_id, artifact_id, run_id, source_owner, source_event_id,
          source_sequence, source_digest, source_asset_id, source_artifact_kind,
          source_content_sha256, source_title, source_mime, source_size_bytes, delivered_at)
       SELECT $1, $2, 'artifact_' || lpad(n::text, 3, '0'), 'run_snapshot', 'kokoro-agent',
              'source_' || n::text, n, repeat('a', 64), 'asset_' || n::text, 'document',
              repeat('b', 64), 'Report ' || n::text, 'text/plain', n,
              '2026-09-28T00:00:00Z'::timestamptz + n * interval '1 millisecond'
         FROM generate_series(1, 101) AS n`,
      [tenantId, sessionId],
    )
    await assert.rejects(
      pool.query(
        `INSERT INTO bff_conversation_artifact
           (tenant_id, conversation_id, artifact_id, run_id, source_owner, source_event_id,
            source_sequence, source_digest, source_asset_id, source_artifact_kind,
            source_content_sha256, source_title, source_mime, source_size_bytes, delivered_at)
         VALUES ($1, $2, 'artifact_unsafe_size', 'run_snapshot', 'kokoro-agent', 'source_unsafe_size',
                 102, repeat('a', 64), 'asset_unsafe_size', 'document', repeat('b', 64),
                 'Unsafe size', 'text/plain', 9007199254740992, '2026-09-28T00:00:01Z')`,
        [tenantId, sessionId],
      ),
      (error) => error?.code === "23514" && error.constraint === "ck_bff_conversation_artifact_display",
    )
    await pool.query(
      `UPDATE bff_conversation_artifact
          SET delivered_at = (SELECT delivered_at FROM bff_conversation_artifact
                               WHERE tenant_id = $1 AND conversation_id = $2 AND artifact_id = 'artifact_101')
        WHERE tenant_id = $1 AND conversation_id = $2 AND artifact_id = 'artifact_100'`,
      [tenantId, sessionId],
    )
    const snapshot = await store.services.chat.snapshot(tenantId, ownerId, sessionId, undefined)
    assert.equal(snapshot.deliveries.length, 100)
    assert.equal(snapshot.deliveries_has_more, true)
    assert.equal(snapshot.deliveries[0].artifact_id, "artifact_100")
    assert.equal(snapshot.deliveries[1].artifact_id, "artifact_101")
    assert.equal(snapshot.deliveries.at(-1).artifact_id, "artifact_002")
    assert.equal(snapshot.deliveries[0].conversation_id, sessionId)
    assert.equal(snapshot.deliveries[0].size, 100)
    const visibleRun = await submitAndAdmit(store, pool, {
      tenantId,
      sessionId,
      ownerId,
      suffix: "snapshot_limit_visible",
    })
    await store.agUi.ingest(tenantId, sessionId, [
      agentSource({
        id: "source_snapshot_limit_visible_start",
        sequence: 1,
        kind: "run.created",
        payload: { run_id: visibleRun },
        sessionId,
        runId: visibleRun,
      }),
    ])
    assert.deepEqual((await store.services.chat.snapshot(tenantId, ownerId, sessionId, undefined)).execution_head, {
      run_id: visibleRun,
      state: "active",
      pending_pauses: [],
    })
    assert.equal(await store.services.chat.snapshot(tenantId, "other_member", sessionId, undefined), null)
    await pool.query("UPDATE bff_conversation SET project_ref = 'missing_project' WHERE conversation_id = $1", [sessionId])
    assert.equal(await store.services.chat.snapshot(tenantId, ownerId, sessionId, undefined), null)
    await pool.query(
      "INSERT INTO bff_project (project_id, tenant_id, owner_id, name, slug, description) VALUES ('project_snapshot', $1, $2, 'Snapshot', 'snapshot', '')",
      [tenantId, ownerId],
    )
    await pool.query("UPDATE bff_conversation SET project_ref = 'project_snapshot' WHERE conversation_id = $1", [sessionId])
    assert.equal((await store.services.chat.snapshot(tenantId, ownerId, sessionId, "project_snapshot")).deliveries.length, 100)
    assert.equal(await store.services.chat.snapshot(tenantId, ownerId, sessionId, "wrong_project"), null)
    assert.equal(await store.services.chat.deleteConversation(tenantId, ownerId, sessionId, "delete-snapshot-limit", "project_snapshot"), true)
    assert.equal(await store.services.chat.snapshot(tenantId, ownerId, sessionId, undefined), null)
  } finally {
    if (store !== null) await store.close()
    await pool.end()
  }
})

integrationTest("reads Artifact deliveries and public watermark from one repeatable-read boundary", async () => {
  const pool = new Pool({
    connectionString: postgresUrl,
    options: "-c search_path=kokoro_bff -c timezone=UTC",
  })
  let reader = null
  let writer = null
  try {
    await pool.query("CREATE SCHEMA IF NOT EXISTS kokoro_bff")
    await pool.query(`DROP TABLE IF EXISTS ${TABLES.join(", ")} CASCADE`)
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    const tenantId = "tenant_snapshot_race"
    const sessionId = "session_snapshot_race"
    const ownerId = "owner_snapshot_race"
    await pool.query("INSERT INTO bff_conversation (conversation_id, tenant_id, owner_id, title) VALUES ($1, $2, $3, 'Race snapshot')", [
      sessionId,
      tenantId,
      ownerId,
    ])
    reader = await pool.connect()
    let allowDeliveryRead
    const readReleased = new Promise((resolve) => {
      allowDeliveryRead = resolve
    })
    let markConversationRead
    const conversationRead = new Promise((resolve) => {
      markConversationRead = resolve
    })
    const gated = new PostgresChatRepository({
      pool: {
        connect: async () => ({
          query: async (sql, values) => {
            const result = await reader.query(sql, values)
            if (sql.includes("FROM bff_conversation") && sql.includes("LIMIT 1")) {
              markConversationRead()
              await readReleased
            }
            return result
          },
          release: () => reader.release(),
        }),
      },
    })
    const pending = gated.readSnapshot(tenantId, ownerId, sessionId, undefined)
    await conversationRead
    writer = await pool.connect()
    await writer.query("BEGIN")
    await writer.query("SELECT 1 FROM bff_conversation WHERE tenant_id=$1 AND conversation_id=$2 FOR UPDATE", [tenantId, sessionId])
    const { createHash } = await import("node:crypto")
    const { buildAgentDispatchPayload, agentDispatchRequestMaterial } = await import("../dist/domain/chat/agent-dispatch.js")
    const { PostgresAgentDispatchOutboxRepository } = await import("../dist/infrastructure/postgres/agent-dispatch-outbox-repository.js")
    const { createAgUiProjectionState, projectChatEvent } = await import("../dist/application/agui/project-chat-event.js")
    const dispatchInput = {
      tenantId,
      conversationId: sessionId,
      subjectId: ownerId,
      actorId: ownerId,
      requestId: "request_race",
      idempotencyKey: "turn_race",
      content: "Race turn",
    }
    const deliveryPayload = {
      artifact_id: "artifact_race",
      artifact_kind: "document",
      asset_id: "asset_race",
      content_hash: "b".repeat(64),
      mime: "text/plain",
      path: "/race.txt",
      size: 4,
      title: "Race report",
      tool_call_id: "tool_race",
    }
    const deliveryDigest = createHash("sha256").update(JSON.stringify(deliveryPayload)).digest("hex")
    await writer.query(
      `INSERT INTO bff_message (message_id, tenant_id, conversation_id, run_id, role, content, status, message_seq)
       VALUES ('user_race', $1, $2, 'run_race', 'user', 'Race turn', 'completed', 2),
              ('assistant_race', $1, $2, 'run_race', 'assistant', '', 'pending', 3)`,
      [tenantId, sessionId],
    )
    await writer.query(
      `INSERT INTO bff_agent_dispatch_outbox
         (outbox_id,tenant_id,conversation_id,conversation_dispatch_seq,subject_id,actor_id,request_id,
          idempotency_key,request_digest,run_id,user_message_id,assistant_message_id,identity_assertion_ref,payload,status,admitted_at)
       VALUES ('dispatch_race',$1,$2,2,$3,$3,'request_race','turn_race',$4,'run_race','user_race','assistant_race',
               'assertion_race',$5::jsonb,'admitted',CURRENT_TIMESTAMP(3))`,
      [
        tenantId,
        sessionId,
        ownerId,
        createHash("sha256").update(agentDispatchRequestMaterial(dispatchInput)).digest("hex"),
        JSON.stringify(
          buildAgentDispatchPayload(dispatchInput, {
            runId: "run_race",
            userMessageId: "user_race",
          }),
        ),
      ],
    )
    await writer.query(
      `INSERT INTO bff_agui_stream (tenant_id,session_id,consumer_subject_id,expected_run_id)
       VALUES ($1,$2,$3,'run_race')`,
      [tenantId, sessionId, ownerId],
    )
    assert.ok(await PostgresAgentDispatchOutboxRepository.projectQueuedHeadInTransaction(writer, tenantId, sessionId))
    const projectionState = createAgUiProjectionState()
    for (const [sequence, id, kind, payload, cursor] of [
      [1, "source_start_race", "run.created", { run_id: "run_race" }, "agui_11111111111111111111111111111111"],
      [2, "source_race", "delivery.created", deliveryPayload, "agui_0123456789abcdef0123456789abcdef"],
    ]) {
      const timestamp = "2026-09-28T00:00:00.000Z"
      const [frame] = projectChatEvent(
        {
          event_id: id,
          seq: sequence,
          session_id: sessionId,
          run_id: "run_race",
          kind,
          timestamp,
          payload,
        },
        projectionState,
      )
      const sourceDigest = createHash("sha256").update(JSON.stringify(payload)).digest("hex")
      await writer.query(
        `INSERT INTO bff_agui_source_event (tenant_id,session_id,source_owner,source_event_id,source_sequence,source_digest,source_occurred_at)
         VALUES ($1,$2,'kokoro-agent',$3,$4,$5,$6::timestamptz)`,
        [tenantId, sessionId, id, sequence, sourceDigest, timestamp],
      )
      await writer.query(
        `INSERT INTO bff_agui_event (tenant_id,session_id,public_sequence,cursor,source_owner,source_event_id,frame_index,event_type,event_payload,source_occurred_at)
         VALUES ($1,$2,$3,$4,'kokoro-agent',$5,0,$6,$7::jsonb,$8::timestamptz)`,
        [tenantId, sessionId, sequence + 1, cursor, id, frame.type, JSON.stringify(frame), timestamp],
      )
      if (frame.type === "RUN_STARTED") {
        await projectRunProcessFrame(
          writer,
          { tenantId, sessionId, subjectId: ownerId },
          {
            sourceRunId: "run_race",
            sourceOwner: "kokoro-agent",
            sourceEventId: id,
            sourceSequence: sequence,
            sourceDigest,
            sourceOccurredAt: timestamp,
            frames: [frame],
          },
          frame,
          sequence + 1,
          cursor,
        )
      }
    }
    await writer.query(
      `UPDATE bff_agui_stream SET latest_run_id='run_race',latest_run_start_sequence=2,source_high_watermark=2,
         next_public_sequence=4,version=version+1 WHERE tenant_id=$1 AND session_id=$2`,
      [tenantId, sessionId],
    )
    await writer.query(
      `INSERT INTO bff_conversation_artifact
         (tenant_id, conversation_id, artifact_id, run_id, source_owner, source_event_id,
          source_sequence, source_digest, source_asset_id, source_artifact_kind,
          source_content_sha256, source_title, source_mime, source_size_bytes, delivered_at)
       VALUES ($1, $2, 'artifact_race', 'run_race', 'kokoro-agent', 'source_race', 2,
               $3, 'asset_race', 'document', repeat('b', 64),
               'Race report', 'text/plain', 4, '2026-09-28T00:00:00Z')`,
      [tenantId, sessionId, deliveryDigest],
    )
    await writer.query(
      `INSERT INTO bff_message
         (message_id, tenant_id, conversation_id, run_id, role, content, status, message_seq,
          agent_failure_code, agent_failure_retryable)
       VALUES ('message_failure_race', $1, $2, 'run_failure_race', 'assistant', 'partial', 'failed', 1,
               'model_unavailable', TRUE)`,
      [tenantId, sessionId],
    )
    await writer.query("COMMIT")
    allowDeliveryRead()
    const before = await pending
    assert.deepEqual(before.deliveries, [])
    assert.deepEqual(before.messages ?? [], [])
    assert.equal(before.eventWatermark, null)
    assert.equal(before.executionHead, undefined)
    const after = await new PostgresChatRepository({ pool }).readSnapshot(tenantId, ownerId, sessionId, undefined)
    assert.deepEqual(
      after.deliveries.map(({ artifactId }) => artifactId),
      ["artifact_race"],
    )
    assert.deepEqual(
      after.messages.map(({ failure }) => failure),
      [{ source: "agent", code: "model_unavailable", retryable: true }, null, null],
    )
    assert.deepEqual(
      after.messages.map(({ messageId, runId, role, status }) => ({
        messageId,
        runId,
        role,
        status,
      })),
      [
        {
          messageId: "message_failure_race",
          runId: "run_failure_race",
          role: "assistant",
          status: "failed",
        },
        {
          messageId: "user_race",
          runId: "run_race",
          role: "user",
          status: "completed",
        },
        {
          messageId: "assistant_race",
          runId: "run_race",
          role: "assistant",
          status: "pending",
        },
      ],
    )
    assert.equal(after.eventWatermark, "agui_0123456789abcdef0123456789abcdef")
    assert.deepEqual(after.executionHead, {
      runId: "run_race",
      state: "active",
      pendingPauses: [],
    })
  } finally {
    if (writer !== null) writer.release()
    await pool.end()
  }
})

integrationTest("reconciles the BFF assistant Message with the committed Agent source ledger", async () => {
  const pool = new Pool({
    connectionString: postgresUrl,
    options: "-c search_path=kokoro_bff -c timezone=UTC",
  })
  let store = null
  try {
    await pool.query("CREATE SCHEMA IF NOT EXISTS kokoro_bff")
    await pool.query(`DROP TABLE IF EXISTS ${TABLES.join(", ")} CASCADE`)
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    store = new PostgresBffRepositories(postgresUrl, redisUrl)
    await store.ready()
    const sessionId = "session_assistant_reconcile"
    await pool.query("INSERT INTO bff_conversation (conversation_id, tenant_id, owner_id, title) VALUES ($1, $2, $3, $4)", [
      sessionId,
      "tenant_reconcile",
      "owner_reconcile",
      "Reconcile assistant",
    ])
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
    await pool.query("INSERT INTO bff_conversation (conversation_id, tenant_id, owner_id, title) VALUES ($1, $2, $3, $4)", [
      "foreign_session_reconcile",
      "foreign_tenant_reconcile",
      "foreign_owner_reconcile",
      "Foreign",
    ])
    await pool.query(
      `INSERT INTO bff_message (message_id, tenant_id, conversation_id, run_id, role, content, status, message_seq)
       VALUES ($1, $2, $3, $4, 'assistant', $5, 'pending', 1)`,
      ["agent_seg_a", "foreign_tenant_reconcile", "foreign_session_reconcile", receipt.run_id, "foreign content"],
    )
    const source = (sequence, kind, payload, runId = receipt.run_id) =>
      agentSource({
        id: `reconcile_${sequence}`,
        sequence,
        kind,
        payload,
        sessionId,
        runId,
      })
    const assistant = async () => {
      const result = await pool.query("SELECT content, status FROM bff_message WHERE tenant_id = $1 AND conversation_id = $2 AND message_id = $3", [
        "tenant_reconcile",
        sessionId,
        receipt.assistant_message_id,
      ])
      return result.rows[0]
    }
    const [leasedBeforeAck] = await store.agentDispatchOutbox.claimAgentDispatchOutbox({
      workerId: "worker_reconcile_first",
      limit: 1,
      leaseDurationMs: 5000,
      maxAttempts: 8,
    })
    assert.equal(leasedBeforeAck.runId, receipt.run_id)
    await store.agUi.ingest("tenant_reconcile", sessionId, [
      source(1, "run.created", { run_id: receipt.run_id }),
      source(2, "message.delta", {
        segment_id: "agent_seg_a",
        delta: "Draft",
      }),
      source(3, "message.completed", {
        segment_id: "agent_seg_a",
        content: "Draft final",
      }),
    ])
    assert.deepEqual(await assistant(), {
      content: "Draft final",
      status: "streaming",
    })
    const beforeMalformed = await store.agUi.status("tenant_reconcile", sessionId)
    for (const [eventType, payload] of [
      ["assistant.delta", { delta: 42 }],
      ["assistant.completed", { content: 42 }],
    ]) {
      assert.throws(
        () =>
          mapAgentEvent({
            chat_event_id: `malformed_${eventType}`,
            session_id: sessionId,
            run_id: receipt.run_id,
            chat_message_id: "agent_seg_a",
            event_type: eventType,
            payload_json: JSON.stringify(payload),
            seq: 4,
            created_at: 4000,
          }),
        /Agent chat projection field (delta|content) is invalid/u,
      )
    }
    assert.deepEqual(await assistant(), {
      content: "Draft final",
      status: "streaming",
    })
    assert.deepEqual(await store.agUi.status("tenant_reconcile", sessionId), beforeMalformed)

    await store.agUi.ingest("tenant_reconcile", sessionId, [
      source(4, "activity.updated", {
        activity: "tool",
        activity_id: "act_" + "4".repeat(64),
        segment_id: "seg_" + "4".repeat(64),
        status: "running",
        display_code: "tool.execution",
      }),
      source(5, "activity.updated", {
        activity: "tool",
        activity_id: "act_" + "4".repeat(64),
        segment_id: "seg_" + "4".repeat(64),
        status: "completed",
        display_code: "tool.execution",
      }),
      source(6, "message.delta", {
        segment_id: "agent_seg_b",
        delta: "Final ",
      }),
      source(7, "message.delta", {
        segment_id: "agent_seg_b",
        delta: "answer",
      }),
      source(8, "message.completed", {
        segment_id: "agent_seg_b",
        content: "Final answer.",
      }),
    ])
    assert.deepEqual(await assistant(), {
      content: "Final answer.",
      status: "streaming",
    })
    await store.agUi.ingest("tenant_reconcile", sessionId, [source(9, "run.completed", { status: "completed" })])
    assert.deepEqual(await assistant(), {
      content: "Final answer.",
      status: "completed",
    })
    assert.deepEqual(
      (
        await pool.query(
          "SELECT status, admitted_at IS NOT NULL AS admitted, completed_at IS NOT NULL AS terminal FROM bff_agent_dispatch_outbox WHERE tenant_id = $1 AND run_id = $2",
          ["tenant_reconcile", receipt.run_id],
        )
      ).rows[0],
      { status: "terminal", admitted: true, terminal: true },
    )
    assert.equal(
      (await pool.query("SELECT expected_run_id FROM bff_agui_stream WHERE tenant_id = $1 AND session_id = $2", ["tenant_reconcile", sessionId])).rows[0]
        .expected_run_id,
      null,
    )
    const foreign = await pool.query("SELECT content, status FROM bff_message WHERE message_id = 'agent_seg_a'")
    assert.deepEqual(foreign.rows[0], {
      content: "foreign content",
      status: "pending",
    })
    const current = await store.agUi.status("tenant_reconcile", sessionId)
    assert.equal(current.sourceHighWatermark, 9)
    assert.match(current.currentCursor, /^agui_/u)
    const snapshot = await store.services.chat.snapshot("tenant_reconcile", "owner_reconcile", sessionId, undefined)
    assert.equal(snapshot.event_watermark, current.currentCursor)
    assert.deepEqual(
      snapshot.messages.map(({ role, content, status }) => ({
        role,
        content,
        status,
      })),
      [
        { role: "user", content: "Answer the question", status: "completed" },
        { role: "assistant", content: "Final answer.", status: "completed" },
      ],
    )
    assert.equal(await store.services.chat.snapshot("tenant_reconcile", "foreign_owner", sessionId, undefined), null)
    const duplicate = await store.agUi.ingest("tenant_reconcile", sessionId, [
      source(7, "message.delta", {
        segment_id: "agent_seg_b",
        delta: "answer",
      }),
    ])
    assert.equal(duplicate.insertedSources, 0)
    assert.deepEqual(await assistant(), {
      content: "Final answer.",
      status: "completed",
    })

    const failedTurn = await store.services.chatTurns.submit({
      tenantId: "tenant_reconcile",
      conversationId: sessionId,
      subjectId: "owner_reconcile",
      actorId: "owner_reconcile",
      requestId: "request_failed",
      idempotencyKey: "turn_failed",
      content: "Try again",
    })
    assert.ok(failedTurn)
    assert.equal(
      (await pool.query("SELECT expected_run_id FROM bff_agui_stream WHERE tenant_id = $1 AND session_id = $2", ["tenant_reconcile", sessionId])).rows[0]
        .expected_run_id,
      null,
    )
    await assert.rejects(
      store.agUi.ingest("tenant_reconcile", sessionId, [
        source(10, "message.delta", {
          segment_id: "late_old",
          delta: "late",
        }),
      ]),
      /AGUI_POST_TERMINAL_SOURCE/u,
    )
    assert.equal((await store.agUi.status("tenant_reconcile", sessionId)).sourceHighWatermark, 9)
    assert.deepEqual(await assistant(), {
      content: "Final answer.",
      status: "completed",
    })
    const failedAssistant = async () => {
      const result = await pool.query("SELECT content, status FROM bff_message WHERE message_id = $1", [failedTurn.assistant_message_id])
      return result.rows[0]
    }
    assert.deepEqual(await failedAssistant(), {
      content: "",
      status: "pending",
    })
    const [failedClaim] = await store.agentDispatchOutbox.claimAgentDispatchOutbox({
      workerId: "worker_reconcile_failed",
      limit: 1,
      leaseDurationMs: 5000,
      maxAttempts: 8,
    })
    assert.equal(failedClaim.runId, failedTurn.run_id)
    assert.equal(await store.agentDispatchOutbox.markAgentDispatchAdmitted(failedClaim), true)
    await store.agUi.ingest("tenant_reconcile", sessionId, [
      source(10, "message.delta", { segment_id: "failed_seg", delta: "Partial" }, failedTurn.run_id),
      source(
        11,
        "run.failed",
        {
          failure: {
            source: "agent",
            code: "model_unavailable",
            retryable: true,
          },
          message: "Agent run failed",
        },
        failedTurn.run_id,
      ),
    ])
    assert.deepEqual(await failedAssistant(), {
      content: "Partial",
      status: "failed",
    })
    assert.deepEqual(
      (
        await pool.query(
          `SELECT agent_failure_code, agent_failure_retryable
         FROM bff_message WHERE message_id = $1`,
          [failedTurn.assistant_message_id],
        )
      ).rows[0],
      {
        agent_failure_code: "model_unavailable",
        agent_failure_retryable: true,
      },
    )
    await assert.rejects(
      store.agUi.ingest("tenant_reconcile", sessionId, [source(12, "message.delta", { segment_id: "late_failed", delta: "wrong" }, failedTurn.run_id)]),
      /AGUI_POST_TERMINAL_SOURCE/u,
    )
    assert.deepEqual(await failedAssistant(), {
      content: "Partial",
      status: "failed",
    })

    const cancelledTurn = await store.services.chatTurns.submit({
      tenantId: "tenant_reconcile",
      conversationId: sessionId,
      subjectId: "owner_reconcile",
      actorId: "owner_reconcile",
      requestId: "request_cancelled",
      idempotencyKey: "turn_cancelled",
      content: "Cancel this",
    })
    assert.ok(cancelledTurn)
    const [cancelledClaim] = await store.agentDispatchOutbox.claimAgentDispatchOutbox({
      workerId: "worker_reconcile_cancelled",
      limit: 1,
      leaseDurationMs: 5000,
      maxAttempts: 8,
    })
    assert.equal(cancelledClaim.runId, cancelledTurn.run_id)
    assert.equal(await store.agentDispatchOutbox.markAgentDispatchAdmitted(cancelledClaim), true)
    await store.agUi.ingest("tenant_reconcile", sessionId, [
      source(12, "message.delta", { segment_id: "cancel_seg", delta: "Partial cancel" }, cancelledTurn.run_id),
      source(13, "run.completed", { status: "cancelled" }, cancelledTurn.run_id),
    ])
    const cancelledAssistant = await pool.query("SELECT content, status, agent_failure_code, agent_failure_retryable FROM bff_message WHERE message_id = $1", [
      cancelledTurn.assistant_message_id,
    ])
    assert.deepEqual(cancelledAssistant.rows[0], {
      content: "Partial cancel",
      status: "failed",
      agent_failure_code: null,
      agent_failure_retryable: null,
    })

    const dispatchFailedTurn = await store.services.chatTurns.submit({
      tenantId: "tenant_reconcile",
      conversationId: sessionId,
      subjectId: "owner_reconcile",
      actorId: "owner_reconcile",
      requestId: "request_dispatch_failed",
      idempotencyKey: "turn_dispatch_failed",
      content: "Do not revive",
    })
    assert.ok(dispatchFailedTurn)
    await pool.query("UPDATE bff_agent_dispatch_outbox SET status = 'failed', completed_at = CURRENT_TIMESTAMP(3) WHERE tenant_id = $1 AND run_id = $2", [
      "tenant_reconcile",
      dispatchFailedTurn.run_id,
    ])
    await pool.query("UPDATE bff_message SET status = 'failed' WHERE message_id = $1", [dispatchFailedTurn.assistant_message_id])
    await assert.rejects(
      store.agUi.ingest("tenant_reconcile", sessionId, [
        agentSource({
          id: "zero_frame_after_dispatch_failure",
          sequence: 14,
          kind: null,
          payload: { control: "receipt" },
          sessionId,
          runId: dispatchFailedTurn.run_id,
        }),
      ]),
      /AGUI_POST_TERMINAL_SOURCE/u,
    )
    await assert.rejects(
      store.agUi.ingest("tenant_reconcile", sessionId, [
        source(14, "message.delta", { segment_id: "after_dispatch_failure", delta: "wrong" }, dispatchFailedTurn.run_id),
        source(15, "run.completed", { status: "completed" }, dispatchFailedTurn.run_id),
      ]),
      /AGUI_POST_TERMINAL_SOURCE/u,
    )
    const dispatchFailedAssistant = await pool.query(
      "SELECT content, status, agent_failure_code, agent_failure_retryable FROM bff_message WHERE message_id = $1",
      [dispatchFailedTurn.assistant_message_id],
    )
    assert.deepEqual(dispatchFailedAssistant.rows[0], {
      content: "",
      status: "failed",
      agent_failure_code: null,
      agent_failure_retryable: null,
    })

    const rollbackTurn = await store.services.chatTurns.submit({
      tenantId: "tenant_reconcile",
      conversationId: sessionId,
      subjectId: "owner_reconcile",
      actorId: "owner_reconcile",
      requestId: "request_rollback",
      idempotencyKey: "turn_rollback",
      content: "Rollback on frame failure",
    })
    assert.ok(rollbackTurn)
    const [rollbackClaim] = await store.agentDispatchOutbox.claimAgentDispatchOutbox({
      workerId: "worker_reconcile_rollback",
      limit: 1,
      leaseDurationMs: 5000,
      maxAttempts: 8,
    })
    assert.equal(rollbackClaim.runId, rollbackTurn.run_id)
    assert.equal(await store.agentDispatchOutbox.markAgentDispatchAdmitted(rollbackClaim), true)
    await pool.query("ALTER TABLE bff_agui_event ADD CONSTRAINT ck_test_reject_projection_frame CHECK (event_type <> 'RUN_ERROR') NOT VALID")
    try {
      await assert.rejects(
        store.agUi.ingest("tenant_reconcile", sessionId, [
          source(
            14,
            "run.failed",
            {
              failure: {
                source: "agent",
                code: "dependency_unavailable",
                retryable: true,
              },
              message: "Agent run failed",
            },
            rollbackTurn.run_id,
          ),
        ]),
        { code: "23514" },
      )
      const unchangedAssistant = await pool.query(
        "SELECT content, status, agent_failure_code, agent_failure_retryable FROM bff_message WHERE message_id = $1",
        [rollbackTurn.assistant_message_id],
      )
      assert.deepEqual(unchangedAssistant.rows[0], {
        content: "",
        status: "pending",
        agent_failure_code: null,
        agent_failure_retryable: null,
      })
      assert.equal((await store.agUi.status("tenant_reconcile", sessionId)).sourceHighWatermark, 13)
      const missingSource = await pool.query("SELECT 1 FROM bff_agui_source_event WHERE tenant_id = $1 AND session_id = $2 AND source_sequence = 14", [
        "tenant_reconcile",
        sessionId,
      ])
      assert.equal(missingSource.rowCount, 0)
      const missingFrame = await pool.query("SELECT 1 FROM bff_agui_event WHERE tenant_id = $1 AND session_id = $2 AND source_event_id = 'reconcile_14'", [
        "tenant_reconcile",
        sessionId,
      ])
      assert.equal(missingFrame.rowCount, 0)
    } finally {
      await pool.query("ALTER TABLE bff_agui_event DROP CONSTRAINT ck_test_reject_projection_frame")
    }
  } finally {
    if (store !== null) await store.close()
    await pool.end()
  }
})

integrationTest("replays an Agent draft, tool, and empty final completion into the durable BFF assistant snapshot", async () => {
  const pool = new Pool({
    connectionString: postgresUrl,
    options: "-c search_path=kokoro_bff -c timezone=UTC",
  })
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
    await pool.query("INSERT INTO bff_conversation (conversation_id, tenant_id, owner_id, title) VALUES ($1, $2, $3, 'Empty final')", [
      sessionId,
      tenantId,
      subjectId,
    ])
    const turn = await store.services.chatTurns.submit({
      tenantId,
      conversationId: sessionId,
      subjectId,
      actorId: subjectId,
      requestId: "request_empty_final",
      idempotencyKey: "turn_empty_final",
      content: "Use the tool",
    })
    assert.ok(turn)
    const [claim] = await store.agentDispatchOutbox.claimAgentDispatchOutbox({
      workerId: "worker_empty_final",
      limit: 1,
      leaseDurationMs: 5000,
      maxAttempts: 8,
    })
    assert.equal(claim.runId, turn.run_id)
    assert.equal(await store.agentDispatchOutbox.markAgentDispatchAdmitted(claim), true)
    const wire = (seq, eventType, payload, chatMessageId = null) => ({
      chat_event_id: `empty_source_${seq}`,
      session_id: sessionId,
      run_id: turn.run_id,
      source_index: seq - 1,
      event_type: eventType,
      payload_json: JSON.stringify(payload),
      seq,
      created_at: seq * 1000,
      chat_message_id: chatMessageId,
    })
    // This is the Agent owner's published v1 replay shape, including a completed
    // final segment with no preceding delta and authoritative content="".
    const page = agentEventPage(
      {
        events: [
          wire(1, "run.started", { status: "running" }),
          wire(2, "assistant.delta", { delta: "draft" }, "draft-segment"),
          wire(3, "assistant.completed", { content: "draft" }, "draft-segment"),
          wire(4, "activity", {
            activity: "tool",
            activity_id: "act_" + "4".repeat(64),
            segment_id: "seg_" + "4".repeat(64),
            status: "running",
            display_code: "tool.execution",
          }),
          wire(5, "activity", {
            activity: "tool",
            activity_id: "act_" + "4".repeat(64),
            segment_id: "seg_" + "4".repeat(64),
            status: "completed",
            display_code: "tool.execution",
          }),
          wire(6, "assistant.completed", { content: "" }, "final-segment"),
          wire(7, "run.completed", {
            status: "completed",
            token_usage: null,
          }),
        ],
        next_seq: 7,
        watermark: 7,
      },
      sessionId,
      0,
      20,
    )
    assert.ok(page)
    const sources = page.events.map((event) => ({
      sourceRunId: event.run_id,
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
    assert.deepEqual(await assistant(), {
      content: "draft",
      status: "streaming",
    })
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
    assert.deepEqual(
      replay.frames.map((frame) => frame.eventType),
      ["CUSTOM", "RUN_STARTED", "TEXT_MESSAGE_START", "TEXT_MESSAGE_CONTENT", "TEXT_MESSAGE_END", "CUSTOM", "CUSTOM", "TEXT_MESSAGE_END", "RUN_FINISHED"],
    )
    assert.equal(replay.frames[0].payload.name, "kokoro.run.queued")
    assert.deepEqual(replay.frames[0].payload.value, {
      run_id: turn.run_id,
      dispatch_sequence: "1",
    })
    assert.deepEqual(
      replay.frames.map((frame) => frame.publicSequence),
      Array.from({ length: 9 }, (_, index) => index + 1),
    )
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
  const pool = new Pool({
    connectionString: postgresUrl,
    options: "-c search_path=kokoro_bff -c timezone=UTC",
  })
  let store = null
  try {
    await pool.query(`DROP TABLE IF EXISTS ${TABLES.join(", ")} CASCADE`)
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    store = new PostgresBffRepositories(postgresUrl, redisUrl)
    await store.ready()
    for (const damage of ["missing_message", "missing_outbox", "wrong_subject", "wrong_message_run"]) {
      const sessionId = `session_binding_${damage}`
      await pool.query("INSERT INTO bff_conversation (conversation_id, tenant_id, owner_id, title) VALUES ($1, $2, $3, 'Binding test')", [
        sessionId,
        "tenant_binding",
        "owner_binding",
      ])
      const receipt = await store.services.chatTurns.submit({
        tenantId: "tenant_binding",
        conversationId: sessionId,
        subjectId: "owner_binding",
        actorId: "owner_binding",
        requestId: `request_${damage}`,
        idempotencyKey: `turn_${damage}`,
        content: "Check binding",
      })
      assert.ok(receipt)
      const [claim] = await store.agentDispatchOutbox.claimAgentDispatchOutbox({
        workerId: `worker_${damage}`,
        limit: 1,
        leaseDurationMs: 5000,
        maxAttempts: 8,
      })
      assert.equal(claim.runId, receipt.run_id)
      assert.equal(await store.agentDispatchOutbox.markAgentDispatchAdmitted(claim), true)
      if (damage === "missing_message") {
        await pool.query("DELETE FROM bff_message WHERE message_id = $1", [receipt.assistant_message_id])
      } else if (damage === "missing_outbox") {
        await pool.query("DELETE FROM bff_agent_dispatch_outbox WHERE tenant_id = $1 AND run_id = $2", ["tenant_binding", receipt.run_id])
      } else if (damage === "wrong_subject") {
        await pool.query("UPDATE bff_agent_dispatch_outbox SET subject_id = 'intruder' WHERE tenant_id = $1 AND run_id = $2", [
          "tenant_binding",
          receipt.run_id,
        ])
      } else {
        await pool.query("UPDATE bff_message SET run_id = 'unrelated_run' WHERE message_id = $1", [receipt.assistant_message_id])
      }
      await assert.rejects(
        store.agUi.ingest("tenant_binding", sessionId, [
          agentSource({
            id: `source_${damage}`,
            sequence: 1,
            kind: "message.delta",
            payload: {
              segment_id: `segment_${damage}`,
              delta: "must roll back",
            },
            sessionId,
            runId: receipt.run_id,
          }),
        ]),
        /AGUI_ASSISTANT_BINDING_MISSING/u,
      )
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
  const pool = new Pool({
    connectionString: postgresUrl,
    options: "-c search_path=kokoro_bff -c timezone=UTC",
  })
  let store = null
  try {
    await pool.query(`DROP TABLE IF EXISTS ${TABLES.join(", ")} CASCADE`)
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    store = new PostgresBffRepositories(postgresUrl, redisUrl)
    await store.ready()
    const sessionId = "session_latest_messages"
    await pool.query("INSERT INTO bff_conversation (conversation_id, tenant_id, owner_id, title) VALUES ($1, $2, $3, 'Long chat')", [
      sessionId,
      "tenant_latest",
      "owner_latest",
    ])
    await pool.query(
      `INSERT INTO bff_message (message_id, tenant_id, conversation_id, role, content, status, message_seq)
       SELECT 'message_' || seq::text, 'tenant_latest', $1,
              CASE WHEN seq = 121 THEN 'assistant' ELSE 'user' END,
              CASE WHEN seq = 121 THEN 'Latest completed answer' ELSE 'Earlier message ' || seq::text END,
              'completed', seq
         FROM generate_series(1, 121) AS seq`,
      [sessionId],
    )
    await store.agUiConsumers.registerConsumer("tenant_latest", sessionId, "owner_latest")
    await store.agUi.ingest("tenant_latest", sessionId, [
      agentSource({
        id: "latest_run",
        sequence: 1,
        kind: "run.created",
        payload: {},
        sessionId,
        runId: "run_latest",
      }),
    ])
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
  const pool = new Pool({
    connectionString: postgresUrl,
    options: "-c search_path=kokoro_bff -c timezone=UTC",
  })
  const redis = createClient({ url: redisUrl })
  let store = null
  try {
    await pool.query(`DROP TABLE IF EXISTS ${TABLES.join(", ")} CASCADE`)
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    await redis.connect()

    store = new PostgresBffRepositories(postgresUrl, redisUrl)
    await store.ready()

    const first = await store.agUi.ingest("tenant_a", "session_shared", [
      agentSource({
        id: "agent_event_1",
        sequence: 1,
        kind: "message.delta",
        payload: { segment_id: "message_1", delta: "Hello" },
      }),
    ])
    assert.deepEqual(first, {
      insertedSources: 1,
      insertedFrames: 2,
      sourceHighWatermark: 1,
    })

    const initial = await store.agUi.replay("tenant_a", "session_shared", null, 100)
    assert.equal(initial.kind, "page")
    assert.deepEqual(
      initial.frames.map((frame) => frame.publicSequence),
      [1, 2],
    )
    assert.deepEqual(
      initial.frames.map((frame) => frame.eventType),
      ["TEXT_MESSAGE_START", "TEXT_MESSAGE_CONTENT"],
    )
    assert.equal(new Set(initial.frames.map((frame) => frame.cursor)).size, 2)
    assert.ok(initial.frames.every((frame) => /^agui_[0-9a-f]{32}$/u.test(frame.cursor)))

    const afterExpandedStart = await store.agUi.replay("tenant_a", "session_shared", initial.frames[0].cursor, 100)
    assert.equal(afterExpandedStart.kind, "page")
    assert.deepEqual(
      afterExpandedStart.frames.map((frame) => frame.eventType),
      ["TEXT_MESSAGE_CONTENT"],
    )

    const second = await store.agUi.ingest("tenant_a", "session_shared", [
      agentSource({
        id: "agent_event_2",
        sequence: 2,
        kind: "message.delta",
        payload: { segment_id: "message_1", delta: " world" },
      }),
    ])
    assert.deepEqual(second, {
      insertedSources: 1,
      insertedFrames: 1,
      sourceHighWatermark: 2,
    })
    const afterSecond = await store.agUi.replay("tenant_a", "session_shared", null, 100)
    assert.equal(afterSecond.kind, "page")
    const currentCursor = afterSecond.frames.at(-1).cursor

    const duplicate = await store.agUi.ingest("tenant_a", "session_shared", [
      agentSource({
        id: "agent_event_2",
        sequence: 2,
        kind: "message.delta",
        payload: { segment_id: "message_1", delta: " world" },
      }),
    ])
    assert.deepEqual(duplicate, {
      insertedSources: 0,
      insertedFrames: 0,
      sourceHighWatermark: 2,
    })

    await assert.rejects(
      store.agUi.ingest("tenant_a", "session_shared", [
        agentSource({
          id: "agent_event_2",
          sequence: 2,
          kind: "message.delta",
          payload: { segment_id: "message_1", delta: "mutated after commit" },
        }),
      ]),
      /AG-UI source identity conflict/u,
    )

    await assert.rejects(
      store.agUi.ingest("tenant_a", "session_shared", [
        agentSource({
          id: "agent_event_other",
          sequence: 2,
          kind: "message.delta",
          payload: { segment_id: "message_1", delta: "reused sequence" },
        }),
      ]),
      /AG-UI source identity conflict/u,
    )

    await assert.rejects(
      store.agUi.ingest("tenant_a", "session_shared", [
        agentSource({
          id: "agent_event_2",
          sequence: 3,
          kind: "message.delta",
          payload: { segment_id: "message_1", delta: "mutated" },
        }),
      ]),
      /AG-UI source identity conflict/u,
    )

    const unknown = await store.agUi.ingest("tenant_a", "session_shared", [
      agentSource({
        id: "agent_event_3",
        sequence: 3,
        kind: null,
        payload: { unsupported: true },
      }),
    ])
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
    assert.equal(
      concurrent.reduce((count, result) => count + result.insertedSources, 0),
      1,
    )
    const concurrentReplay = await store.agUi.replay("tenant_a", "session_concurrent", null, 100)
    assert.equal(concurrentReplay.kind, "page")
    assert.deepEqual(
      concurrentReplay.frames.map((frame) => frame.publicSequence),
      [1, 2],
    )

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
    assert.deepEqual(rows.rows[0], {
      source_count: 3,
      frame_count: 3,
      sequences: ["1", "2", "3"],
    })

    const redisKeys = []
    for await (const keys of redis.scanIterator({
      MATCH: "kokoro:bff:agui:*",
    }))
      redisKeys.push(...keys)
    assert.deepEqual(redisKeys, [])

    await store.close()
    store = new PostgresBffRepositories(postgresUrl, redisUrl)
    const afterRestart = await store.agUi.replay("tenant_a", "session_shared", initial.frames[0].cursor, 100)
    assert.equal(afterRestart.kind, "page")
    assert.deepEqual(
      afterRestart.frames.map((frame) => frame.publicSequence),
      [2, 3],
    )
    assert.deepEqual(
      afterRestart.frames.map((frame) => frame.eventType),
      ["TEXT_MESSAGE_CONTENT", "TEXT_MESSAGE_CONTENT"],
    )

    const resumedProjection = await store.agUi.ingest("tenant_a", "session_shared", [
      agentSource({
        id: "agent_event_4",
        sequence: 4,
        kind: "message.delta",
        payload: { segment_id: "message_1", delta: " after restart" },
      }),
    ])
    assert.deepEqual(resumedProjection, {
      insertedSources: 1,
      insertedFrames: 1,
      sourceHighWatermark: 4,
    })
    const resumedFrames = await store.agUi.replay("tenant_a", "session_shared", currentCursor, 100)
    assert.equal(resumedFrames.kind, "page")
    assert.deepEqual(
      resumedFrames.frames.map((frame) => frame.eventType),
      ["TEXT_MESSAGE_CONTENT"],
    )
    assert.deepEqual(
      resumedFrames.frames.map((frame) => frame.publicSequence),
      [4],
    )
  } finally {
    if (store !== null) await store.close().catch(() => undefined)
    if (redis.isOpen) await redis.quit().catch(() => undefined)
    await pool.end()
  }
})

integrationTest("keeps replay page boundaries and terminal state tied to the latest run identity", async () => {
  const pool = new Pool({
    connectionString: postgresUrl,
    options: "-c search_path=kokoro_bff -c timezone=UTC",
  })
  let store = null
  try {
    await pool.query(`DROP TABLE IF EXISTS ${TABLES.join(", ")} CASCADE`)
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    store = new PostgresBffRepositories(postgresUrl, redisUrl)
    const firstRun = await submitAndAdmit(store, pool, {
      tenantId: "tenant_a",
      sessionId: "session_runs",
      ownerId: "owner_runs",
      suffix: "page_first",
    })

    await store.agUi.ingest("tenant_a", "session_runs", [
      agentSource({
        id: "run_1_started",
        sequence: 1,
        kind: "run.created",
        payload: { run_id: firstRun },
        sessionId: "session_runs",
        runId: firstRun,
      }),
      agentSource({
        id: "run_1_finished",
        sequence: 2,
        kind: "run.completed",
        payload: { status: "completed" },
        sessionId: "session_runs",
        runId: firstRun,
      }),
    ])
    const secondRun = await submitAndAdmit(store, pool, {
      tenantId: "tenant_a",
      sessionId: "session_runs",
      ownerId: "owner_runs",
      suffix: "page_second",
    })
    await store.agUi.ingest("tenant_a", "session_runs", [
      agentSource({
        id: "run_2_started",
        sequence: 3,
        kind: "run.created",
        payload: { run_id: secondRun },
        sessionId: "session_runs",
        runId: secondRun,
      }),
    ])

    const pageAtOldTerminal = await store.agUi.replay("tenant_a", "session_runs", null, 3)
    assert.equal(pageAtOldTerminal.kind, "page")
    assert.deepEqual(
      pageAtOldTerminal.frames.map((frame) => frame.eventType),
      ["CUSTOM", "RUN_STARTED", "RUN_FINISHED"],
    )
    assert.equal(pageAtOldTerminal.frames[0].payload.name, "kokoro.run.queued")
    assert.deepEqual(pageAtOldTerminal.frames[0].payload.value, {
      run_id: firstRun,
      dispatch_sequence: "1",
    })
    assert.deepEqual(
      pageAtOldTerminal.frames.map((frame) => frame.publicSequence),
      [1, 2, 3],
    )
    assert.equal(pageAtOldTerminal.atHead, false)
    assert.equal(pageAtOldTerminal.terminalRunId, null)

    const activeHead = await store.agUi.replay("tenant_a", "session_runs", pageAtOldTerminal.frames.at(-1).cursor, 2)
    assert.equal(activeHead.kind, "page")
    assert.deepEqual(
      activeHead.frames.map((frame) => frame.eventType),
      ["CUSTOM", "RUN_STARTED"],
    )
    assert.equal(activeHead.frames[0].payload.name, "kokoro.run.queued")
    assert.deepEqual(activeHead.frames[0].payload.value, {
      run_id: secondRun,
      dispatch_sequence: "3",
    })
    assert.deepEqual(
      activeHead.frames.map((frame) => frame.publicSequence),
      [4, 5],
    )
    assert.equal(activeHead.atHead, true)
    assert.equal(activeHead.terminalRunId, null)

    await store.agUi.ingest("tenant_a", "session_runs", [
      agentSource({
        id: "run_2_finished",
        sequence: 4,
        kind: "run.completed",
        payload: { status: "completed" },
        sessionId: "session_runs",
        runId: secondRun,
      }),
    ])
    const terminalHead = await store.agUi.replay("tenant_a", "session_runs", activeHead.frames.at(-1).cursor, 1)
    assert.equal(terminalHead.kind, "page")
    assert.equal(terminalHead.atHead, true)
    assert.equal(terminalHead.terminalRunId, secondRun)

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
  const pool = new Pool({
    connectionString: postgresUrl,
    options: "-c search_path=kokoro_bff -c timezone=UTC",
  })
  let store = null
  try {
    await pool.query(`DROP TABLE IF EXISTS ${TABLES.join(", ")} CASCADE`)
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    store = new PostgresBffRepositories(postgresUrl, redisUrl)
    const oldRun = await submitAndAdmit(store, pool, {
      tenantId: "tenant_a",
      sessionId: "session_append",
      ownerId: "owner_append",
      suffix: "append_old",
    })
    await store.agUi.ingest("tenant_a", "session_append", [
      agentSource({
        id: "old_started",
        sequence: 1,
        kind: "run.created",
        payload: { run_id: oldRun },
        sessionId: "session_append",
        runId: oldRun,
      }),
      agentSource({
        id: "old_finished",
        sequence: 2,
        kind: "run.completed",
        payload: { status: "completed" },
        sessionId: "session_append",
        runId: oldRun,
      }),
    ])
    const newRun = await submitAndAdmit(store, pool, {
      tenantId: "tenant_a",
      sessionId: "session_append",
      ownerId: "owner_append",
      suffix: "append_new",
    })
    const [page] = await Promise.all([
      store.agUi.replay("tenant_a", "session_append", null, 100),
      store.agUi.ingest("tenant_a", "session_append", [
        agentSource({
          id: "started_new",
          sequence: 3,
          kind: "run.created",
          payload: { run_id: newRun },
          sessionId: "session_append",
          runId: newRun,
        }),
      ]),
    ])
    assert.equal(page.kind, "page")
    const visibleRunIds = page.frames.filter((frame) => frame.eventType === "RUN_STARTED").map((frame) => frame.payload.metadata.kokoro.run_id)
    if (page.atHead && visibleRunIds.at(-1) === newRun) assert.equal(page.terminalRunId, null)
  } finally {
    if (store !== null) await store.close().catch(() => undefined)
    await pool.end()
  }
})

integrationTest("replays a committed projection immediately when Redis was never reachable", async () => {
  const pool = new Pool({
    connectionString: postgresUrl,
    options: "-c search_path=kokoro_bff -c timezone=UTC",
  })
  let database = null
  try {
    await pool.query(`DROP TABLE IF EXISTS ${TABLES.join(", ")} CASCADE`)
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    database = new PostgresBffDatabase(postgresUrl, "redis://127.0.0.1:1/8")
    const projection = new AgUiProjectionService(new PostgresAgUiProjectionRepository(database))

    const outcome = await Promise.race([
      projection
        .ingest("tenant_a", "session_redis_down", [
          agentSource({
            id: "redis_down_source",
            sequence: 1,
            kind: "message.delta",
            payload: { segment_id: "message_redis_down", delta: "durable" },
            sessionId: "session_redis_down",
          }),
        ])
        .then(() => "committed"),
      new Promise((resolve) => setTimeout(() => resolve("blocked"), 500)),
    ])
    assert.equal(outcome, "committed")

    const replay = await projection.replay("tenant_a", "session_redis_down", null, 100)
    assert.equal(replay.kind, "page")
    assert.deepEqual(
      replay.frames.map((frame) => frame.eventType),
      ["TEXT_MESSAGE_START", "TEXT_MESSAGE_CONTENT"],
    )
  } finally {
    if (database !== null) {
      if (database.redis.isOpen) database.redis.destroy()
      await database.pool.end().catch(() => undefined)
    }
    await pool.end()
  }
})

integrationTest("replays a committed projection immediately after the Redis notification connection drops", async () => {
  const pool = new Pool({
    connectionString: postgresUrl,
    options: "-c search_path=kokoro_bff -c timezone=UTC",
  })
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
      projection
        .ingest("tenant_a", "session_redis_drop", [
          agentSource({
            id: "redis_drop_source",
            sequence: 1,
            kind: "message.delta",
            payload: { segment_id: "message_redis_drop", delta: "durable" },
            sessionId: "session_redis_drop",
          }),
        ])
        .then(() => "committed"),
      new Promise((resolve) => setTimeout(() => resolve("blocked"), 500)),
    ])
    assert.equal(outcome, "committed")
    const replay = await projection.replay("tenant_a", "session_redis_drop", null, 100)
    assert.equal(replay.kind, "page")
    assert.deepEqual(
      replay.frames.map((frame) => frame.eventType),
      ["TEXT_MESSAGE_START", "TEXT_MESSAGE_CONTENT"],
    )
  } finally {
    if (database !== null) await database.close().catch(() => undefined)
    await proxy.disconnect().catch(() => undefined)
    await pool.end()
  }
})

integrationTest("claims AG-UI consumers with fencing and never commits through a superseded lease", async () => {
  const pool = new Pool({
    connectionString: postgresUrl,
    options: "-c search_path=kokoro_bff -c timezone=UTC",
  })
  let store = null
  try {
    await pool.query(`DROP TABLE IF EXISTS ${TABLES.join(", ")} CASCADE`)
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    await pool.query(
      `INSERT INTO bff_conversation (conversation_id, tenant_id, owner_id, title)
       VALUES ($1, $2, $3, $4)`,
      ["session_fenced", "tenant_a", "user_a", "Fenced projection"],
    )
    store = new PostgresBffRepositories(postgresUrl, redisUrl)
    await store.ready()
    const turn = await store.services.chatTurns.submit({
      tenantId: "tenant_a",
      conversationId: "session_fenced",
      subjectId: "user_a",
      actorId: "user_a",
      requestId: "request_fenced",
      idempotencyKey: "turn_fenced",
      content: "start",
    })
    assert.ok(turn)
    const [dispatch] = await store.agentDispatchOutbox.claimAgentDispatchOutbox({
      workerId: "worker_fenced_dispatch",
      limit: 1,
      leaseDurationMs: 5000,
      maxAttempts: 8,
    })
    assert.equal(dispatch.runId, turn.run_id)
    assert.equal(await store.agentDispatchOutbox.markAgentDispatchAdmitted(dispatch), true)
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
    assert.deepEqual(
      await store.agUiConsumers.claimConsumers({
        workerId: "worker_b",
        now: now.toISOString(),
        leaseUntil,
        limit: 10,
      }),
      [],
    )
    const firstLease = firstClaims[0]
    await store.agUi.ingest(
      "tenant_a",
      "session_fenced",
      [
        agentSource({
          id: "fenced_source_1",
          sequence: 1,
          kind: "run.created",
          payload: { run_id: turn.run_id },
          sessionId: "session_fenced",
          runId: turn.run_id,
        }),
      ],
      firstLease,
    )
    assert.equal(await store.agUiConsumers.markConsumerRetryable(firstLease, now.toISOString(), "source_gap", now.toISOString()), true)

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
      store.agUi.ingest(
        "tenant_a",
        "session_fenced",
        [
          agentSource({
            id: "fenced_source_2",
            sequence: 2,
            kind: "run.failed",
            payload: {
              failure: {
                source: "agent",
                code: "dependency_unavailable",
                retryable: true,
              },
              message: "Agent run failed",
            },
            sessionId: "session_fenced",
            runId: turn.run_id,
          }),
        ],
        firstLease,
      ),
      /consumer lease was lost/u,
    )
    assert.deepEqual(
      (await pool.query("SELECT status, agent_failure_code, agent_failure_retryable FROM bff_message WHERE message_id = $1", [turn.assistant_message_id]))
        .rows[0],
      {
        status: "pending",
        agent_failure_code: null,
        agent_failure_retryable: null,
      },
    )
    const committed = await store.agUi.ingest(
      "tenant_a",
      "session_fenced",
      [
        agentSource({
          id: "fenced_source_2",
          sequence: 2,
          kind: "run.failed",
          payload: {
            failure: {
              source: "agent",
              code: "dependency_unavailable",
              retryable: true,
            },
            message: "Agent run failed",
          },
          sessionId: "session_fenced",
          runId: turn.run_id,
        }),
      ],
      secondClaims[0],
    )
    assert.equal(committed.sourceHighWatermark, 2)
    assert.deepEqual(
      (await pool.query("SELECT status, agent_failure_code, agent_failure_retryable FROM bff_message WHERE message_id = $1", [turn.assistant_message_id]))
        .rows[0],
      {
        status: "failed",
        agent_failure_code: "dependency_unavailable",
        agent_failure_retryable: true,
      },
    )
    const settledAt = new Date(now.getTime() + 2)
    assert.equal(await store.agUiConsumers.markConsumerProgress(secondClaims[0], settledAt.toISOString(), settledAt.toISOString()), true)
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
  const pool = new Pool({
    connectionString: postgresUrl,
    options: "-c search_path=kokoro_bff -c timezone=UTC",
  })
  let store = null
  try {
    await pool.query(`DROP TABLE IF EXISTS ${TABLES.join(", ")} CASCADE`)
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    store = new PostgresBffRepositories(postgresUrl, redisUrl)
    await pool.query("INSERT INTO bff_conversation (conversation_id, tenant_id, owner_id, title) VALUES ('session_gc', 'tenant_a', 'owner_gc', 'GC snapshot')")
    const latestRun = await submitAndAdmit(store, pool, {
      tenantId: "tenant_a",
      sessionId: "session_gc",
      ownerId: "owner_gc",
      suffix: "gc_latest",
    })
    // Ingestion is covered above; this durable association isolates normal frame GC from snapshot reads.
    await pool.query(
      `INSERT INTO bff_conversation_artifact
         (tenant_id, conversation_id, artifact_id, run_id, source_owner, source_event_id,
          source_sequence, source_digest, source_asset_id, source_artifact_kind,
          source_content_sha256, source_title, source_mime, source_size_bytes, delivered_at)
       VALUES ('tenant_a', 'session_gc', 'artifact_gc', 'run_1', 'kokoro-agent', 'source_artifact_gc',
               1, repeat('a', 64), 'asset_gc', 'document', repeat('b', 64),
               'GC report', 'text/plain', 8, '2026-09-28T00:00:00Z')`,
    )
    await store.agUi.ingest("tenant_a", "session_gc", [
      agentSource({
        id: "gc_1",
        sequence: 1,
        kind: "run.created",
        payload: { run_id: "run_1" },
        sessionId: "session_gc",
        runId: "run_1",
      }),
      agentSource({
        id: "gc_2",
        sequence: 2,
        kind: "run.failed",
        payload: {
          failure: {
            source: "agent",
            code: "dependency_unavailable",
            retryable: true,
          },
          message: "Agent run failed",
        },
        sessionId: "session_gc",
        runId: "run_1",
      }),
      agentSource({
        id: "gc_3",
        sequence: 3,
        kind: "run.created",
        payload: { run_id: latestRun },
        sessionId: "session_gc",
        runId: latestRun,
      }),
      agentSource({
        id: "gc_4",
        sequence: 4,
        kind: "message.delta",
        payload: { segment_id: "message_2", delta: "hello" },
        sessionId: "session_gc",
        runId: latestRun,
      }),
      agentSource({
        id: "gc_5",
        sequence: 5,
        kind: "message.completed",
        payload: { segment_id: "message_2", content: "hello" },
        sessionId: "session_gc",
        runId: latestRun,
      }),
      agentSource({
        id: "gc_6",
        sequence: 6,
        kind: "run.completed",
        payload: { status: "completed" },
        sessionId: "session_gc",
        runId: latestRun,
      }),
    ])
    await pool.query("DELETE FROM bff_message WHERE tenant_id='tenant_a' AND conversation_id='session_gc' AND run_id=$1", [latestRun])
    await pool.query(
      `INSERT INTO bff_message
       (message_id, tenant_id, conversation_id, run_id, role, content, status, message_seq,
          agent_failure_code, agent_failure_retryable)
       VALUES ('message_failure_gc', 'tenant_a', 'session_gc', 'run_1', 'assistant', 'partial', 'failed', 1,
               'dependency_unavailable', TRUE)`,
    )
    const share = await store.services.chat.createShare("tenant_a", "owner_gc", "session_gc")
    assert.ok(share)
    const before = await store.agUi.replay("tenant_a", "session_gc", null, 100)
    assert.equal(before.kind, "page")
    assert.equal(before.frames.length, 8)
    assert.deepEqual(
      before.frames.map((frame) => frame.eventType),
      ["CUSTOM", "RUN_STARTED", "RUN_ERROR", "RUN_STARTED", "TEXT_MESSAGE_START", "TEXT_MESSAGE_CONTENT", "TEXT_MESSAGE_END", "RUN_FINISHED"],
    )
    assert.equal(before.frames[0].payload.name, "kokoro.run.queued")
    assert.deepEqual(before.frames[0].payload.value, {
      run_id: latestRun,
      dispatch_sequence: "1",
    })
    assert.equal(before.frames[2].eventType, "RUN_ERROR")
    assert.deepEqual(before.frames[2].payload.metadata.kokoro.failure, {
      source: "agent",
      code: "dependency_unavailable",
      retryable: true,
    })
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
    assert.equal(collected.framesDeleted, 3)
    assert.equal(collected.tombstonesInserted, 3)
    assert.deepEqual(await store.agUi.replay("tenant_a", "session_gc", expiredCursor, 100), { kind: "expired_cursor" })
    const refreshed = await store.services.chat.snapshot("tenant_a", "owner_gc", "session_gc", undefined)
    assert.deepEqual(
      refreshed.deliveries.map(({ conversation_id, artifact_id }) => [conversation_id, artifact_id]),
      [["session_gc", "artifact_gc"]],
    )
    assert.deepEqual(
      refreshed.messages.map(({ failure }) => failure),
      [{ source: "agent", code: "dependency_unavailable", retryable: true }],
    )
    const listed = await store.services.chat.listMessages("tenant_a", "owner_gc", "session_gc", 100, null)
    assert.ok(listed)
    assert.deepEqual(
      listed.messages.map(({ run_id, status, failure }) => ({
        run_id,
        status,
        failure,
      })),
      [
        {
          run_id: "run_1",
          status: "failed",
          failure: {
            source: "agent",
            code: "dependency_unavailable",
            retryable: true,
          },
        },
      ],
    )
    const shared = await store.services.publicShares.listMessages(share.shareId, "tenant_a", "session_gc", 100)
    assert.ok(shared)
    assert.deepEqual(
      shared.messages.map(({ run_id, status, failure }) => ({
        run_id,
        status,
        failure,
      })),
      [
        {
          run_id: "run_1",
          status: "failed",
          failure: {
            source: "agent",
            code: "dependency_unavailable",
            retryable: true,
          },
        },
      ],
    )
    assert.equal(refreshed.deliveries_has_more, false)
    assert.equal(refreshed.event_watermark, headCursor)
    assert.equal(refreshed.active_run, undefined)
    assert.equal(refreshed.execution_head, undefined)
    const marker = await pool.query(
      `SELECT expected_run_id, latest_run_id, terminal_run_id FROM bff_agui_stream WHERE tenant_id = 'tenant_a' AND session_id = 'session_gc'`,
    )
    assert.deepEqual(marker.rows, [
      {
        expected_run_id: null,
        latest_run_id: latestRun,
        terminal_run_id: latestRun,
      },
    ])
    const retained = await store.agUi.replay("tenant_a", "session_gc", null, 100)
    assert.equal(retained.kind, "page")
    assert.deepEqual(
      retained.frames.map((frame) => frame.eventType),
      ["RUN_STARTED", "TEXT_MESSAGE_START", "TEXT_MESSAGE_CONTENT", "TEXT_MESSAGE_END", "RUN_FINISHED"],
    )
    assert.equal(
      retained.frames.some((frame) => frame.eventType === "RUN_ERROR"),
      false,
    )
    assert.equal(retained.frames.at(-1).cursor, headCursor)
    assert.equal((await store.agUi.status("tenant_a", "session_gc")).retentionFloorSequence, 3)

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
  const pool = new Pool({
    connectionString: postgresUrl,
    options: "-c search_path=kokoro_bff -c timezone=UTC",
  })
  let store = null
  try {
    await pool.query(`DROP TABLE IF EXISTS ${TABLES.join(", ")} CASCADE`)
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    store = new PostgresBffRepositories(postgresUrl, redisUrl)
    const runB = await submitAndAdmit(store, pool, {
      tenantId: "tenant_a",
      sessionId: "session_interleaved_gc",
      ownerId: "owner_interleaved_gc",
      suffix: "interleaved_gc_b",
    })
    await store.agUi.ingest("tenant_a", "session_interleaved_gc", [
      agentSource({
        id: "run_a_started",
        sequence: 1,
        kind: "run.created",
        payload: { run_id: "run_a" },
        sessionId: "session_interleaved_gc",
        runId: "run_a",
      }),
      agentSource({
        id: "run_b_started",
        sequence: 2,
        kind: "run.created",
        payload: { run_id: runB },
        sessionId: "session_interleaved_gc",
        runId: runB,
      }),
      agentSource({
        id: "run_a_finished",
        sequence: 3,
        kind: "run.completed",
        payload: { status: "completed" },
        sessionId: "session_interleaved_gc",
        runId: "run_a",
      }),
      agentSource({
        id: "run_b_finished",
        sequence: 4,
        kind: "run.completed",
        payload: { status: "completed" },
        sessionId: "session_interleaved_gc",
        runId: runB,
      }),
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
    assert.equal(retained.frames[0].payload.name, "kokoro.run.queued")
    assert.deepEqual(retained.frames[0].payload.value, {
      run_id: runB,
      dispatch_sequence: "1",
    })
    assert.deepEqual(
      retained.frames.map((frame) => frame.eventType),
      ["CUSTOM", "RUN_STARTED", "RUN_STARTED", "RUN_FINISHED", "RUN_FINISHED"],
    )
  } finally {
    if (store !== null) await store.close().catch(() => undefined)
    await pool.end()
  }
})

integrationTest("garbage collection skips ineligible streams instead of starving eligible later streams", async () => {
  const pool = new Pool({
    connectionString: postgresUrl,
    options: "-c search_path=kokoro_bff -c timezone=UTC",
  })
  let store = null
  try {
    await pool.query(`DROP TABLE IF EXISTS ${TABLES.join(", ")} CASCADE`)
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    await pool.query(
      `INSERT INTO bff_agui_stream (tenant_id, session_id, updated_at)
       SELECT 'tenant_a', 'inert_' || lpad(series::text, 3, '0'), CURRENT_TIMESTAMP(3) - INTERVAL '10 days'
         FROM generate_series(1, 100) AS series`,
    )
    await pool.query(
      "INSERT INTO bff_conversation (tenant_id,conversation_id,owner_id,title) VALUES ('tenant_a','session_gc_later','user_gc_later','GC eligible parent')",
    )
    store = new PostgresBffRepositories(postgresUrl, redisUrl)
    await store.agUiConsumers.registerConsumer("tenant_a", "session_gc_later", "user_gc_later")
    await store.agUi.ingest("tenant_a", "session_gc_later", [
      agentSource({
        id: "gc_later_1",
        sequence: 1,
        kind: "run.created",
        payload: { run_id: "run_1" },
        sessionId: "session_gc_later",
        runId: "run_1",
      }),
      agentSource({
        id: "gc_later_2",
        sequence: 2,
        kind: "run.completed",
        payload: { status: "completed" },
        sessionId: "session_gc_later",
        runId: "run_1",
      }),
      agentSource({
        id: "gc_later_3",
        sequence: 3,
        kind: "run.created",
        payload: { run_id: "run_2" },
        sessionId: "session_gc_later",
        runId: "run_2",
      }),
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
  const pool = new Pool({
    connectionString: postgresUrl,
    options: "-c search_path=kokoro_bff -c timezone=UTC",
  })
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
      store.agUi.ingest(
        "tenant_a",
        "session_deleted",
        [
          agentSource({
            id: "deleted_source_1",
            sequence: 1,
            kind: "run.created",
            payload: { run_id: "run_deleted" },
            sessionId: "session_deleted",
            runId: "run_deleted",
          }),
        ],
        activeClaims[0],
      ),
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
  const pool = new Pool({
    connectionString: postgresUrl,
    options: "-c search_path=kokoro_bff -c timezone=UTC",
  })
  let store = null
  try {
    await pool.query(`DROP TABLE IF EXISTS ${TABLES.join(", ")} CASCADE`)
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    await pool.query(
      `INSERT INTO bff_conversation (conversation_id, tenant_id, owner_id, title)
       VALUES ('session_next_run', 'tenant_a', 'user_a', 'Next run')`,
    )
    store = new PostgresBffRepositories(postgresUrl, redisUrl)
    const oldTurn = await store.services.chatTurns.submit({
      tenantId: "tenant_a",
      conversationId: "session_next_run",
      subjectId: "user_a",
      actorId: "user_a",
      requestId: "request_old_run",
      idempotencyKey: "turn_old_run",
      content: "Finish the old run",
    })
    assert.ok(oldTurn)
    const [oldClaim] = await store.agentDispatchOutbox.claimAgentDispatchOutbox({
      workerId: "worker_old_run",
      limit: 1,
      leaseDurationMs: 5000,
      maxAttempts: 8,
    })
    assert.equal(oldClaim.runId, oldTurn.run_id)
    assert.equal(await store.agentDispatchOutbox.markAgentDispatchAdmitted(oldClaim), true)
    await store.agUi.ingest("tenant_a", "session_next_run", [
      agentSource({
        id: "old_run_started",
        sequence: 1,
        kind: "run.created",
        payload: { run_id: oldTurn.run_id },
        sessionId: "session_next_run",
        runId: oldTurn.run_id,
      }),
      agentSource({
        id: "old_run_finished",
        sequence: 2,
        kind: "run.completed",
        payload: { status: "completed" },
        sessionId: "session_next_run",
        runId: oldTurn.run_id,
      }),
    ])
    const before = await store.agUi.replay("tenant_a", "session_next_run", null, 100)
    assert.equal(before.kind, "page")
    assert.equal(before.terminalRunId, oldTurn.run_id)

    const admitted = await store.services.chatTurns.submit({
      tenantId: "tenant_a",
      conversationId: "session_next_run",
      subjectId: "user_a",
      actorId: "user_a",
      requestId: "request_next_run",
      idempotencyKey: "turn_next_run",
      content: "Start the next run",
    })
    assert.ok(admitted)
    const newRunId = admitted.run_id

    const awaitingSource = await store.agUi.replay("tenant_a", "session_next_run", before.frames.at(-1).cursor, 100)
    assert.equal(awaitingSource.kind, "page")
    assert.equal(awaitingSource.terminalRunId, null)
    assert.deepEqual(
      awaitingSource.frames.map((frame) => frame.eventType),
      ["CUSTOM"],
    )
    assert.equal(awaitingSource.frames[0].payload.name, "kokoro.run.queued")
    assert.deepEqual(awaitingSource.frames[0].payload.value, {
      run_id: newRunId,
      dispatch_sequence: "3",
    })
    assert.equal(
      (await pool.query("SELECT terminal_run_id FROM bff_agui_stream WHERE tenant_id='tenant_a' AND session_id='session_next_run'")).rows[0].terminal_run_id,
      oldTurn.run_id,
    )
    assert.deepEqual((await store.services.chat.snapshot("tenant_a", "user_a", "session_next_run", undefined)).execution_head, {
      run_id: newRunId,
      state: "queued",
      pending_pauses: [],
    })
    const queuedSnapshot = await store.services.chat.snapshot("tenant_a", "user_a", "session_next_run", undefined)
    assert.equal(queuedSnapshot.active_run, undefined)
    assert.equal(queuedSnapshot.execution_process.run_id, oldTurn.run_id)
    const [newClaim] = await store.agentDispatchOutbox.claimAgentDispatchOutbox({
      workerId: "worker_new_run",
      limit: 1,
      leaseDurationMs: 5000,
      maxAttempts: 8,
    })
    assert.equal(newClaim.runId, newRunId)
    assert.equal(await store.agentDispatchOutbox.markAgentDispatchAdmitted(newClaim), true)
    assert.equal((await store.agUi.replay("tenant_a", "session_next_run", before.frames.at(-1).cursor, 100)).terminalRunId, null)
    await store.agUi.ingest("tenant_a", "session_next_run", [
      agentSource({
        id: "new_run_started",
        sequence: 3,
        kind: "run.created",
        payload: { run_id: newRunId },
        sessionId: "session_next_run",
        runId: newRunId,
      }),
    ])
    assert.deepEqual((await store.services.chat.snapshot("tenant_a", "user_a", "session_next_run", undefined)).execution_head, {
      run_id: newRunId,
      state: "active",
      pending_pauses: [],
    })
    assert.equal((await store.services.chat.snapshot("tenant_a", "user_a", "session_next_run", undefined)).execution_process.run_id, newRunId)
    await assert.rejects(
      store.agUi.ingest("tenant_a", "session_next_run", [
        agentSource({
          id: "late_old_started_while_active",
          sequence: 4,
          kind: "run.created",
          payload: { run_id: oldTurn.run_id },
          sessionId: "session_next_run",
          runId: oldTurn.run_id,
        }),
      ]),
      /AGUI_POST_TERMINAL_SOURCE/u,
    )
    assert.deepEqual((await store.services.chat.snapshot("tenant_a", "user_a", "session_next_run", undefined)).execution_head, {
      run_id: newRunId,
      state: "active",
      pending_pauses: [],
    })
    const conflictFactsQuery = `SELECT
      (SELECT jsonb_agg(to_jsonb(row) ORDER BY source_sequence) FROM bff_agui_source_event AS row WHERE tenant_id='tenant_a' AND session_id='session_next_run') AS sources,
      (SELECT jsonb_agg(to_jsonb(row) ORDER BY public_sequence) FROM bff_agui_event AS row WHERE tenant_id='tenant_a' AND session_id='session_next_run') AS events,
      (SELECT jsonb_agg(to_jsonb(row) ORDER BY run_id) FROM bff_agui_run_process AS row WHERE tenant_id='tenant_a' AND session_id='session_next_run') AS processes,
      (SELECT jsonb_agg(to_jsonb(row) ORDER BY activity_id) FROM bff_agui_run_activity AS row WHERE tenant_id='tenant_a' AND session_id='session_next_run') AS activities,
      (SELECT jsonb_agg(to_jsonb(row) ORDER BY run_id) FROM bff_agui_run_interaction AS row WHERE tenant_id='tenant_a' AND session_id='session_next_run') AS interactions,
      (SELECT jsonb_agg(to_jsonb(row) ORDER BY outbox_id) FROM bff_agent_dispatch_outbox AS row WHERE tenant_id='tenant_a' AND conversation_id='session_next_run') AS dispatches,
      (SELECT jsonb_agg(to_jsonb(row) ORDER BY message_id) FROM bff_message AS row WHERE tenant_id='tenant_a' AND conversation_id='session_next_run') AS messages,
      (SELECT to_jsonb(row) FROM bff_agui_stream AS row WHERE tenant_id='tenant_a' AND session_id='session_next_run') AS stream`
    const beforeConflict = (await pool.query(conflictFactsQuery)).rows
    await assert.rejects(
      store.agUi.ingest("tenant_a", "session_next_run", [
        agentSource({
          id: "new_run_reobserved",
          sequence: 4,
          kind: "run.created",
          payload: { run_id: newRunId },
          sessionId: "session_next_run",
          runId: newRunId,
        }),
      ]),
      /AGUI_PROCESS_START_IDENTITY_CONFLICT/u,
    )
    assert.deepEqual((await pool.query(conflictFactsQuery)).rows, beforeConflict)
    await store.agUi.ingest("tenant_a", "session_next_run", [
      agentSource({
        id: "new_run_finished",
        sequence: 4,
        kind: "run.completed",
        payload: { status: "completed" },
        sessionId: "session_next_run",
        runId: newRunId,
      }),
    ])
    await assert.rejects(
      store.agUi.ingest("tenant_a", "session_next_run", [
        agentSource({
          id: "late_old_started_after_terminal",
          sequence: 5,
          kind: "run.created",
          payload: { run_id: oldTurn.run_id },
          sessionId: "session_next_run",
          runId: oldTurn.run_id,
        }),
      ]),
      /AGUI_POST_TERMINAL_SOURCE/u,
    )
    assert.equal((await store.services.chat.snapshot("tenant_a", "user_a", "session_next_run", undefined)).active_run, undefined)
  } finally {
    if (store !== null) await store.close().catch(() => undefined)
    await pool.end()
  }
})

integrationTest("rejects blank markers and a foreign terminal without rejecting unadmitted history", async () => {
  const pool = new Pool({
    connectionString: postgresUrl,
    options: "-c search_path=kokoro_bff -c timezone=UTC",
  })
  let store = null
  try {
    await pool.query(`DROP TABLE IF EXISTS ${TABLES.join(", ")} CASCADE`)
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    await pool.query(
      `INSERT INTO bff_conversation (conversation_id, tenant_id, owner_id, title) VALUES ('session_invalid_markers', 'tenant_a', 'user_a', 'Invalid markers')`,
    )
    await pool.query(
      `INSERT INTO bff_agui_stream (tenant_id, session_id, consumer_subject_id, expected_run_id, latest_run_id, terminal_run_id) VALUES ('tenant_a', 'session_invalid_markers', 'user_a', 'run_expected', '', NULL)`,
    )
    store = new PostgresBffRepositories(postgresUrl, redisUrl)
    await assert.rejects(store.services.chat.snapshot("tenant_a", "user_a", "session_invalid_markers", undefined), /CHAT_ACTIVE_RUN_STATE_INVALID/u)
    await pool.query(
      `UPDATE bff_agui_stream SET latest_run_id = 'run_expected', terminal_run_id = ' ' WHERE tenant_id = 'tenant_a' AND session_id = 'session_invalid_markers'`,
    )
    await assert.rejects(store.services.chat.snapshot("tenant_a", "user_a", "session_invalid_markers", undefined), /CHAT_ACTIVE_RUN_STATE_INVALID/u)
    await pool.query(
      `UPDATE bff_agui_stream SET latest_run_id = 'run_expected', terminal_run_id = 'run_foreign' WHERE tenant_id = 'tenant_a' AND session_id = 'session_invalid_markers'`,
    )
    await assert.rejects(store.services.chat.snapshot("tenant_a", "user_a", "session_invalid_markers", undefined), /CHAT_ACTIVE_RUN_STATE_INVALID/u)
    await pool.query(
      `UPDATE bff_agui_stream SET expected_run_id = NULL, latest_run_id = 'run_history', terminal_run_id = 'run_history' WHERE tenant_id = 'tenant_a' AND session_id = 'session_invalid_markers'`,
    )
    assert.equal((await store.services.chat.snapshot("tenant_a", "user_a", "session_invalid_markers", undefined)).active_run, undefined)
  } finally {
    if (store !== null) await store.close().catch(() => undefined)
    await pool.end()
  }
})

integrationTest("registering a newer run fences a stale projector commit", async () => {
  const pool = new Pool({
    connectionString: postgresUrl,
    options: "-c search_path=kokoro_bff -c timezone=UTC",
  })
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
    const oldRun = await submitAndAdmit(store, pool, {
      tenantId: "tenant_a",
      sessionId: "session_run_fence",
      ownerId: "user_a",
      suffix: "stale_old",
    })
    const now = new Date()
    const [lease] = await store.agUiConsumers.claimConsumers({
      workerId: "worker_stale_run",
      now: now.toISOString(),
      leaseUntil: new Date(now.getTime() + 60_000).toISOString(),
      limit: 1,
    })
    assert.ok(lease)
    const stale = await projection.readStream("tenant_a", "session_run_fence")
    await store.agUi.ingest("tenant_a", "session_run_fence", [
      agentSource({
        id: "old_started_before_fence",
        sequence: 1,
        kind: "run.created",
        payload: { run_id: oldRun },
        sessionId: "session_run_fence",
        runId: oldRun,
      }),
      agentSource({
        id: "old_terminal_before_fence",
        sequence: 2,
        kind: "run.completed",
        payload: { status: "completed" },
        sessionId: "session_run_fence",
        runId: oldRun,
      }),
    ])
    const newRun = await submitAndAdmit(store, pool, {
      tenantId: "tenant_a",
      sessionId: "session_run_fence",
      ownerId: "user_a",
      suffix: "stale_new",
    })

    const committed = await projection.commitProjection({
      tenantId: "tenant_a",
      sessionId: "session_run_fence",
      expectedVersion: stale.version,
      sourceHighWatermark: 1,
      projectionState: { textMessageIds: [] },
      sources: [
        {
          sourceOwner: "kokoro-agent",
          sourceEventId: "stale_old_terminal",
          sourceSequence: 1,
          sourceDigest: "a".repeat(64),
          sourceOccurredAt: now.toISOString(),
          frames: [
            {
              type: "RUN_FINISHED",
              threadId: "session_run_fence",
              runId: oldRun,
              timestamp: now.getTime(),
              metadata: {
                kokoro: {
                  event_id: "stale_old_terminal",
                  seq: 1,
                  run_id: oldRun,
                },
              },
            },
          ],
        },
      ],
      latestRunId: oldRun,
      terminalRunId: oldRun,
      consumerLease: lease,
    })
    assert.notEqual(committed, "committed")

    const current = await projection.readStream("tenant_a", "session_run_fence")
    assert.ok(current.version > stale.version)
    assert.equal(current.expectedRunId, newRun)
    assert.equal(current.latestRunId, oldRun)
    assert.equal(current.terminalRunId, null)
    const replay = await store.agUi.replay("tenant_a", "session_run_fence", null, 100)
    assert.equal(replay.kind, "page")
    assert.deepEqual(
      replay.frames.map((frame) => frame.eventType),
      ["CUSTOM", "RUN_STARTED", "RUN_FINISHED", "CUSTOM"],
    )
    assert.equal(replay.frames[0].payload.name, "kokoro.run.queued")
    assert.deepEqual(replay.frames[0].payload.value, {
      run_id: oldRun,
      dispatch_sequence: "1",
    })
    assert.equal(replay.frames[3].payload.name, "kokoro.run.queued")
    assert.deepEqual(replay.frames[3].payload.value, {
      run_id: newRun,
      dispatch_sequence: "3",
    })
  } finally {
    if (store !== null) await store.close().catch(() => undefined)
    if (database !== null) await database.close().catch(() => undefined)
    await pool.end()
  }
})

integrationTest("consumer claims use the PostgreSQL clock instead of a skewed worker clock", async () => {
  const pool = new Pool({
    connectionString: postgresUrl,
    options: "-c search_path=kokoro_bff -c timezone=UTC",
  })
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
  const pool = new Pool({
    connectionString: postgresUrl,
    options: "-c search_path=kokoro_bff -c timezone=UTC",
  })
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
      tenantId: "tenant_a",
      conversationId: "session_expected_run",
      subjectId: "user_a",
      actorId: "user_a",
      requestId: "request_expected_run",
      idempotencyKey: "expected_run",
      content: "Finish the current run",
    })
    assert.ok(turn)
    const [dispatch] = await store.agentDispatchOutbox.claimAgentDispatchOutbox({
      workerId: "worker_expected_run_dispatch",
      limit: 1,
      leaseDurationMs: 5000,
      maxAttempts: 8,
    })
    assert.equal(dispatch.runId, turn.run_id)
    assert.equal(await store.agentDispatchOutbox.markAgentDispatchAdmitted(dispatch), true)
    const now = new Date()
    const [lease] = await store.agUiConsumers.claimConsumers({
      workerId: "worker_expected_run",
      now: now.toISOString(),
      leaseUntil: new Date(now.getTime() + 60_000).toISOString(),
      limit: 1,
    })
    assert.ok(lease)

    await store.agUi.ingest(
      "tenant_a",
      "session_expected_run",
      [
        agentSource({
          id: "catchup_old_start",
          sequence: 1,
          kind: "run.created",
          payload: { run_id: "run_old" },
          sessionId: "session_expected_run",
          runId: "run_old",
        }),
        agentSource({
          id: "catchup_old_end",
          sequence: 2,
          kind: "run.completed",
          payload: { status: "completed" },
          sessionId: "session_expected_run",
          runId: "run_old",
        }),
      ],
      lease,
    )
    const oldCatchup = await store.agUi.replay("tenant_a", "session_expected_run", null, 100)
    assert.equal(oldCatchup.kind, "page")
    assert.equal(oldCatchup.terminalRunId, null)

    await store.agUi.ingest(
      "tenant_a",
      "session_expected_run",
      [
        agentSource({
          id: "expected_new_start",
          sequence: 3,
          kind: "run.created",
          payload: { run_id: turn.run_id },
          sessionId: "session_expected_run",
          runId: turn.run_id,
        }),
        agentSource({
          id: "expected_new_end",
          sequence: 4,
          kind: "run.completed",
          payload: { status: "completed" },
          sessionId: "session_expected_run",
          runId: turn.run_id,
        }),
      ],
      lease,
    )
    const expected = await store.agUi.replay("tenant_a", "session_expected_run", null, 100)
    assert.equal(expected.kind, "page")
    assert.equal(expected.terminalRunId, turn.run_id)
  } finally {
    if (store !== null) await store.close().catch(() => undefined)
    await pool.end()
  }
})

integrationTest("the expected run can finish while source runs are interleaved", async () => {
  const pool = new Pool({
    connectionString: postgresUrl,
    options: "-c search_path=kokoro_bff -c timezone=UTC",
  })
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
      tenantId: "tenant_a",
      conversationId: "session_expected_interleaved",
      subjectId: "user_a",
      actorId: "user_a",
      requestId: "request_expected_interleaved",
      idempotencyKey: "expected_interleaved",
      content: "Finish interleaved run",
    })
    assert.ok(turn)
    const [dispatch] = await store.agentDispatchOutbox.claimAgentDispatchOutbox({
      workerId: "worker_expected_interleaved_dispatch",
      limit: 1,
      leaseDurationMs: 5000,
      maxAttempts: 8,
    })
    assert.equal(dispatch.runId, turn.run_id)
    assert.equal(await store.agentDispatchOutbox.markAgentDispatchAdmitted(dispatch), true)
    const now = new Date()
    const [lease] = await store.agUiConsumers.claimConsumers({
      workerId: "worker_expected_interleaved",
      now: now.toISOString(),
      leaseUntil: new Date(now.getTime() + 60_000).toISOString(),
      limit: 1,
    })
    assert.ok(lease)

    const facts = async () => {
      const result = {}
      for (const [table, column, order] of [
        ["bff_agui_stream", "session_id", "session_id"],
        ["bff_agui_source_event", "session_id", "source_event_id"],
        ["bff_agui_event", "session_id", "public_sequence"],
        ["bff_agui_run_interaction", "session_id", "run_id"],
        ["bff_agent_dispatch_outbox", "conversation_id", "outbox_id"],
        ["bff_message", "conversation_id", "message_id"],
      ]) {
        result[table] = (
          await pool.query("SELECT * FROM " + table + " WHERE tenant_id=$1 AND " + column + "=$2 ORDER BY " + order, [
            "tenant_a",
            "session_expected_interleaved",
          ])
        ).rows
      }
      return result
    }
    const factsBeforeInvalid = await facts()
    const markerBeforeInvalid = (
      await pool.query("SELECT version::text, source_high_watermark::text FROM bff_agui_stream WHERE tenant_id=$1 AND session_id=$2", [
        "tenant_a",
        "session_expected_interleaved",
      ])
    ).rows[0]
    await assert.rejects(
      store.agUi.ingest(
        "tenant_a",
        "session_expected_interleaved",
        [
          agentSource({
            id: "expected_interleaved_start",
            sequence: 1,
            kind: "run.created",
            payload: { run_id: turn.run_id },
            sessionId: "session_expected_interleaved",
            runId: turn.run_id,
          }),
          {
            ...agentSource({
              id: "mismatched_source",
              sequence: 2,
              kind: "run.completed",
              payload: { status: "completed" },
              sessionId: "session_expected_interleaved",
              runId: "run_other",
            }),
            sourceRunId: turn.run_id,
          },
        ],
        lease,
      ),
      /AG-UI Agent source response did not match its contract/u,
    )
    const afterInvalid = await store.agUi.status("tenant_a", "session_expected_interleaved")
    assert.equal(afterInvalid.sourceHighWatermark, 0)
    assert.deepEqual(
      (
        await pool.query(
          `SELECT version::text, source_high_watermark::text, expected_run_id, latest_run_id, terminal_run_id,
              (SELECT count(*)::int FROM bff_agui_source_event WHERE tenant_id=$1 AND session_id=$2) AS source_count,
              (SELECT count(*)::int FROM bff_agui_event WHERE tenant_id=$1 AND session_id=$2) AS frame_count
         FROM bff_agui_stream WHERE tenant_id=$1 AND session_id=$2`,
          ["tenant_a", "session_expected_interleaved"],
        )
      ).rows,
      [
        {
          ...markerBeforeInvalid,
          expected_run_id: turn.run_id,
          latest_run_id: null,
          terminal_run_id: null,
          source_count: 0,
          frame_count: 1,
        },
      ],
    )

    assert.deepEqual(await facts(), factsBeforeInvalid)
    await store.agUi.ingest(
      "tenant_a",
      "session_expected_interleaved",
      [
        agentSource({
          id: "expected_interleaved_start",
          sequence: 1,
          kind: "run.created",
          payload: { run_id: turn.run_id },
          sessionId: "session_expected_interleaved",
          runId: turn.run_id,
        }),
        agentSource({
          id: "other_interleaved_start",
          sequence: 2,
          kind: "run.created",
          payload: { run_id: "run_other" },
          sessionId: "session_expected_interleaved",
          runId: "run_other",
        }),
        agentSource({
          id: "other_interleaved_terminal",
          sequence: 3,
          kind: "run.completed",
          payload: { status: "completed" },
          sessionId: "session_expected_interleaved",
          runId: "run_other",
        }),
      ],
      lease,
    )
    const interleaved = await store.agUi.status("tenant_a", "session_expected_interleaved")
    assert.equal(interleaved.sourceHighWatermark, 3)
    assert.deepEqual(
      (
        await pool.query(
          "SELECT expected_run_id, latest_run_id, terminal_run_id, latest_run_start_sequence FROM bff_agui_stream WHERE tenant_id=$1 AND session_id=$2",
          ["tenant_a", "session_expected_interleaved"],
        )
      ).rows,
      [
        {
          expected_run_id: turn.run_id,
          latest_run_id: turn.run_id,
          terminal_run_id: null,
          latest_run_start_sequence: "2",
        },
      ],
    )
    await store.agUi.ingest(
      "tenant_a",
      "session_expected_interleaved",
      [
        agentSource({
          id: "expected_interleaved_end",
          sequence: 4,
          kind: "run.completed",
          payload: { status: "completed" },
          sessionId: "session_expected_interleaved",
          runId: turn.run_id,
        }),
      ],
      lease,
    )

    const replay = await store.agUi.replay("tenant_a", "session_expected_interleaved", null, 100)
    assert.equal(replay.kind, "page")
    assert.equal(replay.terminalRunId, turn.run_id)
    assert.deepEqual(
      (
        await pool.query("SELECT expected_run_id, latest_run_id, terminal_run_id FROM bff_agui_stream WHERE tenant_id=$1 AND session_id=$2", [
          "tenant_a",
          "session_expected_interleaved",
        ])
      ).rows,
      [
        {
          expected_run_id: null,
          latest_run_id: turn.run_id,
          terminal_run_id: turn.run_id,
        },
      ],
    )
  } finally {
    if (store !== null) await store.close().catch(() => undefined)
    await pool.end()
  }
})

integrationTest("a skewed worker can read and settle a database-clock lease", async () => {
  const pool = new Pool({
    connectionString: postgresUrl,
    options: "-c search_path=kokoro_bff -c timezone=UTC",
  })
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
    const runner = new AgUiProjectorRunner(
      store.agUi,
      store.agUiConsumers,
      {
        read: async () => {
          sourceReads += 1
          return {
            events: [],
            nextSequence: 0,
            watermark: 0,
            exhausted: true,
          }
        },
      },
      {
        workerId: "worker_clock_completion",
        leaseDurationMs: 60_000,
        pollIntervalMs: 1_000,
        now: () => skewedNow,
      },
    )

    const result = await runner.runOnce()

    assert.equal(sourceReads, 1)
    assert.equal(result.consumersSucceeded, 1)
  } finally {
    if (store !== null) await store.close().catch(() => undefined)
    await pool.end()
  }
})

integrationTest("a skewed worker releases a lease back to the PostgreSQL clock", async () => {
  const pool = new Pool({
    connectionString: postgresUrl,
    options: "-c search_path=kokoro_bff -c timezone=UTC",
  })
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

integrationTest(
  "R43 keeps old A and old cursor in an authorized RR snapshot while production terminal atomically hands off to queued B",
  { timeout: 30_000 },
  async () => {
    const { randomUUID } = await import("node:crypto")
    const { ChatApplicationService } = await import("../dist/application/chat-service.js")
    const pool = new Pool({
      connectionString: postgresUrl,
      options: "-c search_path=kokoro_bff -c timezone=UTC",
    })
    const suffix = randomUUID()
    const tenantId = "r43_rr_" + suffix
    const sessionId = "conv_" + randomUUID()
    const ownerId = "r43_rr_owner"
    let store = null
    let reader = null
    let readerReleased = false
    let pending = null
    let releaseRead
    const readReleased = new Promise((resolve) => {
      releaseRead = resolve
    })
    let markAuthorized
    const authorized = new Promise((resolve) => {
      markAuthorized = resolve
    })
    const bounded = async (promise, label) => {
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
    try {
      await pool.query("CREATE SCHEMA IF NOT EXISTS kokoro_bff")
      await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
      store = new PostgresBffRepositories(postgresUrl, redisUrl)
      await store.ready()
      const submit = (name) =>
        store.services.chatTurns.submit({
          tenantId,
          conversationId: sessionId,
          subjectId: ownerId,
          actorId: ownerId,
          requestId: "r43_rr_request_" + name + suffix,
          idempotencyKey: "r43_rr_key_" + name + suffix,
          content: "RR turn " + name,
        })
      const a = await submit("A")
      const b = await submit("B")
      assert.ok(a)
      assert.ok(b)
      const claims = await store.agentDispatchOutbox.claimAgentDispatchOutbox({
        workerId: "r43_rr_worker_" + suffix,
        limit: 1,
        leaseDurationMs: 5000,
        maxAttempts: 8,
      })
      assert.equal(claims[0]?.runId, a.run_id, "isolated fixture must claim A through the production repository")
      assert.equal(await store.agentDispatchOutbox.markAgentDispatchAdmitted(claims[0]), true)
      await store.agUi.ingest(tenantId, sessionId, [
        agentSource({
          id: "r43_rr_started_" + suffix,
          sequence: 1,
          kind: "run.created",
          sessionId,
          runId: a.run_id,
          payload: { run_id: a.run_id },
        }),
      ])
      const before = await store.services.chat.snapshot(tenantId, ownerId, sessionId, undefined)
      assert.ok(before)
      assert.match(before.event_watermark, /^agui_[0-9a-f]{32}$/u)
      reader = await pool.connect()
      let authorizationCount = 0
      const gated = new PostgresChatRepository({
        pool: {
          connect: async () => ({
            query: async (sql, values) => {
              const result = await reader.query(sql, values)
              if (sql.includes("FROM bff_conversation") && sql.includes("LIMIT 1") && authorizationCount++ === 0) {
                assert.equal(result.rows[0]?.conversation_id, sessionId, "barrier follows real successful Conversation authorization")
                const isolation = await reader.query("SHOW transaction_isolation")
                assert.equal(isolation.rows[0]?.transaction_isolation, "repeatable read")
                markAuthorized()
                await readReleased
              }
              return result
            },
            release: () => {
              readerReleased = true
              reader.release()
            },
          }),
        },
      })
      pending = new ChatApplicationService(gated).snapshot(tenantId, ownerId, sessionId, undefined)
      void pending.catch(() => undefined)
      await bounded(
        Promise.race([
          authorized,
          pending.then(() => {
            throw new Error("snapshot finished before authorization barrier")
          }),
        ]),
        "authorization barrier timed out",
      )
      // The real reader's RR transaction stays open; a separate production connection commits.
      await bounded(
        store.agUi.ingest(tenantId, sessionId, [
          agentSource({
            id: "r43_rr_terminal_" + suffix,
            sequence: 2,
            kind: "run.completed",
            sessionId,
            runId: a.run_id,
            payload: { status: "completed" },
          }),
        ]),
        "independent production terminal writer timed out",
      )
      const fresh = await store.services.chat.snapshot(tenantId, ownerId, sessionId, undefined)
      const dispatches = await pool.query(
        "SELECT run_id,status FROM bff_agent_dispatch_outbox WHERE tenant_id=$1 AND conversation_id=$2 ORDER BY conversation_dispatch_seq,outbox_id",
        [tenantId, sessionId],
      )
      releaseRead()
      const old = await bounded(pending, "RR reader did not finish after release")
      assert.deepEqual(dispatches.rows, [
        { run_id: a.run_id, status: "terminal" },
        { run_id: b.run_id, status: "pending" },
      ])
      assert.deepEqual(old.execution_head, {
        run_id: a.run_id,
        state: "active",
        pending_pauses: [],
      })
      assert.equal(old.event_watermark, before.event_watermark, "old A must not be combined with the new cursor")
      const oldAssistant = old.messages?.find((message) => message.message_id === a.assistant_message_id)
      assert.ok(oldAssistant, "RR snapshot must retain A's admitted assistant identity")
      assert.equal(oldAssistant.status, "pending")
      assert.deepEqual(fresh.execution_head, {
        run_id: b.run_id,
        state: "queued",
        pending_pauses: [],
      })
      assert.notEqual(fresh.event_watermark, before.event_watermark, "new B must not be combined with the old cursor")
      const freshAssistant = fresh.messages?.find((message) => message.message_id === a.assistant_message_id)
      assert.ok(freshAssistant, "new snapshot must retain A's terminal assistant identity")
      assert.equal(freshAssistant.status, "completed")
      const replay = await store.agUi.replay(tenantId, sessionId, before.event_watermark, 100)
      assert.equal(replay.kind, "page")
      assert.deepEqual(
        replay.frames.map(({ eventType }) => eventType),
        ["RUN_FINISHED", "CUSTOM"],
      )
      assert.equal(replay.frames[0].payload.runId, a.run_id)
      assert.equal(replay.frames[1].payload.name, "kokoro.run.queued")
      assert.deepEqual(replay.frames[1].payload.value, {
        run_id: b.run_id,
        dispatch_sequence: "3",
      })
      assert.equal(replay.frames.at(-1).cursor, fresh.event_watermark)
      assert.equal(new Set(replay.frames.map(({ cursor }) => cursor)).size, 2)
      const duplicate = await store.agUi.ingest(tenantId, sessionId, [
        agentSource({
          id: "r43_rr_terminal_" + suffix,
          sequence: 2,
          kind: "run.completed",
          sessionId,
          runId: a.run_id,
          payload: { status: "completed" },
        }),
      ])
      assert.equal(duplicate.insertedFrames, 0)
      assert.equal((await store.services.chat.snapshot(tenantId, ownerId, sessionId, undefined)).event_watermark, fresh.event_watermark)
    } finally {
      releaseRead()
      if (pending !== null) await pending.catch(() => undefined)
      if (reader !== null && !readerReleased) reader.release()
      if (store !== null) await store.close()
      for (const [table, column] of [
        ["bff_agui_event", "session_id"],
        ["bff_agui_source_event", "session_id"],
        ["bff_agui_stream", "session_id"],
        ["bff_agent_dispatch_outbox", "conversation_id"],
        ["bff_message", "conversation_id"],
        ["bff_conversation", "conversation_id"],
      ]) {
        await pool.query("DELETE FROM " + table + " WHERE tenant_id=$1 AND " + column + "=$2", [tenantId, sessionId])
      }
      await pool.end()
    }
  },
)

// R46 scoped authority regressions: Root runs these against its owned PostgreSQL/Redis fixture.
function r46AuthorityCleanup(context, pool, currentStore, scopes) {
  context.after(async () => {
    const failures = []
    const store = currentStore()
    if (store !== null) {
      try {
        await store.close()
      } catch (error) {
        failures.push(error)
      }
    }
    for (const [table, column] of [
      ["bff_agui_cursor_tombstone", "session_id"],
      ["bff_agui_event", "session_id"],
      ["bff_agui_source_event", "session_id"],
      ["bff_agui_stream", "session_id"],
      ["bff_conversation", "conversation_id"],
    ]) {
      try {
        await pool.query(
          "DELETE FROM " +
            table +
            " AS owned WHERE EXISTS (" +
            "SELECT 1 FROM jsonb_to_recordset($1::jsonb) AS scope(tenant_id text,session_id text) " +
            "WHERE scope.tenant_id=owned.tenant_id AND scope.session_id=owned." +
            column +
            ")",
          [JSON.stringify(scopes)],
        )
      } catch (error) {
        failures.push(error)
      }
    }
    try {
      await pool.end()
    } catch (error) {
      failures.push(error)
    }
    if (failures.length > 0) throw new AggregateError(failures, "R46 scoped authority fixture cleanup failed")
  })
}

for (const parentCase of ["missing", "wrong tenant", "wrong subject"]) {
  integrationTest("R46 direct-register rejects " + parentCase + " Conversation authority without writing a stream", { timeout: 30_000 }, async (context) => {
    const { randomUUID } = await import("node:crypto")
    const suffix = randomUUID()
    const tenantId = "r46_register_" + suffix
    const foreignTenantId = "r46_register_foreign_" + suffix
    const sessionId = "conv_" + randomUUID()
    const ownerId = "r46_register_owner"
    const parentTenantId = parentCase === "wrong tenant" ? foreignTenantId : tenantId
    const callerSubjectId = parentCase === "wrong subject" ? "r46_register_other_subject" : ownerId
    const pool = new Pool({
      connectionString: postgresUrl,
      options: "-c search_path=kokoro_bff -c timezone=UTC",
      statement_timeout: 5000,
    })
    let store = null
    r46AuthorityCleanup(context, pool, () => store, [
      { tenant_id: tenantId, session_id: sessionId },
      { tenant_id: foreignTenantId, session_id: sessionId },
    ])
    await pool.query("CREATE SCHEMA IF NOT EXISTS kokoro_bff")
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    if (parentCase !== "missing") {
      await pool.query("INSERT INTO bff_conversation (conversation_id,tenant_id,owner_id,title) VALUES ($1,$2,$3,'R46 authority fixture')", [
        sessionId,
        parentTenantId,
        ownerId,
      ])
    }
    const parents = await pool.query("SELECT tenant_id,owner_id,status FROM bff_conversation WHERE conversation_id=$1 ORDER BY tenant_id", [sessionId])
    assert.deepEqual(
      parents.rows,
      parentCase === "missing"
        ? []
        : [
            {
              tenant_id: parentTenantId,
              owner_id: ownerId,
              status: "active",
            },
          ],
    )
    const streams = () =>
      pool.query("SELECT to_jsonb(stream) AS row FROM bff_agui_stream AS stream WHERE session_id=$1 AND tenant_id=ANY($2::text[]) ORDER BY tenant_id", [
        sessionId,
        [tenantId, foreignTenantId],
      ])
    assert.deepEqual((await streams()).rows, [])
    store = new PostgresBffRepositories(postgresUrl, redisUrl)
    await store.ready()
    assert.equal(typeof store.agUiConsumers.registerConsumer, "function", "production direct-register method must exist")
    let failure
    try {
      await store.agUiConsumers.registerConsumer(tenantId, sessionId, callerSubjectId)
    } catch (error) {
      failure = error
    }
    // Read real state even when the call wrongly succeeded; both rejection and zero writes are contractual.
    const after = (await streams()).rows
    assert.deepEqual(
      {
        error: failure instanceof Error ? failure.message : null,
        streams: after,
      },
      {
        error: "AG-UI consumer subject does not match the registered session owner",
        streams: [],
      },
      "direct-register must require a matching active parent, use the existing stable error, and roll back every stream write",
    )
  })
}

integrationTest(
  "R46 garbage collection preserves a historical orphan stream tail without parent authority while collecting an eligible owned control",
  { timeout: 30_000 },
  async (context) => {
    const { randomUUID, createHash } = await import("node:crypto")
    const suffix = randomUUID()
    const tenantId = "r46_gc_" + suffix
    const orphanSessionId = "conv_" + randomUUID()
    const controlSessionId = "conv_" + randomUUID()
    const ownerId = "r46_gc_owner"
    const pool = new Pool({
      connectionString: postgresUrl,
      options: "-c search_path=kokoro_bff -c timezone=UTC",
      statement_timeout: 5000,
    })
    let store = null
    r46AuthorityCleanup(context, pool, () => store, [
      { tenant_id: tenantId, session_id: orphanSessionId },
      { tenant_id: tenantId, session_id: controlSessionId },
    ])
    await pool.query("CREATE SCHEMA IF NOT EXISTS kokoro_bff")
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    const occurredAt = "2026-01-01T00:00:00.000Z"
    // Explicit historical fixture, not a replacement repository or mocked return.
    for (const sessionId of [orphanSessionId, controlSessionId]) {
      const oldRunId = "r46_old_" + sessionId
      const currentRunId = "r46_current_" + sessionId
      await pool.query("INSERT INTO bff_conversation (conversation_id,tenant_id,owner_id,title) VALUES ($1,$2,$3,'R46 GC authority fixture')", [
        sessionId,
        tenantId,
        ownerId,
      ])
      await pool.query(
        "INSERT INTO bff_agui_stream (tenant_id,session_id,consumer_subject_id,source_high_watermark,next_public_sequence,latest_run_id,latest_run_start_sequence) " +
          "VALUES ($1,$2,$3,3,4,$4,3)",
        [tenantId, sessionId, ownerId, currentRunId],
      )
      for (const [sequence, type, runId] of [
        [1, "RUN_STARTED", oldRunId],
        [2, "RUN_FINISHED", oldRunId],
        [3, "RUN_STARTED", currentRunId],
      ]) {
        const sourceEventId = "r46_gc_source_" + sessionId + "_" + sequence
        const cursor = "agui_" + createHash("sha256").update(sourceEventId).digest("hex").slice(0, 32)
        const payload = {
          type,
          threadId: sessionId,
          runId,
          metadata: {
            kokoro: {
              event_id: sourceEventId,
              seq: sequence,
              session_id: sessionId,
              run_id: runId,
              timestamp: occurredAt,
              source_owner: "kokoro-agent",
            },
          },
        }
        const serialized = JSON.stringify(payload)
        await pool.query(
          "INSERT INTO bff_agui_source_event (tenant_id,session_id,source_owner,source_event_id,source_sequence,source_digest,source_occurred_at) " +
            "VALUES ($1,$2,'kokoro-agent',$3,$4,$5,$6)",
          [tenantId, sessionId, sourceEventId, sequence, createHash("sha256").update(serialized).digest("hex"), occurredAt],
        )
        await pool.query(
          "INSERT INTO bff_agui_event (tenant_id,session_id,public_sequence,cursor,source_owner,source_event_id,frame_index,event_type,event_payload,source_occurred_at,recorded_at) " +
            "VALUES ($1,$2,$3,$4,'kokoro-agent',$5,0,$6,$7::jsonb,$8,CURRENT_TIMESTAMP(3)-INTERVAL '2 days')",
          [tenantId, sessionId, sequence, cursor, sourceEventId, type, serialized, occurredAt],
        )
      }
    }
    // Model a historical missing parent precisely; leave its real durable tail intact.
    const deleted = await pool.query("DELETE FROM bff_conversation WHERE tenant_id=$1 AND conversation_id=$2", [tenantId, orphanSessionId])
    assert.equal(deleted.rowCount, 1)
    const parents = await pool.query(
      "SELECT conversation_id,owner_id,status FROM bff_conversation WHERE tenant_id=$1 AND conversation_id=ANY($2::text[]) ORDER BY conversation_id",
      [tenantId, [orphanSessionId, controlSessionId]],
    )
    assert.deepEqual(parents.rows, [
      {
        conversation_id: controlSessionId,
        owner_id: ownerId,
        status: "active",
      },
    ])
    const fingerprint = async (sessionId) => {
      const facts = {}
      for (const [table, order] of [
        ["bff_agui_run_interaction", "run_id"],
        ["bff_agui_stream", "tenant_id,session_id"],
        ["bff_agui_event", "public_sequence"],
        ["bff_agui_source_event", "source_sequence"],
        ["bff_agui_cursor_tombstone", "public_sequence,cursor"],
      ]) {
        facts[table] = (
          await pool.query("SELECT to_jsonb(fact) AS row FROM " + table + " AS fact WHERE tenant_id=$1 AND session_id=$2 ORDER BY " + order, [
            tenantId,
            sessionId,
          ])
        ).rows.map(({ row }) => row)
      }
      return facts
    }
    const before = await fingerprint(orphanSessionId)
    assert.equal(before.bff_agui_stream[0]?.latest_run_start_sequence, 3)
    assert.equal(before.bff_agui_stream[0]?.retention_floor_sequence, 0)
    assert.deepEqual(
      before.bff_agui_event.map(({ public_sequence }) => public_sequence),
      [1, 2, 3],
    )
    assert.equal(before.bff_agui_source_event.length, 3)
    assert.deepEqual(before.bff_agui_cursor_tombstone, [])
    store = new PostgresBffRepositories(postgresUrl, redisUrl)
    await store.ready()
    assert.equal(typeof store.agUiConsumers.collectGarbage, "function", "production GC method must exist")
    const collected = await store.agUiConsumers.collectGarbage({
      now: new Date().toISOString(),
      retentionMs: 1,
      tombstoneRetentionMs: 24 * 60 * 60 * 1000,
      batchSize: 100,
    })
    const after = await fingerprint(orphanSessionId)
    const control = await fingerprint(controlSessionId)
    // A real eligible parent-backed stream must still collect; skipping every stream is not a fix.
    assert.deepEqual(
      control.bff_agui_event.map(({ public_sequence }) => public_sequence),
      [3],
    )
    assert.deepEqual(
      control.bff_agui_cursor_tombstone.map(({ public_sequence }) => public_sequence),
      [1, 2],
    )
    assert.equal(control.bff_agui_stream[0]?.retention_floor_sequence, 2)
    assert.equal(control.bff_agui_source_event.length, 3, "source identity ledger must survive public frame GC")
    assert.deepEqual(after, before, "without an existing same-tenant parent lock, GC must not mutate orphan stream/events/source/tombstones")
    assert.deepEqual(collected, {
      streamsScanned: 1,
      framesDeleted: 2,
      tombstonesInserted: 2,
      tombstonesDeleted: 0,
    })
  },
)

integrationTest(
  "R52 GC batch one skips a valid queued-pinned A with no deletable prefix and collects eligible B history",
  { timeout: 30_000 },
  async (context) => {
    const { randomUUID } = await import("node:crypto")
    const suffix = randomUUID()
    const tenantId = "000_r52_gc_" + suffix
    const ownerId = "r52_gc_owner_" + suffix
    const aSessionId = "conv_a_" + suffix
    const bSessionId = "conv_b_" + suffix
    const sessionIds = [aSessionId, bSessionId]
    const pool = new Pool({
      connectionString: postgresUrl,
      options: "-c search_path=kokoro_bff -c timezone=UTC",
      statement_timeout: 5000,
    })
    let store = null
    context.after(async () => {
      const failures = []
      if (store !== null) {
        try {
          await store.close()
        } catch (error) {
          failures.push(error)
        }
      }
      // Attempt every owned cleanup and pool close, even if an earlier step fails.
      for (const [table, column] of [
        ["bff_agui_cursor_tombstone", "session_id"],
        ["bff_agui_event", "session_id"],
        ["bff_conversation_artifact", "conversation_id"],
        ["bff_agui_source_event", "session_id"],
        ["bff_agui_stream", "session_id"],
        ["bff_agent_cancellation_outbox", "conversation_id"],
        ["bff_agent_dispatch_outbox", "conversation_id"],
        ["bff_message", "conversation_id"],
        ["bff_conversation", "conversation_id"],
      ]) {
        try {
          await pool.query("DELETE FROM " + table + " WHERE tenant_id=$1 AND " + column + "=ANY($2::text[])", [tenantId, sessionIds])
        } catch (error) {
          failures.push(error)
        }
      }
      try {
        await pool.end()
      } catch (error) {
        failures.push(error)
      }
      if (failures.length > 0) throw new AggregateError(failures, "R52 scoped GC fairness fixture cleanup failed")
    })
    await pool.query("CREATE SCHEMA IF NOT EXISTS kokoro_bff")
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    await pool.query("INSERT INTO bff_conversation (conversation_id,tenant_id,owner_id,title) VALUES ($1,$3,$4,'R52 A'),($2,$3,$4,'R52 B')", [
      aSessionId,
      bSessionId,
      tenantId,
      ownerId,
    ])
    const parents = await pool.query(
      "SELECT conversation_id,tenant_id,owner_id,status FROM bff_conversation WHERE tenant_id=$1 AND conversation_id=ANY($2::text[]) ORDER BY conversation_id",
      [tenantId, sessionIds],
    )
    assert.deepEqual(
      parents.rows,
      sessionIds.map((conversation_id) => ({
        conversation_id,
        tenant_id: tenantId,
        owner_id: ownerId,
        status: "active",
      })),
    )
    store = new PostgresBffRepositories(postgresUrl, redisUrl)
    await store.ready()
    const submitAndClaim = async (sessionId, name) => {
      const turn = await store.services.chatTurns.submit({
        tenantId,
        conversationId: sessionId,
        subjectId: ownerId,
        actorId: ownerId,
        requestId: "r52_request_" + name + suffix,
        idempotencyKey: "r52_turn_" + name + suffix,
        content: "R52 GC fairness " + name,
      })
      assert.ok(turn, "a real authorized production Chat submit must create the turn")
      const claims = await store.agentDispatchOutbox.claimAgentDispatchOutbox({
        workerId: "r52_worker_" + name + suffix,
        limit: 1,
        leaseDurationMs: 5000,
        maxAttempts: 8,
      })
      assert.equal(claims.length, 1)
      assert.equal(claims[0].runId, turn.run_id, "production claim must select this fixture's pending head")
      assert.equal(await store.agentDispatchOutbox.markAgentDispatchAdmitted(claims[0]), true)
      return turn
    }
    const a = await submitAndClaim(aSessionId, "A")
    await store.agUi.ingest(tenantId, aSessionId, [
      agentSource({
        id: "r52_a_started_" + suffix,
        sequence: 1,
        kind: "run.created",
        sessionId: aSessionId,
        runId: a.run_id,
        payload: { run_id: a.run_id },
      }),
    ])
    const bOld = await submitAndClaim(bSessionId, "B_old")
    await store.agUi.ingest(tenantId, bSessionId, [
      agentSource({
        id: "r52_b_old_started_" + suffix,
        sequence: 1,
        kind: "run.created",
        sessionId: bSessionId,
        runId: bOld.run_id,
        payload: { run_id: bOld.run_id },
      }),
      agentSource({
        id: "r52_b_old_terminal_" + suffix,
        sequence: 2,
        kind: "run.completed",
        sessionId: bSessionId,
        runId: bOld.run_id,
        payload: { status: "completed" },
      }),
    ])
    const b = await submitAndClaim(bSessionId, "B_current")
    await store.agUi.ingest(tenantId, bSessionId, [
      agentSource({
        id: "r52_b_started_" + suffix,
        sequence: 3,
        kind: "run.created",
        sessionId: bSessionId,
        runId: b.run_id,
        payload: { run_id: b.run_id },
      }),
    ])
    // Only age this run's actual production frames; live queued pins and STARTs stay intact.
    const matured = await pool.query(
      "UPDATE bff_agui_event SET recorded_at=CURRENT_TIMESTAMP(3)-INTERVAL '2 days' WHERE tenant_id=$1 AND session_id=ANY($2::text[])",
      [tenantId, sessionIds],
    )
    assert.equal(matured.rowCount, 7)
    const fingerprint = async (sessionId) => {
      const facts = {}
      for (const [table, column, order] of [
        ["bff_conversation", "conversation_id", "conversation_id"],
        ["bff_agent_dispatch_outbox", "conversation_id", "conversation_dispatch_seq,outbox_id"],
        ["bff_message", "conversation_id", "message_seq,message_id"],
        ["bff_agui_run_interaction", "session_id", "run_id"],
        ["bff_agui_stream", "session_id", "tenant_id,session_id"],
        ["bff_agui_event", "session_id", "public_sequence"],
        ["bff_agui_source_event", "session_id", "source_sequence,source_owner,source_event_id"],
        ["bff_agui_cursor_tombstone", "session_id", "public_sequence,cursor"],
      ]) {
        facts[table] = (
          await pool.query("SELECT to_jsonb(fact) AS row FROM " + table + " AS fact WHERE tenant_id=$1 AND " + column + "=$2 ORDER BY " + order, [
            tenantId,
            sessionId,
          ])
        ).rows.map(({ row }) => row)
      }
      return facts
    }
    const beforeA = await fingerprint(aSessionId)
    const beforeB = await fingerprint(bSessionId)
    assert.deepEqual(
      beforeA.bff_agui_event.map(({ public_sequence, event_type }) => [public_sequence, event_type]),
      [
        [1, "CUSTOM"],
        [2, "RUN_STARTED"],
      ],
    )
    assert.equal(beforeA.bff_agui_event[0].event_payload.name, "kokoro.run.queued")
    assert.equal(beforeA.bff_agui_event[0].event_payload.value.run_id, a.run_id)
    assert.equal(beforeA.bff_agui_event[1].event_payload.runId, a.run_id)
    assert.deepEqual(
      beforeA.bff_agent_dispatch_outbox.map(({ run_id, status }) => [run_id, status]),
      [[a.run_id, "admitted"]],
    )
    assert.equal(beforeA.bff_agui_stream[0].latest_run_start_sequence, 2)
    assert.equal(beforeA.bff_agui_stream[0].retention_floor_sequence, 0)
    assert.deepEqual(beforeA.bff_agui_cursor_tombstone, [])
    assert.deepEqual(
      beforeB.bff_agui_event.map(({ public_sequence, event_type }) => [public_sequence, event_type]),
      [
        [1, "CUSTOM"],
        [2, "RUN_STARTED"],
        [3, "RUN_FINISHED"],
        [4, "CUSTOM"],
        [5, "RUN_STARTED"],
      ],
    )
    assert.equal(beforeB.bff_agui_event[0].event_payload.value.run_id, bOld.run_id)
    assert.equal(beforeB.bff_agui_event[1].event_payload.runId, bOld.run_id)
    assert.equal(beforeB.bff_agui_event[2].event_payload.runId, bOld.run_id)
    assert.equal(beforeB.bff_agui_event[3].event_payload.name, "kokoro.run.queued")
    assert.equal(beforeB.bff_agui_event[3].event_payload.value.run_id, b.run_id)
    assert.equal(beforeB.bff_agui_event[4].event_payload.runId, b.run_id)
    assert.deepEqual(
      beforeB.bff_agent_dispatch_outbox.map(({ run_id, status }) => [run_id, status]),
      [
        [bOld.run_id, "terminal"],
        [b.run_id, "admitted"],
      ],
    )
    assert.equal(beforeB.bff_agui_stream[0].latest_run_start_sequence, 5)
    assert.equal(beforeB.bff_agui_stream[0].retention_floor_sequence, 0)
    assert.deepEqual(beforeB.bff_agui_cursor_tombstone, [])
    // This reader uses the real Pool and production RR query, with no query or return replacement.
    const reader = new PostgresChatRepository({ pool })
    const snapshotA = await reader.readSnapshot(tenantId, ownerId, aSessionId, undefined)
    const snapshotB = await reader.readSnapshot(tenantId, ownerId, bSessionId, undefined)
    assert.deepEqual(snapshotA?.executionHead, {
      runId: a.run_id,
      state: "active",
      pendingPauses: [],
    })
    assert.deepEqual(snapshotB?.executionHead, {
      runId: b.run_id,
      state: "active",
      pendingPauses: [],
    })
    const now = new Date().toISOString()
    const cutoff = Date.parse(now) - 1000
    assert.ok([...beforeA.bff_agui_event, ...beforeB.bff_agui_event].every(({ recorded_at }) => Date.parse(recorded_at) < cutoff))
    // A sorts before B and meets old START-only discovery, but its live pin at 1 permits no prefix deletion.
    assert.ok(aSessionId < bSessionId)
    const collected = await store.agUiConsumers.collectGarbage({
      now,
      retentionMs: 1000,
      tombstoneRetentionMs: 24 * 60 * 60 * 1000,
      batchSize: 1,
    })
    const afterA = await fingerprint(aSessionId)
    const afterB = await fingerprint(bSessionId)
    assert.deepEqual(afterA, beforeA, "GC must leave every A fact unchanged, including the queued pin and head")
    assert.deepEqual(await reader.readSnapshot(tenantId, ownerId, aSessionId, undefined), snapshotA)
    assert.deepEqual(
      afterB.bff_agui_event,
      beforeB.bff_agui_event.slice(1),
      "batchSize=1 must skip non-deletable A and delete exactly B's oldest expired prefix frame",
    )
    assert.deepEqual(
      afterB.bff_agui_cursor_tombstone.map(({ expired_at, ...fact }) => fact),
      [
        {
          tenant_id: tenantId,
          session_id: bSessionId,
          cursor: beforeB.bff_agui_event[0].cursor,
          public_sequence: 1,
        },
      ],
    )
    assert.equal(Date.parse(afterB.bff_agui_cursor_tombstone[0].expired_at), Date.parse(now))
    assert.equal(afterB.bff_agui_stream[0].retention_floor_sequence, 1)
    const { updated_at: beforeUpdated, retention_floor_sequence: beforeFloor, ...beforeStream } = beforeB.bff_agui_stream[0]
    const { updated_at: afterUpdated, retention_floor_sequence: afterFloor, ...afterStream } = afterB.bff_agui_stream[0]
    assert.equal(beforeFloor, 0)
    assert.equal(afterFloor, 1)
    assert.ok(Date.parse(afterUpdated) >= Date.parse(beforeUpdated))
    assert.deepEqual(afterStream, beforeStream, "GC may advance B's floor/time, not its source watermark, current START, version or identity")
    for (const table of ["bff_conversation", "bff_agent_dispatch_outbox", "bff_message", "bff_agui_source_event"]) {
      assert.deepEqual(afterB[table], beforeB[table], "B production facts must survive public prefix GC: " + table)
    }
    assert.deepEqual(
      await reader.readSnapshot(tenantId, ownerId, bSessionId, undefined),
      snapshotB,
      "B's current head, messages and opaque watermark must be preserved",
    )
    assert.deepEqual(
      collected,
      {
        streamsScanned: 1,
        framesDeleted: 1,
        tombstonesInserted: 1,
        tombstonesDeleted: 0,
      },
      "eligible B must be served rather than returning an all-skipped batch",
    )
  },
)

// R57: production PostgreSQL operations only; Root supplies isolated PG/Redis. No global DROP/reset.

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
              input_schema: {
                type: "object",
                properties: { query: { type: "string" } },
              },
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
            display: {
              name: "edit",
              description: "Edit parameters",
              editable: true,
              input_schema: { type: "object" },
            },
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
            display: {
              name: "question",
              description: "Choose a region",
              editable: false,
              input_schema: { type: "object" },
            },
            validation: {
              code: "json_schema_invalid",
              instance_path: ["region", 0],
            },
          },
          {
            item_id: "item_submit",
            request_id: "request_input_1",
            kind: "input",
            allowed_decisions: ["submit"],
            display: {
              name: "form",
              description: "Confirm values",
              editable: true,
              input_schema: { type: "object" },
            },
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
      {
        type: "submit",
        item_id: "item_submit",
        value: { confirmed: true, comment: null },
      },
    ],
  }
}

async function r57Bounded(promise, label) {
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
async function r57ProjectionContext(context) {
  const { randomUUID } = await import("node:crypto")
  const suffix = randomUUID().replaceAll("-", "")
  const tenantId = "r57_projection_" + suffix,
    sessionId = "r57_session_" + suffix,
    ownerId = "r57_owner_" + suffix
  const pool = new Pool({
    connectionString: postgresUrl,
    options: "-c search_path=kokoro_bff -c timezone=UTC",
    statement_timeout: 5000,
  })
  let store = null
  context.after(async () => {
    const failures = []
    if (store !== null) {
      try {
        await store.close()
      } catch (error) {
        failures.push(error)
      }
    }
    for (const [table, column] of [
      ["bff_agui_run_activity", "session_id"],
      ["bff_agui_run_process", "session_id"],
      ["bff_agui_run_interaction", "session_id"],
      ["bff_agui_cursor_tombstone", "session_id"],
      ["bff_agui_event", "session_id"],
      ["bff_conversation_artifact", "conversation_id"],
      ["bff_agui_source_event", "session_id"],
      ["bff_agui_stream", "session_id"],
      ["bff_agent_cancellation_outbox", "conversation_id"],
      ["bff_agent_dispatch_outbox", "conversation_id"],
      ["bff_message", "conversation_id"],
      ["bff_share", "conversation_id"],
      ["bff_conversation", "conversation_id"],
    ]) {
      try {
        if (
          ["bff_agui_run_activity", "bff_agui_run_process", "bff_agui_run_interaction"].includes(table) &&
          (await pool.query("SELECT to_regclass($1) AS name", ["kokoro_bff." + table])).rows[0].name === null
        )
          continue
        await pool.query(
          "DELETE FROM " + table + " WHERE tenant_id=$1" + (column === null ? "" : " AND " + column + "=$2"),
          column === null ? [tenantId] : [tenantId, sessionId],
        )
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
    if (failures.length) throw new AggregateError(failures, "R57 scoped projection cleanup failed")
  })
  await pool.query("CREATE SCHEMA IF NOT EXISTS kokoro_bff")
  await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
  store = new PostgresBffRepositories(postgresUrl, redisUrl)
  await store.ready()
  const runId = await submitAndAdmit(store, pool, {
    tenantId,
    sessionId,
    ownerId,
    suffix,
  })
  const source = (sequence, payload, kind = "interaction.state", run = runId) => {
    const id = "r57_source_" + suffix + "_" + sequence
    const occurredAt = new Date(sequence * 1000).toISOString()
    const eventType = kind === "run.created" ? "run.started" : kind
    return {
      sourceRunId: run,
      sourceEventId: id,
      sourceSequence: sequence,
      sourceOccurredAt: occurredAt,
      sourcePayload: {
        chat_event_id: id,
        session_id: sessionId,
        run_id: run,
        source_index: sequence - 1,
        event_type: eventType,
        payload_json: JSON.stringify(payload),
        seq: sequence,
        created_at: sequence * 1000,
      },
      event: {
        event_id: id,
        seq: sequence,
        session_id: sessionId,
        run_id: run,
        kind,
        timestamp: occurredAt,
        payload,
      },
    }
  }
  const ingest = (sources) => store.agUi.ingest(tenantId, sessionId, sources)
  const snapshot = () => store.services.chat.snapshot(tenantId, ownerId, sessionId, undefined)
  const fingerprint = async () => {
    const facts = {}
    for (const [table, column, order] of [
      ["bff_conversation", "conversation_id", "conversation_id"],
      ["bff_message", "conversation_id", "message_id"],
      ["bff_agent_dispatch_outbox", "conversation_id", "outbox_id"],
      ["bff_agui_stream", "session_id", "session_id"],
      ["bff_agui_source_event", "session_id", "source_sequence"],
      ["bff_agui_event", "session_id", "public_sequence"],
      ["bff_agui_cursor_tombstone", "session_id", "public_sequence"],
      ["bff_agui_run_process", "session_id", "run_id"],
      ["bff_agui_run_activity", "session_id", "activity_id"],
      ["bff_agui_run_interaction", "session_id", "run_id"],
    ]) {
      if (
        ["bff_agui_run_activity", "bff_agui_run_process", "bff_agui_run_interaction"].includes(table) &&
        (await pool.query("SELECT to_regclass($1) AS name", ["kokoro_bff." + table])).rows[0].name === null
      ) {
        facts[table] = null
        continue
      }
      facts[table] = (await pool.query("SELECT * FROM " + table + " WHERE tenant_id=$1 AND " + column + "=$2 ORDER BY " + order, [tenantId, sessionId])).rows
    }
    return facts
  }
  await ingest([source(1, { run_id: runId }, "run.created")])
  return {
    pool,
    store,
    tenantId,
    sessionId,
    ownerId,
    runId,
    suffix,
    source,
    ingest,
    snapshot,
    fingerprint,
  }
}
function r57ExpectedHead(runId, state, pause) {
  return {
    run_id: runId,
    state,
    pending_pauses: pause === undefined ? [] : [pause],
  }
}

integrationTest(
  "R57 durable full revision lifecycle preserves complete resuming groups and releases FIFO only on Run terminal",
  { timeout: 30_000 },
  async (context) => {
    const c = await r57ProjectionContext(context)
    const activeBefore = await c.snapshot()
    const queued = await c.store.services.chatTurns.submit({
      tenantId: c.tenantId,
      conversationId: c.sessionId,
      subjectId: c.ownerId,
      actorId: c.ownerId,
      requestId: "r57_next_" + c.suffix,
      idempotencyKey: "r57_next_key_" + c.suffix,
      content: "Queued next Run",
    })
    assert.ok(queued)
    const waiting = r57Waiting()
    assert.equal((await c.ingest([c.source(2, waiting)])).insertedFrames, 1, "full HTTP4 revision must durably emit one CUSTOM")
    assert.deepEqual(activeBefore.execution_head, r57ExpectedHead(c.runId, "active"))
    const check = async (state, payload, priorCursor) => {
      const current = await c.snapshot()
      assert.deepEqual(current.execution_head, r57ExpectedHead(c.runId, state, state === "waiting" || state === "resuming" ? payload : undefined))
      assert.equal(Object.hasOwn(current, "active_run"), false)
      assert.equal(Object.hasOwn(current, "pending_pauses"), false)
      assert.match(current.event_watermark, /^agui_[0-9a-f]{32}$/u)
      if (priorCursor !== undefined) assert.notEqual(current.event_watermark, priorCursor)
      const replay = await c.store.agUi.replay(c.tenantId, c.sessionId, priorCursor ?? activeBefore.event_watermark, 100)
      assert.equal(replay.kind, "page")
      assert.equal(replay.frames.at(-1).payload.name, "kokoro.interaction.state")
      assert.deepEqual(replay.frames.at(-1).payload.value, payload)
      assert.equal(replay.frames.at(-1).cursor, current.event_watermark)
      const rows = (
        await c.pool.query("SELECT * FROM bff_agui_run_interaction WHERE tenant_id=$1 AND session_id=$2 AND run_id=$3", [c.tenantId, c.sessionId, c.runId])
      ).rows
      assert.equal(rows.length, 1)
      assert.equal(String(rows[0].interaction_revision), String(payload.interaction_revision))
      assert.equal(rows[0].public_cursor, current.event_watermark)
      return current
    }
    let previous = await check("waiting", waiting, activeBefore.event_watermark)
    const accepted = {
      ...waiting,
      interaction_revision: 8,
      phase: "resuming",
      action_result: {
        command_id: "r57_resume",
        pause_revision: 7,
        kind: "accepted",
      },
    }
    await c.ingest([c.source(3, accepted)])
    previous = await check("resuming", accepted, previous.event_watermark)
    const unknown = {
      ...accepted,
      interaction_revision: 9,
      action_result: { ...accepted.action_result, kind: "unknown" },
    }
    await c.ingest([c.source(4, unknown)])
    previous = await check("resuming", unknown, previous.event_watermark)
    const consumed = {
      ...unknown,
      interaction_revision: 10,
      phase: "active",
      groups: [],
      action_result: { ...unknown.action_result, kind: "native_consumed" },
    }
    await c.ingest([c.source(5, consumed)])
    previous = await check("active", consumed, previous.event_watermark)
    assert.equal(consumed.pause_ref, waiting.pause_ref, "consumed active legitimately retains its historical locator")
    const repause = {
      ...waiting,
      interaction_revision: 11,
      pause_revision: 11,
      pause_ref: "pause:run_hitl_1:11",
      groups: [waiting.groups[1]],
      action_result: consumed.action_result,
    }
    await c.ingest([c.source(6, repause)])
    previous = await check("waiting", repause, previous.event_watermark)
    const resumedAgain = {
      ...repause,
      interaction_revision: 12,
      phase: "resuming",
      action_result: {
        command_id: "r57_resume_again",
        pause_revision: 11,
        kind: "accepted",
      },
    }
    await c.ingest([c.source(7, resumedAgain)])
    previous = await check("resuming", resumedAgain, previous.event_watermark)
    const validationFailed = {
      ...repause,
      interaction_revision: 13,
      pause_revision: 13,
      pause_ref: "pause:run_hitl_1:13",
      action_result: {
        command_id: "r57_resume_again",
        pause_revision: 11,
        kind: "validation_failed",
      },
    }
    await c.ingest([c.source(8, validationFailed)])
    previous = await check("waiting", validationFailed, previous.event_watermark)
    const interactionTerminal = {
      ...validationFailed,
      interaction_revision: 14,
      phase: "terminal",
      groups: [],
      action_result: {
        command_id: "r57_cancel",
        pause_revision: 13,
        kind: "cancelled",
      },
    }
    await c.ingest([c.source(9, interactionTerminal)])
    previous = await check("active", interactionTerminal, previous.event_watermark)
    const beforeTerminal = await c.fingerprint()
    assert.equal(beforeTerminal.bff_agent_dispatch_outbox.find((row) => row.run_id === c.runId).status, "admitted")
    assert.ok(beforeTerminal.bff_agui_event.every((row) => row.event_type !== "RUN_FINISHED"))
    await c.ingest([c.source(10, { status: "completed" }, "run.completed")])
    const final = await c.snapshot()
    assert.deepEqual(final.execution_head, r57ExpectedHead(queued.run_id, "queued"))
    const finalReplay = await c.store.agUi.replay(c.tenantId, c.sessionId, previous.event_watermark, 100)
    assert.equal(finalReplay.kind, "page")
    assert.deepEqual(
      finalReplay.frames.map((frame) => frame.eventType),
      ["RUN_FINISHED", "CUSTOM"],
    )
    assert.equal(finalReplay.frames[1].payload.name, "kokoro.run.queued")
    assert.equal(finalReplay.frames.at(-1).cursor, final.event_watermark)
  },
)
integrationTest(
  "R57 same full revision is a frame no-op but optional presence or stale revision is an atomic conflict",
  { timeout: 30_000 },
  async (context) => {
    const c = await r57ProjectionContext(context),
      waiting = r57Waiting()
    assert.equal((await c.ingest([c.source(2, waiting)])).insertedFrames, 1)
    const before = await c.snapshot()
    const repeated = await c.ingest([c.source(3, structuredClone(waiting))])
    assert.equal(repeated.insertedSources, 1)
    assert.equal(repeated.insertedFrames, 0)
    assert.equal(repeated.sourceHighWatermark, 3)
    assert.deepEqual(await c.snapshot(), before)
    const facts = await c.fingerprint()
    const omitted = structuredClone(waiting)
    for (const key of ["result_preview", "truncated", "source"]) delete omitted.groups[0].items[0].display[key]
    await assert.rejects(c.ingest([c.source(4, omitted)]))
    assert.deepEqual(await c.fingerprint(), facts, "same revision with different optional presence must write nothing")
    const stale = {
      ...waiting,
      interaction_revision: 6,
      pause_revision: 6,
      pause_ref: "pause:run_hitl_1:6",
    }
    await assert.rejects(c.ingest([c.source(4, stale)]))
    assert.deepEqual(await c.fingerprint(), facts)
    const newer = { ...omitted, interaction_revision: 8 }
    assert.equal((await c.ingest([c.source(4, newer)])).insertedFrames, 1)
    const after = await c.snapshot()
    assert.deepEqual(after.execution_head, r57ExpectedHead(c.runId, "waiting", newer))
    assert.notEqual(after.event_watermark, before.event_watermark)
  },
)
integrationTest(
  "R57 malformed full-state in a mixed production ingest rolls back preceding valid revision and every fact",
  { timeout: 30_000 },
  async (context) => {
    const c = await r57ProjectionContext(context)
    const before = await c.fingerprint()
    const invalid = r57Waiting()
    invalid.groups[1].items[0].item_id = invalid.groups[0].items[0].item_id
    await assert.rejects(c.ingest([c.source(2, r57Waiting()), c.source(3, { ...invalid, interaction_revision: 8 })]))
    assert.deepEqual(await c.fingerprint(), before, "mixed invalid page cannot write a source prefix, state, assistant, dispatch, stream CAS or cursor")
  },
)
integrationTest("R57 interaction CUSTOM insertion failure rolls back source row typed state CAS and public watermark", { timeout: 30_000 }, async (context) => {
  const c = await r57ProjectionContext(context)
  const before = await c.fingerprint(),
    snapshot = await c.snapshot()
  const fn = "r57_frame_fail_" + c.suffix,
    trigger = "r57_frame_trigger_" + c.suffix
  try {
    await c.pool.query(
      "CREATE FUNCTION " +
        fn +
        "() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.tenant_id = '" +
        c.tenantId +
        "' AND NEW.session_id = '" +
        c.sessionId +
        "' AND NEW.event_type = 'CUSTOM' AND NEW.event_payload->>'name' = 'kokoro.interaction.state' THEN RAISE EXCEPTION 'r57_owned_custom_insert_failure'; END IF; RETURN NEW; END $$",
    )
    await c.pool.query("CREATE TRIGGER " + trigger + " BEFORE INSERT ON bff_agui_event FOR EACH ROW EXECUTE FUNCTION " + fn + "()")
    await assert.rejects(c.ingest([c.source(2, r57Waiting())]), /r57_owned_custom_insert_failure/u)
    assert.deepEqual(await c.fingerprint(), before)
    assert.deepEqual(await c.snapshot(), snapshot)
  } finally {
    const failures = []
    try {
      await c.pool.query("DROP TRIGGER IF EXISTS " + trigger + " ON bff_agui_event")
    } catch (error) {
      failures.push(error)
    }
    try {
      await c.pool.query("DROP FUNCTION IF EXISTS " + fn + "()")
    } catch (error) {
      failures.push(error)
    }
    if (failures.length) throw new AggregateError(failures, "R57 owned trigger cleanup failed")
  }
  assert.equal((await c.ingest([c.source(2, r57Waiting())])).insertedFrames, 1, "healthy same source must succeed after rollback")
})
integrationTest(
  "R57 authorized RR snapshot keeps old complete pause and cursor while a genuine independent revision commits",
  { timeout: 30_000 },
  async (context) => {
    const c = await r57ProjectionContext(context)
    const { ChatApplicationService } = await import("../dist/application/chat-service.js")
    const waiting = r57Waiting()
    assert.equal((await c.ingest([c.source(2, waiting)])).insertedFrames, 1)
    const before = await c.snapshot()
    let authorize, release
    const authorized = new Promise((resolve) => {
      authorize = resolve
    })
    const released = new Promise((resolve) => {
      release = resolve
    })
    const reader = await c.pool.connect()
    let returned = false,
      pending = null,
      gatedOnce = false
    try {
      const repository = new PostgresChatRepository({
        pool: {
          connect: async () => ({
            query: async (sql, values) => {
              const result = await reader.query(sql, values)
              if (!gatedOnce && sql.includes("FROM bff_conversation") && sql.includes("LIMIT 1")) {
                gatedOnce = true
                assert.equal(result.rows[0]?.conversation_id, c.sessionId)
                assert.equal((await reader.query("SHOW transaction_isolation")).rows[0].transaction_isolation, "repeatable read")
                authorize()
                await released
              }
              return result
            },
            release: () => {
              returned = true
              reader.release()
            },
          }),
        },
      })
      pending = new ChatApplicationService(repository).snapshot(c.tenantId, c.ownerId, c.sessionId, undefined)
      void pending.catch(() => undefined)
      await r57Bounded(
        Promise.race([
          authorized,
          pending.then(() => {
            throw new Error("snapshot finished before real authorization barrier")
          }),
        ]),
        "R57 RR authorization timeout",
      )
      const accepted = {
        ...waiting,
        interaction_revision: 8,
        phase: "resuming",
        action_result: {
          command_id: "r57_rr_control",
          pause_revision: 7,
          kind: "accepted",
        },
      }
      await r57Bounded(c.ingest([c.source(3, accepted)]), "R57 independent production revision writer timeout")
      const fresh = await c.snapshot()
      release()
      const old = await r57Bounded(pending, "R57 RR reader release timeout")
      assert.deepEqual(old.execution_head, r57ExpectedHead(c.runId, "waiting", waiting))
      assert.equal(old.event_watermark, before.event_watermark)
      assert.deepEqual(fresh.execution_head, r57ExpectedHead(c.runId, "resuming", accepted))
      assert.notEqual(fresh.event_watermark, before.event_watermark)
    } finally {
      release()
      if (pending !== null) await pending.catch(() => undefined)
      if (!returned) reader.release()
    }
  },
)

integrationTest(
  "R57 full interaction ingestion rejects foreign run source gap and stale lease without changing any durable fact",
  { timeout: 30_000 },
  async (context) => {
    const c = await r57ProjectionContext(context)
    assert.equal((await c.ingest([c.source(2, r57Waiting())])).insertedFrames, 1)
    const before = await c.fingerprint()
    const newer = { ...r57Waiting(), interaction_revision: 8 }
    await assert.rejects(c.ingest([c.source(3, newer, "interaction.state", "foreign_unadmitted_run")]))
    assert.deepEqual(await c.fingerprint(), before)
    await assert.rejects(c.ingest([c.source(4, newer)]))
    assert.deepEqual(await c.fingerprint(), before)
    const [lease] = await c.store.agUiConsumers.claimConsumers({
      workerId: "r57_lease_" + c.suffix,
      now: new Date().toISOString(),
      leaseUntil: new Date(Date.now() + 5000).toISOString(),
      limit: 1,
    })
    assert.equal(lease?.tenantId, c.tenantId)
    assert.equal(lease?.sessionId, c.sessionId)
    const leasedBefore = await c.fingerprint()
    await assert.rejects(
      c.store.agUi.ingest(c.tenantId, c.sessionId, [c.source(3, newer)], {
        ...lease,
        fence: lease.fence + 1,
      }),
    )
    assert.deepEqual(await c.fingerprint(), leasedBefore)
    assert.equal(
      (await c.store.agUi.ingest(c.tenantId, c.sessionId, [c.source(3, newer)], lease)).insertedFrames,
      1,
      "the genuine current lease and contiguous source must still commit",
    )
    assert.equal(await c.store.agUiConsumers.releaseConsumer(lease, new Date().toISOString()), true)
  },
)

integrationTest(
  "R61 a distinct START after full interaction is atomically rejected while exact START replay is idempotent",
  { timeout: 30_000 },
  async (context) => {
    const c = await r57ProjectionContext(context)
    await c.ingest([c.source(2, r57Waiting())])
    const before = await c.fingerprint()
    const snapshot = await c.snapshot()
    await assert.rejects(c.ingest([c.source(3, { run_id: c.runId }, "run.created")]), /source identity conflict/u)
    assert.deepEqual(await c.fingerprint(), before)
    assert.deepEqual(await c.snapshot(), snapshot)
    const replay = await c.ingest([c.source(1, { run_id: c.runId }, "run.created")])
    assert.equal(replay.insertedSources, 0)
    assert.equal(replay.insertedFrames, 0)
    assert.deepEqual(await c.fingerprint(), before)
    // Prove the rejected source did not damage the current stream's future write boundary.
    const next = { ...r57Waiting(), interaction_revision: 8 }
    assert.equal((await c.ingest([c.source(3, next)])).insertedFrames, 1)
    assert.deepEqual((await c.snapshot()).execution_head, r57ExpectedHead(c.runId, "waiting", next))
  },
)

integrationTest("R126 a second START identity for one Run rolls back while the exact START replay stays a no-op", { timeout: 30_000 }, async (context) => {
  const c = await r57ProjectionContext(context)
  const before = await c.fingerprint()
  await assert.rejects(c.ingest([c.source(2, { run_id: c.runId }, "run.created")]), /AGUI_PROCESS_START_IDENTITY_CONFLICT/u)
  assert.deepEqual(await c.fingerprint(), before)
  const replay = await c.ingest([c.source(1, { run_id: c.runId }, "run.created")])
  assert.deepEqual(
    {
      insertedSources: replay.insertedSources,
      insertedFrames: replay.insertedFrames,
    },
    { insertedSources: 0, insertedFrames: 0 },
  )
  assert.deepEqual(await c.fingerprint(), before)
})

integrationTest(
  "R126 observed Todo requires every value and provenance column while an observed empty table is valid",
  { timeout: 30_000 },
  async (context) => {
    const c = await r57ProjectionContext(context)
    await c.ingest([c.source(2, { todos: [] }, "todo.updated")])
    const before = await c.fingerprint()
    assert.deepEqual(before.bff_agui_run_process[0].todos, [])
    assert.equal(before.bff_agui_run_process[0].todo_observed, true)
    for (const column of ["todos", "todo_source_owner", "todo_source_sequence", "todo_source_digest", "todo_public_sequence"]) {
      await assert.rejects(
        c.pool.query(`UPDATE bff_agui_run_process SET ${column}=NULL WHERE tenant_id=$1 AND session_id=$2 AND run_id=$3`, [c.tenantId, c.sessionId, c.runId]),
        (error) => error?.code === "23514",
      )
      assert.deepEqual(await c.fingerprint(), before)
    }
  },
)

integrationTest(
  "R118 authorized RR snapshot keeps assistant interaction head and watermark on one committed boundary",
  { timeout: 30_000 },
  async (context) => {
    const c = await r57ProjectionContext(context)
    const { ChatApplicationService } = await import("../dist/application/chat-service.js")
    const waiting = r57Waiting()
    const segmentId = "r118_segment_" + c.suffix
    assert.equal(
      (await c.ingest([c.source(2, { segment_id: segmentId, delta: "R118 old partial" }, "message.delta"), c.source(3, waiting)])).insertedSources,
      2,
    )
    const before = await c.snapshot()
    const beforeAssistant = before.messages.find((message) => message.role === "assistant" && message.run_id === c.runId)
    assert.ok(beforeAssistant)
    assert.deepEqual(
      {
        message_id: beforeAssistant.message_id,
        run_id: beforeAssistant.run_id,
        content: beforeAssistant.content,
        status: beforeAssistant.status,
      },
      {
        message_id: beforeAssistant.message_id,
        run_id: c.runId,
        content: "R118 old partial",
        status: "streaming",
      },
    )
    assert.deepEqual(before.execution_head, r57ExpectedHead(c.runId, "waiting", waiting))
    assert.match(before.event_watermark, /^agui_[0-9a-f]{32}$/u)

    let authorize, release
    const authorized = new Promise((resolve) => {
      authorize = resolve
    })
    const released = new Promise((resolve) => {
      release = resolve
    })
    const reader = await c.pool.connect()
    let returned = false,
      pending = null,
      gatedOnce = false,
      primaryFailure = null
    try {
      const repository = new PostgresChatRepository({
        pool: {
          connect: async () => ({
            query: async (sql, values) => {
              const result = await reader.query(sql, values)
              if (!gatedOnce && sql.includes("FROM bff_conversation") && sql.includes("LIMIT 1")) {
                gatedOnce = true
                assert.equal(result.rows[0]?.conversation_id, c.sessionId)
                assert.equal((await reader.query("SHOW transaction_isolation")).rows[0].transaction_isolation, "repeatable read")
                authorize()
                await released
              }
              return result
            },
            release: () => {
              returned = true
              reader.release()
            },
          }),
        },
      })
      pending = new ChatApplicationService(repository).snapshot(c.tenantId, c.ownerId, c.sessionId, undefined)
      void pending.catch(() => undefined)
      await r57Bounded(
        Promise.race([
          authorized,
          pending.then(() => {
            throw new Error("R118 snapshot finished before real authorization barrier")
          }),
        ]),
        "R118 RR authorization timeout",
      )

      const accepted = {
        ...waiting,
        interaction_revision: 8,
        phase: "resuming",
        action_result: {
          command_id: "r118_resume_" + c.suffix,
          pause_revision: 7,
          kind: "accepted",
        },
      }
      const committed = await r57Bounded(
        c.ingest([c.source(4, { segment_id: segmentId, delta: " + committed" }, "message.delta"), c.source(5, accepted)]),
        "R118 independent production ingest timeout",
      )
      assert.deepEqual(
        {
          insertedSources: committed.insertedSources,
          insertedFrames: committed.insertedFrames,
          sourceHighWatermark: committed.sourceHighWatermark,
        },
        { insertedSources: 2, insertedFrames: 2, sourceHighWatermark: 5 },
      )
      const committedStatus = await c.store.agUi.status(c.tenantId, c.sessionId)
      const fresh = await c.snapshot()
      release()
      const old = await r57Bounded(pending, "R118 RR reader release timeout")

      const oldAssistant = old.messages.find((message) => message.message_id === beforeAssistant.message_id)
      const freshAssistant = fresh.messages.find((message) => message.message_id === beforeAssistant.message_id)
      assert.deepEqual(
        {
          message_id: oldAssistant?.message_id,
          run_id: oldAssistant?.run_id,
          content: oldAssistant?.content,
          status: oldAssistant?.status,
          execution_head: old.execution_head,
          event_watermark: old.event_watermark,
        },
        {
          message_id: beforeAssistant.message_id,
          run_id: c.runId,
          content: "R118 old partial",
          status: "streaming",
          execution_head: r57ExpectedHead(c.runId, "waiting", waiting),
          event_watermark: before.event_watermark,
        },
      )
      assert.deepEqual(
        {
          message_id: freshAssistant?.message_id,
          run_id: freshAssistant?.run_id,
          content: freshAssistant?.content,
          status: freshAssistant?.status,
          execution_head: fresh.execution_head,
          event_watermark: fresh.event_watermark,
        },
        {
          message_id: beforeAssistant.message_id,
          run_id: c.runId,
          content: "R118 old partial + committed",
          status: "streaming",
          execution_head: r57ExpectedHead(c.runId, "resuming", accepted),
          event_watermark: committedStatus.currentCursor,
        },
      )
      assert.match(fresh.event_watermark, /^agui_[0-9a-f]{32}$/u)
      assert.notEqual(fresh.event_watermark, before.event_watermark)

      const replay = await c.store.agUi.replay(c.tenantId, c.sessionId, before.event_watermark, 100)
      assert.equal(replay.kind, "page")
      assert.deepEqual(
        replay.frames.map(({ eventType, payload }) => ({ eventType, payload })),
        [
          {
            eventType: "TEXT_MESSAGE_CONTENT",
            payload: {
              type: "TEXT_MESSAGE_CONTENT",
              delta: " + committed",
              metadata: {
                kokoro: {
                  seq: 4,
                  run_id: c.runId,
                  event_id: "r57_source_" + c.suffix + "_4",
                  timestamp: "1970-01-01T00:00:04.000Z",
                  session_id: c.sessionId,
                },
              },
              messageId: segmentId,
              timestamp: 4000,
            },
          },
          {
            eventType: "CUSTOM",
            payload: {
              name: "kokoro.interaction.state",
              type: "CUSTOM",
              value: accepted,
              metadata: {
                kokoro: {
                  seq: 5,
                  run_id: c.runId,
                  event_id: "r57_source_" + c.suffix + "_5",
                  timestamp: "1970-01-01T00:00:05.000Z",
                  session_id: c.sessionId,
                },
              },
              timestamp: 5000,
            },
          },
        ],
      )
      assert.equal(replay.frames.at(-1).cursor, fresh.event_watermark)
      assert.equal(new Set(replay.frames.map(({ cursor }) => cursor)).size, 2)
    } catch (error) {
      primaryFailure = error
    } finally {
      release()
      const cleanupFailures = []
      try {
        if (pending !== null) await r57Bounded(pending, "R118 pending reader cleanup timeout")
      } catch (error) {
        if (error !== primaryFailure) cleanupFailures.push(error)
      }
      try {
        if (!returned) reader.release()
      } catch (error) {
        cleanupFailures.push(error)
      }
      if (primaryFailure !== null) cleanupFailures.unshift(primaryFailure)
      if (cleanupFailures.length === 1) throw cleanupFailures[0]
      if (cleanupFailures.length > 1) throw new AggregateError(cleanupFailures, "R118 snapshot or reader cleanup failed")
    }
  },
)

integrationTest("R124 successor registration preserves terminal A process until B durable START", { timeout: 30_000 }, async (context) => {
  const c = await r57ProjectionContext(context)
  const freshProjectionState = (
    await c.pool.query("SELECT projection_state FROM bff_agui_stream WHERE tenant_id=$1 AND session_id=$2", [c.tenantId, c.sessionId])
  ).rows[0].projection_state
  assert.deepEqual(freshProjectionState, { text_message_ids: [] })
  const activity = {
    activity: "tool",
    activity_id: "act_" + "a".repeat(64),
    segment_id: "seg_" + "a".repeat(64),
    status: "completed",
    display_code: "tool.execution",
  }
  await c.ingest([c.source(2, { todos: [] }, "todo.updated"), c.source(3, activity, "activity.updated"), c.source(4, { status: "completed" }, "run.completed")])
  const queued = await c.store.services.chatTurns.submit({
    tenantId: c.tenantId,
    conversationId: c.sessionId,
    subjectId: c.ownerId,
    actorId: c.ownerId,
    requestId: "r124_successor_" + c.suffix,
    idempotencyKey: "r124_successor_key_" + c.suffix,
    content: "next",
  })
  assert.ok(queued)
  const beforeStart = await c.snapshot()
  assert.deepEqual(beforeStart.execution_head, {
    run_id: queued.run_id,
    state: "queued",
    pending_pauses: [],
  })
  assert.equal(Object.hasOwn(beforeStart, "execution_process"), true)
  assert.notEqual(beforeStart.execution_process, null)
  assert.equal(beforeStart.execution_process.run_id, c.runId)
  assert.deepEqual(beforeStart.execution_process.todos, [])
  assert.deepEqual(beforeStart.execution_process.activities, [activity])
  const [claim] = await c.store.agentDispatchOutbox.claimAgentDispatchOutbox({
    workerId: "r124_successor_" + c.suffix,
    limit: 1,
    leaseDurationMs: 5000,
    maxAttempts: 8,
  })
  assert.equal(claim.runId, queued.run_id)
  assert.equal(await c.store.agentDispatchOutbox.markAgentDispatchAdmitted(claim), true)
  await c.ingest([c.source(5, { run_id: queued.run_id }, "run.created", queued.run_id)])
  const afterStart = await c.snapshot()
  assert.equal(Object.hasOwn(afterStart, "execution_process"), true)
  assert.notEqual(afterStart.execution_process, null)
  assert.equal(afterStart.execution_process.run_id, queued.run_id)
  assert.equal(afterStart.execution_process.todos, null)
  assert.deepEqual(afterStart.execution_process.activities, [])
})

integrationTest("R124 one authorized RR snapshot binds Message head process HITL Delivery and watermark", { timeout: 30_000 }, async (context) => {
  const c = await r57ProjectionContext(context)
  const { ChatApplicationService } = await import("../dist/application/chat-service.js")
  const oldInteraction = r57Waiting()
  const oldSkill = {
    activity: "skill",
    activity_id: "act_" + "b".repeat(64),
    preflight_id: "spf_" + "b".repeat(64),
    source_refs: ["skill:catalog/read"],
    phase: "ready",
  }
  const delivery = (suffix) => ({
    tool_call_id: "tool_delivery_" + suffix,
    artifact_id: "artifact_r124_" + suffix,
    asset_id: "asset_r124_" + suffix,
    artifact_kind: "document",
    path: "/" + suffix + ".md",
    title: "Report " + suffix,
    mime: "text/markdown",
    size: 12,
    content_hash: suffix.repeat(64).slice(0, 64),
  })
  await c.ingest([
    c.source(2, { segment_id: "seg_" + "2".repeat(64), delta: "old" }, "message.delta"),
    c.source(3, { todos: [{ content: "inspect", status: "in_progress" }] }, "todo.updated"),
    c.source(4, oldSkill, "activity.updated"),
    c.source(5, oldInteraction, "interaction.state"),
    c.source(6, delivery("a"), "delivery.created"),
  ])
  const before = await c.snapshot()
  assert.equal(Object.hasOwn(before, "execution_process"), true)
  assert.notEqual(before.execution_process, null)
  let markAuthorized, releaseRead
  const authorized = new Promise((resolve) => {
    markAuthorized = resolve
  })
  const released = new Promise((resolve) => {
    releaseRead = resolve
  })
  const reader = await c.pool.connect()
  let returned = false,
    pending = null,
    gated = false
  try {
    const repository = new PostgresChatRepository({
      pool: {
        connect: async () => ({
          query: async (sql, values) => {
            const result = await reader.query(sql, values)
            if (!gated && sql.includes("FROM bff_conversation") && sql.includes("LIMIT 1")) {
              gated = true
              assert.equal(result.rows[0]?.conversation_id, c.sessionId)
              assert.equal((await reader.query("SHOW transaction_isolation")).rows[0].transaction_isolation, "repeatable read")
              markAuthorized()
              await released
            }
            return result
          },
          release: () => {
            returned = true
            reader.release()
          },
        }),
      },
    })
    pending = new ChatApplicationService(repository).snapshot(c.tenantId, c.ownerId, c.sessionId, undefined)
    void pending.catch(() => undefined)
    await r57Bounded(
      Promise.race([
        authorized,
        pending.then(() => {
          throw new Error("R124 snapshot finished before authorization barrier")
        }),
      ]),
      "R124 RR authorization timeout",
    )
    const newInteraction = {
      ...oldInteraction,
      interaction_revision: 8,
      phase: "resuming",
      action_result: {
        command_id: "r124_rr_resume_" + c.suffix,
        pause_revision: 7,
        kind: "accepted",
      },
    }
    const newSkill = {
      ...oldSkill,
      preflight_id: "spf_" + "c".repeat(64),
      phase: "failed",
      error_code: "skill_load_failed",
    }
    await r57Bounded(
      c.ingest([
        c.source(7, { segment_id: "seg_" + "2".repeat(64), delta: "-new" }, "message.delta"),
        c.source(8, { todos: [{ content: "inspect", status: "completed" }] }, "todo.updated"),
        c.source(9, newSkill, "activity.updated"),
        c.source(10, newInteraction, "interaction.state"),
        c.source(11, delivery("b"), "delivery.created"),
      ]),
      "R124 RR writer timeout",
    )
    const fresh = await c.snapshot()
    releaseRead()
    const old = await r57Bounded(pending, "R124 RR reader release timeout")
    assert.equal(old.event_watermark, before.event_watermark)
    assert.deepEqual(old.execution_process, before.execution_process)
    assert.deepEqual(old.execution_head, before.execution_head)
    assert.deepEqual(old.messages, before.messages)
    assert.deepEqual(old.deliveries, before.deliveries)
    assert.notEqual(fresh.event_watermark, before.event_watermark)
    assert.deepEqual(fresh.execution_process.todos, [{ content: "inspect", status: "completed" }])
    assert.deepEqual(fresh.execution_process.activities, [newSkill])
    assert.deepEqual(fresh.execution_head, r57ExpectedHead(c.runId, "resuming", newInteraction))
    assert.equal(fresh.messages.at(-1).content, "old-new")
    assert.deepEqual(fresh.deliveries.map(({ artifact_id }) => artifact_id).sort(), ["artifact_r124_a", "artifact_r124_b"])
    const replay = await c.store.agUi.replay(c.tenantId, c.sessionId, before.event_watermark, 100)
    assert.equal(replay.kind, "page")
    assert.equal(replay.frames.at(-1).cursor, fresh.event_watermark)
  } finally {
    releaseRead()
    if (pending !== null) await pending.catch(() => undefined)
    if (!returned) reader.release()
  }
})

integrationTest("R124 safe process SQL fault rolls back source ledger compact facts and watermark", { timeout: 30_000 }, async (context) => {
  const c = await r57ProjectionContext(context)
  assert.equal((await c.pool.query("SELECT to_regclass('kokoro_bff.bff_agui_run_activity') AS name")).rows[0].name, "bff_agui_run_activity")
  const before = await c.fingerprint()
  const fn = "r124_process_fail_" + c.suffix
  const trigger = "r124_process_trigger_" + c.suffix
  const batch = [
    c.source(2, { todos: [{ content: "first", status: "pending" }] }, "todo.updated"),
    c.source(
      3,
      {
        activity: "tool",
        activity_id: "act_" + "c".repeat(64),
        segment_id: "seg_" + "c".repeat(64),
        status: "running",
        display_code: "tool.execution",
      },
      "activity.updated",
    ),
  ]
  try {
    await c.pool.query("CREATE FUNCTION " + fn + "() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'r124_owned_process_failure'; END $$")
    await c.pool.query("CREATE TRIGGER " + trigger + " BEFORE INSERT ON bff_agui_run_activity FOR EACH ROW EXECUTE FUNCTION " + fn + "()")
    await assert.rejects(c.ingest(batch), /r124_owned_process_failure/u)
    assert.deepEqual(await c.fingerprint(), before)
  } finally {
    await c.pool.query("DROP TRIGGER IF EXISTS " + trigger + " ON bff_agui_run_activity").catch(() => undefined)
    await c.pool.query("DROP FUNCTION IF EXISTS " + fn + "()").catch(() => undefined)
  }
  const committed = await c.ingest(batch)
  assert.deepEqual(
    {
      insertedSources: committed.insertedSources,
      insertedFrames: committed.insertedFrames,
      sourceHighWatermark: committed.sourceHighWatermark,
    },
    { insertedSources: 2, insertedFrames: 2, sourceHighWatermark: 3 },
  )
  const afterCommit = await c.fingerprint()
  assert.notDeepEqual(afterCommit, before)
  const replay = await c.ingest(batch)
  assert.deepEqual(
    {
      insertedSources: replay.insertedSources,
      insertedFrames: replay.insertedFrames,
      sourceHighWatermark: replay.sourceHighWatermark,
    },
    { insertedSources: 0, insertedFrames: 0, sourceHighWatermark: 3 },
  )
  assert.deepEqual(await c.fingerprint(), afterCommit)
})

integrationTest("R124 GC locked requery protects selected process and can collect an unreferenced old Run", { timeout: 30_000 }, async (context) => {
  const c = await r57ProjectionContext(context)
  assert.equal((await c.pool.query("SELECT to_regclass('kokoro_bff.bff_agui_run_process') AS name")).rows[0].name, "bff_agui_run_process")
  await c.ingest([c.source(2, { todos: [{ content: "old", status: "completed" }] }, "todo.updated"), c.source(3, { status: "completed" }, "run.completed")])
  const next = await c.store.services.chatTurns.submit({
    tenantId: c.tenantId,
    conversationId: c.sessionId,
    subjectId: c.ownerId,
    actorId: c.ownerId,
    requestId: "r124_gc_next_" + c.suffix,
    idempotencyKey: "r124_gc_next_key_" + c.suffix,
    content: "next",
  })
  assert.ok(next)
  const [claim] = await c.store.agentDispatchOutbox.claimAgentDispatchOutbox({
    workerId: "r124_gc_" + c.suffix,
    limit: 1,
    leaseDurationMs: 5000,
    maxAttempts: 8,
  })
  assert.equal(claim.runId, next.run_id)
  assert.equal(await c.store.agentDispatchOutbox.markAgentDispatchAdmitted(claim), true)
  await c.ingest([
    c.source(4, { run_id: next.run_id }, "run.created", next.run_id),
    c.source(5, { todos: [{ content: "live", status: "in_progress" }] }, "todo.updated", next.run_id),
  ])
  const before = await c.snapshot()
  assert.equal(before.execution_process.run_id, next.run_id)
  await c.pool.query("UPDATE bff_agui_event SET recorded_at=CURRENT_TIMESTAMP(3)-INTERVAL '40 days' WHERE tenant_id=$1 AND session_id=$2", [
    c.tenantId,
    c.sessionId,
  ])
  let markDiscovered, releaseRequery
  const discovered = new Promise((resolve) => {
    markDiscovered = resolve
  })
  const released = new Promise((resolve) => {
    releaseRequery = resolve
  })
  let gated = false,
    pending = null,
    returned = false
  const collector = new PostgresAgUiConsumerRepository({
    pool: {
      connect: async () => {
        const client = await c.pool.connect()
        return {
          query: async (sql, values) => {
            const result = await client.query(sql, values)
            if (!gated && sql.includes("ORDER BY tenant_id ASC, session_id ASC") && sql.includes("LIMIT $2") && !sql.includes("FOR UPDATE")) {
              gated = true
              assert.ok(result.rows.some((row) => row.tenant_id === c.tenantId && row.session_id === c.sessionId))
              markDiscovered()
              await released
            }
            return result
          },
          release: () => {
            returned = true
            client.release()
          },
        }
      },
    },
  })
  try {
    pending = collector.collectGarbage({
      now: new Date().toISOString(),
      retentionMs: 1,
      tombstoneRetentionMs: 30 * 24 * 60 * 60 * 1000,
      batchSize: 100,
    })
    void pending.catch(() => undefined)
    await r57Bounded(
      Promise.race([
        discovered,
        pending.then(() => {
          throw new Error("R124 GC finished before discovery barrier")
        }),
      ]),
      "R124 GC discovery timeout",
    )
    const liveActivity = {
      activity: "tool",
      activity_id: "act_" + "e".repeat(64),
      segment_id: "seg_" + "e".repeat(64),
      status: "running",
      display_code: "tool.execution",
    }
    await c.ingest([c.source(6, liveActivity, "activity.updated", next.run_id)])
    releaseRequery()
    const collected = await r57Bounded(pending, "R124 GC locked requery timeout")
    assert.ok(collected.framesDeleted > 0)
    assert.equal(
      (
        await c.pool.query("SELECT count(*)::int AS count FROM bff_agui_run_process WHERE tenant_id=$1 AND session_id=$2 AND run_id=$3", [
          c.tenantId,
          c.sessionId,
          c.runId,
        ])
      ).rows[0].count,
      0,
    )
    assert.equal(
      (
        await c.pool.query("SELECT count(*)::int AS count FROM bff_agui_run_process WHERE tenant_id=$1 AND session_id=$2 AND run_id=$3", [
          c.tenantId,
          c.sessionId,
          next.run_id,
        ])
      ).rows[0].count,
      1,
    )
    const provenance = await c.pool.query(
      `SELECT process.start_source_event_id,process.start_source_digest,process.start_public_cursor,
              (SELECT count(*)::int FROM bff_agui_source_event AS source
                WHERE source.tenant_id=process.tenant_id AND source.session_id=process.session_id
                  AND source.source_event_id=process.start_source_event_id AND source.source_digest=process.start_source_digest) AS start_sources,
              (SELECT count(*)::int FROM bff_agui_event AS event
                WHERE event.tenant_id=process.tenant_id AND event.session_id=process.session_id
                  AND event.cursor=process.start_public_cursor AND event.source_event_id=process.start_source_event_id) AS start_frames
         FROM bff_agui_run_process AS process WHERE process.tenant_id=$1 AND process.session_id=$2 AND process.run_id=$3`,
      [c.tenantId, c.sessionId, next.run_id],
    )
    assert.equal(provenance.rows[0].start_sources, 1)
    assert.equal(provenance.rows[0].start_frames, 1)
    const activityProvenance = await c.pool.query(
      `SELECT count(*)::int AS count FROM bff_agui_run_activity AS activity
        JOIN bff_agui_source_event AS source ON source.tenant_id=activity.tenant_id AND source.session_id=activity.session_id
          AND source.source_event_id=activity.latest_source_event_id AND source.source_digest=activity.latest_source_digest
        JOIN bff_agui_event AS event ON event.tenant_id=activity.tenant_id AND event.session_id=activity.session_id
          AND event.cursor=activity.latest_public_cursor AND event.source_event_id=activity.latest_source_event_id
       WHERE activity.tenant_id=$1 AND activity.session_id=$2 AND activity.run_id=$3`,
      [c.tenantId, c.sessionId, next.run_id],
    )
    assert.equal(activityProvenance.rows[0].count, 1)
    const after = await c.snapshot()
    assert.equal(after.execution_process.run_id, next.run_id)
    assert.deepEqual(after.execution_process.todos, [{ content: "live", status: "in_progress" }])
    assert.deepEqual(after.execution_process.activities, [liveActivity])
  } finally {
    releaseRequery()
    if (pending !== null) await pending.catch(() => undefined)
    assert.equal(returned, true)
  }
})

integrationTest("R124 corrupt or missing process provenance is unavailable instead of null or empty", { timeout: 30_000 }, async (context) => {
  const c = await r57ProjectionContext(context)
  await c.ingest([c.source(2, { todos: [] }, "todo.updated")])
  const good = await c.snapshot()
  assert.equal(Object.hasOwn(good, "execution_process"), true)
  assert.notEqual(good.execution_process, null)
  assert.equal(good.execution_process.run_id, c.runId)
  const original = (
    await c.pool.query("SELECT start_source_digest FROM bff_agui_run_process WHERE tenant_id=$1 AND session_id=$2 AND run_id=$3", [
      c.tenantId,
      c.sessionId,
      c.runId,
    ])
  ).rows[0].start_source_digest
  await c.pool.query("UPDATE bff_agui_run_process SET start_source_digest=$1 WHERE tenant_id=$2 AND session_id=$3 AND run_id=$4", [
    "f".repeat(64),
    c.tenantId,
    c.sessionId,
    c.runId,
  ])
  await assert.rejects(c.snapshot(), /PROCESS_PROJECTION_UNAVAILABLE|process projection unavailable/iu)
  await c.pool.query("UPDATE bff_agui_run_process SET start_source_digest=$1 WHERE tenant_id=$2 AND session_id=$3 AND run_id=$4", [
    original,
    c.tenantId,
    c.sessionId,
    c.runId,
  ])
  assert.deepEqual(await c.snapshot(), good)
})
