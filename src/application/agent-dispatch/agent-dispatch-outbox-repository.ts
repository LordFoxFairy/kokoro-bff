import type { RegenerateMessageInput, RegenerationSource } from "../chat/message-regeneration.js"
import type { AgentDispatchCommand, AgentDispatchLease, AgentDispatchPayload, AgentDispatchReceipt } from "../../domain/chat/agent-dispatch.js"

export type CommitChatTurn = {
  /** Internal activation fence, never accepted from an HTTP DTO. */
  scheduledActivation?: Readonly<{
    tenantId: string
    taskId: string
    dispatchId: string
    runId: string
    leaseOwner: string
    leaseToken: string
    fence: number
  }>
  regeneration?: Readonly<{ sourceMessageId: string; originalUserMessageId: string; sourceRunId: string; sourceFingerprint: string }>
  lifetime?: Readonly<{ signal: AbortSignal; deadlineAt: number }>
  outboxId: string
  tenantId: string
  conversationId: string
  projectRef?: string
  interruptRunId?: string
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
  skillSelection?: Readonly<{ projectId: string | null; installationIds: string[] }>
  payload: AgentDispatchPayload
}

export type ChatTurnSelectionInput = Pick<
  CommitChatTurn,
  "tenantId" | "conversationId" | "subjectId" | "projectRef" | "interruptRunId" | "idempotencyKey" | "requestDigest" | "lifetime"
>
export type ChatTurnSelection = { kind: "new"; projectId: string | null; installationIds: string[] } | { kind: "replay"; receipt: AgentDispatchReceipt }

export type AgentDispatchOutboxClaimInput = {
  workerId: string
  limit: number
  leaseDurationMs: number
  maxAttempts: number
}

/** Atomic Chat turn admission plus the durable Agent command queue. */
export interface AgentDispatchOutboxRepository {
  readRegenerationSource(input: RegenerateMessageInput): Promise<RegenerationSource | null>
  prepareChatTurnSelection(input: ChatTurnSelectionInput): Promise<ChatTurnSelection | null>
  commitChatTurn(command: CommitChatTurn): Promise<AgentDispatchReceipt | null>
  claimAgentDispatchOutbox(input: AgentDispatchOutboxClaimInput): Promise<AgentDispatchCommand[]>
  markAgentDispatchAdmitted(lease: AgentDispatchLease): Promise<boolean>
  markAgentDispatchUnknown(lease: AgentDispatchLease, delayMs: number, errorCode: string): Promise<boolean>
  markAgentDispatchNotAdmitted(lease: AgentDispatchLease, delayMs: number, errorCode: string): Promise<boolean>
}
