import { parseCustomApiProfileSelection, type SelectedCustomApiProfile } from "./custom-api-profile-selection.js"
import { parseMcpConnectionSelection } from "./mcp-connection-selection.js"
import { isRecord } from "../json.js"
import { parseSkillSourceSelection } from "./skill-source-selection.js"

export const AGENT_DISPATCH_SCHEMA_VERSION = 3 as const

export type AgentLaunchBody = {
  request_id: string
  run_id: string
  session_id: string
  feature_key: "chat"
  message_id: string
  content: string
  project_ref: string | null
  selected_skill_source_refs: string[]
  selected_mcp_connection_ids?: string[]
  selected_custom_api_profiles?: SelectedCustomApiProfile[]
  requested_model_label?: string
  trace: {
    source: "kokoro-bff"
    project_ref?: string
    agent?: string
    thinking?: boolean
    mcp_servers?: string[]
  }
}

export type AgentDispatchPayload = {
  schema_version: typeof AGENT_DISPATCH_SCHEMA_VERSION
  launch: AgentLaunchBody
}

export type AgentDispatchReceipt = {
  run_id: string
  user_message_id: string
  assistant_message_id: string
}

export type AgentDispatchStatus = "pending" | "leased" | "retryable" | "admitted" | "terminal" | "failed"

export type AgentDispatchLease = {
  tenantId: string
  outboxId: string
  leaseOwner: string
  leaseToken: string
  fence: number
}

export type AgentDispatchCommand = AgentDispatchLease & {
  tenantId: string
  conversationId: string
  conversationDispatchSeq: string
  subjectId: string
  actorId: string
  requestId: string
  idempotencyKey: string
  requestDigest: string
  runId: string
  userMessageId: string
  assistantMessageId: string
  identityAssertionRef: string
  executionProjectRef: string | null
  payload: AgentDispatchPayload
  status: "leased"
  attemptCount: number
  admissionUnknownSeen: boolean
  leaseUntil: Date
  leaseRemainingMs: number
}

export type AgentDispatchInput = {
  tenantId: string
  conversationId: string
  projectRef?: string
  subjectId: string
  actorId: string
  requestId: string
  idempotencyKey: string
  content: string
  model?: string
  agent?: string
  thinking?: boolean
  selectedSkillSourceRefs?: string[]
  selectedMcpConnectionIds?: string[]
  selectedCustomApiProfiles?: SelectedCustomApiProfile[]
}

function requiredString(value: unknown, code: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(code)
  return value
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  if (value === undefined) return undefined
  return requiredString(value, "AGENT_DISPATCH_PAYLOAD_INVALID")
}

function optionalStringArray(record: Record<string, unknown>, key: string): string[] | undefined {
  const value = record[key]
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim() === "")) {
    throw new Error("AGENT_DISPATCH_PAYLOAD_INVALID")
  }
  return value.map((item) => String(item))
}

export function assertAgentDispatchInput(input: AgentDispatchInput): void {
  for (const value of [input.tenantId, input.conversationId, input.subjectId, input.actorId, input.requestId, input.idempotencyKey, input.content]) {
    if (value.trim() === "") throw new Error("CHAT_TURN_INPUT_INVALID")
  }
  for (const value of [input.projectRef, input.model, input.agent]) {
    if (value !== undefined && value.trim() === "") throw new Error("CHAT_TURN_INPUT_INVALID")
  }
  if (parseSkillSourceSelection(input.selectedSkillSourceRefs === undefined ? [] : input.selectedSkillSourceRefs) === null)
    throw new Error("CHAT_TURN_INPUT_INVALID")
  if (input.selectedMcpConnectionIds !== undefined && parseMcpConnectionSelection(input.selectedMcpConnectionIds) === null)
    throw new Error("CHAT_TURN_INPUT_INVALID")
  if (input.selectedCustomApiProfiles !== undefined && parseCustomApiProfileSelection(input.selectedCustomApiProfiles) === null)
    throw new Error("CHAT_TURN_INPUT_INVALID")
}

/** Stable command identity; payload changes are detected separately by requestDigest. */
export function agentDispatchIdentityMaterial(input: AgentDispatchInput): string {
  assertAgentDispatchInput(input)
  return [input.tenantId, input.subjectId, input.conversationId, input.idempotencyKey].join("\u001f")
}

