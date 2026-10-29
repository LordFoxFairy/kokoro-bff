import { readChatComposerSelection } from "../src/infrastructure/postgres/chat-composer-selection.ts"
import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { test } from "node:test"
import pg from "pg"
import { applyCanonicalSchema, loadCanonicalSchema } from "../scripts/apply-schema.mjs"
import { ChatTurnApplicationService } from "../src/application/chat-turn-service.ts"
import { ChatApplicationService } from "../src/application/chat-service.ts"
import { PostgresAgentDispatchOutboxRepository } from "../src/infrastructure/postgres/agent-dispatch-outbox-repository.ts"
import { PostgresChatRepository } from "../src/infrastructure/postgres/chat-repository.ts"
const url = process.env.KOKORO_TEST_POSTGRES_URL
const integration = url ? test : test.skip
integration("real PG private snapshot restores only latest ordinary accepted MCP choices without rewriting any history", { timeout: 30000 }, async (t) => {
  assert.match(new URL(url).pathname, /^\/kokoro_bff_composer_[0-9a-f]{32}$/u)
  const pool = new pg.Pool({ connectionString: url, options: "-c search_path=kokoro_bff -c timezone=UTC", max: 4 })
  try {
    assert.equal((await pool.query("SELECT to_regclass('kokoro_bff.bff_message') AS relation")).rows[0].relation, null)
    await applyCanonicalSchema(url, await loadCanonicalSchema())
    const db = { pool, notifyAgUiProjection: async () => undefined }
    const turns = new ChatTurnApplicationService(new PostgresAgentDispatchOutboxRepository(db), {
      generate: (material) => createHash("sha256").update(material).digest("hex"),
    })
    const repository = new PostgresChatRepository(db),
      chat = new ChatApplicationService(repository)
    const tenantId = "composer_" + randomUUID(),
      subjectId = "owner",
      conversationId = "session_" + randomUUID()
    await pool.query("INSERT INTO bff_conversation(conversation_id,tenant_id,owner_id,title) VALUES($1,$2,$3,'composer fixture')", [
      conversationId,
      tenantId,
      subjectId,
    ])
    const life = () => ({ signal: new AbortController().signal, deadlineAt: performance.now() + 5000, scope: "all" })
    const snapshot = () => chat.snapshot(tenantId, subjectId, conversationId, undefined, life())
    const fingerprint = async () =>
      JSON.stringify(
        (
          await pool.query(
            `
      SELECT 'message' AS kind, to_jsonb(m) AS value, xmin::text AS revision FROM bff_message m WHERE tenant_id=$1
      UNION ALL SELECT 'dispatch', to_jsonb(d), xmin::text FROM bff_agent_dispatch_outbox d WHERE tenant_id=$1
      ORDER BY kind,value`,
            [tenantId],
          )
        ).rows,
      )
    const submit = async (key, ids) => {
      const receipt = await turns.submit({
        tenantId,
        subjectId,
        actorId: subjectId,
        conversationId,
        requestId: key,
        idempotencyKey: key,
        content: "fixture " + key,
        selectedSkillSourceRefs: [],
        ...(ids === undefined ? {} : { selectedMcpConnectionIds: ids }),
      })
      assert.ok(receipt)
      await pool.query(
        "UPDATE bff_agent_dispatch_outbox SET status='terminal',admitted_at=CURRENT_TIMESTAMP(3),completed_at=CURRENT_TIMESTAMP(3) WHERE tenant_id=$1 AND run_id=$2",
        [tenantId, receipt.run_id],
      )
      await pool.query(
        "UPDATE bff_message SET status='completed',content='answer',ordered_parts=NULL,parts_format_version=NULL,parts_public_sequence=NULL WHERE tenant_id=$1 AND message_id=$2",
        [tenantId, receipt.assistant_message_id],
      )
      return receipt
    }
    await t.test("new session has no fabricated baseline", async () => assert.equal((await snapshot()).composer_selection, undefined))
    const first = await submit("first", ["connection-one"])
    await t.test("accepted selection survives independent reads and history stays byte/revision identical", async () => {
      const before = await fingerprint()
      for (let i = 0; i < 2; i++)
        assert.deepEqual((await snapshot()).composer_selection, { source_message_id: first.user_message_id, selected_mcp_connection_ids: ["connection-one"] })
      assert.equal(await fingerprint(), before)
    })
    await t.test("regeneration input does not replace the original ordinary source identity", async () => {
      const regeneration = await turns.regenerate({
        tenantId,
        subjectId,
        actorId: subjectId,
        conversationId,
        sourceMessageId: first.assistant_message_id,
        requestId: "regenerate",
        idempotencyKey: "regenerate",
        ...life(),
      })
      assert.ok(regeneration)
      assert.deepEqual((await snapshot()).composer_selection, { source_message_id: first.user_message_id, selected_mcp_connection_ids: ["connection-one"] })
      await pool.query(
        "UPDATE bff_agent_dispatch_outbox SET status='terminal',admitted_at=CURRENT_TIMESTAMP(3),completed_at=CURRENT_TIMESTAMP(3) WHERE tenant_id=$1 AND run_id=$2",
        [tenantId, regeneration.run_id],
      )
    })
    const second = await submit("second", [])
    await t.test("latest empty selection clears previous nonempty choice", async () =>
      assert.deepEqual((await snapshot()).composer_selection, { source_message_id: second.user_message_id, selected_mcp_connection_ids: [] }),
    )
    const latest = await submit("third-omitted", undefined)
    await t.test("original omission remains no MCP, not inherited selection", async () =>
      assert.deepEqual((await snapshot()).composer_selection, { source_message_id: latest.user_message_id, selected_mcp_connection_ids: [] }),
    )
    await t.test("other tenant/subject and wrong project remain unauthorized", async () => {
      assert.equal(await chat.snapshot(tenantId, "other", conversationId, undefined, life()), null)
      assert.equal(await chat.snapshot("other", subjectId, conversationId, undefined, life()), null)
      assert.equal(await chat.snapshot(tenantId, subjectId, conversationId, "another-project", life()), null)
    })
    const original = (await pool.query("SELECT payload FROM bff_agent_dispatch_outbox WHERE tenant_id=$1 AND run_id=$2", [tenantId, latest.run_id])).rows[0]
      .payload
    await t.test("bad latest payload never falls back to earlier nonempty record", async () => {
      for (const patch of [
        { ...original, schema_version: 2 },
        { ...original, schema_version: "3" },
        { ...original, launch: { ...original.launch, run_id: "wrong" } },
        { ...original, launch: { ...original.launch, session_id: "wrong" } },
        { ...original, launch: { ...original.launch, message_id: "wrong" } },
        { ...original, launch: { ...original.launch, selected_mcp_connection_ids: null } },
        { ...original, launch: { ...original.launch, selected_mcp_connection_ids: ["same", "same"] } },
        { ...original, launch: { ...original.launch, selected_mcp_connection_ids: ["x".repeat(5000)] } },
      ]) {
        await pool.query("UPDATE bff_agent_dispatch_outbox SET payload=$3::jsonb WHERE tenant_id=$1 AND run_id=$2", [
          tenantId,
          latest.run_id,
          JSON.stringify(patch),
        ])
        assert.equal((await snapshot()).composer_selection, undefined)
      }
      await pool.query("UPDATE bff_agent_dispatch_outbox SET payload=$3::jsonb WHERE tenant_id=$1 AND run_id=$2", [
        tenantId,
        latest.run_id,
        JSON.stringify(original),
      ])
    })
    await t.test("oversized corrupt version and identity fields stay in PG, not the Node projection", async () => {
      const large = "x".repeat(512 * 1024)
      const patches = [
        { ...original, schema_version: { large } },
        ...["run_id", "message_id", "session_id"].map((key) => ({ ...original, launch: { ...original.launch, [key]: large } })),
      ]
      for (const patch of patches) {
        await pool.query("UPDATE bff_agent_dispatch_outbox SET payload=$3::jsonb WHERE tenant_id=$1 AND run_id=$2", [
          tenantId,
          latest.run_id,
          JSON.stringify(patch),
        ])
        const reader = {
          query: async (...args) => {
            const result = await pool.query(...args)
            assert.ok(Buffer.byteLength(JSON.stringify(result.rows), "utf8") < 512)
            return result
          },
        }
        assert.equal(await readChatComposerSelection(reader, tenantId, subjectId, conversationId), undefined)
        assert.equal((await snapshot()).composer_selection, undefined)
      }
      await pool.query("UPDATE bff_agent_dispatch_outbox SET payload=$3::jsonb WHERE tenant_id=$1 AND run_id=$2", [
        tenantId,
        latest.run_id,
        JSON.stringify(original),
      ])
    })
    await t.test("foreign dispatch identity or deleted dispatch never reveals older selections", async () => {
      await pool.query("UPDATE bff_agent_dispatch_outbox SET subject_id='another' WHERE tenant_id=$1 AND run_id=$2", [tenantId, latest.run_id])
      assert.equal((await snapshot()).composer_selection, undefined)
      await pool.query("UPDATE bff_agent_dispatch_outbox SET subject_id=$3,actor_id='another' WHERE tenant_id=$1 AND run_id=$2", [
        tenantId,
        latest.run_id,
        subjectId,
      ])
      assert.equal((await snapshot()).composer_selection, undefined)
      await pool.query("DELETE FROM bff_agent_dispatch_outbox WHERE tenant_id=$1 AND run_id=$2", [tenantId, latest.run_id])
      assert.equal((await snapshot()).composer_selection, undefined)
    })
  } finally {
    await pool.end()
  }
})
