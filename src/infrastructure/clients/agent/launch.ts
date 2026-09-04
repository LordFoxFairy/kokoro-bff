import { createHash } from "node:crypto"

import type { AgentLaunch, BffIdentity } from "./types.js"

function digest(input: string): string {
  return createHash("sha256").update(input).digest("hex")
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
    message_id: userMessageId,
    content: input.content,
    ...(input.model === undefined ? {} : { requested_model_label: input.model }),
    trace,
  }
  return {
    body,
    identityAssertionRef: `bff:${suffix}`,
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
