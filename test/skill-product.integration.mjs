import assert from "node:assert/strict"
import test from "node:test"
import { randomUUID } from "node:crypto"
import { Pool } from "pg"
import { PostgresConversationArtifactLibrary } from "../dist/infrastructure/postgres/conversation-artifact-library.js"
import { PostgresIdempotencyRepository } from "../dist/infrastructure/postgres/idempotency-repository.js"
import { handoffSkillPackage } from "../dist/application/skill-ai-handoff.js"

// Root provisions/applies the existing canonical BFF schema. This file never installs or resets a database.
const url = process.env.KOKORO_TEST_POSTGRES_URL
const integration = url ? test : test.skip
function isolatedPool() {
  assert.equal(process.env.KOKORO_BFF_PRODUCT_TEST_ISOLATED, "1", "Root must explicitly identify this as its isolated Product fixture, never normal data")
  return new Pool({ connectionString: url, max: 3 })
}
integration("AI source selects only exact BFF artifact association with successful same-run terminal and active owned conversation", async () => {
  const pool = isolatedPool(),
    tenant = `product_${randomUUID()}`,
    subject = `subject_${randomUUID()}`,
    conversation = randomUUID(),
    run = randomUUID(),
    artifact = randomUUID()
  const repository = new PostgresConversationArtifactLibrary({ pool })
  try {
    await pool.query("INSERT INTO bff_conversation(conversation_id,tenant_id,owner_id,title) VALUES($1,$2,$3,'isolated Product AI source')", [
      conversation,
      tenant,
      subject,
    ])
    await pool.query(
      "INSERT INTO bff_conversation_artifact(tenant_id,conversation_id,artifact_id,run_id,source_owner,source_event_id,source_sequence,source_digest,source_asset_id,source_artifact_kind,source_content_sha256,source_title,source_mime,source_size_bytes,delivered_at) VALUES($1,$2,$3,$4,'kokoro-agent',$5,1,$6,$7,'archive',$8,'isolated package','application/zip',10,CURRENT_TIMESTAMP(3))",
      [tenant, conversation, artifact, run, randomUUID(), "a".repeat(64), `asset_${randomUUID()}`, "b".repeat(64)],
    )
    assert.equal(await repository.findSkillHandoff(tenant, subject, conversation, artifact), null)
    await pool.query(
      "INSERT INTO bff_skill_usage_run_terminal(tenant_id,run_id,session_id,status,source_owner,source_event_id,source_sequence,source_digest,source_occurred_at) VALUES($1,$2,$3,'failed','kokoro-agent',$4,2,$5,CURRENT_TIMESTAMP(3))",
      [tenant, run, conversation, randomUUID(), "c".repeat(64)],
    )
    assert.equal(await repository.findSkillHandoff(tenant, subject, conversation, artifact), null)
    await pool.query("UPDATE bff_skill_usage_run_terminal SET status='completed' WHERE tenant_id=$1 AND run_id=$2", [tenant, run])
    const source = await repository.findSkillHandoff(tenant, subject, conversation, artifact)
    assert.equal(source.runId, run)
    assert.equal(source.artifactId, artifact)
    assert.equal(source.sourceEventSeq, "1")
    assert.equal(source.sourceEventDigest, "a".repeat(64))
    assert.equal(source.sizeBytes, "10")
    assert.equal(await repository.findSkillHandoff("foreign", subject, conversation, artifact), null)
    assert.equal(await repository.findSkillHandoff(tenant, "foreign", conversation, artifact), null)
    await pool.query("UPDATE bff_conversation SET status='deleted',deleted_at=CURRENT_TIMESTAMP(3) WHERE tenant_id=$1 AND conversation_id=$2", [
      tenant,
      conversation,
    ])
    assert.equal(await repository.findSkillHandoff(tenant, subject, conversation, artifact), null)
  } finally {
    await pool.query("DELETE FROM bff_skill_usage_run_terminal WHERE tenant_id=$1", [tenant])
    await pool.query("DELETE FROM bff_conversation_artifact WHERE tenant_id=$1", [tenant])
    await pool.query("DELETE FROM bff_conversation WHERE tenant_id=$1", [tenant])
    await pool.end()
  }
})
integration("Durable AI import uses real JSONB exact CAS and dropped-ACK readback, then replays without PUT or Complete", async () => {
  const pool = isolatedPool(),
    scope = `product-receipt:${randomUUID()}`,
    repository = new PostgresIdempotencyRepository(pool)
  let puts = 0,
    completes = 0,
    selected = null
  const receipts = {
    getReceipt: (...args) => repository.getReceipt(...args),
    claimReceipt: (...args) => repository.claimReceipt(...args),
    compareAndSetReceipt: async (...args) => {
      const result = await repository.compareAndSetReceipt(...args)
      if (result.updated) throw Error("isolated dropped ACK after durable CAS")
      return result
    },
  }
  const steps = {
    create: async () => ({ skillId: "s", stateVersion: "1" }),
    begin: async () => ({ skillId: "s", attemptId: "a", uploadId: "u", attemptEpoch: "1", stateVersion: "2" }),
    status: async () => ({ skillId: "s", attemptId: "a", uploadId: "u", attemptEpoch: "1", sourceVersionId: completes ? "OPAQUE+/=" : null }),
    put: async () => {
      puts++
      return "OPAQUE+/="
    },
    completion: (admission, version) => ({ sourceVersionId: version, commandId: "complete", requestDigest: "a".repeat(64) }),
    complete: async (admission, selection) => {
      const actual = await repository.getReceipt(scope)
      assert.equal(actual.body.stage, "selected")
      assert.deepEqual(actual.body.selected, selection)
      selected = selection
      completes++
      return { stateVersion: "3" }
    },
    validate: async () => ({ skill_id: "s", valid: true }),
  }
  try {
    const input = { scope, fingerprint: "b".repeat(64), frozen: { artifact: { second: "two", first: "one" }, selector: "immutable" }, commandId: "handoff" }
    assert.deepEqual(await handoffSkillPackage(input, receipts, steps, AbortSignal.timeout(5000)), { skill_id: "s", valid: true })
    assert.deepEqual(await handoffSkillPackage(input, receipts, steps, AbortSignal.timeout(5000)), { skill_id: "s", valid: true })
    assert.equal(puts, 1)
    assert.equal(completes, 1)
    assert.equal(selected.sourceVersionId, "OPAQUE+/=")
    await assert.rejects(
      () => handoffSkillPackage({ ...input, fingerprint: "c".repeat(64) }, receipts, steps, AbortSignal.timeout(5000)),
      /skill_idempotency_conflict/u,
    )
  } finally {
    await pool.query("DELETE FROM bff_idempotency_receipt WHERE scope=$1", [scope])
    await pool.end()
  }
})
