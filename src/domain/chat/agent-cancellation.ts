import { isRecord } from "../json.js"

export type AgentCancellationPayload = {
  kind: "run.cancel"
  session_id: string
}

export type AgentCancellationStatus = "cancel_requested" | "leased" | "retryable" | "succeeded" | "failed"

export type AgentCancellationLease = {
  tenantId: string
  cancellationId: string
  leaseOwner: string
  leaseToken: string
  fence: number
}

export type AgentCancellationCommand = AgentCancellationLease & {
  conversationId: string
  conversationDispatchSeq: string
  runId: string
  subjectId: string
  actorId: string
  requestId: string
  commandId: string
  identityAssertionRef: string
  payload: AgentCancellationPayload
  status: "leased"
  attemptCount: number
  leaseUntil: Date
  leaseRemainingMs: number
}

export function parseAgentCancellationPayload(value: unknown): AgentCancellationPayload {
  if (
    !isRecord(value)
    || Object.keys(value).some((key) => key !== "kind" && key !== "session_id")
    || value.kind !== "run.cancel"
    || typeof value.session_id !== "string"
    || value.session_id.trim() === ""
  ) throw new Error("AGENT_CANCELLATION_PAYLOAD_INVALID")
  return { kind: "run.cancel", session_id: value.session_id }
}

export function agentCancellationRetryDelayMs(
  attemptCount: number,
  random: number,
  baseMs = 500,
  maxMs = 30_000,
): number {
  if (!Number.isSafeInteger(attemptCount) || attemptCount < 1) throw new Error("AGENT_CANCELLATION_ATTEMPT_INVALID")
  if (!Number.isFinite(random) || random < 0 || random > 1) throw new Error("AGENT_CANCELLATION_RANDOM_INVALID")
  const capped = Math.min(maxMs, baseMs * (2 ** Math.min(attemptCount - 1, 30)))
  return Math.max(1, Math.min(maxMs, Math.floor(capped * (0.8 + random * 0.4))))
}
