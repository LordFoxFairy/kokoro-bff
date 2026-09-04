import {
  agentDispatchIdentityMaterial,
  agentDispatchRequestMaterial,
  buildAgentDispatchPayload,
  type AgentDispatchInput,
  type AgentDispatchReceipt,
} from "../domain/chat/agent-dispatch.js"
import type { AgentDispatchOutboxRepository } from "./ports/agent-dispatch-outbox-repository.js"
import type { StableIdGenerator } from "./ports/stable-id-generator.js"

export class ChatTurnApplicationService {
  public constructor(
    private readonly repository: AgentDispatchOutboxRepository,
    private readonly stableIdGenerator: StableIdGenerator,
  ) {}

  public submit(input: AgentDispatchInput): Promise<AgentDispatchReceipt | null> {
    const suffix = this.stableIdGenerator.generate(agentDispatchIdentityMaterial(input))
    const runId = `run_bff_${suffix}`
    const userMessageId = `msg_bff_${suffix}_user`
    const assistantMessageId = `msg_bff_${suffix}_assistant`
    return this.repository.commitChatTurn({
      outboxId: `agent_outbox_${suffix.slice(0, 32)}`,
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      ...(input.projectRef === undefined ? {} : { projectRef: input.projectRef }),
      subjectId: input.subjectId,
      actorId: input.actorId,
      requestId: input.requestId,
      idempotencyKey: input.idempotencyKey,
      requestDigest: this.stableIdGenerator.generate(agentDispatchRequestMaterial(input)),
      runId,
      userMessageId,
      assistantMessageId,
      identityAssertionRef: `bff:${suffix}`,
      content: input.content,
      payload: buildAgentDispatchPayload(input, { runId, userMessageId }),
    })
  }
}
