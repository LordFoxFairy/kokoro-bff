import type { ChatEvent, ChatMessage, ChatSessionDetail, ChatSessionSummary } from "../../contracts/index.js"
import type { AgentChatEvent, AgentChatMessage, BffIdentity } from "./types.js"

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

function sourceOf(value: unknown): "built-in" | "config-custom" | "runtime-custom" {
  if (value === "built-in" || value === "config-custom" || value === "runtime-custom") return value
  throw new Error("Agent subagent source is invalid")
}

const WEB_FAILURE_CODES = new Set([
  "token_budget_exceeded",
  "recursion_limit_exceeded",
  "assembly_failed",
  "enqueue_failed",
  "dispatch_exhausted",
  "contract_incompatible",
  "internal_error",
])

export function mapAgentEvent(event: AgentChatEvent): ChatEvent | null {
  const payload = recordPayload(event)
  const segmentId = event.chat_message_id ?? event.chat_event_id
  switch (event.event_type) {
    case "run.started":
      return baseEvent(event, "run.created", { run_id: event.run_id })
    case "assistant.delta":
      return baseEvent(event, "message.delta", {
        segment_id: nonEmptyString(segmentId, "chat_message_id"),
        delta: typeof payload.delta === "string" ? payload.delta : "",
      })
    case "assistant.completed":
      return baseEvent(event, "message.completed", {
        segment_id: nonEmptyString(segmentId, "chat_message_id"),
        content: typeof payload.content === "string" ? payload.content : "",
      })
    case "activity": {
      const activity = payload.activity
      if (activity === "tool") {
        const toolId = nonEmptyString(payload.tool_id, "tool_id")
        const toolPayload = {
          segment_id: nonEmptyString(payload.segment_id, "segment_id"),
          tool_id: toolId,
          name: nonEmptyString(payload.name, "name"),
        }
        if (payload.status === "started") return baseEvent(event, "tool.invoked", { ...toolPayload, args: {} })
        return baseEvent(event, "tool.returned", {
          ...toolPayload,
          result: typeof payload.result === "string" ? payload.result : "",
          is_error: payload.is_error === true,
          ...(payload.truncated === true ? { truncated: true } : {}),
        })
      }
      if (activity === "subagent") {
        const subagentPayload = {
          segment_id: nonEmptyString(payload.segment_id, "segment_id"),
          subagent_id: nonEmptyString(payload.subagent_id, "subagent_id"),
          name: nonEmptyString(payload.name, "name"),
          subagent_type: nonEmptyString(payload.subagent_type, "subagent_type"),
          source: sourceOf(payload.source),
        }
        if (payload.status === "started") return baseEvent(event, "subagent.started", {
          ...subagentPayload,
          description: typeof payload.description === "string" ? payload.description : "",
        })
        return baseEvent(event, "subagent.finished", {
          ...subagentPayload,
          ...(payload.status === "failed" ? { failed: true } : {}),
          ...(typeof payload.error === "string" ? { error: payload.error } : {}),
        })
      }
      return null
    }
    case "interaction":
      return baseEvent(event, "tool.awaiting_approval", {
        segment_id: nonEmptyString(payload.segment_id, "segment_id"),
        tool_id: nonEmptyString(payload.tool_id, "tool_id"),
        name: nonEmptyString(payload.name, "name"),
        args: {},
        description: typeof payload.description === "string" ? payload.description : "",
        allowed_decisions: Array.isArray(payload.allowed_decisions) ? payload.allowed_decisions : [],
        kind: nonEmptyString(payload.kind, "kind"),
        editable: payload.editable === true,
        pending_tool_ids: Array.isArray(payload.pending_tool_ids) ? payload.pending_tool_ids : [],
        ...(typeof payload.result === "string" ? { result: payload.result } : {}),
        ...(typeof payload.input_schema === "object" && payload.input_schema !== null && !Array.isArray(payload.input_schema) ? { input_schema: payload.input_schema } : {}),
        ...(typeof payload.risk === "object" && payload.risk !== null && !Array.isArray(payload.risk) ? { risk: payload.risk } : {}),
      })
    case "delivery":
      return baseEvent(event, "delivery.created", {
        path: nonEmptyString(payload.path, "path"),
        title: nonEmptyString(payload.title, "title"),
        mime: nonEmptyString(payload.mime, "mime"),
        size: typeof payload.size === "number" ? payload.size : 0,
        content_hash: nonEmptyString(payload.content_hash, "content_hash"),
        ...(typeof payload.note === "string" ? { note: payload.note } : {}),
      })
    case "run.completed":
      return baseEvent(event, "run.completed", {
        status: payload.status === "cancelled" ? "cancelled" : "completed",
        token_usage: payload.token_usage ?? null,
      })
    case "run.failed":
      return baseEvent(event, "run.failed", {
        code: typeof payload.code === "string" && WEB_FAILURE_CODES.has(payload.code) ? payload.code : "internal_error",
        error_kind: "agent_error",
        message: "Agent run failed",
      })
    default:
      return null
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

export function buildSessionDetail(
  identity: BffIdentity,
  sessionId: string,
  messages: AgentChatMessage[],
  events: AgentChatEvent[],
  watermark: number,
): ChatSessionDetail {
  const mappedEvents = events.map(mapAgentEvent).filter((event): event is ChatEvent => event !== null)
  const mappedMessages = messages.map(mapAgentMessage)
  const firstCreated = messages[0]?.created_at ?? Date.now()
  const latest = messages.reduce((value, item) => Math.max(value, item.updated_at), firstCreated)
  const lastByRun = new Map<string, ChatEvent>()
  for (const event of mappedEvents) lastByRun.set(event.run_id ?? "", event)
  const active = [...lastByRun.values()].reverse().find((event) => event.kind !== "run.completed" && event.kind !== "run.failed")
  const title = mappedMessages.find((message) => message.role === "user")?.content.slice(0, 80) || "Kokoro chat"
  return {
    session: {
      session_id: sessionId,
      title,
      owner_id: identity.namespace,
      created_at: isoTime(firstCreated),
      updated_at: isoTime(latest),
    },
    messages: mappedMessages,
    ...(active === undefined ? {} : { active_run: { run_id: active.run_id ?? "", status: "running" } }),
    pending_pauses: mappedEvents.filter((event) => event.kind === "tool.awaiting_approval").map((event) => event.payload),
    files: [],
    deliveries: mappedEvents.filter((event) => event.kind === "delivery.created").map((event) => ({
      ...(event.payload as { content_hash: string; path: string; title: string; mime: string; size: number }),
      run_id: event.run_id ?? sessionId,
      created_at: event.timestamp,
    })),
    event_watermark: watermark,
  }
}

export function buildSessionSummary(_identity: BffIdentity, _sessionId: string, detail: ChatSessionDetail): ChatSessionSummary {
  return {
    session_id: detail.session.session_id,
    title: detail.session.title,
    updated_at: detail.session.updated_at,
  }
}
