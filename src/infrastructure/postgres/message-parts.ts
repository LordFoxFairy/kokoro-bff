import type { AgUiEvent } from "../../application/agui/project-chat-event.js"
import type { AgUiAssistantUpdate } from "../../application/agui/ports/agui-projection-repository.js"
import { parseAgentProcessPayload, sameAgentActivityIdentity, type AgentActivity } from "../clients/agent/process-state.js"

type Position = { part_id: string; first_sequence: string; latest_sequence: string }
export type MessageTextPart = Position & { kind: "text"; segment_id: string; text: string; completed: boolean }
export type MessageActivityPart = Position & { kind: "activity"; activity: AgentActivity }
export type MessagePart = MessageTextPart | MessageActivityPart
export type MessageParts = { parts: MessagePart[]; formatVersion: 1; publicSequence: string }
export type PositionedMessageFrame = { publicSequence: number; frame: AgUiEvent }

function invalid(): never {
  throw new Error("AGUI_MESSAGE_PARTS_INVALID")
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return invalid()
  return value as Record<string, unknown>
}

function keys(value: Record<string, unknown>, expected: string[]): void {
  if (Object.keys(value).sort().join(",") !== expected.sort().join(",")) invalid()
}

function sequence(value: unknown): string {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,18})$/u.test(value) || BigInt(value) > 9223372036854775807n) return invalid()
  return value
}

function identity(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") return invalid()
  return value
}

function activity(value: unknown): AgentActivity {
  try {
    const parsed = parseAgentProcessPayload("activity", JSON.stringify(value))
    if (parsed?.kind !== "activity.updated") return invalid()
    return parsed.value
  } catch {
    return invalid()
  }
}

/** NULL is legacy, never an unobserved but allegedly complete empty timeline. */
export function parseMessageParts(parts: unknown, formatVersion: unknown, publicSequence: unknown): MessageParts | null {
  if (parts === null && formatVersion === null && publicSequence === null) return null
  if (!Array.isArray(parts) || formatVersion !== 1) return invalid()
  const watermark = sequence(publicSequence)
  let previous = 0n
  const seen = new Set<string>()
  const decoded: MessagePart[] = parts.map((raw: unknown) => {
    const value = record(raw)
    const first = sequence(value.first_sequence)
    const latest = sequence(value.latest_sequence)
    if (BigInt(first) <= previous || BigInt(first) > BigInt(latest) || BigInt(latest) > BigInt(watermark)) return invalid()
    previous = BigInt(first)
    const partId = identity(value.part_id)
    if (seen.has(partId)) return invalid()
    seen.add(partId)
    const position = { part_id: partId, first_sequence: first, latest_sequence: latest }
    if (value.kind === "text") {
      keys(value, ["kind", "part_id", "first_sequence", "latest_sequence", "segment_id", "text", "completed"])
      const segmentId = identity(value.segment_id)
      if (partId !== `text:${segmentId}` || typeof value.text !== "string" || typeof value.completed !== "boolean") return invalid()
      return { ...position, kind: "text", segment_id: segmentId, text: value.text, completed: value.completed }
    }
    if (value.kind !== "activity") return invalid()
    keys(value, ["kind", "part_id", "first_sequence", "latest_sequence", "activity"])
    const safe = activity(value.activity)
    if (partId !== `activity:${safe.activity_id}`) return invalid()
    return { ...position, kind: "activity", activity: safe }
  })
  return { parts: decoded, formatVersion: 1, publicSequence: watermark }
}

/** Fold only this source's safe public frames after the owning transaction assigned their public positions. */
export function foldMessageParts(
  current: MessageParts | null,
  runId: string,
  frames: readonly PositionedMessageFrame[],
  update?: AgUiAssistantUpdate,
): MessageParts | null {
  if (current === null) return null
  const state = parseMessageParts(current.parts, current.formatVersion, current.publicSequence)
  if (state === null) return invalid()
  identity(runId)
  if (update !== undefined && update.runId !== runId) return invalid()
  const textUpdate = update !== undefined && "content" in update ? update : undefined
  if (textUpdate !== undefined) {
    identity(textUpdate.segmentId)
    if (typeof textUpdate.content !== "string" || typeof textUpdate.completed !== "boolean") return invalid()
  }
  let appliedText = false
  for (const { frame, publicSequence } of frames) {
    if (!Number.isSafeInteger(publicSequence) || publicSequence < 1 || BigInt(publicSequence) <= BigInt(state.publicSequence)) return invalid()
    const position = String(publicSequence)
    if (frame.metadata.kokoro.run_id !== runId || (frame.runId !== undefined && frame.runId !== runId)) return invalid()
    state.publicSequence = position
    if (frame.type === "TEXT_MESSAGE_START" || frame.type === "TEXT_MESSAGE_CONTENT" || frame.type === "TEXT_MESSAGE_END") {
      const segmentId = identity(frame.messageId)
      if (textUpdate === undefined || textUpdate.segmentId !== segmentId) return invalid()
      let part = state.parts.find((item): item is MessageTextPart => item.kind === "text" && item.segment_id === segmentId)
      if (frame.type === "TEXT_MESSAGE_START") {
        if (part !== undefined || textUpdate.completed || textUpdate.kind !== "replace") return invalid()
        state.parts.push({
          kind: "text",
          part_id: `text:${segmentId}`,
          segment_id: segmentId,
          first_sequence: position,
          latest_sequence: position,
          text: "",
          completed: false,
        })
      } else if (frame.type === "TEXT_MESSAGE_CONTENT") {
        if (part === undefined || part.completed || textUpdate.completed || frame.delta !== textUpdate.content || appliedText) return invalid()
        part.text += textUpdate.content
        part.latest_sequence = position
        appliedText = true
      } else {
        if (!textUpdate.completed || textUpdate.kind !== "replace" || appliedText) return invalid()
        if (part === undefined) {
          part = {
            kind: "text",
            part_id: `text:${segmentId}`,
            segment_id: segmentId,
            first_sequence: position,
            latest_sequence: position,
            text: "",
            completed: false,
          }
          state.parts.push(part)
        }
        part.text = textUpdate.content
        part.completed = true
        part.latest_sequence = position
        appliedText = true
      }
    } else if (frame.type === "CUSTOM" && frame.name === "kokoro.activity.updated") {
      const safe = activity(frame.value)
      const existing = state.parts.find((item): item is MessageActivityPart => item.kind === "activity" && item.activity.activity_id === safe.activity_id)
      if (existing === undefined) {
        state.parts.push({ kind: "activity", part_id: `activity:${safe.activity_id}`, first_sequence: position, latest_sequence: position, activity: safe })
      } else {
        if (!sameAgentActivityIdentity(existing.activity, safe)) return invalid()
        existing.activity = safe
        existing.latest_sequence = position
      }
    }
  }
  if (textUpdate !== undefined && !appliedText) return invalid()
  return state
}

/** Compatibility body is a byte-preserving projection, not another editable fact or final-phase guess. */
export function messagePartsContent(state: MessageParts): string {
  return state.parts
    .filter((part): part is MessageTextPart => part.kind === "text")
    .map((part) => part.text)
    .join("")
}
