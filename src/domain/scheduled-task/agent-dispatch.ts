export type ScheduledAgentDispatchStatus = "pending" | "leased" | "retryable" | "admitted" | "terminal" | "failed"

export type ScheduledAgentDispatchLease = {
  tenantId: string
  taskId: string
  dispatchId: string
  runId: string
  leaseOwner: string
  leaseToken: string
  fence: number
}

export type ScheduledAgentDispatchCommand = ScheduledAgentDispatchLease & {
  subjectId: string
  requestId: string
  idempotencyKey: string
  identityAssertionRef: string
  payload: Record<string, unknown>
  attemptCount: number
  admissionUnknownSeen: boolean
  leaseRemainingMs: number
  leaseObservedAt: number
}

export type ScheduledAgentSourceEvent = {
  sourceSequence: number
  sourceEventId: string
  sourceRunId: string
  sourceDigest: string
  sourceOccurredAt: string
  eventType: string
  sourcePayload: Record<string, unknown>
}

export function scheduledOccurrenceOrderKey(value: string): string {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/u.exec(value)
  if (match === null) throw new Error("SCHEDULED_AGENT_OCCURRENCE_INVALID")
  return `${match[1]}.${(match[2] ?? "").padEnd(9, "0")}Z`
}
