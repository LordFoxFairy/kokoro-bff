import { Buffer } from "node:buffer"

import { zChatActivity, zChatTodo } from "../../../generated/agent-http/zod.gen.js"
import { AGENT_PROCESS_CONSTRAINTS } from "../../../generated/agent-http/process-profile.gen.js"

export type AgentTodo = Readonly<{
  todos: ReadonlyArray<Readonly<{ content: string; status: "pending" | "in_progress" | "completed" }>>
}>

export type AgentActivity =
  | Readonly<{
      activity: "tool" | "subagent"
      activity_id: string
      segment_id: string
      status: "running" | "completed" | "failed"
      display_code: "tool.execution" | "subagent.execution"
    }>
  | Readonly<{
      activity: "skill"
      activity_id: string
      preflight_id: string
      source_refs: ReadonlyArray<string>
      phase: "resolving" | "loading" | "ready" | "failed"
      error_code?: "skill_resolve_failed" | "skill_load_failed"
    }>

export type AgentProcessPayload = Readonly<{ kind: "todo.updated"; value: AgentTodo }> | Readonly<{ kind: "activity.updated"; value: AgentActivity }>

const ACTIVITY_ID = new RegExp(AGENT_PROCESS_CONSTRAINTS.activityId.pattern, "u")
const SEGMENT_ID = new RegExp(AGENT_PROCESS_CONSTRAINTS.segmentId.pattern, "u")
const PREFLIGHT_ID = new RegExp(AGENT_PROCESS_CONSTRAINTS.skill.preflightId.pattern, "u")
const SKILL_SOURCE_REF = new RegExp(AGENT_PROCESS_CONSTRAINTS.skill.sourceRefs.pattern, "u")

function jsonPayload(payloadJson: string): unknown {
  try {
    return JSON.parse(payloadJson) as unknown
  } catch {
    throw new Error("Agent process payload is not JSON")
  }
}

function unicodeScalarLength(value: string): number | null {
  let length = 0
  for (const scalar of value) {
    const codePoint = scalar.codePointAt(0)
    if (codePoint === undefined || (codePoint >= 0xd800 && codePoint <= 0xdfff)) return null
    length += 1
  }
  return length
}

function todoPayload(payloadJson: string): AgentTodo {
  if (Buffer.byteLength(payloadJson, "utf8") > AGENT_PROCESS_CONSTRAINTS.todo.jsonByteLimit) {
    throw new Error("Agent Todo payload exceeds its byte limit")
  }
  const result = zChatTodo.safeParse(jsonPayload(payloadJson))
  if (!result.success) throw new Error("Agent Todo payload does not match its contract")
  for (const todo of result.data.todos) {
    const length = unicodeScalarLength(todo.content)
    if (length === null || length < AGENT_PROCESS_CONSTRAINTS.todo.content.minScalars || length > AGENT_PROCESS_CONSTRAINTS.todo.content.maxScalars) {
      throw new Error("Agent Todo content is not bounded Unicode scalar text")
    }
  }
  return result.data
}

function activityPayload(payloadJson: string): AgentActivity {
  const result = zChatActivity.safeParse(jsonPayload(payloadJson))
  if (!result.success) throw new Error("Agent activity payload does not match its contract")
  const activity = result.data
  if (!ACTIVITY_ID.test(activity.activity_id)) throw new Error("Agent activity identity is invalid")
  if (activity.activity === "tool" || activity.activity === "subagent") {
    if (!SEGMENT_ID.test(activity.segment_id)) throw new Error("Agent activity segment identity is invalid")
    return activity
  }
  if (!PREFLIGHT_ID.test(activity.preflight_id)) throw new Error("Agent Skill preflight identity is invalid")
  if (
    (AGENT_PROCESS_CONSTRAINTS.skill.sourceRefs.uniqueItems && new Set(activity.source_refs).size !== activity.source_refs.length) ||
    activity.source_refs.some((sourceRef) => !SKILL_SOURCE_REF.test(sourceRef)) ||
    Buffer.byteLength(JSON.stringify(activity.source_refs), "utf8") > AGENT_PROCESS_CONSTRAINTS.skill.sourceRefs.jsonByteLimit
  ) {
    throw new Error("Agent Skill source references are invalid")
  }
  const hasErrorCode = Object.hasOwn(activity, "error_code")
  if ((activity.phase === AGENT_PROCESS_CONSTRAINTS.skill.failedPhase) !== hasErrorCode) {
    throw new Error("Agent Skill failure code presence is invalid")
  }
  return {
    activity: "skill",
    activity_id: activity.activity_id,
    preflight_id: activity.preflight_id,
    source_refs: activity.source_refs,
    phase: activity.phase,
    ...(activity.error_code === undefined ? {} : { error_code: activity.error_code }),
  }
}

/** Decode only the two Agent5 process payloads; all other event payloads keep their existing decoders. */
export function parseAgentProcessPayload(eventType: string, payloadJson: string): AgentProcessPayload | null {
  if (eventType === "todo.updated") return { kind: "todo.updated", value: todoPayload(payloadJson) }
  if (eventType === "activity") return { kind: "activity.updated", value: activityPayload(payloadJson) }
  return null
}
