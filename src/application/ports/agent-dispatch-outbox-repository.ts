import type {
  AgentDispatchCommand,
  AgentDispatchLease,
  AgentDispatchPayload,
  AgentDispatchReceipt,
} from "../../domain/chat/agent-dispatch.js"

export type CommitChatTurn = {
  outboxId: string
  tenantId: string
  conversationId: string
  projectRef?: string
  subjectId: string
  actorId: string
  requestId: string
  idempotencyKey: string
  requestDigest: string
  runId: string
  userMessageId: string
  assistantMessageId: string
  identityAssertionRef: string
  content: string
  payload: AgentDispatchPayload
}

export type AgentDispatchOutboxClaimInput = {
  workerId: string
  limit: number
  leaseDurationMs: number
  maxAttempts: number
}

/** Atomic Chat turn admission plus the durable Agent command queue. */
export interface AgentDispatchOutboxRepository {
  commitChatTurn(command: CommitChatTurn): Promise<AgentDispatchReceipt | null>
  claimAgentDispatchOutbox(input: AgentDispatchOutboxClaimInput): Promise<AgentDispatchCommand[]>
  markAgentDispatchSucceeded(lease: AgentDispatchLease): Promise<boolean>
  markAgentDispatchRetryable(lease: AgentDispatchLease, delayMs: number, errorCode: string): Promise<boolean>
  markAgentDispatchFailed(lease: AgentDispatchLease, errorCode: string): Promise<boolean>
}
