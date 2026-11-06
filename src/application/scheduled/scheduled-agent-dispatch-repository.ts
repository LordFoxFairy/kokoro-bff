import type { SchedulerDispatchClaim, SchedulerDispatchResponse, SchedulerDispatchSnapshot } from "./scheduler-dispatch-receipt-repository.js"
import type { ScheduledAgentDispatchCommand, ScheduledAgentDispatchLease, ScheduledAgentSourceEvent } from "../../domain/scheduled-task/agent-dispatch.js"

export type ScheduledAgentRejectionReason = "task_not_found" | "task_not_active" | "task_changed"
export type ScheduledAgentAcceptResult = { outcome: "accepted" } | { outcome: "rejected"; response: SchedulerDispatchResponse } | { outcome: "claim_lost" }

export type ScheduledAgentAcceptInput = {
  claim: SchedulerDispatchClaim
  snapshot: SchedulerDispatchSnapshot
  response: SchedulerDispatchResponse
  rejections: Record<ScheduledAgentRejectionReason, SchedulerDispatchResponse>
}
export type ScheduledAgentConsumerLease = {
  tenantId: string
  taskId: string
  sessionId: string
  subjectId: string
  leaseOwner: string
  leaseToken: string
  fence: number
  sourceHighWatermark: number
  failureCount: number
  leaseRemainingMs: number
  leaseObservedAt: number
}
export interface ScheduledAgentDispatchRepository {
  accept(input: ScheduledAgentAcceptInput): Promise<ScheduledAgentAcceptResult>
  claim(input: { workerId: string; leaseDurationMs: number; settlementReserveMs: number; maxAttempts: number }): Promise<ScheduledAgentDispatchCommand | null>
  releaseNeverSent(lease: ScheduledAgentDispatchLease, delayMs: number): Promise<boolean>
  markAdmitted(lease: ScheduledAgentDispatchLease): Promise<boolean>
  markUnknown(lease: ScheduledAgentDispatchLease, delayMs: number, errorCode: string): Promise<boolean>
  markNotAdmitted(lease: ScheduledAgentDispatchLease, delayMs: number, errorCode: string): Promise<boolean>
  claimConsumer(input: { workerId: string; leaseDurationMs: number; settlementReserveMs: number }): Promise<ScheduledAgentConsumerLease | null>
  commitSourcePage(lease: ScheduledAgentConsumerLease, events: readonly ScheduledAgentSourceEvent[], nextSequence: number, exhausted: boolean): Promise<boolean>
  releaseConsumer(lease: ScheduledAgentConsumerLease, delayMs: number): Promise<boolean>
}
