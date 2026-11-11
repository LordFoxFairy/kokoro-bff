import { performance } from "node:perf_hooks"
import type { ScheduledAgentDispatchDeliveryPort, ScheduledAgentDeliveryResult } from "../../application/scheduled/scheduled-agent-dispatch-delivery.js"
import type { AgentDispatchOutboxRepository } from "../../application/agent-dispatch/agent-dispatch-outbox-repository.js"
import type { ScheduledAgentDispatchCommand } from "../../domain/scheduled-task/agent-dispatch.js"
import { type AgentDispatchInput } from "../../domain/chat/agent-dispatch.js"
import { buildAgentDispatchPayload, parseAgentDispatchPayload } from "../../application/chat/agent-dispatch-payload.js"

/** Scheduled activation only queues the ordinary Chat turn; it never sends Agent HTTP. */
export class ScheduledChatSubmission implements ScheduledAgentDispatchDeliveryPort {
  public constructor(private readonly chat: Pick<AgentDispatchOutboxRepository, "commitChatTurn">) {}

  public async deliver(command: ScheduledAgentDispatchCommand, timeoutMs: number): Promise<ScheduledAgentDeliveryResult> {
    let frozen
    try {
      frozen = parseAgentDispatchPayload({ schema_version: 3, launch: command.payload }).launch
    } catch {
      return { outcome: "not_admitted", errorCode: "scheduled_snapshot_invalid" }
    }
    if (
      frozen.run_id !== command.runId ||
      frozen.session_id !== command.conversationId ||
      frozen.message_id !== command.userMessageId ||
      frozen.request_id !== command.requestId
    )
      return { outcome: "not_admitted", errorCode: "scheduled_snapshot_invalid" }
    const content = frozen.content
    const projectRef = frozen.project_ref
    const input: AgentDispatchInput = {
      tenantId: command.tenantId,
      conversationId: command.conversationId,
      subjectId: command.subjectId,
      actorId: command.subjectId,
      requestId: command.requestId,
      idempotencyKey: command.idempotencyKey,
      content,
      ...(projectRef === null ? {} : { projectRef }),
    }
    try {
      const receipt = await this.chat.commitChatTurn({
        ...input,
        outboxId: `scheduled_chat_${command.dispatchId}`,
        requestDigest: command.requestDigest,
        runId: command.runId,
        userMessageId: command.userMessageId,
        assistantMessageId: command.assistantMessageId,
        identityAssertionRef: command.identityAssertionRef,
        payload: buildAgentDispatchPayload(input, command),
        scheduledActivation: {
          tenantId: command.tenantId,
          taskId: command.taskId,
          dispatchId: command.dispatchId,
          runId: command.runId,
          leaseOwner: command.leaseOwner,
          leaseToken: command.leaseToken,
          fence: command.fence,
        },
        lifetime: { signal: new AbortController().signal, deadlineAt: performance.now() + timeoutMs },
      })
      return receipt === null ? { outcome: "not_admitted", errorCode: "scheduled_conversation_unavailable" } : { outcome: "submitted" }
    } catch (error) {
      if (error instanceof Error && (error.message === "CHAT_TURN_PROJECT_NOT_FOUND" || error.message === "SCHEDULED_ACTIVATION_LOST"))
        return { outcome: "not_admitted", errorCode: "scheduled_activation_unavailable" }
      return { outcome: "unknown", errorCode: "scheduled_chat_submission_unknown" }
    }
  }
}
