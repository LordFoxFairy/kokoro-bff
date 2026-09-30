import type { AgentLaunch, BffIdentity } from "./types.js"

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
    body: {
      request_id: input.requestId,
      run_id: runId,
      session_id: input.sessionId,
      feature_key: "chat",
      message_id: userMessageId,
      content: input.content,
      selected_skill_source_refs: [],
      trace: {
        source: "kokoro-bff-scheduler",
        ...(input.projectRef === undefined ? {} : { project_ref: input.projectRef }),
      },
    },
    identityAssertionRef: `bff:${suffix}`,
    receipt: { run_id: runId, user_message_id: userMessageId, assistant_message_id: assistantMessageId },
  }
}
