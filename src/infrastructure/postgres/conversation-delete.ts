import type { PoolClient } from "pg"

/** Applies local consequences after the caller has locked and tombstoned a conversation. */
export async function deleteLockedConversationFacts(
  client: PoolClient,
  tenantId: string,
  subjectId: string,
  conversationId: string,
  requestId: string,
): Promise<void> {
  await client.query(`DELETE FROM bff_message_feedback WHERE tenant_id=$1 AND conversation_id=$2`, [tenantId, conversationId])
  await client.query(`DELETE FROM bff_agui_run_interaction WHERE tenant_id=$1 AND session_id=$2`, [tenantId, conversationId])
  await client.query(`DELETE FROM bff_agui_run_activity WHERE tenant_id=$1 AND session_id=$2`, [tenantId, conversationId])
  await client.query(`DELETE FROM bff_agui_run_process WHERE tenant_id=$1 AND session_id=$2`, [tenantId, conversationId])
  await client.query(`DELETE FROM bff_conversation_artifact WHERE tenant_id = $1 AND conversation_id = $2`, [tenantId, conversationId])
  await client.query(
    `UPDATE bff_share SET revoked_at=CURRENT_TIMESTAMP(3) WHERE tenant_id=$1 AND conversation_id=$3 AND resource_kind='conversation' AND revoked_at IS NULL AND EXISTS (SELECT 1 FROM bff_conversation c WHERE c.tenant_id=bff_share.tenant_id AND c.conversation_id=bff_share.conversation_id AND c.owner_id=$2)`,
    [tenantId, subjectId, conversationId],
  )
  await client.query(
    `UPDATE bff_agui_stream SET consumer_state='stopped',consumer_fence=consumer_fence+1,consumer_lease_owner=NULL,consumer_lease_token=NULL,consumer_lease_until=NULL,consumer_last_error_code='conversation_deleted',consumer_last_error_at=CURRENT_TIMESTAMP(3),updated_at=CURRENT_TIMESTAMP(3) WHERE tenant_id=$1 AND session_id=$3 AND consumer_subject_id=$2`,
    [tenantId, subjectId, conversationId],
  )
  await client.query(
    `INSERT INTO bff_agent_cancellation_outbox (cancellation_id,tenant_id,conversation_id,conversation_dispatch_seq,run_id,subject_id,actor_id,request_id,command_id,identity_assertion_ref,payload,status,attempt_count,available_at,fence) SELECT 'cancel_'||d.outbox_id,d.tenant_id,d.conversation_id,d.conversation_dispatch_seq,d.run_id,d.subject_id,$2,$4,'cancel_'||d.outbox_id,d.identity_assertion_ref,jsonb_build_object('kind','run.cancel','session_id',d.conversation_id),'cancel_requested',0,CURRENT_TIMESTAMP(3),0 FROM bff_agent_dispatch_outbox d WHERE d.tenant_id=$1 AND d.subject_id=$2 AND d.conversation_id=$3 AND d.attempt_count>0 ON CONFLICT (tenant_id,run_id) DO NOTHING`,
    [tenantId, subjectId, conversationId, requestId],
  )
  await client.query(
    `UPDATE bff_agent_dispatch_outbox SET status='retryable',admission_unknown_seen=TRUE,last_error_code='conversation_deleted',last_error_at=CURRENT_TIMESTAMP(3),lease_owner=NULL,lease_token=NULL,lease_until=NULL,fence=fence+1,updated_at=CURRENT_TIMESTAMP(3) WHERE tenant_id=$1 AND subject_id=$2 AND conversation_id=$3 AND status IN ('leased','retryable') AND attempt_count>0`,
    [tenantId, subjectId, conversationId],
  )
  await client.query(
    `UPDATE bff_agent_dispatch_outbox SET status='failed',completed_at=CURRENT_TIMESTAMP(3),last_error_code='conversation_deleted',last_error_at=CURRENT_TIMESTAMP(3),lease_owner=NULL,lease_token=NULL,lease_until=NULL,fence=fence+1,updated_at=CURRENT_TIMESTAMP(3) WHERE tenant_id=$1 AND subject_id=$2 AND conversation_id=$3 AND status IN ('pending','retryable','leased') AND attempt_count=0 AND admission_unknown_seen=FALSE`,
    [tenantId, subjectId, conversationId],
  )
  await client.query(
    `UPDATE bff_message SET status='failed',agent_failure_code=NULL,agent_failure_retryable=NULL,updated_at=CURRENT_TIMESTAMP(3) WHERE tenant_id=$1 AND conversation_id=$3 AND role='assistant' AND status IN ('pending','streaming') AND EXISTS (SELECT 1 FROM bff_conversation c WHERE c.tenant_id=bff_message.tenant_id AND c.conversation_id=bff_message.conversation_id AND c.owner_id=$2)`,
    [tenantId, subjectId, conversationId],
  )
}
