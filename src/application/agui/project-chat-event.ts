import type { ChatEvent } from "../../contracts/chat.js"
import { EventType } from "@ag-ui/core"

/**
 * AG-UI is the public streaming protocol. Kokoro-specific replay metadata is
 * carried under `metadata.kokoro`; the event discriminator and message/tool
 * fields stay compatible with @ag-ui/core and the Vercel integration.
 */
export type AgUiEventType =
  | EventType.RUN_STARTED
  | EventType.RUN_FINISHED
  | EventType.RUN_ERROR
  | EventType.TEXT_MESSAGE_START
  | EventType.TEXT_MESSAGE_CONTENT
  | EventType.TEXT_MESSAGE_END
  | EventType.TOOL_CALL_START
  | EventType.TOOL_CALL_ARGS
  | EventType.TOOL_CALL_END
  | EventType.TOOL_CALL_RESULT
  | EventType.CUSTOM

export type AgUiEvent = {
  type: AgUiEventType
  timestamp: number
  metadata: {
    kokoro: {
      event_id: string
      seq: number
      session_id: string
      run_id: string | null
      timestamp: string
    }
  }
  threadId?: string
  runId?: string
  messageId?: string
  role?: "assistant" | "tool"
  delta?: string
  toolCallId?: string
  toolCallName?: string
  parentMessageId?: string
  content?: string
  code?: string
  message?: string
  result?: unknown
  name?: string
  value?: unknown
  usage?: Array<Record<string, unknown>>
  isError?: boolean
  outcome?:
    | { type: "success" }
    | { type: "interrupt"; interrupts: Array<{ id: string; reason: string; message?: string }> }
  status?: string
}

export type AgUiProjectionState = {
  textMessages: Set<string>
  toolCalls: Set<string>
}

export function createAgUiProjectionState(): AgUiProjectionState {
  return { textMessages: new Set(), toolCalls: new Set() }
}

function timestampOf(event: ChatEvent): number {
  const timestamp = Date.parse(event.timestamp)
  return Number.isFinite(timestamp) ? timestamp : Date.now()
}

function metadataOf(event: ChatEvent): AgUiEvent["metadata"] {
  return {
    kokoro: {
      event_id: event.event_id,
      seq: event.seq,
      session_id: event.session_id,
      run_id: event.run_id,
      timestamp: event.timestamp,
    },
  }
}

function base(event: ChatEvent, type: AgUiEventType, fields: Omit<AgUiEvent, "type" | "timestamp" | "metadata"> = {}): AgUiEvent {
  return { type, timestamp: timestampOf(event), metadata: metadataOf(event), ...fields }
}

function stringField(payload: Record<string, unknown>, name: string, fallback = ""): string {
  return typeof payload[name] === "string" ? payload[name] : fallback
}

function recordField(payload: Record<string, unknown>, name: string): Record<string, unknown> {
  const value = payload[name]
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {}
}

function usageField(payload: Record<string, unknown>): Array<Record<string, unknown>> | undefined {
  const usage = recordField(payload, "token_usage")
  const inputTokens = usage.input_tokens
  const outputTokens = usage.output_tokens
  if (typeof inputTokens !== "number" || typeof outputTokens !== "number") return undefined
  return [{ inputTokens, outputTokens, totalTokens: inputTokens + outputTokens }]
}

function runStatePrefix(runId: string | null): string {
  return `${JSON.stringify(runId)}:`
}

function runStateKey(runId: string | null, localId: string): string {
  return `${runStatePrefix(runId)}${JSON.stringify(localId)}`
}

function clearRunState(state: AgUiProjectionState, runId: string | null): void {
  const prefix = runStatePrefix(runId)
  for (const key of state.textMessages) {
    if (key.startsWith(prefix)) state.textMessages.delete(key)
  }
  for (const key of state.toolCalls) {
    if (key.startsWith(prefix)) state.toolCalls.delete(key)
  }
}