/** Positional JSON keeps the semantic digest stable across object-key ordering. */
export function agentDispatchRequestMaterial(input: AgentDispatchInput): string {
  assertAgentDispatchInput(input)
  const material: unknown[] = [
    input.tenantId,
    input.conversationId,
    input.projectRef ?? null,
    input.subjectId,
    input.actorId,
    input.content,
    input.model ?? null,
    input.agent ?? null,
    input.thinking ?? null,
    input.selectedSkillSourceRefs ?? null,
    null, // Retired trace-only mcp_servers position; preserve old unselected digests.
  ]
  if (input.selectedMcpConnectionIds?.length) material.push({ selected_mcp_connection_ids: input.selectedMcpConnectionIds })
  if (input.selectedCustomApiProfiles?.length)
    material.push({
      selected_custom_api_profiles: input.selectedCustomApiProfiles.map(({ profile_id, expected_state_version }) => ({ profile_id, expected_state_version })),
    })
  return JSON.stringify(material)
}

export function buildAgentDispatchPayload(input: AgentDispatchInput, ids: { runId: string; userMessageId: string }): AgentDispatchPayload {
  assertAgentDispatchInput(input)
  const trace: AgentLaunchBody["trace"] = {
    source: "kokoro-bff",
    ...(input.projectRef === undefined ? {} : { project_ref: input.projectRef }),
    ...(input.agent === undefined ? {} : { agent: input.agent }),
    ...(input.thinking === undefined ? {} : { thinking: input.thinking }),
  }
  return {
    schema_version: AGENT_DISPATCH_SCHEMA_VERSION,
    launch: {
      request_id: input.requestId,
      run_id: ids.runId,
      session_id: input.conversationId,
      feature_key: "chat",
      message_id: ids.userMessageId,
      content: input.content,
      project_ref: input.projectRef ?? null,
      selected_skill_source_refs: [...(input.selectedSkillSourceRefs ?? [])],
      ...(input.selectedMcpConnectionIds?.length ? { selected_mcp_connection_ids: [...input.selectedMcpConnectionIds] } : {}),
      ...(input.selectedCustomApiProfiles?.length ? { selected_custom_api_profiles: input.selectedCustomApiProfiles.map((profile) => ({ ...profile })) } : {}),
      ...(input.model === undefined ? {} : { requested_model_label: input.model }),
      trace,
    },
  }
}

/** Bind the durable Conversation scope only after its parent/Conversation locks agree. */
export function bindAgentDispatchPayloadProjectScope(value: AgentDispatchPayload, canonicalProjectId: string | null): AgentDispatchPayload {
  const payload = parseAgentDispatchPayload(value)
  const { project_ref: _callerProjectRef, ...trace } = payload.launch.trace
  return {
    ...payload,
    launch: {
      ...payload.launch,
      project_ref: canonicalProjectId,
      trace: canonicalProjectId === null ? trace : { ...trace, project_ref: canonicalProjectId },
    },
  }
}

