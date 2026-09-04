import { createHash } from "node:crypto"

import { EventSchemas, EventType } from "@ag-ui/core"

export type AgentDispatchFailureProjection = {
  sourceOwner: "kokoro-bff"
  sourceEventId: string
  sourceSequence: string
  sourceDigest: string
  sourceOccurredAt: string
  frameType: typeof EventType.RUN_ERROR
  framePayload: unknown
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value)
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("AGENT_DISPATCH_FAILURE_EVENT_INVALID")
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (typeof value !== "object" || value === null) throw new Error("AGENT_DISPATCH_FAILURE_EVENT_INVALID")
  const record = Object.fromEntries(Object.entries(value))
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`
}

export function agentDispatchFailureProjection(input: {
  outboxId: string
  conversationId: string
  conversationDispatchSeq: string
  runId: string
  errorCode: string
  failedAt: string
}): AgentDispatchFailureProjection {
  if (
    input.outboxId.trim() === ""
    || input.conversationId.trim() === ""
    || input.runId.trim() === ""
    || input.errorCode.trim() === ""
    || !/^[1-9][0-9]*$/u.test(input.conversationDispatchSeq)
  ) throw new Error("AGENT_DISPATCH_FAILURE_EVENT_INVALID")
  const failedAt = new Date(input.failedAt)
  if (!Number.isFinite(failedAt.getTime())) throw new Error("AGENT_DISPATCH_FAILURE_EVENT_INVALID")
  const sourceEventId = `dispatch_failure:${input.outboxId}`
  const framePayload = EventSchemas.parse({
    type: EventType.RUN_ERROR,
    timestamp: failedAt.getTime(),
    threadId: input.conversationId,
    runId: input.runId,
    message: "Agent launch could not be confirmed",
    code: input.errorCode,
    metadata: {
      kokoro: {
        event_id: sourceEventId,
        seq: input.conversationDispatchSeq,
        session_id: input.conversationId,
        run_id: input.runId,
        timestamp: failedAt.toISOString(),
        source_owner: "kokoro-bff",
      },
    },
  })
  return {
    sourceOwner: "kokoro-bff",
    sourceEventId,
    sourceSequence: input.conversationDispatchSeq,
    sourceDigest: createHash("sha256").update(canonicalJson(framePayload)).digest("hex"),
    sourceOccurredAt: failedAt.toISOString(),
    frameType: EventType.RUN_ERROR,
    framePayload,
  }
}
