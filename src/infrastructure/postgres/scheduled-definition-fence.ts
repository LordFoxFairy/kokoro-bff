import type { PoolClient } from "pg"

/** Task row is held first. Only proven never-submitted work is retired; uncertain and durable Chat work keeps its actor/payload. */
export async function retireUnsentScheduledDefinition(
  client: Pick<PoolClient, "query">,
  tenantId: string,
  taskId: string,
  revision: number | null,
): Promise<void> {
  await client.query("SELECT 1 FROM bff_scheduled_agent_scope WHERE tenant_id=$1 AND task_id=$2 FOR UPDATE", [tenantId, taskId])
  const retired = await client.query<{ dispatch_id: string }>(
    `UPDATE bff_scheduled_agent_dispatch d SET status='failed',lease_owner=NULL,lease_token=NULL,lease_until=NULL,
      fence=fence+1,completed_at=clock_timestamp(),last_error_code='scheduled_definition_changed',last_error_at=clock_timestamp(),updated_at=clock_timestamp()
     WHERE d.tenant_id=$1 AND d.task_id=$2 AND ($3::bigint IS NULL OR d.task_revision<>$3)
       AND d.status IN ('pending','retryable','leased') AND NOT d.admission_unknown_seen
       AND NOT EXISTS (SELECT 1 FROM bff_agent_dispatch_outbox ordinary WHERE ordinary.tenant_id=d.tenant_id AND ordinary.run_id=d.run_id)
     RETURNING dispatch_id`,
    [tenantId, taskId, revision],
  )
  if (retired.rows.length)
    await client.query(
      `UPDATE bff_scheduled_agent_scope SET active_dispatch_id=NULL,active_run_id=NULL,updated_at=clock_timestamp()
      WHERE tenant_id=$1 AND task_id=$2 AND active_dispatch_id=ANY($3::text[])`,
      [tenantId, taskId, retired.rows.map((row) => row.dispatch_id)],
    )
}
