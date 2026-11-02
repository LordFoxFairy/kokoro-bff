import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { test } from "node:test"
import pg from "pg"
import { applyCanonicalSchema, loadCanonicalSchema } from "../scripts/apply-schema.mjs"
import { evolveMessageFeedbackSchema as evolve } from "../scripts/evolve-message-feedback-schema.mjs"
import { PostgresChatRepository } from "../src/infrastructure/postgres/chat-repository.ts"
const databaseUrl = process.env.KOKORO_TEST_POSTGRES_URL
const integration = databaseUrl ? test : test.skip
integration("real PG feedback fresh/evolution, exact owner noops, abort and parent deletion preserve Messages", { timeout: 30000 }, async (t) => {
  assert.match(new URL(databaseUrl).pathname, /^\/kokoro_bff_feedback_[0-9a-f]{32}$/u, "fresh owned feedback database only")
  const pool = new pg.Pool({ connectionString: databaseUrl, options: "-c search_path=kokoro_bff -c timezone=UTC", max: 6 })
  try {
    assert.equal((await pool.query("SELECT to_regclass('kokoro_bff.bff_message') AS relation")).rows[0].relation, null, "empty owned database required")
    await applyCanonicalSchema(databaseUrl, await loadCanonicalSchema())
    const repository = new PostgresChatRepository({ pool }),
      tenantId = "feedback_" + randomUUID(),
      subjectId = "owner",
      conversationId = "session_" + randomUUID(),
      messageId = "assistant_" + randomUUID(),
      userId = "user_" + randomUUID()
    await pool.query("INSERT INTO bff_conversation(conversation_id,tenant_id,owner_id,title) VALUES($1,$2,$3,'Feedback QA')", [
      conversationId,
      tenantId,
      subjectId,
    ])
    await pool.query(
      "INSERT INTO bff_message(message_id,tenant_id,conversation_id,role,content,status,message_seq) VALUES($1,$2,$3,'user','question','completed',1),($4,$2,$3,'assistant','answer','completed',2)",
      [userId, tenantId, conversationId, messageId],
    )
    const originals = async () =>
      (await pool.query("SELECT to_jsonb(m) AS row,xmin::text AS xmin FROM bff_message m WHERE tenant_id=$1 ORDER BY message_seq", [tenantId])).rows
    const before = await originals()
    const q = (extra = {}) => ({
      tenantId,
      subjectId,
      conversationId,
      messageId,
      signal: new AbortController().signal,
      deadlineAt: performance.now() + 5000,
      ...extra,
    })
    const read = (extra) => repository.readMessageFeedback(q(extra)),
      put = (feedback, extra) => repository.setMessageFeedback({ ...q(extra), feedback })
    const preference = async () =>
      (await pool.query("SELECT to_jsonb(f) AS row,xmin::text AS xmin FROM bff_message_feedback f WHERE tenant_id=$1 AND message_id=$2", [tenantId, messageId]))
        .rows
    await t.test("additive install is repeatable, exact, and old rows survive", async () => {
      await pool.query("DROP TABLE bff_message_feedback")
      assert.equal((await evolve({ mode: "check", databaseUrl })).state, "update_required")
      assert.equal((await evolve({ mode: "apply", databaseUrl })).state, "updated")
      assert.equal((await evolve({ mode: "apply", databaseUrl })).state, "current")
      assert.deepEqual(await originals(), before)
      await pool.query("ALTER TABLE bff_message_feedback ADD COLUMN unwanted TEXT")
      assert.equal((await evolve({ mode: "check", databaseUrl })).state, "invalid_schema")
      await pool.query("ALTER TABLE bff_message_feedback DROP COLUMN unwanted")
      assert.equal((await evolve({ mode: "check", databaseUrl })).state, "current")
    })
    await t.test("up/down/clear and concurrent equal values keep timestamp and xmin on noop", async () => {
      assert.equal((await read()).feedback, null)
      await Promise.all([put("up"), put("up")])
      const up = await preference()
      await put("up")
      assert.deepEqual(await preference(), up)
      assert.equal((await put("down")).feedback, "down")
      assert.equal((await read()).feedback, "down")
      await put(null)
      await put(null)
      assert.deepEqual(await preference(), [])
      assert.deepEqual(await originals(), before)
    })
    await t.test("foreign tenant/actor/session/message/user role never obtains or mutates preference", async () => {
      await put("up")
      const snapshot = await preference()
      for (const extra of [{ tenantId: "foreign" }, { subjectId: "foreign" }, { conversationId: "foreign" }, { messageId: "foreign" }, { messageId: userId }]) {
        assert.equal(await read(extra), null)
        assert.equal(await put("down", extra), null)
      }
      assert.deepEqual(await preference(), snapshot)
    })
    await t.test("aborted waiting write releases its own client and never commits a late value", async () => {
      const blocker = await pool.connect()
      await blocker.query("BEGIN")
      await blocker.query("SELECT 1 FROM bff_conversation WHERE conversation_id=$1 FOR UPDATE", [conversationId])
      const controller = new AbortController()
      const write = put("down", { signal: controller.signal })
      controller.abort()
      await assert.rejects(write)
      await blocker.query("ROLLBACK")
      blocker.release()
      assert.equal((await read()).feedback, "up")
    })
    await t.test("parent deletion shares the lock and cleans preference without rewriting old Messages", async () => {
      await Promise.all([put("down"), repository.deleteConversation(tenantId, subjectId, conversationId, "qa-delete")])
      assert.equal(await read(), null)
      assert.equal(await put("up"), null)
      assert.deepEqual(await preference(), [])
      assert.deepEqual(await originals(), before)
    })
  } finally {
    await pool.end()
  }
})
