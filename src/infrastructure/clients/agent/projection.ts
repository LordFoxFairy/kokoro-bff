import { zChatEvent } from "../../../generated/agent-http/zod.gen.js"
import { parseAgentInteractionState } from "./interaction-state.js"
import type { ChatEvent, ChatMessage, ChatSessionDetail, ChatSessionSummary } from "../../../contracts/index.js"
import { parseAgentFailure } from "../../../generated/agent-http/failure-profile.gen.js"
import type { AgentChatEvent, AgentChatMessage, AgentEventPage, BffIdentity } from "./types.js"
import { parseAgentProcessPayload } from "./process-state.js"

function recordPayload(event: AgentChatEvent): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(event.payload_json)
  } catch {
    throw new Error("Agent chat projection payload is not JSON")
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("Agent chat projection payload is not an object")
  return parsed as Record<string, unknown>
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`Agent chat projection field ${label} is invalid`)
  return value
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`Agent chat projection field ${label} is invalid`)
  return value
}

function isoTime(value: number): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) throw new Error("Agent chat projection timestamp is invalid")
  return date.toISOString()
}

function baseEvent(event: AgentChatEvent, kind: string, payload: Record<string, unknown>): ChatEvent {
  return {
    event_id: nonEmptyString(event.chat_event_id, "chat_event_id"),
    seq: event.seq,
    session_id: nonEmptyString(event.session_id, "session_id"),
    run_id: nonEmptyString(event.run_id, "run_id"),
    kind,
    timestamp: isoTime(event.created_at),
    payload,
  }
}

const ARTIFACT_KINDS = new Set(["document", "code", "image", "audio", "video", "data", "archive", "other"])
const SHA256 = /^[0-9a-f]{64}$/u

function artifactKind(value: unknown): string {
  if (typeof value !== "string" || !ARTIFACT_KINDS.has(value)) throw new Error("Agent delivery artifact_kind is invalid")
  return value
}

function contentHash(value: unknown): string {
  if (typeof value !== "string" || !SHA256.test(value)) throw new Error("Agent delivery content_hash is invalid")
  return value
}

function deliverySize(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("Agent delivery size is invalid")
  return value
}

