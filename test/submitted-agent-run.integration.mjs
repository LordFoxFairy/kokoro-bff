import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import test from "node:test"
import { createServer } from "node:http"
import { mkdtemp, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { agentModelAdmissionRoute } from "../dist/http/routes/model-admission.js"
import { Pool } from "pg"
import { PostgresAgentDispatchOutboxRepository } from "../dist/infrastructure/postgres/agent-dispatch-outbox-repository.js"
import { buildAgentDispatchPayload } from "../dist/domain/chat/agent-dispatch.js"

// Real BFF repository + HTTP route; the named Billing peer is a wire fixture, not a money/model execution claim.
async function recoverAndSettleRetiredSubmission(repository, tenant, runId, user) {
  const dir = await mkdtemp(join(tmpdir(), "kokoro-retired-settlement-")),
    file = join(dir, "credential.json"),
    secret = "agent-only-" + "a".repeat(40),
    servers = [],
    calls = []
  const listen = async (server) => {
    servers.push(server)
    await new Promise((resolve, reject) => {
      server.once("error", reject)
      server.listen(0, "127.0.0.1", resolve)
    })
    return `http://127.0.0.1:${server.address().port}`
  }
  try {
    await writeFile(
      file,
      JSON.stringify({ version: 1, entries: [{ credential_id: "settlement", caller: "kokoro-agent", surface: "model_admission", tenant_id: tenant, secret }] }),
      { mode: 0o600 },
    )
    const admissionId = "33333333-3333-4333-8333-333333333333",
      wire = { run_id: runId, evidence_event_id: "66666666-6666-4666-8666-666666666666", evidence_revision: "1", evidence_digest: "a".repeat(64) }
    const ack = {
      ...wire,
      admission_id: admissionId,
      attempt_id: "22222222-2222-4222-8222-222222222222",
      status: "pending_reconciliation",
      reason: "unknown_usage_or_outcome",
      captured_credits: "0",
      released_credits: "0",
      usage_event_id: null,
      settlement_id: null,
      updated_at: "2026-10-22T00:00:00.000Z",
    }
    const recoveryWire = {
      run_id: runId,
      attempt_id: ack.attempt_id,
      request_ref: "original-attempt-request",
      attempt_binding_digest: "b".repeat(64),
      planned_digest: "c".repeat(64),
      final_request_digest: "d".repeat(64),
    }
    const recoveryAck = {
      ...recoveryWire,
      admission_id: admissionId,
      hold_id: "44444444-4444-4444-8444-444444444444",
      budget_credits: "10",
      pricing_snapshot_digest: "e".repeat(64),
      status: "held",
      created_at: "2026-10-22T00:00:00.000Z",
      updated_at: "2026-10-22T00:00:00.000Z",
    }
    const billing = await listen(
      createServer(async (req, res) => {
        const chunks = []
        for await (const c of req) chunks.push(c)
        calls.push({ headers: req.headers, url: req.url, body: JSON.parse(Buffer.concat(chunks).toString()) })
        res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store", "x-request-id": req.headers["x-request-id"] })
        res.end(JSON.stringify({ data: req.url === "/v1/internal/billing/admissions/recover" ? recoveryAck : ack }))
      }),
    )
    const config = {
      agentModelAdmissionCredentialFile: file,
      upstreamTimeoutMs: 1000,
      upstreamMaxResponseBytes: 32768,
      billingServiceToken: "billing-service-fixture",
      upstreamSecret: "billing-internal-fixture",
      upstreams: { billing },
    }
    const base = await listen(createServer((req, res) => void agentModelAdmissionRoute(req, res, config, repository)))
    const response = await fetch(`${base}/internal/v1/model-admissions/${admissionId}/settle`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/json",
        "idempotency-key": "retired-original-command",
        "x-request-id": "retired-settlement",
      },
      body: JSON.stringify(wire),
    })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { data: ack })
    assert.equal(calls.length, 1)
    assert.deepEqual(calls[0].body, wire)
    assert.equal(calls[0].headers["x-kokoro-tenant-id"], "u1." + Buffer.from(tenant).toString("base64url"))
    assert.equal(calls[0].headers["x-kokoro-subject"], "u1." + Buffer.from(user).toString("base64url"))
    assert.equal(calls[0].headers["x-billing-execution-proof"], undefined)
    const recovered = await fetch(`${base}/internal/v1/model-admissions/recover`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/json",
        "idempotency-key": "original-admission-command",
        "x-request-id": "retired-recovery",
      },
      body: JSON.stringify(recoveryWire),
    })
    assert.equal(recovered.status, 200)
    assert.deepEqual(await recovered.json(), { data: recoveryAck })
    assert.equal(calls.length, 2)
    assert.equal(calls[1].url, "/v1/internal/billing/admissions/recover")
    assert.deepEqual(calls[1].body, recoveryWire)
    assert.equal(calls[1].headers["x-kokoro-tenant-id"], calls[0].headers["x-kokoro-tenant-id"])
    assert.equal(calls[1].headers["x-kokoro-subject"], calls[0].headers["x-kokoro-subject"])
    assert.equal(calls[1].headers["idempotency-key"], "original-admission-command")
    assert.equal(calls[1].headers["x-billing-execution-proof"], undefined)
    assert.equal(calls[1].headers["x-billing-consumption-token"], undefined)
  } finally {
    for (const server of servers.reverse())
      await new Promise((resolve) => {
        server.closeAllConnections()
        server.close(resolve)
      })
    await rm(dir, { recursive: true, force: true })
  }
}

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
    await recoverAndSettleRetiredSubmission(repository, tenant, ids.run, user)
    assert.deepEqual(await facts(), retired)
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
