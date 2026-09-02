import { createHash } from "node:crypto"

import type {
  ChatEvent,
  ChatMessage,
  ChatSessionDetail,
  ChatSessionSummary,
} from "../contracts/index.js"

export type BffIdentity = {
  namespace: string
  userId: string
}

export type AgentIdentityHeaders = {
  "x-kokoro-tenant-ref": string
  "x-kokoro-subject-ref": string
  "x-kokoro-actor-ref": string
  "x-kokoro-subject-kind": "user"
  "x-kokoro-actor-kind": "user"
  "x-kokoro-identity-assertion-ref": string
}

export type AgentLaunch = {
  body: Record<string, unknown>
  receipt: {
    run_id: string
    user_message_id: string
    assistant_message_id: string
  }
}

export type AgentControl = {
  kind: "run.cancel" | "run.resume" | "run.steer"
  session_id: string
  decisions?: unknown[]
  message_id?: string
  content?: string
}

export type AgentChatEvent = {
  chat_event_id: string
  session_id: string
  run_id: string
  chat_message_id?: string | null
  event_type: string
  payload_json: string
  seq: number
  created_at: number
}

export type AgentChatMessage = {
  chat_message_id: string
  session_id: string
  run_id: string
  role: "user" | "assistant"
  content: string
  status: "completed" | "failed"
  seq: number
  created_at: number
  updated_at: number
}

function digest(input: string): string {
  return createHash("sha256").update(input).digest("hex")
}

function jsonValue(value: unknown): unknown {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? value
    : Array.isArray(value)
      ? value.map(jsonValue)
      : typeof value === "object" && value !== null
        ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonValue(item)]))
        : String(value)
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys)
  return Object.keys(value).every((key) => allowed.has(key))
}

export function agentIdentityHeaders(identity: BffIdentity, assertionRef: string): AgentIdentityHeaders {
  return {
    "x-kokoro-tenant-ref": identity.namespace,
    "x-kokoro-subject-ref": identity.userId,
    "x-kokoro-actor-ref": identity.userId,
    "x-kokoro-subject-kind": "user",
    "x-kokoro-actor-kind": "user",
    "x-kokoro-identity-assertion-ref": assertionRef,
  }
}

export function buildAgentLaunch(input: {
  identity: BffIdentity
  requestId: string
  sessionId: string
  idempotencyKey: string
  content: string
  model?: string
  agent?: string
  thinking?: boolean
  pinnedSkills?: string[]
  mcpServers?: string[]
  projectRef?: string
}): AgentLaunch {
  // Derive all immutable ids from the idempotency key.  A BFF restart must
  // replay the same Agent run instead of admitting a second execution.
  const seed = [input.identity.namespace, input.identity.userId, input.sessionId, input.idempotencyKey].join("\u001f")
  const suffix = digest(seed)
  const runId = `run_bff_${suffix}`
  const userMessageId = `msg_bff_${suffix}_user`
  const assistantMessageId = `msg_bff_${suffix}_assistant`
  const trace: Record<string, unknown> = { source: "kokoro-bff" }
  if (input.projectRef !== undefined) trace.project_ref = input.projectRef
  if (input.agent !== undefined) trace.agent = input.agent
  if (input.thinking !== undefined) trace.thinking = input.thinking
  if (input.pinnedSkills !== undefined) trace.pinned_skills = [...input.pinnedSkills]
  if (input.mcpServers !== undefined) trace.mcp_servers = [...input.mcpServers]

  const body: Record<string, unknown> = {
    request_id: input.requestId,
    run_id: runId,
    session_id: input.sessionId,
    feature_key: "chat",
    execution_identity: {
      tenant_ref: input.identity.namespace,
      actor: { kind: "user", opaque_ref: input.identity.userId },
      subject: { kind: "user", opaque_ref: input.identity.userId },
      identity_assertion_ref: `bff:${suffix}`,
    },
    message_id: userMessageId,
    content: input.content,
    ...(input.model === undefined ? {} : { requested_model_label: input.model }),
    trace,
  }
  return {
    body,
    receipt: {
      run_id: runId,
      user_message_id: userMessageId,
      // The Agent derives the final assistant id from its native segment.
      // This stable provisional id preserves the existing Web receipt shape;
      // the final id arrives on assistant.delta/completed chat projections.
      assistant_message_id: assistantMessageId,
    },
  }
}

export function buildAgentControl(
  sessionId: string,
  body: Record<string, unknown>,
): AgentControl | null {
  const kind = body.kind
  if (kind === "run.cancel" && hasOnlyKeys(body, ["kind"])) {
    return { kind, session_id: sessionId }
  }
  if (kind === "run.resume" && hasOnlyKeys(body, ["kind", "decisions"]) && Array.isArray(body.decisions) && body.decisions.length > 0) {
    return { kind, session_id: sessionId, decisions: body.decisions.map(jsonValue) }
  }
  if (kind === "run.steer" && hasOnlyKeys(body, ["kind", "message_id", "content"]) && typeof body.message_id === "string" && typeof body.content === "string" && body.message_id.trim() !== "" && body.content.trim() !== "") {
    return { kind, session_id: sessionId, message_id: body.message_id, content: body.content }
  }
  return null
}

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

export function buildSessionSummary(identity: BffIdentity, sessionId: string, detail: ChatSessionDetail): ChatSessionSummary {
  return {
    session_id: sessionId,
    title: detail.session.title,
    updated_at: detail.session.updated_at,
  }
}
