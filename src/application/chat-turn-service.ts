import { parseSkillSourceSelection } from "../domain/chat/skill-source-selection.js"
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

  public async submit(
    input: AgentDispatchInput,
    resolveProjectSkills?: (projectId: string, installationIds: string[]) => Promise<string[]>,
    signal?: AbortSignal,
  ): Promise<AgentDispatchReceipt | null> {
    signal?.throwIfAborted()
    const suffix = this.stableIdGenerator.generate(agentDispatchIdentityMaterial(input))
    const runId = `run_bff_${suffix}`
    const userMessageId = `msg_bff_${suffix}_user`
    const assistantMessageId = `msg_bff_${suffix}_assistant`
    const requestDigest = this.stableIdGenerator.generate(agentDispatchRequestMaterial(input))
    let skillSelection: { projectId: string | null; installationIds: string[] } | undefined
    let selectedSkillSourceRefs = input.selectedSkillSourceRefs
    if (selectedSkillSourceRefs === undefined) {
      const current = await this.repository.prepareChatTurnSelection({ ...input, requestDigest })
      signal?.throwIfAborted()
      if (current === null) return null
      if (current.kind === "replay") return current.receipt
      skillSelection = { projectId: current.projectId, installationIds: current.installationIds }
      if (current.installationIds.length === 0) selectedSkillSourceRefs = []
      else {
        if (current.projectId === null || resolveProjectSkills === undefined) throw new Error("CHAT_SKILL_SELECTION_UNAVAILABLE")
        selectedSkillSourceRefs = await resolveProjectSkills(current.projectId, current.installationIds)
        if (parseSkillSourceSelection(selectedSkillSourceRefs) === null || selectedSkillSourceRefs.length !== current.installationIds.length)
          throw new Error("CHAT_SKILL_SELECTION_INVALID")
      }
    }
    signal?.throwIfAborted()
    return this.repository.commitChatTurn({
      outboxId: `agent_outbox_${suffix.slice(0, 32)}`,
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      ...(input.projectRef === undefined ? {} : { projectRef: input.projectRef }),
      subjectId: input.subjectId,
      actorId: input.actorId,
      requestId: input.requestId,
      idempotencyKey: input.idempotencyKey,
      requestDigest,
      runId,
      userMessageId,
      assistantMessageId,
      identityAssertionRef: `bff:${suffix}`,
      content: input.content,
      ...(skillSelection === undefined ? {} : { skillSelection }),
      payload: buildAgentDispatchPayload({ ...input, selectedSkillSourceRefs }, { runId, userMessageId }),
    })
  }
}
