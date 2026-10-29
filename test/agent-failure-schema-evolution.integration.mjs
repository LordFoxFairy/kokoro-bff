import assert from "node:assert/strict"
import { test } from "node:test"
import { Pool } from "pg"
import { loadCanonicalSchema } from "../scripts/apply-schema.mjs"
import { evolveAgentFailureSchema } from "../scripts/evolve-agent-failure-schema.mjs"

const databaseUrl = process.env.KOKORO_TEST_POSTGRES_URL
const integration = databaseUrl ? test : test.skip
integration("expands only the approved failure CHECK without rewriting retained messages and rejects drift", async () => {
  const pool = new Pool({ connectionString: databaseUrl, options: "-c search_path=kokoro_bff -c timezone=UTC" })
  const target = (await loadCanonicalSchema()).match(/CONSTRAINT ck_bff_message_agent_failure CHECK \([\s\S]*?\n  \)/u)[0]
  const old = target.replace(", 'model_settlement_pending'", "")
  const replace = (definition, suffix = "") =>
    pool.query(`ALTER TABLE kokoro_bff.bff_message DROP CONSTRAINT ck_bff_message_agent_failure; ALTER TABLE kokoro_bff.bff_message ADD ${definition}${suffix}`)
  const evolve = (mode = "apply", signal) => evolveAgentFailureSchema({ databaseUrl, mode, signal })
  const row = async () =>
    (await pool.query("SELECT to_jsonb(m) AS value, xmin::text AS version FROM kokoro_bff.bff_message m WHERE message_id='settlement_evolution' ")).rows
  try {
    await replace(old)
    await pool.query(`INSERT INTO kokoro_bff.bff_message(message_id,tenant_id,conversation_id,run_id,role,content,status,message_seq,agent_failure_code,agent_failure_retryable)
      VALUES('settlement_evolution','settlement_owner','settlement_session','settlement_run','assistant','Generated text remains intact','failed',1,'dependency_unavailable',false)`)
    const before = await row()
    assert.equal((await evolve("check")).state, "update_required")
    assert.deepEqual(await row(), before)
    assert.equal((await evolve()).state, "updated")
    assert.deepEqual(await row(), before)
    assert.equal((await evolve()).state, "current")
    assert.equal((await evolve("check")).state, "current")
    assert.deepEqual(await row(), before)
    await pool.query("UPDATE kokoro_bff.bff_message SET agent_failure_code='model_settlement_pending' WHERE message_id='settlement_evolution'")
    await assert.rejects(pool.query("UPDATE kokoro_bff.bff_message SET agent_failure_retryable=true WHERE message_id='settlement_evolution'"), {
      code: "23514",
    })
    await assert.rejects(pool.query("UPDATE kokoro_bff.bff_message SET agent_failure_code='invented_failure' WHERE message_id='settlement_evolution'"), {
      code: "23514",
    })
    for (const definition of [
      target.replace("AND role = 'assistant'", "AND role <> ''"),
      target.replace("'model_unavailable', 'dependency_unavailable'", "'model_unavailable', 'dependency_unavailable', 'model_settlement_pending'"),
    ]) {
      await replace(definition)
      const prior = (
        await pool.query(
          "SELECT pg_get_constraintdef(oid,false) AS definition FROM pg_constraint WHERE conrelid='kokoro_bff.bff_message'::regclass AND conname='ck_bff_message_agent_failure'",
        )
      ).rows
      assert.equal((await evolve()).state, "invalid_schema")
      assert.deepEqual(
        (
          await pool.query(
            "SELECT pg_get_constraintdef(oid,false) AS definition FROM pg_constraint WHERE conrelid='kokoro_bff.bff_message'::regclass AND conname='ck_bff_message_agent_failure'",
          )
        ).rows,
        prior,
      )
    }
    await replace(target, " NOT VALID")
    assert.equal((await evolve()).state, "invalid_schema")
    await replace(target)
    await pool.query("UPDATE kokoro_bff.bff_message SET agent_failure_code='dependency_unavailable' WHERE message_id='settlement_evolution'")
    await replace(old)
    const aborted = new AbortController()
    aborted.abort()
    assert.equal((await evolve("apply", aborted.signal)).state, "unavailable")
    assert.equal((await evolve("check")).state, "update_required")
    const blocker = await pool.connect()
    try {
      await blocker.query("BEGIN; LOCK TABLE kokoro_bff.bff_message IN ACCESS SHARE MODE")
      const blocked = await evolveAgentFailureSchema({ databaseUrl, mode: "apply", timeoutMs: 500 })
      assert.equal(blocked.state, "unavailable")
      assert.ok(blocked.duration_ms < 1500)
    } finally {
      try {
        await blocker.query("ROLLBACK")
      } finally {
        blocker.release()
      }
    }
    assert.equal((await evolve("check")).state, "update_required")
    await pool.query("ALTER TABLE kokoro_bff.bff_message RENAME CONSTRAINT ck_bff_message_agent_failure TO unexpected_failure_constraint")
    try {
      assert.equal((await evolve()).state, "invalid_schema")
    } finally {
      await pool.query("ALTER TABLE kokoro_bff.bff_message RENAME CONSTRAINT unexpected_failure_constraint TO ck_bff_message_agent_failure")
    }
    assert.equal((await evolve()).state, "updated")
  } finally {
    try {
      await replace(target)
    } finally {
      try {
        await pool.query("DELETE FROM kokoro_bff.bff_message WHERE message_id='settlement_evolution'")
      } finally {
        await pool.end()
      }
    }
  }
})

test("rejects invalid owner scope and modes before connecting", async () => {
  for (const request of [
    { databaseUrl: "postgres://127.0.0.1/x", mode: "apply" },
    { databaseUrl: "postgres://127.0.0.1/x?schema=kokoro_bff", mode: "reset" },
  ]) {
    assert.equal((await evolveAgentFailureSchema(request)).state, "invalid_request")
  }
})
