import type { PoolClient } from "pg"

/** Caller owns Conversation -> stream. The standard projection is the only source of terminal facts. */
export async function projectScheduledChatTerminal(client: PoolClient, tenantId: string, sessionId: string, runId: string): Promise<void> {
  const scope = await client.query<{ active_dispatch_id: string }>(
    `SELECT active_dispatch_id FROM bff_scheduled_agent_scope
      WHERE tenant_id=$1 AND session_id=$2 AND active_run_id=$3 FOR UPDATE`,
    [tenantId, sessionId, runId],
  )
  const dispatchId = scope.rows[0]?.active_dispatch_id
  if (dispatchId === undefined) return
  await client.query(
    `UPDATE bff_scheduled_agent_dispatch scheduled
        SET status='terminal',admitted_at=ordinary.admitted_at,completed_at=ordinary.completed_at,
            lease_owner=NULL,lease_token=NULL,lease_until=NULL,fence=scheduled.fence+1,
            last_error_code=NULL,last_error_at=NULL,updated_at=clock_timestamp()
       FROM bff_agent_dispatch_outbox ordinary
      WHERE scheduled.dispatch_id=$1 AND scheduled.tenant_id=$2 AND scheduled.run_id=$3
        AND scheduled.status IN ('submitted','admitted')
        AND ordinary.tenant_id=scheduled.tenant_id AND ordinary.conversation_id=$4
        AND ordinary.run_id=scheduled.run_id AND ordinary.subject_id=scheduled.subject_id AND ordinary.status='terminal'`,
    [dispatchId, tenantId, runId, sessionId],
  )
}

/** Only call after a successful, currently leased standard source page reports exhausted. */
export async function releaseExhaustedScheduledChat(client: PoolClient, tenantId: string, sessionId: string): Promise<void> {
  await client.query(`SELECT 1 FROM bff_scheduled_agent_scope WHERE tenant_id=$1 AND session_id=$2 FOR UPDATE`, [tenantId, sessionId])
  await client.query(
    `UPDATE bff_scheduled_agent_scope scope
        SET active_dispatch_id=NULL,active_run_id=NULL,updated_at=clock_timestamp()
      WHERE scope.tenant_id=$1 AND scope.session_id=$2
        AND EXISTS(SELECT 1 FROM bff_scheduled_agent_dispatch dispatch
          WHERE dispatch.dispatch_id=scope.active_dispatch_id AND dispatch.tenant_id=scope.tenant_id
            AND dispatch.task_id=scope.task_id AND dispatch.run_id=scope.active_run_id AND dispatch.status='terminal')`,
    [tenantId, sessionId],
  )
}
