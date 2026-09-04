import { isRecord } from "../json.js"

export const AGENT_DISPATCH_SCHEMA_VERSION = 1 as const

export type AgentLaunchBody = {
  request_id: string
  run_id: string
  session_id: string
  feature_key: "chat"
  message_id: string
  content: string
  requested_model_label?: string
  trace: {
    source: "kokoro-bff"
    project_ref?: string
    agent?: string
    thinking?: boolean
    pinned_skills?: string[]
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

export type AgentDispatchStatus = "pending" | "leased" | "retryable" | "succeeded" | "failed"

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
  subjectId: string
  actorId: string
  requestId: string
  idempotencyKey: string
  requestDigest: string
  runId: string
  userMessageId: string
  assistantMessageId: string
  identityAssertionRef: string
  payload: AgentDispatchPayload
  status: "leased"
  attemptCount: number
  leaseUntil: Date
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
  pinnedSkills?: string[]
  mcpServers?: string[]
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
  for (const value of [
    input.tenantId,
    input.conversationId,
    input.subjectId,
    input.actorId,
    input.requestId,
    input.idempotencyKey,
    input.content,
  ]) {
    if (value.trim() === "") throw new Error("CHAT_TURN_INPUT_INVALID")
  }
  for (const value of [input.projectRef, input.model, input.agent]) {
    if (value !== undefined && value.trim() === "") throw new Error("CHAT_TURN_INPUT_INVALID")
  }
  for (const values of [input.pinnedSkills, input.mcpServers]) {
    if (values?.some((value) => value.trim() === "")) throw new Error("CHAT_TURN_INPUT_INVALID")
  }
}

/** Stable command identity; payload changes are detected separately by requestDigest. */
export function agentDispatchIdentityMaterial(input: AgentDispatchInput): string {
  assertAgentDispatchInput(input)
  return [input.tenantId, input.subjectId, input.conversationId, input.idempotencyKey].join("\u001f")
}

/** Positional JSON keeps the semantic digest stable across object-key ordering. */
export function agentDispatchRequestMaterial(input: AgentDispatchInput): string {
  assertAgentDispatchInput(input)
  return JSON.stringify([
    input.tenantId,
    input.conversationId,
    input.projectRef ?? null,
    input.subjectId,
    input.actorId,
    input.content,
    input.model ?? null,
    input.agent ?? null,
    input.thinking ?? null,
    input.pinnedSkills ?? null,
    input.mcpServers ?? null,
  ])
}

export function buildAgentDispatchPayload(
  input: AgentDispatchInput,
  ids: { runId: string; userMessageId: string },
): AgentDispatchPayload {
  assertAgentDispatchInput(input)
  const trace: AgentLaunchBody["trace"] = {
    source: "kokoro-bff",
    ...(input.projectRef === undefined ? {} : { project_ref: input.projectRef }),
    ...(input.agent === undefined ? {} : { agent: input.agent }),
    ...(input.thinking === undefined ? {} : { thinking: input.thinking }),
    ...(input.pinnedSkills === undefined ? {} : { pinned_skills: [...input.pinnedSkills] }),
    ...(input.mcpServers === undefined ? {} : { mcp_servers: [...input.mcpServers] }),
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
      ...(input.model === undefined ? {} : { requested_model_label: input.model }),
      trace,
    },
  }
}

/** Parse JSONB before an outbox worker may call the Agent owner. */
export function parseAgentDispatchPayload(value: unknown): AgentDispatchPayload {
  if (!isRecord(value) || value.schema_version !== AGENT_DISPATCH_SCHEMA_VERSION || !isRecord(value.launch)) {
    throw new Error("AGENT_DISPATCH_PAYLOAD_INVALID")
  }
  const launchValue = value.launch
  if (!isRecord(launchValue.trace) || launchValue.feature_key !== "chat") throw new Error("AGENT_DISPATCH_PAYLOAD_INVALID")
  const traceValue = launchValue.trace
  if (traceValue.source !== "kokoro-bff") throw new Error("AGENT_DISPATCH_PAYLOAD_INVALID")
  const projectRef = optionalString(traceValue, "project_ref")
  const agent = optionalString(traceValue, "agent")
  const pinnedSkills = optionalStringArray(traceValue, "pinned_skills")
  const mcpServers = optionalStringArray(traceValue, "mcp_servers")
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
      ...(requestedModel === undefined ? {} : { requested_model_label: requestedModel }),
      trace: {
        source: "kokoro-bff",
        ...(projectRef === undefined ? {} : { project_ref: projectRef }),
        ...(agent === undefined ? {} : { agent }),
        ...(thinking === undefined ? {} : { thinking }),
        ...(pinnedSkills === undefined ? {} : { pinned_skills: pinnedSkills }),
        ...(mcpServers === undefined ? {} : { mcp_servers: mcpServers }),
      },
    },
  }
}

export function agentDispatchRetryDelayMs(attemptCount: number, random: number, baseMs = 500, maxMs = 30_000): number {
  if (!Number.isSafeInteger(attemptCount) || attemptCount < 1) throw new Error("AGENT_DISPATCH_ATTEMPT_INVALID")
  if (!Number.isFinite(random) || random < 0 || random > 1) throw new Error("AGENT_DISPATCH_RANDOM_INVALID")
  const capped = Math.min(maxMs, baseMs * (2 ** Math.min(attemptCount - 1, 30)))
  return Math.max(1, Math.min(maxMs, Math.floor(capped * (0.8 + random * 0.4))))
}
