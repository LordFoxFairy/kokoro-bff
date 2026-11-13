import { readCurrentConversation } from "./chat-conversation-access.js"
import { createHash } from "node:crypto"
import type { QueryResult, QueryResultRow } from "pg"
import type { RegenerateMessageInput, RegenerationSource } from "../../application/chat/message-regeneration.js"
import type { PostgresBffDatabase } from "./client.js"
import { parseAgentDispatchPayload } from "../../application/chat/agent-dispatch-payload.js"
import { withMessageReadClient } from "./message-parts-read.js"
type SourceRow = {
  source_run_id: string
  source_status: string
  dispatch_status: string
  admission_unknown_seen: boolean
  user_message_id: string
  content: string
  input_id: string
  payload: unknown
  input_content: string
  selected_skill_source_refs: unknown
  source_origin: string
  input_origin: string
  source_parent: string | null
  input_parent: string | null
  source_user: string | null
  input_user: string | null
}
export async function regenerationSourceInTransaction(
  client: { query: <Row extends QueryResultRow = QueryResultRow>(sql: string, values?: unknown[]) => Promise<QueryResult<Row>> },
  input: Pick<RegenerateMessageInput, "tenantId" | "subjectId" | "conversationId" | "sourceMessageId">,
): Promise<RegenerationSource | null> {
  const current = await readCurrentConversation(client, input.tenantId, input.subjectId, input.conversationId, undefined, false)
  if (!current) return null
  if (current.projectAccess && !current.projectAccess.capabilities.includes("edit")) throw new Error("CHAT_TURN_PROJECT_FORBIDDEN")
  const rows = await client.query<SourceRow>(
    `SELECT source.run_id AS source_run_id,source.status AS source_status,dispatch.status AS dispatch_status,dispatch.admission_unknown_seen,
  original.message_id AS user_message_id,original.content,entry.message_id AS input_id,dispatch.payload,entry.content AS input_content,entry.selected_skill_source_refs,
  source.origin AS source_origin,entry.origin AS input_origin,source.regenerated_from_message_id AS source_parent,entry.regenerated_from_message_id AS input_parent,
  source.regeneration_user_message_id AS source_user,entry.regeneration_user_message_id AS input_user
  FROM bff_conversation conversation
  JOIN bff_message source ON source.tenant_id=conversation.tenant_id AND source.conversation_id=conversation.conversation_id AND source.message_id=$4 AND source.role='assistant'
  JOIN bff_agent_dispatch_outbox dispatch ON dispatch.tenant_id=source.tenant_id AND dispatch.conversation_id=source.conversation_id AND dispatch.run_id=source.run_id AND dispatch.assistant_message_id=source.message_id AND dispatch.subject_id=$2 AND dispatch.actor_id=$2
  JOIN bff_message entry ON entry.tenant_id=source.tenant_id AND entry.conversation_id=source.conversation_id AND entry.run_id=source.run_id AND entry.message_id=dispatch.user_message_id AND entry.role='user'
  JOIN bff_message original ON original.tenant_id=source.tenant_id AND original.conversation_id=source.conversation_id AND original.message_id=COALESCE(source.regeneration_user_message_id,entry.message_id) AND original.role='user' AND original.origin='normal'
  WHERE conversation.tenant_id=$1 AND conversation.conversation_id=$3 AND conversation.status='active'
`,
    [input.tenantId, input.subjectId, input.conversationId, input.sourceMessageId],
  )
  const row = rows.rows[0]
  if (!row) return null
  if (
    !["completed", "failed"].includes(row.source_status) ||
    !["terminal", "failed"].includes(row.dispatch_status) ||
    (row.dispatch_status === "failed" && row.admission_unknown_seen)
  )
    throw Error("MESSAGE_REGENERATION_NOT_READY")
  const eligibility = (
    await client.query<{ latest_message_id: string | null; has_active: boolean }>(
      `SELECT (SELECT message_id FROM bff_message WHERE tenant_id=$1 AND conversation_id=$2 AND role='assistant' ORDER BY message_seq DESC,message_id DESC LIMIT 1) AS latest_message_id,
      EXISTS(SELECT 1 FROM bff_agent_dispatch_outbox WHERE tenant_id=$1 AND conversation_id=$2 AND status IN ('pending','leased','retryable','admitted')) AS has_active`,
      [input.tenantId, input.conversationId],
    )
  ).rows[0]
  if (!eligibility || eligibility.latest_message_id !== input.sourceMessageId || eligibility.has_active) throw new Error("MESSAGE_REGENERATION_NOT_READY")
  const payload = parseAgentDispatchPayload(row.payload)
  if (
    payload.launch.run_id !== row.source_run_id ||
    payload.launch.session_id !== input.conversationId ||
    payload.launch.message_id !== row.input_id ||
    payload.launch.content !== row.content ||
    row.input_content !== row.content ||
    JSON.stringify(payload.launch.selected_skill_source_refs) !== JSON.stringify(row.selected_skill_source_refs) ||
    !(
      (row.source_origin === "normal" && row.input_origin === "normal") ||
      (row.source_origin === "regeneration_answer" &&
        row.input_origin === "regeneration_input" &&
        row.source_parent === row.input_parent &&
        row.source_user === row.user_message_id &&
        row.input_user === row.user_message_id)
    )
  )
    throw Error("MESSAGE_REGENERATION_SOURCE_INVALID")
  return {
    sourceMessageId: input.sourceMessageId,
    sourceRunId: row.source_run_id,
    originalUserMessageId: row.user_message_id,
    content: row.content,
    payload,
    sourceFingerprint: createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
  }
}
export function readRegenerationSource(database: PostgresBffDatabase, input: RegenerateMessageInput): Promise<RegenerationSource | null> {
  return withMessageReadClient(database.pool, input, (client) => regenerationSourceInTransaction(client, input))
}

/** The read projection asks the same regeneration predicate as the native command, not a second owner/role guess. */
export async function projectMessageRegeneration(
  client: Parameters<typeof regenerationSourceInTransaction>[0],
  input: Pick<RegenerateMessageInput, "tenantId" | "subjectId" | "conversationId">,
  messages: readonly import("../../application/chat/types.js").PrivateMessageRead[],
): Promise<import("../../application/chat/types.js").PrivateMessageRead[]> {
  const candidate = [...messages].reverse().find((message) => message.role === "assistant" && !message.sharedProjectRead)
  let eligible: string | undefined
  if (candidate) {
    try {
      if (await regenerationSourceInTransaction(client, { ...input, sourceMessageId: candidate.messageId })) eligible = candidate.messageId
    } catch (error) {
      if (!(error instanceof Error) || !["MESSAGE_REGENERATION_NOT_READY", "CHAT_TURN_PROJECT_FORBIDDEN"].includes(error.message)) throw error
    }
  }
  return messages.map((message) => ({ ...message, canRegenerate: message.messageId === eligible }))
}
