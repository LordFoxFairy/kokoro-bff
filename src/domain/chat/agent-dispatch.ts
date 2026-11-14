import type { LaunchRequest } from "../../generated/agent-http/types.gen.js"
import { parseCustomApiProfileSelection, type SelectedCustomApiProfile } from "./custom-api-profile-selection.js"
import { parseMcpConnectionSelection } from "./mcp-connection-selection.js"
import { parseSkillSourceSelection } from "./skill-source-selection.js"
import { parseResourceReferenceSelection, type CanonicalResourceRef, type SelectedResourceRef } from "./resource-reference-selection.js"

export const AGENT_DISPATCH_SCHEMA_VERSION = 3 as const

export type AgentLaunchBody = {
  request_id: string
  run_id: string
  session_id: string
  feature_key: "chat"
  message_id: string
  content: string
  project_ref: string | null
  project_instruction?: string
  personal_context?: NonNullable<LaunchRequest["personal_context"]>
  shared_conversation_context?: NonNullable<LaunchRequest["shared_conversation_context"]>
  selected_skill_source_refs: string[]
  selected_mcp_connection_ids?: string[]
  selected_custom_api_profiles?: SelectedCustomApiProfile[]
  selected_resource_refs?: CanonicalResourceRef[]
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
  interruptRunId?: string
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
  selectedResourceRefs?: SelectedResourceRef[]
}

export function isInterruptRunId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}(?![\s\S])/u.test(value)
}

export function assertAgentDispatchInput(input: AgentDispatchInput): void {
  for (const value of [input.tenantId, input.conversationId, input.subjectId, input.actorId, input.requestId, input.idempotencyKey, input.content]) {
    if (value.trim() === "") throw new Error("CHAT_TURN_INPUT_INVALID")
  }
  for (const value of [input.projectRef, input.model, input.agent]) {
    if (value !== undefined && value.trim() === "") throw new Error("CHAT_TURN_INPUT_INVALID")
  }
  if (input.interruptRunId !== undefined && !isInterruptRunId(input.interruptRunId)) throw new Error("CHAT_TURN_INPUT_INVALID")
  if (parseSkillSourceSelection(input.selectedSkillSourceRefs === undefined ? [] : input.selectedSkillSourceRefs) === null)
    throw new Error("CHAT_TURN_INPUT_INVALID")
  if (input.selectedMcpConnectionIds !== undefined && parseMcpConnectionSelection(input.selectedMcpConnectionIds) === null)
    throw new Error("CHAT_TURN_INPUT_INVALID")
  if (input.selectedCustomApiProfiles !== undefined && parseCustomApiProfileSelection(input.selectedCustomApiProfiles) === null)
    throw new Error("CHAT_TURN_INPUT_INVALID")
  if (input.selectedResourceRefs !== undefined && parseResourceReferenceSelection(input.selectedResourceRefs) === null)
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
  if (input.selectedMcpConnectionIds?.length)
    material.push({
      selected_mcp_connection_ids: input.selectedMcpConnectionIds,
    })
  if (input.selectedCustomApiProfiles?.length)
    material.push({
      selected_custom_api_profiles: input.selectedCustomApiProfiles.map(({ profile_id, expected_state_version }) => ({
        profile_id,
        expected_state_version,
      })),
    })
  if (input.selectedResourceRefs?.length)
    material.push({
      selected_resource_refs: input.selectedResourceRefs.map((ref) => ({
        ...ref,
      })),
    })
  return JSON.stringify(input.interruptRunId === undefined ? material : ["message.interrupt:v1", input.interruptRunId, material])
}

export function agentDispatchRetryDelayMs(attemptCount: number, random: number, baseMs = 500, maxMs = 30_000): number {
  if (!Number.isSafeInteger(attemptCount) || attemptCount < 1) throw new Error("AGENT_DISPATCH_ATTEMPT_INVALID")
  if (!Number.isFinite(random) || random < 0 || random > 1) throw new Error("AGENT_DISPATCH_RANDOM_INVALID")
  const capped = Math.min(maxMs, baseMs * 2 ** Math.min(attemptCount - 1, 30))
  return Math.max(1, Math.min(maxMs, Math.floor(capped * (0.8 + random * 0.4))))
}
