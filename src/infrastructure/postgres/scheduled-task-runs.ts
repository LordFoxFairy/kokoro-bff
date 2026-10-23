import type { Pool } from "pg"
import type { ScheduledRunsQuery, ScheduledTaskRunsReader } from "../../application/scheduled-task-runs.types.js"
import { ArchiveSqlLease } from "./archive-sql-lease.js"

// One statement snapshot: eligibility precedes L+1 and exact-run terminal lookup is at most two rows.
const snapshotSql = `WITH eligible AS MATERIALIZED (
  SELECT t.task_id,t.tenant_id,t.owner_id,t.title,t.project_id,t.revision
  FROM bff_scheduled_task t
  WHERE t.tenant_id=$1 AND t.owner_id=$2
    AND (t.project_id IS NULL OR EXISTS(SELECT 1 FROM bff_project p
      WHERE p.project_id=t.project_id AND p.tenant_id=t.tenant_id AND p.owner_id=t.owner_id AND p.deleted_at IS NULL))
    AND ($3::text IS NULL OR t.task_id=$3)
), candidates AS MATERIALIZED (
  SELECT d.dispatch_id,d.tenant_id,d.subject_id,d.task_id,t.title,t.project_id,t.revision,d.run_id,d.occurrence_order_key,d.source_kind,d.source_observed_at,d.status,d.admission_unknown_seen
  FROM bff_scheduled_agent_dispatch d JOIN eligible t ON t.task_id=d.task_id AND t.tenant_id=d.tenant_id AND t.owner_id=d.subject_id
  WHERE d.tenant_id=$1 AND d.subject_id=$2
    AND ($4::text IS NULL OR (d.occurrence_order_key COLLATE "C",d.dispatch_id COLLATE "C")<($4::text COLLATE "C",$5::text COLLATE "C"))
  ORDER BY d.occurrence_order_key COLLATE "C" DESC,d.dispatch_id COLLATE "C" DESC LIMIT $6
), projected AS (
  SELECT c.dispatch_id,c.tenant_id,c.subject_id,c.task_id,c.title,c.project_id,c.revision,c.run_id,c.occurrence_order_key,c.source_kind,c.source_observed_at,c.status,c.admission_unknown_seen,COALESCE(s.terminals,'[]'::jsonb) AS terminals FROM candidates c
  LEFT JOIN LATERAL (SELECT jsonb_agg(jsonb_build_object(
    'tenantId',x.tenant_id,'taskId',x.task_id,'sequence',x.source_sequence::text,'sourceEventId',x.source_event_id,
    'sourceRunId',x.source_run_id,'owner',x.source_owner,'sourceDigest',x.source_digest,
    'occurredAt',to_char(x.source_occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'eventType',x.event_type,'payload',CASE WHEN octet_length(x.source_payload::text)<=65536 THEN x.source_payload ELSE NULL END
  ) ORDER BY x.source_sequence) AS terminals FROM (
    SELECT e.tenant_id,e.task_id,e.source_sequence,e.source_event_id,e.source_run_id,e.source_owner,e.source_digest,e.source_occurred_at,e.event_type,e.source_payload FROM bff_scheduled_agent_source_event e WHERE e.tenant_id=c.tenant_id AND e.task_id=c.task_id AND e.source_run_id=c.run_id
      AND e.event_type IN ('run.completed','run.failed') ORDER BY e.source_sequence LIMIT 2
  ) x) s ON TRUE
), page AS (
  SELECT jsonb_build_object('taskExists',EXISTS(SELECT 1 FROM eligible),'rows',COALESCE(jsonb_agg(jsonb_build_object(
    'dispatchId',dispatch_id,'tenantId',tenant_id,'subjectId',subject_id,'taskId',task_id,'title',title,'projectRef',project_id,
    'taskRevision',revision::text,'runId',run_id,'orderKey',occurrence_order_key,'sourceKind',source_kind,'sourceObservedAt',CASE WHEN source_observed_at IS NULL THEN NULL ELSE to_char(source_observed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,'status',status,'unknownSeen',admission_unknown_seen,'terminals',terminals
  ) ORDER BY occurrence_order_key COLLATE "C" DESC,dispatch_id COLLATE "C" DESC),'[]'::jsonb)) AS snapshot FROM projected
) SELECT CASE WHEN octet_length(snapshot::text)<=1048576 THEN snapshot::text ELSE NULL END AS snapshot FROM page`

export class PostgresScheduledTaskRunsReader implements ScheduledTaskRunsReader {
  public constructor(private readonly pool: Pick<Pool, "connect">) {}
  public async readSnapshot(query: ScheduledRunsQuery): Promise<unknown> {
    const lease = await ArchiveSqlLease.acquire(this.pool, query)
    let clean = false
    try {
      await lease.begin(true)
      const result = await lease.query(snapshotSql, [
        query.tenantId,
        query.subjectId,
        query.taskId,
        query.position?.orderKey ?? null,
        query.position?.dispatchId ?? null,
        query.limit + 1,
      ])
      if (result.rows.length !== 1 || typeof result.rows[0]?.snapshot !== "string" || Buffer.byteLength(result.rows[0].snapshot) > 1048576)
        throw new Error("SCHEDULED_RUNS_INVALID")
      const value: unknown = JSON.parse(result.rows[0].snapshot)
      await lease.query("COMMIT")
      clean = true
      return value
    } finally {
      lease.release(!clean)
    }
  }
}
