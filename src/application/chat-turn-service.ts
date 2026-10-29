import type { RegenerateMessageInput, RegenerationReceipt } from "./chat/message-regeneration.js"
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

  public async regenerate(input: RegenerateMessageInput): Promise<RegenerationReceipt | null> {
    input.signal.throwIfAborted()
    const source = await this.repository.readRegenerationSource(input)
    input.signal.throwIfAborted()
    if (source === null) return null
    const frozen = source.payload.launch
    const next: AgentDispatchInput = {
      tenantId: input.tenantId,
      subjectId: input.subjectId,
      actorId: input.actorId,
      conversationId: input.conversationId,
      requestId: input.requestId,
      idempotencyKey: input.idempotencyKey,
      content: source.content,
      selectedSkillSourceRefs: [...frozen.selected_skill_source_refs],
      ...(frozen.selected_mcp_connection_ids === undefined ? {} : { selectedMcpConnectionIds: [...frozen.selected_mcp_connection_ids] }),
      ...(frozen.selected_custom_api_profiles === undefined
        ? {}
        : { selectedCustomApiProfiles: frozen.selected_custom_api_profiles.map((profile) => ({ ...profile })) }),
      ...(frozen.requested_model_label === undefined ? {} : { model: frozen.requested_model_label }),
      ...(frozen.trace.agent === undefined ? {} : { agent: frozen.trace.agent }),
      ...(frozen.trace.thinking === undefined ? {} : { thinking: frozen.trace.thinking }),
    }
    const suffix = this.stableIdGenerator.generate(agentDispatchIdentityMaterial(next))
    const runId = `run_bff_${suffix}`,
      userMessageId = `msg_bff_${suffix}_user`,
      assistantMessageId = `msg_bff_${suffix}_assistant`
    const receipt = await this.repository.commitChatTurn({
      outboxId: `agent_outbox_${suffix.slice(0, 32)}`,
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      subjectId: input.subjectId,
      actorId: input.actorId,
      requestId: input.requestId,
      idempotencyKey: input.idempotencyKey,
      requestDigest: this.stableIdGenerator.generate(JSON.stringify(["message.regenerate:v1", input.sourceMessageId, agentDispatchRequestMaterial(next)])),
      runId,
      userMessageId,
      assistantMessageId,
      identityAssertionRef: `bff:${suffix}`,
      content: source.content,
      regeneration: {
        sourceMessageId: source.sourceMessageId,
        originalUserMessageId: source.originalUserMessageId,
        sourceRunId: source.sourceRunId,
        sourceFingerprint: source.sourceFingerprint,
      },
      lifetime: { signal: input.signal, deadlineAt: input.deadlineAt },
      payload: buildAgentDispatchPayload(next, { runId, userMessageId }),
    })
    return receipt === null
      ? null
      : {
          run_id: receipt.run_id,
          user_message_id: source.originalUserMessageId,
          assistant_message_id: receipt.assistant_message_id,
          regenerated_from_message_id: source.sourceMessageId,
        }
  }

  public async submit(
    input: AgentDispatchInput,
    resolveProjectSkills?: (projectId: string, installationIds: string[]) => Promise<string[]>,
    signal?: AbortSignal,
  ): Promise<AgentDispatchReceipt | null> {
    signal?.throwIfAborted()
    const suffix = this.stableIdGenerator.generate(agentDispatchIdentityMaterial(input))
    // The same connector intent must bind both digest and payload across awaited defaults.
    if (input.selectedMcpConnectionIds !== undefined) input = { ...input, selectedMcpConnectionIds: [...input.selectedMcpConnectionIds] }
    if (input.selectedCustomApiProfiles !== undefined)
      input = { ...input, selectedCustomApiProfiles: input.selectedCustomApiProfiles.map((profile) => ({ ...profile })) }
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
