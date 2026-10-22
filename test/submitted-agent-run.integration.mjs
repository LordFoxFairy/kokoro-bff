import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import test from "node:test"
import { Pool } from "pg"
import { PostgresAgentDispatchOutboxRepository } from "../dist/infrastructure/postgres/agent-dispatch-outbox-repository.js"
import { buildAgentDispatchPayload } from "../dist/domain/chat/agent-dispatch.js"

const url = process.env.KOKORO_TEST_POSTGRES_URL
const integration = url ? test : test.skip

integration("submitted Run source survives retirement, but rejects foreign and inconsistent original facts without writes", async () => {
  const pool = new Pool({ connectionString: url, options: "-c search_path=kokoro_bff -c timezone=UTC" })
  const tenant = `qa-budget-source-${randomUUID()}`
  const ids = { conversation: randomUUID(), run: randomUUID(), userMessage: randomUUID(), assistantMessage: randomUUID(), outbox: randomUUID() }
  const user = "original-submitter",
    project = "original-project",
    request = "original-submit-request",
    assertion = "original-assertion"
  const payload = buildAgentDispatchPayload(
    {
      tenantId: tenant,
      conversationId: ids.conversation,
      subjectId: user,
      actorId: user,
      requestId: request,
      idempotencyKey: "source-command",
      content: "submitted content",
      projectRef: project,
      selectedSkillSourceRefs: ["skill:original"],
    },
    { runId: ids.run, userMessageId: ids.userMessage },
  )
  const repository = new PostgresAgentDispatchOutboxRepository({ pool })
  const input = { tenantId: tenant, runId: ids.run }
  try {
    await pool.query("INSERT INTO bff_conversation(conversation_id,tenant_id,owner_id,project_ref,title) VALUES($1,$2,$3,$4,'budget source')", [
      ids.conversation,
      tenant,
      user,
      project,
    ])
    await pool.query(
      "INSERT INTO bff_message(message_id,tenant_id,conversation_id,run_id,role,content,status,message_seq,selected_skill_source_refs) VALUES($1,$2,$3,$4,'user',$5,'completed',1,$6)",
      [ids.userMessage, tenant, ids.conversation, ids.run, "submitted content", JSON.stringify(["skill:original"])],
    )
    await pool.query(
      `INSERT INTO bff_agent_dispatch_outbox(outbox_id,tenant_id,conversation_id,conversation_dispatch_seq,subject_id,actor_id,request_id,idempotency_key,request_digest,run_id,user_message_id,assistant_message_id,identity_assertion_ref,execution_project_ref,payload) VALUES($1,$2,$3,1,$4,$4,$5,'source-command',$6,$7,$8,$9,$10,$11,$12)`,
      [
        ids.outbox,
        tenant,
        ids.conversation,
        user,
        request,
        "a".repeat(64),
        ids.run,
        ids.userMessage,
        ids.assistantMessage,
        assertion,
        project,
        JSON.stringify(payload),
      ],
    )
    const original = { tenantId: tenant, userId: user, runId: ids.run, conversationId: ids.conversation }
    const facts = async () =>
      (
        await pool.query(
          `SELECT (SELECT row_to_json(c)::text FROM bff_conversation c WHERE conversation_id=$1) AS conversation,(SELECT row_to_json(m)::text FROM bff_message m WHERE message_id=$2) AS message,(SELECT row_to_json(d)::text FROM bff_agent_dispatch_outbox d WHERE outbox_id=$3) AS dispatch`,
          [ids.conversation, ids.userMessage, ids.outbox],
        )
      ).rows
    const before = await facts()
    assert.deepEqual(await repository.readSubmittedAgentRun(input), original)
    assert.equal(await repository.readSubmittedAgentRun({ ...input, tenantId: "foreign" }), null)
    assert.equal(await repository.readSubmittedAgentRun({ ...input, runId: "missing" }), null)
    assert.deepEqual(await facts(), before)
    await pool.query("UPDATE bff_conversation SET project_ref='moved-project',status='deleted',deleted_at=CURRENT_TIMESTAMP WHERE conversation_id=$1", [
      ids.conversation,
    ])
    await pool.query(
      "UPDATE bff_agent_dispatch_outbox SET execution_context_retired_at=CURRENT_TIMESTAMP,status='terminal',admitted_at=CURRENT_TIMESTAMP,completed_at=CURRENT_TIMESTAMP WHERE outbox_id=$1",
      [ids.outbox],
    )
    assert.deepEqual(await repository.readSubmittedAgentRun(input), original)
    const retired = await facts()
    await repository.readSubmittedAgentRun(input)
    assert.deepEqual(await facts(), retired)
    for (const mutate of [
      { table: "bff_agent_dispatch_outbox", column: "actor_id", value: "another-actor", restore: user, id: "outbox_id", ref: ids.outbox },
      { table: "bff_agent_dispatch_outbox", column: "request_id", value: "changed-request", restore: request, id: "outbox_id", ref: ids.outbox },
      { table: "bff_agent_dispatch_outbox", column: "execution_project_ref", value: "changed-project", restore: project, id: "outbox_id", ref: ids.outbox },
      { table: "bff_message", column: "content", value: "changed-content", restore: "submitted content", id: "message_id", ref: ids.userMessage },
      { table: "bff_conversation", column: "owner_id", value: "changed-owner", restore: user, id: "conversation_id", ref: ids.conversation },
    ]) {
      await pool.query(`UPDATE ${mutate.table} SET ${mutate.column}=$1 WHERE ${mutate.id}=$2`, [mutate.value, mutate.ref])
      try {
        assert.equal(await repository.readSubmittedAgentRun(input), null, mutate.column)
      } finally {
        await pool.query(`UPDATE ${mutate.table} SET ${mutate.column}=$1 WHERE ${mutate.id}=$2`, [mutate.restore, mutate.ref])
      }
    }
    await pool.query("UPDATE bff_message SET selected_skill_source_refs='[]'::jsonb WHERE message_id=$1", [ids.userMessage])
    assert.equal(await repository.readSubmittedAgentRun(input), null)
    await pool.query("UPDATE bff_message SET selected_skill_source_refs=$1 WHERE message_id=$2", [JSON.stringify(["skill:original"]), ids.userMessage])
    assert.deepEqual(await repository.readSubmittedAgentRun(input), original)
    const abort = new AbortController()
    abort.abort()
    await assert.rejects(repository.readSubmittedAgentRun({ ...input, signal: abort.signal }))
    assert.deepEqual(await facts(), retired)
  } finally {
    await pool.query("DELETE FROM bff_agent_dispatch_outbox WHERE tenant_id=$1", [tenant])
    await pool.query("DELETE FROM bff_message WHERE tenant_id=$1", [tenant])
    await pool.query("DELETE FROM bff_conversation WHERE tenant_id=$1", [tenant])
    await pool.end()
  }
})
