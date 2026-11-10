import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { test } from "node:test"
import { Pool } from "pg"
import { applyCanonicalSchema, loadCanonicalSchema } from "../scripts/apply-schema.mjs"
import { selectedFinalAnswerInTransaction } from "../src/infrastructure/postgres/run-final-answer-read.ts"

const url = process.env.KOKORO_TEST_POSTGRES_URL
const integration = url ? test : test.skip
const tenantId = "final-source-tenant"
const subjectId = "final-source-owner"
const projectId = "project-same"
const projectSlug = "same-slug"
const segment = "msg_" + "f".repeat(32)
const text = "  Exact e\u0301 🧪\nend\n"
const slot = (segmentId, value, firstSequence = "4", completed = true) => ({
  kind: "text",
  part_id: `text:${segmentId}`,
  segment_id: segmentId,
  text: value,
  completed,
  first_sequence: firstSequence,
  latest_sequence: firstSequence,
})
const finalPart = (value, completed = true) => slot(segment, value, "8", completed)

integration("selected final answer reads one exact durable slot in the caller's isolated PostgreSQL transaction", { timeout: 30000 }, async (suite) => {
  assert.match(new URL(url).pathname, /^\/kokoro_bff_selected_final_[0-9a-f]{32}$/u)
  await applyCanonicalSchema(url, await loadCanonicalSchema())
  const pool = new Pool({ connectionString: url, options: "-c search_path=kokoro_bff -c timezone=UTC", max: 2, statement_timeout: 3000 })
  const withTransaction = async (callback) => {
    const client = await pool.connect()
    try {
      await client.query("BEGIN")
      return await callback(client)
    } finally {
      try {
        await client.query("ROLLBACK")
      } finally {
        client.release()
      }
    }
  }
  const read = (messageId, scope = null, identity = {}) =>
    withTransaction((client) => selectedFinalAnswerInTransaction(client, { tenantId, subjectId, messageId, projectId: scope, ...identity }))
  async function seed(client, id, { projectRef = null, executionProjectRef = null, content = text, finalSegmentId = segment } = {}) {
    const conversationId = `session-${id}`,
      runId = `run-${id}`,
      messageId = `assistant-${id}`
    await client.query("INSERT INTO bff_conversation (conversation_id,tenant_id,owner_id,project_ref,title) VALUES ($1,$2,$3,$4,'Source')", [
      conversationId,
      tenantId,
      subjectId,
      projectRef,
    ])
    await client.query(
      `INSERT INTO bff_message (message_id,tenant_id,conversation_id,run_id,role,content,ordered_parts,parts_format_version,parts_public_sequence,final_segment_id,status,message_seq)
       VALUES ($1,$2,$3,$4,'assistant','Not the authoritative final segment',$5::jsonb,1,12,$6,'completed',1)`,
      [messageId, tenantId, conversationId, runId, JSON.stringify([slot("prefinal", "not the final"), finalPart(content)]), finalSegmentId],
    )
    await client.query(
      `INSERT INTO bff_agent_dispatch_outbox (outbox_id,tenant_id,conversation_id,conversation_dispatch_seq,subject_id,actor_id,request_id,idempotency_key,
         request_digest,run_id,user_message_id,assistant_message_id,identity_assertion_ref,execution_project_ref,payload,status,admitted_at)
       VALUES ($1,$2,$3,1,$4,$4,$1,$1,repeat('a',64),$5,$6,$7,$1,$8,'{}'::jsonb,'admitted',CURRENT_TIMESTAMP)`,
      [`outbox-${id}`, tenantId, conversationId, subjectId, runId, `user-${id}`, messageId, executionProjectRef],
    )
    return { conversationId, messageId, runId }
  }
  try {
    await pool.query(
      "INSERT INTO bff_project (project_id,tenant_id,owner_id,name,slug) VALUES ($1,$3,$4,'Same',$2),('other-project',$3,$4,'Other','other-slug')",
      [projectId, projectSlug, tenantId, subjectId],
    )
    const direct = await seed(pool, "direct")
    const project = await seed(pool, "project", { projectRef: projectSlug, executionProjectRef: projectId })
    const legacy = await seed(pool, "legacy", { finalSegmentId: null })
    await suite.test("returns original UTF-8 from exact assistant, independent of aggregate text, artifacts, and terminal outbox status", async () => {
      assert.deepEqual(await read(direct.messageId), {
        ...direct,
        finalSegmentId: segment,
        revision: "12",
        content: text,
        sizeBytes: String(Buffer.byteLength(text)),
        contentSha256: createHash("sha256").update(text).digest("hex"),
      })
      assert.equal((await read(project.messageId, projectId)).content, text)
      assert.equal((await pool.query("SELECT count(*)::int AS total FROM bff_conversation_artifact")).rows[0].total, 0)
    })
    await suite.test("exact direct or canonical project, trusted subject and tenant, active source, and non-retired exact dispatch", async () => {
      assert.equal(await read("missing"), null)
      assert.equal(await read(direct.messageId, null, { subjectId: "another" }), null)
      assert.equal(await read(direct.messageId, null, { tenantId: "another" }), null)
      assert.equal(await read(project.messageId), null)
      assert.equal(await read(project.messageId, "other-project"), null)
      assert.equal(await read(project.messageId, projectSlug), null)
      assert.equal(await read(direct.messageId, projectId), null)
      await pool.query("INSERT INTO bff_project (project_id,tenant_id,owner_id,name,slug) VALUES ($1,$2,$3,'Shadow','shadow-slug')", [
        projectSlug,
        tenantId,
        subjectId,
      ])
      assert.equal(await read(project.messageId, projectId), null)
      await pool.query("DELETE FROM bff_project WHERE project_id=$1", [projectSlug])
      const retired = await seed(pool, "retired")
      await pool.query("UPDATE bff_agent_dispatch_outbox SET execution_context_retired_at=CURRENT_TIMESTAMP WHERE run_id=$1", [retired.runId])
      assert.equal(await read(retired.messageId), null)
      const deleted = await seed(pool, "deleted")
      await pool.query("UPDATE bff_conversation SET status='deleted',deleted_at=CURRENT_TIMESTAMP WHERE conversation_id=$1", [deleted.conversationId])
      assert.equal(await read(deleted.messageId), null)
      const wrongRun = await seed(pool, "wrong-run")
      await pool.query("UPDATE bff_agent_dispatch_outbox SET run_id='not-the-source-run' WHERE run_id=$1", [wrongRun.runId])
      assert.equal(await read(wrongRun.messageId), null)
    })
    await suite.test("rejects absent durable markers, incomplete or duplicate slots, and over-budget Unicode without truncation", async () => {
      assert.equal(await read(legacy.messageId), null)
      const malformed = await seed(pool, "malformed")
      for (const parts of [[finalPart(text, false)], [finalPart(text), finalPart("duplicate")], [slot("another", text)]]) {
        await pool.query("UPDATE bff_message SET ordered_parts=$2::jsonb WHERE message_id=$1", [malformed.messageId, JSON.stringify(parts)])
        assert.equal(await read(malformed.messageId), null)
      }
      const budget = await seed(pool, "budget", { content: "🧪".repeat(6144) })
      assert.equal((await read(budget.messageId)).sizeBytes, "24576")
      await pool.query("UPDATE bff_message SET ordered_parts=$2::jsonb WHERE message_id=$1", [
        budget.messageId,
        JSON.stringify([finalPart("🧪".repeat(6144) + "x")]),
      ])
      assert.equal(await read(budget.messageId), null)
    })
    await suite.test("holds all three source rows through the owner transaction and uses NOWAIT against all three conflicting writers", async () => {
      const lockable = [
        ["SELECT 1 FROM bff_conversation WHERE conversation_id=$1 FOR NO KEY UPDATE", direct.conversationId],
        ["SELECT 1 FROM bff_message WHERE message_id=$1 FOR NO KEY UPDATE", direct.messageId],
        ["SELECT 1 FROM bff_agent_dispatch_outbox WHERE run_id=$1 FOR NO KEY UPDATE", direct.runId],
      ]
      const lockConflict = { code: "55P03" }
      await withTransaction(async (reader) => {
        assert.ok(await selectedFinalAnswerInTransaction(reader, { tenantId, subjectId, messageId: direct.messageId, projectId: null }))
        for (const [sql, id] of lockable) {
          await withTransaction((writer) => assert.rejects(writer.query(sql + " NOWAIT", [id]), lockConflict))
        }
      })
      for (const [sql, id] of lockable) {
        await withTransaction(async (writer) => {
          await writer.query(sql, [id])
          await assert.rejects(read(direct.messageId), lockConflict)
        })
      }
      assert.ok(await read(direct.messageId))
    })
  } finally {
    await pool.end()
  }
})