/** Convert one internal BFF Chat event into canonical AG-UI event(s). */
export function projectChatEvent(event: ChatEvent, state: AgUiProjectionState): AgUiEvent[] {
  const payload = event.payload
  switch (event.kind) {
    case "session.created":
      return [base(event, EventType.CUSTOM, { name: "kokoro.session.created", value: payload })]
    case "run.created":
      return [base(event, EventType.RUN_STARTED, { threadId: event.session_id, runId: event.run_id ?? "" })]
    case "message.delta": {
      const messageId = stringField(payload, "segment_id", event.event_id)
      const stateKey = runStateKey(event.run_id, messageId)
      const events: AgUiEvent[] = []
      if (!state.textMessages.has(stateKey)) {
        state.textMessages.add(stateKey)
        events.push(base(event, EventType.TEXT_MESSAGE_START, { messageId, role: "assistant" }))
      }
      const delta = stringField(payload, "delta")
      // Always emit the content frame, including an empty delta. One internal
      // Chat event can expand to START + CONTENT; CONTENT marks the source
      // event as fully projected for replay purposes.
      events.push(base(event, EventType.TEXT_MESSAGE_CONTENT, { messageId, delta }))
      return events
    }
    case "message.completed": {
      const messageId = stringField(payload, "segment_id", event.event_id)
      state.textMessages.delete(runStateKey(event.run_id, messageId))
      return [base(event, EventType.TEXT_MESSAGE_END, { messageId })]
    }
    case "tool.invoked": {
      const toolCallId = stringField(payload, "tool_id", event.event_id)
      state.toolCalls.add(runStateKey(event.run_id, toolCallId))
      const args = JSON.stringify(recordField(payload, "args"))
      return [
        base(event, EventType.TOOL_CALL_START, {
          toolCallId,
          toolCallName: stringField(payload, "name", "tool"),
          parentMessageId: stringField(payload, "segment_id", event.event_id),
        }),
        base(event, EventType.TOOL_CALL_ARGS, { toolCallId, delta: args }),
      ]
    }
    case "tool.returned": {
      const toolCallId = stringField(payload, "tool_id", event.event_id)
      state.toolCalls.delete(runStateKey(event.run_id, toolCallId))
      return [
        base(event, EventType.TOOL_CALL_END, { toolCallId }),
        base(event, EventType.TOOL_CALL_RESULT, {
          messageId: stringField(payload, "segment_id", event.event_id),
          toolCallId,
          role: "tool",
          content: stringField(payload, "result"),
          isError: payload.is_error === true,
        }),
      ]
    }
    case "run.completed": {
      const usage = usageField(payload)
      const cancelled = stringField(payload, "status") === "cancelled"
      clearRunState(state, event.run_id)
      return [base(event, EventType.RUN_FINISHED, {
        threadId: event.session_id,
        runId: event.run_id ?? "",
        status: cancelled ? "cancelled" : "completed",
        ...(cancelled
          ? {
              result: { status: "cancelled" },
              outcome: {
                type: "interrupt",
                interrupts: [{ id: `cancelled:${event.event_id}`, reason: "cancelled", message: "Agent run cancelled" }],
              },
            }
          : { outcome: { type: "success" } }),
        ...(usage === undefined ? {} : { usage }),
      })]
    }
    case "run.failed":
      clearRunState(state, event.run_id)
      return [base(event, EventType.RUN_ERROR, {
        threadId: event.session_id,
        runId: event.run_id ?? "",
        message: stringField(payload, "message", "Agent run failed"),
        code: stringField(payload, "code", "internal_error"),
      })]
    case "tool.awaiting_approval":
      return [base(event, EventType.CUSTOM, { name: "kokoro.interaction.awaiting_approval", value: payload })]
    case "delivery.created":
      return [base(event, EventType.CUSTOM, { name: "kokoro.delivery.created", value: payload })]
    case "subagent.started":
      return [base(event, EventType.CUSTOM, { name: "kokoro.subagent.started", value: payload })]
    case "subagent.finished":
      return [base(event, EventType.CUSTOM, { name: "kokoro.subagent.finished", value: payload })]
    case "todo.updated":
      return [base(event, EventType.CUSTOM, { name: "kokoro.todo.updated", value: payload })]
    case "message.user":
      return [base(event, EventType.CUSTOM, { name: "kokoro.message.user", value: payload })]
    default:
      return []
  }
}
