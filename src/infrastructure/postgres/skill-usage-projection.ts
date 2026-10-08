import type { PoolClient } from "pg"
import type { SkillUsageFact, SkillUsageResult } from "../../application/agui/skill-usage.js"
import { skillUsageResult } from "../../application/agui/skill-usage.js"

export type SkillUsageSource = {
  tenantId: string
  sessionId: string
  sourceOwner: "kokoro-agent"
  sourceEventId: string
  sourceSequence: number
  sourceDigest: string
  sourceOccurredAt: string
  fact: SkillUsageFact
}

function sameFirstEvidence(
  current: { source_owner: string; source_event_id: string; source_sequence: string; source_digest: string; source_occurred_at: Date | string },
  source: SkillUsageSource,
): boolean {
  const reusesIdentity = current.source_event_id === source.sourceEventId || String(current.source_sequence) === String(source.sourceSequence)
  if (!reusesIdentity) return true
  return (
    current.source_owner === source.sourceOwner &&
    current.source_event_id === source.sourceEventId &&
    String(current.source_sequence) === String(source.sourceSequence) &&
    current.source_digest === source.sourceDigest &&
    new Date(current.source_occurred_at).toISOString() === new Date(source.sourceOccurredAt).toISOString()
  )
}

export async function applySkillUsageFact(client: PoolClient, source: SkillUsageSource): Promise<void> {
  await client.query(
    `INSERT INTO bff_skill_usage_coverage (tenant_id,status) VALUES ($1,'unavailable')
     ON CONFLICT (tenant_id) DO NOTHING`,
    [source.tenantId],
  )
  const values = [
    source.tenantId,
    source.fact.runId,
    source.sessionId,
    source.sourceOwner,
    source.sourceEventId,
    source.sourceSequence,
    source.sourceDigest,
    source.sourceOccurredAt,
  ]
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [JSON.stringify(["skill_usage", source.tenantId, source.fact.runId])])
  if (source.fact.kind === "terminal") {
    const readySession = await client.query<{ session_id: string }>(
      `SELECT session_id FROM bff_skill_usage_observation WHERE tenant_id=$1 AND run_id=$2 AND session_id<>$3 LIMIT 1`,
      [source.tenantId, source.fact.runId, source.sessionId],
    )
    if (readySession.rows[0] !== undefined) throw new Error("SKILL_USAGE_TERMINAL_CONFLICT")
    const inserted = await client.query(
      `INSERT INTO bff_skill_usage_run_terminal
         (tenant_id,run_id,session_id,status,source_owner,source_event_id,source_sequence,source_digest,source_occurred_at)
       VALUES ($1,$2,$3,$9,$4,$5,$6,$7,$8)
       ON CONFLICT (tenant_id,run_id) DO NOTHING RETURNING run_id`,
      [...values, source.fact.status],
    )
    if (inserted.rowCount === 0) {
      const current = await client.query<{
        session_id: string
        status: string
        source_owner: string
        source_event_id: string
        source_sequence: string
        source_digest: string
        source_occurred_at: Date | string
      }>(
        `SELECT session_id,status,source_owner,source_event_id,source_sequence,source_digest,source_occurred_at
           FROM bff_skill_usage_run_terminal WHERE tenant_id=$1 AND run_id=$2`,
        [source.tenantId, source.fact.runId],
      )
      const row = current.rows[0]
      if (
        row === undefined ||
        row.session_id !== source.sessionId ||
        row.status !== source.fact.status ||
        !sameFirstEvidence(row, source)
      )
        throw new Error("SKILL_USAGE_TERMINAL_CONFLICT")
    }
    if (source.fact.status === "completed") {
      await client.query(
        `UPDATE bff_skill_usage_observation SET counted_at=COALESCE(counted_at,$3::timestamptz)
          WHERE tenant_id=$1 AND run_id=$2 AND session_id=$4`,
        [source.tenantId, source.fact.runId, source.sourceOccurredAt, source.sessionId],
      )
    }
    return
  }
  const terminalSession = await client.query<{ session_id: string }>(
    `SELECT session_id FROM bff_skill_usage_run_terminal WHERE tenant_id=$1 AND run_id=$2`,
    [source.tenantId, source.fact.runId],
  )
  if (terminalSession.rows[0] !== undefined && terminalSession.rows[0].session_id !== source.sessionId) throw new Error("SKILL_USAGE_READY_CONFLICT")
  for (const sourceRef of source.fact.sourceRefs) {
    const inserted = await client.query(
      `INSERT INTO bff_skill_usage_observation
         (tenant_id,run_id,source_ref,session_id,ready_source_owner,ready_source_event_id,ready_source_sequence,ready_source_digest,ready_source_occurred_at,counted_at)
       SELECT $1,$2,$9,$3,$4,$5,$6,$7,$8,
              CASE WHEN terminal.status='completed' THEN terminal.source_occurred_at ELSE NULL END
         FROM (SELECT 1) AS seed
         LEFT JOIN bff_skill_usage_run_terminal AS terminal ON terminal.tenant_id=$1 AND terminal.run_id=$2 AND terminal.session_id=$3
       ON CONFLICT (tenant_id,run_id,source_ref) DO NOTHING RETURNING source_ref`,
      [...values, sourceRef],
    )
    if (inserted.rowCount === 0) {
      const current = await client.query<{
        session_id: string
        ready_source_owner: string
        ready_source_event_id: string
        ready_source_sequence: string
        ready_source_digest: string
        ready_source_occurred_at: Date | string
      }>(
        `SELECT session_id,ready_source_owner,ready_source_event_id,ready_source_sequence,ready_source_digest,ready_source_occurred_at
           FROM bff_skill_usage_observation WHERE tenant_id=$1 AND run_id=$2 AND source_ref=$3`,
        [source.tenantId, source.fact.runId, sourceRef],
      )
      const row = current.rows[0]
      if (
        row === undefined ||
        row.session_id !== source.sessionId ||
        !sameFirstEvidence(
          {
            source_owner: row.ready_source_owner,
            source_event_id: row.ready_source_event_id,
            source_sequence: row.ready_source_sequence,
            source_digest: row.ready_source_digest,
            source_occurred_at: row.ready_source_occurred_at,
          },
          source,
        )
      )
        throw new Error("SKILL_USAGE_READY_CONFLICT")
    }
  }
}

export async function readSkillUsage(client: PoolClient, tenantId: string, sourceRefs: readonly string[]): Promise<Map<string, SkillUsageResult>> {
  if (sourceRefs.length === 0 || sourceRefs.length > 100 || new Set(sourceRefs).size !== sourceRefs.length) throw new Error("SKILL_USAGE_QUERY_INVALID")
  const counts = await client.query<{ source_ref: string; coverage_status: "unavailable" | "complete" | null; count: string }>(
    `SELECT requested.source_ref,coverage.status AS coverage_status,count(observation.run_id)::text AS count
       FROM unnest($2::text[]) WITH ORDINALITY AS requested(source_ref,ordinality)
       LEFT JOIN bff_skill_usage_coverage AS coverage ON coverage.tenant_id=$1
       LEFT JOIN bff_skill_usage_observation AS observation
         ON observation.tenant_id=$1 AND observation.source_ref=requested.source_ref AND observation.counted_at IS NOT NULL
      GROUP BY requested.source_ref,requested.ordinality,coverage.status ORDER BY requested.ordinality`,
    [tenantId, sourceRefs],
  )
  return new Map(
    counts.rows.map((row) => [
      row.source_ref,
      row.coverage_status === "complete" ? skillUsageResult("complete", BigInt(row.count)) : skillUsageResult("unavailable"),
    ]),
  )
}