export function mapAgentEvent(event: AgentChatEvent): ChatEvent {
  const process = parseAgentProcessPayload(event.event_type, event.payload_json)
  if (process !== null) return baseEvent(event, process.kind, { ...process.value })
  const payload = recordPayload(event)
  const segmentId = event.chat_message_id ?? event.chat_event_id
  switch (event.event_type) {
    case "run.started":
      return baseEvent(event, "run.created", { run_id: event.run_id })
    case "assistant.delta":
      return baseEvent(event, "message.delta", {
        segment_id: nonEmptyString(segmentId, "chat_message_id"),
        delta: stringValue(payload.delta, "delta"),
      })
    case "assistant.completed":
      return baseEvent(event, "message.completed", {
        segment_id: nonEmptyString(segmentId, "chat_message_id"),
        content: stringValue(payload.content, "content"),
      })
    case "interaction.state":
      return baseEvent(event, "interaction.state", parseAgentInteractionState(payload))
    case "delivery":
      return baseEvent(event, "delivery.created", {
        tool_call_id: nonEmptyString(payload.tool_call_id, "tool_call_id"),
        artifact_id: nonEmptyString(payload.artifact_id, "artifact_id"),
        asset_id: nonEmptyString(payload.asset_id, "asset_id"),
        artifact_kind: artifactKind(payload.artifact_kind),
        path: nonEmptyString(payload.path, "path"),
        title: nonEmptyString(payload.title, "title"),
        mime: nonEmptyString(payload.mime, "mime"),
        size: deliverySize(payload.size),
        content_hash: contentHash(payload.content_hash),
        ...(typeof payload.note === "string" ? { note: payload.note } : {}),
      })
    case "run.completed":
      return baseEvent(event, "run.completed", {
        status: payload.status === "cancelled" ? "cancelled" : "completed",
        token_usage: payload.token_usage ?? null,
      })
    case "run.failed": {
      const failure = parseAgentFailure(payload)
      if (failure === null) throw new Error("Agent run failure payload is invalid")
      return baseEvent(event, "run.failed", {
        failure,
        message: "Agent run failed",
      })
    }
    default:
      throw new Error("Agent chat projection event type is unsupported")
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function agentEvent(value: unknown, expectedSessionId: string): AgentChatEvent | null {
  const result = zChatEvent.safeParse(value)
  if (!result.success || result.data.session_id !== expectedSessionId) return null
  const event = result.data
  return {
    chat_event_id: event.chat_event_id,
    session_id: event.session_id,
    run_id: event.run_id,
    source_index: event.source_index,
    event_type: event.event_type,
    payload_json: event.payload_json,
    seq: event.seq,
    created_at: event.created_at,
    ...(event.chat_message_id === undefined ? {} : { chat_message_id: event.chat_message_id }),
  }
}

export function agentEventList(value: unknown, expectedSessionId: string): AgentChatEvent[] | null {
  if (!Array.isArray(value)) return null
  const events: AgentChatEvent[] = []
  for (const candidate of value) {
    const parsed = agentEvent(candidate, expectedSessionId)
    if (parsed === null) return null
    events.push(parsed)
  }
  return events
}

export function agentEventPage(value: unknown, expectedSessionId: string, afterSequence: number, limit: number): AgentEventPage | null {
  const parsed = classifyAgentEventPage(value, expectedSessionId, afterSequence, limit)
  return parsed.kind === "page" ? parsed.page : null
}

export type AgentEventPageParse = { kind: "page"; page: AgentEventPage } | { kind: "gap" } | { kind: "invalid" }

/**
 * Distinguishes a temporarily incomplete Agent snapshot from a malformed
 * response.  A gap is retried by the durable projector; malformed identity or
 * metadata is recorded as a source-contract failure instead of being guessed.
 */
export function classifyAgentEventPage(value: unknown, expectedSessionId: string, afterSequence: number, limit: number): AgentEventPageParse {
  if (!isRecord(value) || !Number.isSafeInteger(afterSequence) || afterSequence < 0 || !Number.isSafeInteger(limit) || limit < 1) return { kind: "invalid" }

  const events = agentEventList(value.events, expectedSessionId)
  const nextSequence = value.next_seq
  const watermark = value.watermark
  if (
    events === null ||
    events.length > limit ||
    typeof nextSequence !== "number" ||
    !Number.isSafeInteger(nextSequence) ||
    typeof watermark !== "number" ||
    !Number.isSafeInteger(watermark) ||
    nextSequence < afterSequence ||
    watermark < nextSequence
  )
    return { kind: "invalid" }

  const eventIds = new Set<string>()
  let expectedSequence = afterSequence
  for (const event of events) {
    const requiredSequence = expectedSequence + 1
    if (eventIds.has(event.chat_event_id)) return { kind: "invalid" }
    if (event.seq !== requiredSequence) {
      return event.seq > requiredSequence ? { kind: "gap" } : { kind: "invalid" }
    }
    eventIds.add(event.chat_event_id)
    expectedSequence = event.seq
  }
  if (nextSequence !== expectedSequence) {
    return nextSequence > expectedSequence ? { kind: "gap" } : { kind: "invalid" }
  }
  if (events.length === 0 && watermark !== nextSequence) {
    return watermark > nextSequence ? { kind: "gap" } : { kind: "invalid" }
  }

  return {
    kind: "page",
    page: {
      events,
      nextSequence,
      watermark,
      exhausted: nextSequence === watermark,
    },
  }
}

export function mapAgentMessage(message: AgentChatMessage): ChatMessage {
  return {
    message_id: nonEmptyString(message.chat_message_id, "chat_message_id"),
    role: message.role,
    content: message.content,
    status: message.status,
    created_at: isoTime(message.created_at),
    run_id: message.run_id,
  }
}

export function buildSessionSummary(_identity: BffIdentity, _sessionId: string, detail: ChatSessionDetail): ChatSessionSummary {
  return {
    session_id: detail.session.session_id,
    title: detail.session.title,
    updated_at: detail.session.updated_at,
  }
}
