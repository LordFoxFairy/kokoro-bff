import { z } from "zod"
import { parseAgentFailure } from "../../generated/agent-http/failure-profile.gen.js"

const timestamp = z.string().datetime({ offset: true })
const baseKeys = ["event_id", "seq", "session_id", "run_id", "timestamp", "public_sequence"]

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function positiveDecimal(value: unknown): value is string {
  return typeof value === "string" && /^[1-9][0-9]{0,18}$(?![\s\S])/u.test(value) && BigInt(value) <= 9223372036854775807n
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}

/** Read projection only: never rewrite source payloads or derive a position from source seq/cursor. */
export function agUiReplayPayload(payload: unknown, publicSequence: string, eventType: string): Record<string, unknown> {
  const invalid = (): never => {
    throw new Error("AGUI_REPLAY_METADATA_INVALID")
  }
  if (!positiveDecimal(publicSequence) || !record(payload) || payload.type !== eventType || !record(payload.metadata)) return invalid()
  if (Object.keys(payload.metadata).some((key) => key !== "kokoro") || !record(payload.metadata.kokoro)) return invalid()
  const owner = payload.metadata.kokoro
  if (!nonempty(owner.event_id) || !nonempty(owner.session_id) || !timestamp.safeParse(owner.timestamp).success) return invalid()
  if (Object.hasOwn(owner, "public_sequence") && owner.public_sequence !== publicSequence) return invalid()
  if (Object.hasOwn(owner, "source_owner")) {
    if (owner.source_owner !== "kokoro-bff" || !positiveDecimal(owner.seq) || !nonempty(owner.run_id)) return invalid()
    if (Object.keys(owner).some((key) => !baseKeys.includes(key) && key !== "source_owner")) return invalid()
  } else {
    if (typeof owner.seq !== "number" || !Number.isSafeInteger(owner.seq) || owner.seq < 0 || (owner.run_id !== null && !nonempty(owner.run_id)))
      return invalid()
    if (Object.keys(owner).some((key) => !baseKeys.includes(key) && key !== "failure")) return invalid()
    if (Object.hasOwn(owner, "failure")) {
      const failure = owner.failure
      if (!record(failure) || failure.source !== "agent" || Object.keys(failure).sort().join(",") !== "code,retryable,source") return invalid()
      if (parseAgentFailure({ status: "failed", code: failure.code, retryable: failure.retryable }) === null) return invalid()
    }
  }
  return { ...payload, metadata: { kokoro: { ...owner, public_sequence: publicSequence } } }
}
