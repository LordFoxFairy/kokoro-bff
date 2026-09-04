import type {
  ScheduledTaskOutboxCommand,
  ScheduledTaskOutboxLease,
} from "../../domain/scheduled-task/outbox.js"

export type ScheduledTaskOutboxClaimInput = {
  workerId: string
  limit: number
  leaseDurationMs: number
  now: Date
}

/** Persistence port for the ScheduledTask-owned outbound command queue. */
export interface ScheduledTaskOutboxRepository {
  claimScheduledTaskOutbox(input: ScheduledTaskOutboxClaimInput): Promise<ScheduledTaskOutboxCommand[]>
  markScheduledTaskOutboxSucceeded(lease: ScheduledTaskOutboxLease, completedAt: Date): Promise<boolean>
  markScheduledTaskOutboxRetryable(lease: ScheduledTaskOutboxLease, nextAttemptAt: Date, errorCode: string, failedAt: Date): Promise<boolean>
  markScheduledTaskOutboxFailed(lease: ScheduledTaskOutboxLease, errorCode: string, failedAt: Date): Promise<boolean>
}