/** Parse JSONB before an outbox worker may call the Agent owner. */
export function parseAgentDispatchPayload(value: unknown): AgentDispatchPayload {
  if (!isRecord(value) || value.schema_version !== AGENT_DISPATCH_SCHEMA_VERSION || !isRecord(value.launch)) {
    throw new Error("AGENT_DISPATCH_PAYLOAD_INVALID")
  }
  if (Object.keys(value).some((key) => !["schema_version", "launch"].includes(key))) throw new Error("AGENT_DISPATCH_PAYLOAD_INVALID")
  const launchValue = value.launch
  if (
    Object.keys(launchValue).some(
      (key) =>
        ![
          "request_id",
          "run_id",
          "session_id",
          "feature_key",
          "message_id",
          "content",
          "project_ref",
          "selected_skill_source_refs",
          "selected_mcp_connection_ids",
          "selected_custom_api_profiles",
          "requested_model_label",
          "trace",
        ].includes(key),
    )
  )
    throw new Error("AGENT_DISPATCH_PAYLOAD_INVALID")
  if (!isRecord(launchValue.trace) || launchValue.feature_key !== "chat") throw new Error("AGENT_DISPATCH_PAYLOAD_INVALID")
  const executionProject = launchValue.project_ref
  if (executionProject !== null && (typeof executionProject !== "string" || !/^[^\s\x00-\x1f\x7f]{1,255}$/u.test(executionProject)))
    throw new Error("AGENT_DISPATCH_PAYLOAD_INVALID")
  const traceValue = launchValue.trace
  if (Object.keys(traceValue).some((key) => !["source", "project_ref", "agent", "thinking", "mcp_servers"].includes(key)))
    throw new Error("AGENT_DISPATCH_PAYLOAD_INVALID")
  if (traceValue.source !== "kokoro-bff") throw new Error("AGENT_DISPATCH_PAYLOAD_INVALID")
  const projectRef = optionalString(traceValue, "project_ref")
  const agent = optionalString(traceValue, "agent")
  const selectedSkillSourceRefs = parseSkillSourceSelection(launchValue.selected_skill_source_refs)
  if (selectedSkillSourceRefs === null) throw new Error("AGENT_DISPATCH_PAYLOAD_INVALID")
  // Historic trace remains diagnostic only; never promote it to execution refs.
  const mcpServers = optionalStringArray(traceValue, "mcp_servers")
  const selectedMcpConnectionIds =
    launchValue.selected_mcp_connection_ids === undefined ? undefined : parseMcpConnectionSelection(launchValue.selected_mcp_connection_ids)
  if (selectedMcpConnectionIds === null) throw new Error("AGENT_DISPATCH_PAYLOAD_INVALID")
  const selectedCustomApiProfiles =
    launchValue.selected_custom_api_profiles === undefined ? undefined : parseCustomApiProfileSelection(launchValue.selected_custom_api_profiles)
  if (selectedCustomApiProfiles === null) throw new Error("AGENT_DISPATCH_PAYLOAD_INVALID")
  const thinking = traceValue.thinking
  if (thinking !== undefined && typeof thinking !== "boolean") throw new Error("AGENT_DISPATCH_PAYLOAD_INVALID")
  const requestedModel = optionalString(launchValue, "requested_model_label")
  return {
    schema_version: AGENT_DISPATCH_SCHEMA_VERSION,
    launch: {
      request_id: requiredString(launchValue.request_id, "AGENT_DISPATCH_PAYLOAD_INVALID"),
      run_id: requiredString(launchValue.run_id, "AGENT_DISPATCH_PAYLOAD_INVALID"),
      session_id: requiredString(launchValue.session_id, "AGENT_DISPATCH_PAYLOAD_INVALID"),
      feature_key: "chat",
      message_id: requiredString(launchValue.message_id, "AGENT_DISPATCH_PAYLOAD_INVALID"),
      content: requiredString(launchValue.content, "AGENT_DISPATCH_PAYLOAD_INVALID"),
      project_ref: executionProject,
      selected_skill_source_refs: selectedSkillSourceRefs,
      ...(selectedMcpConnectionIds === undefined ? {} : { selected_mcp_connection_ids: selectedMcpConnectionIds }),
      ...(selectedCustomApiProfiles === undefined ? {} : { selected_custom_api_profiles: selectedCustomApiProfiles }),
      ...(requestedModel === undefined ? {} : { requested_model_label: requestedModel }),
      trace: {
        source: "kokoro-bff",
        ...(projectRef === undefined ? {} : { project_ref: projectRef }),
        ...(agent === undefined ? {} : { agent }),
        ...(thinking === undefined ? {} : { thinking }),
        ...(mcpServers === undefined ? {} : { mcp_servers: mcpServers }),
      },
    },
  }
}

export function agentDispatchRetryDelayMs(attemptCount: number, random: number, baseMs = 500, maxMs = 30_000): number {
  if (!Number.isSafeInteger(attemptCount) || attemptCount < 1) throw new Error("AGENT_DISPATCH_ATTEMPT_INVALID")
  if (!Number.isFinite(random) || random < 0 || random > 1) throw new Error("AGENT_DISPATCH_RANDOM_INVALID")
  const capped = Math.min(maxMs, baseMs * 2 ** Math.min(attemptCount - 1, 30))
  return Math.max(1, Math.min(maxMs, Math.floor(capped * (0.8 + random * 0.4))))
}
