import { zLaunchRequest } from "../../generated/agent-http/zod.gen.js"
import { isRecord } from "../../domain/json.js"
import { parseCustomApiProfileSelection } from "../../domain/chat/custom-api-profile-selection.js"
import { parseMcpConnectionSelection } from "../../domain/chat/mcp-connection-selection.js"
import { parseSkillSourceSelection } from "../../domain/chat/skill-source-selection.js"
import type { CanonicalResourceRef } from "../../domain/chat/resource-reference-selection.js"
import {
  AGENT_DISPATCH_SCHEMA_VERSION,
  assertAgentDispatchInput,
  type AgentDispatchInput,
  type AgentDispatchPayload,
  type AgentLaunchBody,
} from "../../domain/chat/agent-dispatch.js"
import { parseCanonicalResourceReferences } from "./resource-reference-manifest.js"

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

export function buildAgentDispatchPayload(
  input: AgentDispatchInput,
  ids: { runId: string; userMessageId: string },
  canonicalResourceRefs?: readonly CanonicalResourceRef[],
): AgentDispatchPayload {
  assertAgentDispatchInput(input)
  const resources = parseCanonicalResourceReferences(canonicalResourceRefs ?? [])
  if (
    resources === null ||
    JSON.stringify(resources.map(({ kind, resource_id }) => ({ kind, resource_id }))) !== JSON.stringify(input.selectedResourceRefs ?? [])
  )
    throw new Error("CHAT_RESOURCE_SELECTION_INVALID")
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
      ...(input.selectedCustomApiProfiles?.length
        ? {
            selected_custom_api_profiles: input.selectedCustomApiProfiles.map((profile) => ({ ...profile })),
          }
        : {}),
      ...(resources.length ? { selected_resource_refs: resources } : {}),
      ...(input.model === undefined ? {} : { requested_model_label: input.model }),
      trace,
    },
  }
}

/** Bind the exact owner Project values only after its parent/Conversation locks agree. */
export function bindAgentDispatchPayloadProjectScope(
  value: AgentDispatchPayload,
  canonicalProjectId: string | null,
  currentInstruction: string | null,
): AgentDispatchPayload {
  const payload = parseAgentDispatchPayload(value)
  if (payload.launch.project_instruction !== undefined) throw new Error("AGENT_DISPATCH_LINEAGE_MISMATCH")
  const { project_ref: _callerProjectRef, ...trace } = payload.launch.trace
  const projectInstruction =
    canonicalProjectId !== null && currentInstruction !== null && /\P{White_Space}/u.test(currentInstruction) ? currentInstruction : undefined
  return {
    ...payload,
    launch: {
      ...payload.launch,
      project_ref: canonicalProjectId,
      ...(projectInstruction === undefined ? {} : { project_instruction: projectInstruction }),
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
          "project_instruction",
          "personal_context",
          "shared_conversation_context",
          "selected_skill_source_refs",
          "selected_mcp_connection_ids",
          "selected_custom_api_profiles",
          "selected_resource_refs",
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
  const projectInstruction = launchValue.project_instruction
  if (
    projectInstruction !== undefined &&
    (executionProject === null ||
      typeof projectInstruction !== "string" ||
      !/\P{White_Space}/u.test(projectInstruction) ||
      /[\u0000\p{Surrogate}]/u.test(projectInstruction))
  )
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
  const selectedResourceRefs =
    launchValue.selected_resource_refs === undefined ? undefined : parseCanonicalResourceReferences(launchValue.selected_resource_refs)
  if (selectedResourceRefs === null) throw new Error("AGENT_DISPATCH_PAYLOAD_INVALID")
  const personal = zLaunchRequest.shape.personal_context.safeParse(launchValue.personal_context)
  if (!personal.success || (Object.hasOwn(launchValue, "personal_context") && personal.data == null)) throw new Error("AGENT_DISPATCH_PAYLOAD_INVALID")
  const shared = zLaunchRequest.shape.shared_conversation_context.safeParse(launchValue.shared_conversation_context)
  if (
    !shared.success ||
    (Object.hasOwn(launchValue, "shared_conversation_context") && shared.data == null) ||
    (shared.data && (shared.data.project_ref !== launchValue.project_ref || shared.data.conversation_id !== launchValue.session_id))
  )
    throw new Error("AGENT_DISPATCH_PAYLOAD_INVALID")
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
      ...(projectInstruction === undefined ? {} : { project_instruction: projectInstruction }),
      ...(personal.data == null ? {} : { personal_context: personal.data }),
      ...(shared.data == null ? {} : { shared_conversation_context: shared.data }),
      selected_skill_source_refs: selectedSkillSourceRefs,
      ...(selectedMcpConnectionIds === undefined ? {} : { selected_mcp_connection_ids: selectedMcpConnectionIds }),
      ...(selectedCustomApiProfiles === undefined ? {} : { selected_custom_api_profiles: selectedCustomApiProfiles }),
      ...(selectedResourceRefs === undefined ? {} : { selected_resource_refs: selectedResourceRefs }),
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
