import type { AgentDispatchPayload } from "../../domain/chat/agent-dispatch.js"
export type RegenerateMessageInput = Readonly<{
  tenantId: string
  subjectId: string
  actorId: string
  conversationId: string
  sourceMessageId: string
  requestId: string
  idempotencyKey: string
  signal: AbortSignal
  deadlineAt: number
}>
export type RegenerationSource = Readonly<{
  sourceMessageId: string
  sourceRunId: string
  originalUserMessageId: string
  content: string
  payload: AgentDispatchPayload
  sourceFingerprint: string
}>
export type RegenerationReceipt = Readonly<{ run_id: string; user_message_id: string; assistant_message_id: string; regenerated_from_message_id: string }>
