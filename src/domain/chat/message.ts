export type MessageRole = "user" | "assistant" | "system"
export type MessageStatus = "pending" | "streaming" | "completed" | "failed"

export type Message = {
  messageId: string
  tenantId: string
  conversationId: string
  runId: string | null
  role: MessageRole
  content: string
  status: MessageStatus
  /** PostgreSQL BIGINT decimal; never coerced through a JavaScript Number. */
  messageSeq: string
  createdAt: Date
  updatedAt: Date
}
