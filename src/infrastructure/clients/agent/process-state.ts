import { safeSkillDisplays, safeVirtualPath } from "./display-safety.js"
import { Buffer } from "node:buffer"

import { zChatActivity, zChatTodo } from "../../../generated/agent-http/zod.gen.js"
import { AGENT_PROCESS_CONSTRAINTS } from "../../../generated/agent-http/process-profile.gen.js"

export type AgentTodo = Readonly<{
  todos: ReadonlyArray<Readonly<{ content: string; status: "pending" | "in_progress" | "completed" }>>
}>

export type AgentActivity =
  | Readonly<{
      activity: "tool"
      activity_id: string
      segment_id: string
      status: "running" | "completed" | "failed"
      display_code: Extract<ReturnType<typeof zChatActivity.parse>, { activity: "tool" }>["display_code"]
      display_detail?: NonNullable<Extract<ReturnType<typeof zChatActivity.parse>, { activity: "tool" }>["display_detail"]>
    }>
  | Readonly<{
      activity: "subagent"
      activity_id: string
      segment_id: string
      status: "running" | "completed" | "failed"
      display_code: "subagent.execution"
    }>
  | Readonly<{
      activity: "skill"
      activity_id: string
      preflight_id: string
      source_refs: ReadonlyArray<string>
      phase: "resolving" | "loading" | "ready" | "failed"
      display_skills?: NonNullable<Extract<ReturnType<typeof zChatActivity.parse>, { activity: "skill" }>["display_skills"]>
      error_code?: "skill_resolve_failed" | "skill_load_failed"
    }>

export type AgentProcessPayload = Readonly<{ kind: "todo.updated"; value: AgentTodo }> | Readonly<{ kind: "activity.updated"; value: AgentActivity }>

const ACTIVITY_ID = new RegExp(AGENT_PROCESS_CONSTRAINTS.activityId.pattern, "u")
const SEGMENT_ID = new RegExp(AGENT_PROCESS_CONSTRAINTS.segmentId.pattern, "u")
const PREFLIGHT_ID = new RegExp(AGENT_PROCESS_CONSTRAINTS.skill.preflightId.pattern, "u")
const SKILL_SOURCE_REF = new RegExp(AGENT_PROCESS_CONSTRAINTS.skill.sourceRefs.pattern, "u")
const FILE_DETAIL_NAME = new RegExp(AGENT_PROCESS_CONSTRAINTS.toolDetail.fileNamePattern, "u")
const DETAIL_FORBIDDEN = new RegExp("[" + AGENT_PROCESS_CONSTRAINTS.toolDetail.forbiddenCategories.map((category) => `\\p{${category}}`).join("") + "]", "u")

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
    if (activity.activity === "tool" && activity.display_detail !== undefined) {
      const { name, kind, virtual_path } = activity.display_detail
      if (virtual_path !== undefined && (kind !== "file" || !safeVirtualPath(virtual_path) || virtual_path.split("/").at(-1) !== name))
        throw Error("Agent virtual path is invalid")
      const domain = AGENT_PROCESS_CONSTRAINTS.toolDetail
      const length = unicodeScalarLength(name)
      const allowed: readonly string[] = domain.codesByKind[kind]
      if (
        length === null ||
        length < domain.minScalars ||
        length > domain.maxScalars ||
        Buffer.byteLength(name, "utf8") > domain.utf8ByteLimit ||
        name.normalize(domain.normalization) !== name ||
        DETAIL_FORBIDDEN.test(name) ||
        (kind === "file" && !FILE_DETAIL_NAME.test(name)) ||
        !allowed.includes(activity.display_code)
      )
        throw new Error("Agent activity detail does not match its public domain")
    }
    if (activity.activity === "tool") {
      const { display_detail, ...base } = activity
      return { ...base, ...(display_detail === undefined ? {} : { display_detail }) }
    }
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
  if (activity.display_skills !== undefined && (activity.phase !== "ready" || !safeSkillDisplays(activity.display_skills, activity.source_refs)))
    throw Error("Agent Skill display binding is invalid")
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
    ...(activity.display_skills === undefined ? {} : { display_skills: activity.display_skills }),
    ...(activity.error_code === undefined ? {} : { error_code: activity.error_code }),
  }
}

/** Decode only the two Agent5 process payloads; all other event payloads keep their existing decoders. */
export function parseAgentProcessPayload(eventType: string, payloadJson: string): AgentProcessPayload | null {
  if (eventType === "todo.updated") return { kind: "todo.updated", value: todoPayload(payloadJson) }
  if (eventType === "activity") return { kind: "activity.updated", value: activityPayload(payloadJson) }
  return null
}

/** Compare immutable tool/subagent presentation; Skill lifecycle revisions retain their original rules. */
export function sameAgentActivityIdentity(previous: AgentActivity, next: AgentActivity): boolean {
  if (previous.activity !== next.activity || previous.activity_id !== next.activity_id) return false
  if (previous.activity === "skill" || next.activity === "skill") return true
  if (previous.segment_id !== next.segment_id || previous.display_code !== next.display_code) return false
  if (previous.activity !== "tool" || next.activity !== "tool") return true
  return (
    Object.hasOwn(previous, "display_detail") === Object.hasOwn(next, "display_detail") &&
    previous.display_detail?.kind === next.display_detail?.kind &&
    previous.display_detail?.name === next.display_detail?.name &&
    previous.display_detail?.virtual_path === next.display_detail?.virtual_path
  )
}
