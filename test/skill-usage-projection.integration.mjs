import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import test from "node:test"
import { Pool } from "pg"
import { applySkillUsageFact, readSkillUsage } from "../dist/infrastructure/postgres/skill-usage-projection.js"

const url = process.env.KOKORO_TEST_POSTGRES_URL
const integration = url ? test : test.skip

integration("R353 closes ready-first, terminal-first, duplicate and conflict in one durable transaction", async () => {
  const pool = new Pool({ connectionString: url })
  const tenantId = `tenant_${randomUUID()}`
  const source = (runId, sequence, fact) => ({
    tenantId,
    sessionId: `session_${runId}`,
    sourceOwner: "kokoro-agent",
    sourceEventId: `event_${runId}_${sequence}`,
    sourceSequence: sequence,
    sourceDigest: sequence.toString(16).padStart(64, "0"),
    sourceOccurredAt: new Date(sequence * 1000).toISOString(),
    fact,
  })
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    await applySkillUsageFact(client, source("ready_first", 1, { kind: "ready", runId: "ready_first", sourceRefs: ["skill:one"] }))
    await applySkillUsageFact(client, source("ready_first", 2, { kind: "terminal", runId: "ready_first", status: "completed" }))
    await applySkillUsageFact(client, source("ready_first", 7, { kind: "ready", runId: "ready_first", sourceRefs: ["skill:one"] }))
    await applySkillUsageFact(client, source("ready_first", 8, { kind: "terminal", runId: "ready_first", status: "completed" }))
    await applySkillUsageFact(client, source("terminal_first", 3, { kind: "terminal", runId: "terminal_first", status: "completed" }))
    await applySkillUsageFact(client, source("terminal_first", 4, { kind: "ready", runId: "terminal_first", sourceRefs: ["skill:one"] }))
    await applySkillUsageFact(client, source("cancelled", 5, { kind: "ready", runId: "cancelled", sourceRefs: ["skill:one"] }))
    await applySkillUsageFact(client, source("cancelled", 6, { kind: "terminal", runId: "cancelled", status: "cancelled" }))
    await applySkillUsageFact(client, source("ready_wrong_session", 9, { kind: "ready", runId: "ready_wrong_session", sourceRefs: ["skill:one"] }))
    await assert.rejects(
      () =>
        applySkillUsageFact(client, {
          ...source("ready_wrong_session", 10, { kind: "terminal", runId: "ready_wrong_session", status: "completed" }),
          sessionId: "session_other",
        }),
      /SKILL_USAGE_TERMINAL_CONFLICT/u,
    )
    assert.equal(
      (await client.query("SELECT count(*)::int AS count FROM bff_skill_usage_run_terminal WHERE tenant_id=$1 AND run_id='ready_wrong_session'", [tenantId])).rows[0]
        .count,
      0,
    )
    assert.equal(
      (await client.query("SELECT counted_at FROM bff_skill_usage_observation WHERE tenant_id=$1 AND run_id='ready_wrong_session'", [tenantId])).rows[0]
        .counted_at,
      null,
    )
    await applySkillUsageFact(client, source("terminal_wrong_session", 11, { kind: "terminal", runId: "terminal_wrong_session", status: "completed" }))
    await assert.rejects(
      () =>
        applySkillUsageFact(client, {
          ...source("terminal_wrong_session", 12, { kind: "ready", runId: "terminal_wrong_session", sourceRefs: ["skill:one"] }),
          sessionId: "session_other",
        }),
      /SKILL_USAGE_READY_CONFLICT/u,
    )
    assert.equal(
      (await client.query("SELECT count(*)::int AS count FROM bff_skill_usage_observation WHERE tenant_id=$1 AND run_id='terminal_wrong_session'", [tenantId]))
        .rows[0].count,
      0,
    )
    await client.query("UPDATE bff_skill_usage_coverage SET status='complete',checkpoint_id='fixture',checkpoint_at=CURRENT_TIMESTAMP(3) WHERE tenant_id=$1", [
      tenantId,
    ])
    const result = await readSkillUsage(client, tenantId, ["skill:one", "skill:none"])
    assert.deepEqual(result.get("skill:one"), { status: "available", successfulRunCount: "2" })
    assert.deepEqual(result.get("skill:none"), { status: "available", successfulRunCount: "0" })
    await applySkillUsageFact(client, source("ready_first", 1, { kind: "ready", runId: "ready_first", sourceRefs: ["skill:one"] }))
    for (const changed of [
      { sourceEventId: "event_ready_first_changed" },
      { sourceSequence: 99 },
      { sourceDigest: "f".repeat(64) },
      { sourceOccurredAt: new Date(99_000).toISOString() },
    ]) {
      await assert.rejects(
        () => applySkillUsageFact(client, { ...source("ready_first", 1, { kind: "ready", runId: "ready_first", sourceRefs: ["skill:one"] }), ...changed }),
        /SKILL_USAGE_READY_CONFLICT/u,
      )
    }
    await applySkillUsageFact(client, source("ready_first", 2, { kind: "terminal", runId: "ready_first", status: "completed" }))
    for (const changed of [
      { sourceEventId: "event_ready_first_terminal_changed" },
      { sourceSequence: 98 },
      { sourceDigest: "e".repeat(64) },
      { sourceOccurredAt: new Date(98_000).toISOString() },
    ]) {
      await assert.rejects(
        () => applySkillUsageFact(client, { ...source("ready_first", 2, { kind: "terminal", runId: "ready_first", status: "completed" }), ...changed }),
        /SKILL_USAGE_TERMINAL_CONFLICT/u,
      )
    }
    await assert.rejects(
      () =>
        applySkillUsageFact(client, {
          ...source("ready_first", 1, { kind: "ready", runId: "ready_first", sourceRefs: ["skill:one"] }),
          sourceDigest: "f".repeat(64),
        }),
      /CONFLICT/u,
    )
    await client.query("ROLLBACK")
  } finally {
    client.release()
    await pool.end()
  }
})
