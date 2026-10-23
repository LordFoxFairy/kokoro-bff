import type { PoolClient } from "pg"
/** Caller already owns Project (if any) and task; never takes a parent after scope. */
export async function invalidateRssPoll(
  input: Readonly<{ client: Pick<PoolClient, "query">; tenantId: string; taskId: string; retireSeen: boolean }>,
): Promise<void> {
  const { client, tenantId, taskId } = input
  await client.query(`SELECT task_id FROM bff_scheduled_rss_poll WHERE tenant_id=$1 AND task_id=$2 FOR UPDATE`, [tenantId, taskId])
  if (input.retireSeen) {
    await client.query(`DELETE FROM bff_scheduled_rss_poll WHERE tenant_id=$1 AND task_id=$2`, [tenantId, taskId])
  } else
    await client.query(
      `UPDATE bff_scheduled_rss_poll SET fence=fence+1,lease_owner=NULL,lease_token=NULL,lease_until=NULL,updated_at=CURRENT_TIMESTAMP(3) WHERE tenant_id=$1 AND task_id=$2`,
      [tenantId, taskId],
    )
  await client.query(`SELECT task_id FROM bff_scheduled_agent_scope WHERE tenant_id=$1 AND task_id=$2 FOR UPDATE`, [tenantId, taskId])
  const stopped = await client.query<{ dispatch_id: string; run_id: string }>(
    `UPDATE bff_scheduled_agent_dispatch SET status='failed',completed_at=CURRENT_TIMESTAMP(3),last_error_code='scheduled_task_changed',updated_at=CURRENT_TIMESTAMP(3)
 WHERE tenant_id=$1 AND task_id=$2 AND status IN('pending','retryable') AND admission_unknown_seen=false RETURNING dispatch_id,run_id`,
    [tenantId, taskId],
  )
  for (const row of stopped.rows)
    await client.query(
      `UPDATE bff_scheduled_agent_scope SET active_dispatch_id=NULL,active_run_id=NULL,updated_at=CURRENT_TIMESTAMP(3) WHERE tenant_id=$1 AND task_id=$2 AND active_dispatch_id=$3 AND active_run_id=$4`,
      [tenantId, taskId, row.dispatch_id, row.run_id],
    )
  if (input.retireSeen) {
    // One epoch is capped at 100k rows. Retire atomically, never chunk-delete a partial history.
    // The enclosing mutation transaction rolls back on lock or statement timeout.
    await client.query("SELECT set_config('statement_timeout','5000',true),set_config('lock_timeout','2000',true)")
    await client.query(`DELETE FROM bff_scheduled_rss_seen WHERE tenant_id=$1 AND task_id=$2`, [tenantId, taskId])
  }
}
