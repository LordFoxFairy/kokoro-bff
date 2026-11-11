import { createHash } from "node:crypto"
import { buildAgentDispatchPayload } from "../../../application/chat/agent-dispatch-payload.js"
import type { AgentLaunch, BffIdentity } from "./types.js"

/** One ordinary, browser-addressable conversation per tenant/task; no private alias. */
export function scheduledConversationId(tenantId: string, taskId: string): string {
  const hex = createHash("sha256")
    .update(JSON.stringify(["scheduled-conversation:v1", tenantId, taskId]))
    .digest("hex")
  return `conv_${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${((parseInt(hex[16]!, 16) & 3) | 8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

/** Scheduler launches use the occurrence identity, never actor or opaque delivery key, as their execution seed. */
export function buildScheduledAgentLaunch(input: {
  identity: BffIdentity
  requestId: string
  sessionId: string
  occurrenceIdentity: string
  content: string
  projectRef?: string
}): AgentLaunch {
  const suffix = input.occurrenceIdentity
  const runId = `run_bff_${suffix}`
  const userMessageId = `msg_bff_${suffix}_user`
  const assistantMessageId = `msg_bff_${suffix}_assistant`
  return {
    body: buildAgentDispatchPayload(
      {
        tenantId: input.identity.namespace,
        conversationId: input.sessionId,
        subjectId: input.identity.userId,
        actorId: input.identity.userId,
        requestId: input.requestId,
        idempotencyKey: input.occurrenceIdentity,
        content: input.content,
        ...(input.projectRef === undefined ? {} : { projectRef: input.projectRef }),
      },
      { runId, userMessageId },
    ).launch,
    identityAssertionRef: `bff:${suffix}`,
    receipt: { run_id: runId, user_message_id: userMessageId, assistant_message_id: assistantMessageId },
  }
}
