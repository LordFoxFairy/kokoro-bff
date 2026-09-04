import type {
  AgentCancellationCommand,
  AgentCancellationLease,
} from "../../domain/chat/agent-cancellation.js"

export type AgentCancellationOutboxClaimInput = {
  workerId: string
  limit: number
  leaseDurationMs: number
  maxAttempts: number
}

export interface AgentCancellationOutboxRepository {
  claimAgentCancellationOutbox(input: AgentCancellationOutboxClaimInput): Promise<AgentCancellationCommand[]>
  markAgentCancellationSucceeded(lease: AgentCancellationLease): Promise<boolean>
  markAgentCancellationRetryable(lease: AgentCancellationLease, delayMs: number, errorCode: string): Promise<boolean>
  markAgentCancellationFailed(lease: AgentCancellationLease, errorCode: string): Promise<boolean>
}
