export type SchedulerDispatchSnapshot = {
  tenantId: string
  schedule: string
  occurrence: string
  idempotencyKey: string
  actorId: string
  taskId: string
  launch: {
    requestId: string
    body: Record<string, unknown>
    identityAssertionRef: string
    receipt: { run_id: string; user_message_id: string; assistant_message_id: string }
  }
}

export type SchedulerDispatchClaim = {
  scope: string
  digest: string
  claimToken: string
  /** Database-observed lease budget paired with the monotonic observation below. */
  leaseRemainingMs: number
  /** Same-process monotonic observation anchored before the database budget query. */
  leaseObservedAt: number
  snapshot: SchedulerDispatchSnapshot | null
}

export type SchedulerDispatchPreparation = { leaseRemainingMs: number; leaseObservedAt: number }

export type SchedulerDispatchResponse = { status: number; body: unknown }

export type SchedulerDispatchClaimResult =
  | { outcome: "claimed"; claim: SchedulerDispatchClaim }
  | { outcome: "terminal"; response: SchedulerDispatchResponse }
  | { outcome: "conflict" }
  | { outcome: "pending" }

export interface SchedulerDispatchReceiptRepository {
  claim(scope: string, digest: string): Promise<SchedulerDispatchClaimResult>
  prepareSnapshot(claim: SchedulerDispatchClaim, snapshot: SchedulerDispatchSnapshot): Promise<SchedulerDispatchPreparation | null>
  complete(claim: SchedulerDispatchClaim, response: SchedulerDispatchResponse): Promise<boolean>
  releaseRetryable(claim: SchedulerDispatchClaim, errorCode: string, retryAfterMs?: number): Promise<boolean>
}
