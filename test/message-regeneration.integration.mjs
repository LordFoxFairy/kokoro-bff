import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { test } from "node:test"
import pg from "pg"
import { applyCanonicalSchema, loadCanonicalSchema } from "../scripts/apply-schema.mjs"
import { ChatTurnApplicationService } from "../src/application/chat-turn-service.ts"
import { PostgresAgentDispatchOutboxRepository } from "../src/infrastructure/postgres/agent-dispatch-outbox-repository.ts"
import { PostgresChatRepository } from "../src/infrastructure/postgres/chat-repository.ts"
import { PostgresPublicShareRepository } from "../src/infrastructure/postgres/public-share-repository.ts"
const url = process.env.KOKORO_TEST_POSTGRES_URL
const integration = url ? test : test.skip
integration(
  "real PG regeneration preserves original facts and hides only the internal input before private/public/share pagination",
  { timeout: 30000 },
  async (t) => {
    assert.match(new URL(url).pathname, /^\/kokoro_bff_regeneration_[0-9a-f]{32}$/u)
    const pool = new pg.Pool({ connectionString: url, options: "-c search_path=kokoro_bff -c timezone=UTC", max: 6 })
    try {
      assert.equal((await pool.query("SELECT to_regclass('kokoro_bff.bff_message') AS relation")).rows[0].relation, null)
      await applyCanonicalSchema(url, await loadCanonicalSchema())
      const db = { pool, notifyAgUiProjection: async () => undefined },
        repo = new PostgresAgentDispatchOutboxRepository(db),
        chat = new PostgresChatRepository(db),
        shares = new PostgresPublicShareRepository(db)
      const service = new ChatTurnApplicationService(repo, { generate: (material) => createHash("sha256").update(material).digest("hex") })
      const tenantId = "regen_" + randomUUID(),
        subjectId = "owner",
        conversationId = "session_" + randomUUID()
      await pool.query("INSERT INTO bff_conversation(conversation_id,tenant_id,owner_id,title) VALUES($1,$2,$3,'regeneration fixture')", [
        conversationId,
        tenantId,
        subjectId,
      ])
      const first = await service.submit({
        tenantId,
        subjectId,
        actorId: subjectId,
        conversationId,
        requestId: "first-request",
        idempotencyKey: "first-input",
        content: "trusted original question",
        model: "qa-model",
        agent: "deep",
        thinking: true,
        selectedSkillSourceRefs: [],
        selectedMcpConnectionIds: [],
      })
      assert.ok(first)
      await pool.query(
        "UPDATE bff_agent_dispatch_outbox SET status='terminal',admitted_at=CURRENT_TIMESTAMP(3),completed_at=CURRENT_TIMESTAMP(3) WHERE tenant_id=$1 AND run_id=$2",
        [tenantId, first.run_id],
      )
      await pool.query(
        "UPDATE bff_message SET status='completed',content='original answer',ordered_parts=NULL,parts_format_version=NULL,parts_public_sequence=NULL WHERE tenant_id=$1 AND message_id=$2",
        [tenantId, first.assistant_message_id],
      )
      const old = async () =>
        (
          await pool.query(
            "SELECT to_jsonb(message) AS row,xmin::text AS xmin FROM bff_message message WHERE tenant_id=$1 AND message_id=ANY($2::text[]) ORDER BY message_seq",
            [tenantId, [first.user_message_id, first.assistant_message_id]],
          )
        ).rows
      const before = await old()
      const input = (extra = {}) => ({
        tenantId,
        subjectId,
        actorId: subjectId,
        conversationId,
        sourceMessageId: first.assistant_message_id,
        requestId: "new-current-request",
        idempotencyKey: "explicit-regeneration",
        signal: new AbortController().signal,
        deadlineAt: performance.now() + 5000,
        ...extra,
      })
      let receipt
      await t.test("same-key races create one new native input/assistant pair and replay while its new head is active", async () => {
        const results = await Promise.all([service.regenerate(input()), service.regenerate(input())])
        assert.deepEqual(results[0], results[1])
        receipt = results[0]
        assert.ok(receipt)
        assert.equal(receipt.user_message_id, first.user_message_id)
        assert.equal(receipt.regenerated_from_message_id, first.assistant_message_id)
        const mirrored = (
          await pool.query(
            "SELECT message_id,role,origin,run_id,regenerated_from_message_id,regeneration_user_message_id,content FROM bff_message WHERE tenant_id=$1 AND run_id=$2 ORDER BY message_seq",
            [tenantId, receipt.run_id],
          )
        ).rows
        assert.equal(mirrored.length, 2)
        assert.notEqual(mirrored[0].message_id, first.user_message_id)
        assert.equal(mirrored[0].origin, "regeneration_input")
        assert.equal(mirrored[0].content, "trusted original question")
        assert.equal(mirrored[1].origin, "regeneration_answer")
        assert.ok(
          mirrored.every((row) => row.regeneration_user_message_id === first.user_message_id && row.regenerated_from_message_id === first.assistant_message_id),
        )
        assert.deepEqual(await service.regenerate(input({ requestId: "lost-ack-readback" })), receipt)
        assert.deepEqual(await old(), before)
        await assert.rejects(service.regenerate(input({ idempotencyKey: "another-attempt" })), /NOT_READY/)
        assert.equal(Number((await pool.query("SELECT count(*) AS n FROM bff_agent_dispatch_outbox WHERE tenant_id=$1", [tenantId])).rows[0].n), 2)
      })
      await t.test("fresh execution binding uses the actual mirror, no stale assertion or prior native Message identity", async () => {
        const row = (
          await pool.query("SELECT payload,user_message_id,request_id,identity_assertion_ref FROM bff_agent_dispatch_outbox WHERE tenant_id=$1 AND run_id=$2", [
            tenantId,
            receipt.run_id,
          ])
        ).rows[0]
        assert.notEqual(row.user_message_id, first.user_message_id)
        assert.equal(row.payload.launch.message_id, row.user_message_id)
        assert.equal(row.payload.launch.request_id, "new-current-request")
        assert.equal(row.payload.launch.requested_model_label, "qa-model")
        assert.equal(row.payload.launch.trace.agent, "deep")
        assert.notEqual(
          row.identity_assertion_ref,
          (await pool.query("SELECT identity_assertion_ref FROM bff_agent_dispatch_outbox WHERE tenant_id=$1 AND run_id=$2", [tenantId, first.run_id])).rows[0]
            .identity_assertion_ref,
        )
        const publicFrames = (
          await pool.query("SELECT event_type,event_payload FROM bff_agui_event WHERE tenant_id=$1 AND session_id=$2", [tenantId, conversationId])
        ).rows
        assert.equal(
          publicFrames.some((frame) => frame.event_payload.name === "kokoro.message.user"),
          false,
        )
      })
      await t.test("private snapshot/pages and public Share filter mirror before LIMIT/cursor without filtering the new answer", async () => {
        const life = () => ({ signal: new AbortController().signal, deadlineAt: performance.now() + 5000 })
        const snapshot = await chat.readSnapshot(tenantId, subjectId, conversationId, undefined, life())
        assert.ok(snapshot)
        assert.equal(snapshot.messages.filter((message) => message.role === "user").length, 1)
        assert.equal(
          snapshot.messages.find((message) => message.messageId === receipt.assistant_message_id).regeneratedFromMessageId,
          first.assistant_message_id,
        )
        const page1 = await chat.listMessages(tenantId, subjectId, conversationId, 2, null, undefined, life())
        assert.ok(page1.next_cursor)
        const page2 = await chat.listMessages(tenantId, subjectId, conversationId, 2, page1.next_cursor, undefined, life())
        assert.equal(page2.messages.length, 1)
        assert.equal(page2.messages[0].messageId, receipt.assistant_message_id)
        assert.equal(page2.next_cursor, null)
        const share = await chat.createShare(tenantId, subjectId, conversationId)
        assert.ok(share)
        const visible = await shares.listSharedMessages(share.shareId, tenantId, conversationId, 3)
        assert.equal(visible.messages.length, 3)
        assert.equal(visible.messages.filter((message) => message.role === "user").length, 1)
        assert.equal(visible.messages[2].messageId, receipt.assistant_message_id)
        assert.equal(visible.next_cursor, null)
      })
      await t.test("foreign and invalid source cannot recover another actor attempt or dispatch new work", async () => {
        for (const extra of [
          { tenantId: "foreign" },
          { subjectId: "foreign", actorId: "foreign" },
          { conversationId: "foreign" },
          { sourceMessageId: first.user_message_id },
        ])
          assert.equal(await service.regenerate(input(extra)), null)
        assert.equal(Number((await pool.query("SELECT count(*) AS n FROM bff_agent_dispatch_outbox WHERE tenant_id=$1", [tenantId])).rows[0].n), 2)
      })
      await t.test("regenerated answers retain the original user and choices; stale latest and unknown admission never open another attempt", async () => {
        await pool.query(
          "UPDATE bff_agent_dispatch_outbox SET status='terminal',admitted_at=CURRENT_TIMESTAMP(3),completed_at=CURRENT_TIMESTAMP(3) WHERE tenant_id=$1 AND run_id=$2",
          [tenantId, receipt.run_id],
        )
        await pool.query("UPDATE bff_message SET status='completed' WHERE tenant_id=$1 AND message_id=$2", [tenantId, receipt.assistant_message_id])
        await assert.rejects(service.regenerate(input({ idempotencyKey: "stale-source" })), /NOT_READY/)
        const next = input({ sourceMessageId: receipt.assistant_message_id, idempotencyKey: "explicit-second-regeneration" })
        const mirror = (await pool.query("SELECT user_message_id FROM bff_agent_dispatch_outbox WHERE tenant_id=$1 AND run_id=$2", [tenantId, receipt.run_id]))
          .rows[0].user_message_id
        await pool.query("UPDATE bff_message SET selected_skill_source_refs='[\"skill:wrong\"]'::jsonb WHERE tenant_id=$1 AND message_id=$2", [
          tenantId,
          mirror,
        ])
        await assert.rejects(repo.readRegenerationSource(next), /SOURCE_INVALID/)
        await pool.query("UPDATE bff_message SET selected_skill_source_refs='[]'::jsonb WHERE tenant_id=$1 AND message_id=$2", [tenantId, mirror])
        await pool.query(
          "UPDATE bff_agent_dispatch_outbox SET status='retryable',admission_unknown_seen=true,admitted_at=NULL,completed_at=NULL WHERE tenant_id=$1 AND run_id=$2",
          [tenantId, receipt.run_id],
        )
        await assert.rejects(service.regenerate(next), /NOT_READY/)
        await pool.query(
          "UPDATE bff_agent_dispatch_outbox SET status='terminal',admission_unknown_seen=false,admitted_at=CURRENT_TIMESTAMP(3),completed_at=CURRENT_TIMESTAMP(3) WHERE tenant_id=$1 AND run_id=$2",
          [tenantId, receipt.run_id],
        )
        const again = await service.regenerate(next)
        assert.equal(again.user_message_id, first.user_message_id)
        assert.equal(again.regenerated_from_message_id, receipt.assistant_message_id)
        assert.notEqual(again.run_id, receipt.run_id)
        assert.deepEqual(await old(), before)
      })
    } finally {
      await pool.end()
    }
  },
)
