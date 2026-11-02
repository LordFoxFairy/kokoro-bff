import type { PoolClient } from "pg"
import type { PrivateMessageRead } from "../../application/ports/chat-repository.js"

type Scope = Readonly<{ tenantId: string; subjectId: string; conversationId: string }>
type TerminalRow = {
  message_id: string
  run_id: string
  tenant_id: string
  session_id: string
  subject_id: string
  status: string
  source_owner: string
  source_event_id: string
  source_sequence: string
  source_digest: string
  source_occurred_at: Date | string
}
const invalid = (): never => {
  throw new Error("MESSAGE_PARTS_UNAVAILABLE")
}

/** Reuse the durable owner terminal fact; AG-UI frame retention cannot erase cancellation. */
export async function withCancelledMessageTerminals(client: PoolClient, messages: PrivateMessageRead[], scope: Scope): Promise<PrivateMessageRead[]> {
  const candidates = messages.filter(
    (message) => message.role === "assistant" && message.status === "failed" && message.failure === null && message.runId !== null,
  )
  if (candidates.length === 0) return messages
  if (candidates.length > 100) return invalid()
  for (const message of candidates) if (message.tenantId !== scope.tenantId || message.conversationId !== scope.conversationId) return invalid()
  const result = await client.query<TerminalRow>(
    `WITH candidates AS (SELECT input.message_id,input.run_id FROM unnest($4::text[],$5::text[]) AS input(message_id,run_id))
     SELECT c.message_id,c.run_id,message.tenant_id,message.conversation_id AS session_id,dispatch.subject_id,
       terminal.status,terminal.source_owner,terminal.source_event_id,terminal.source_sequence::text,terminal.source_digest,terminal.source_occurred_at
     FROM candidates c JOIN bff_message message ON message.message_id=c.message_id AND message.run_id=c.run_id
       AND message.tenant_id=$1 AND message.conversation_id=$2 AND message.role='assistant' AND message.status='failed'
       AND message.agent_failure_code IS NULL AND message.agent_failure_retryable IS NULL
     JOIN bff_conversation conversation ON conversation.tenant_id=message.tenant_id AND conversation.conversation_id=message.conversation_id
       AND conversation.owner_id=$3 AND conversation.status='active'
     JOIN bff_agent_dispatch_outbox dispatch ON dispatch.tenant_id=message.tenant_id AND dispatch.conversation_id=message.conversation_id
       AND dispatch.run_id=message.run_id AND dispatch.assistant_message_id=message.message_id AND dispatch.subject_id=$3
     JOIN bff_skill_usage_run_terminal terminal ON terminal.tenant_id=message.tenant_id AND terminal.session_id=message.conversation_id AND terminal.run_id=message.run_id`,
    [scope.tenantId, scope.conversationId, scope.subjectId, candidates.map((message) => message.messageId), candidates.map((message) => message.runId)],
  )
  const seen = new Set<string>(),
    cancelled = new Set<string>()
  for (const row of result.rows) {
    if (
      row.tenant_id !== scope.tenantId ||
      row.session_id !== scope.conversationId ||
      row.subject_id !== scope.subjectId ||
      row.source_owner !== "kokoro-agent" ||
      typeof row.source_event_id !== "string" ||
      row.source_event_id.trim() === "" ||
      !/^[1-9][0-9]{0,18}$(?![\s\S])/u.test(row.source_sequence) ||
      BigInt(row.source_sequence) > 9223372036854775807n ||
      !/^[0-9a-f]{64}$/u.test(row.source_digest) ||
      !Number.isFinite(new Date(row.source_occurred_at).getTime()) ||
      !["completed", "cancelled", "failed"].includes(row.status) ||
      seen.has(row.message_id) ||
      !candidates.some((message) => message.messageId === row.message_id && message.runId === row.run_id)
    )
      return invalid()
    seen.add(row.message_id)
    if (row.status === "cancelled") cancelled.add(row.message_id)
  }
  return messages.map((message) => (cancelled.has(message.messageId) ? { ...message, terminal_status: "cancelled" as const } : message))
}
