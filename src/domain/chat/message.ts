export type MessageRole = "user" | "assistant"
export type MessageStatus = "pending" | "streaming" | "completed" | "failed"
export type AgentFailureCode =
  | "token_budget_exceeded"
  | "recursion_limit_exceeded"
  | "assembly_failed"
  | "enqueue_failed"
  | "dispatch_exhausted"
  | "contract_incompatible"
  | "internal_error"
  | "model_unavailable"
  | "dependency_unavailable"
  | "model_access_denied"
  | "model_settlement_pending"

export type AgentFailureProfile = { source: "agent"; code: AgentFailureCode; retryable: boolean }

export type Message = {
  regeneratedFromMessageId?: string
  messageId: string
  tenantId: string
  conversationId: string
  runId: string | null
  role: MessageRole
  content: string
  selectedSkillSourceRefs: string[]
  status: MessageStatus
  failure: AgentFailureProfile | null
  /** PostgreSQL BIGINT decimal; never coerced through a JavaScript Number. */
  messageSeq: string
  createdAt: Date
  updatedAt: Date
}
