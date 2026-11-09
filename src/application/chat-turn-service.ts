import { parseCanonicalResourceReferences, type CanonicalResourceRef, type SelectedResourceRef } from "../domain/chat/resource-reference-selection.js"
import type { RegenerateMessageInput, RegenerationReceipt } from "./chat/message-regeneration.js"
import { parseSkillSourceSelection } from "../domain/chat/skill-source-selection.js"
import {
  agentDispatchIdentityMaterial,
  agentDispatchRequestMaterial,
  buildAgentDispatchPayload,
  type AgentDispatchInput,
  type AgentDispatchReceipt,
} from "../domain/chat/agent-dispatch.js"
import type { CommitChatTurn } from "./agent-dispatch/agent-dispatch-outbox-repository.js"
import type { AgentDispatchOutboxRepository } from "./agent-dispatch/agent-dispatch-outbox-repository.js"

export const CHAT_TURN_TOTAL_BUDGET_MS = 4500

export type ResolveSelectedResources = (
  input: Readonly<{
    tenantId: string
    subjectId: string
    requestId: string
    projectId: string | null
    refs: readonly SelectedResourceRef[]
  }>,
  lifetime: NonNullable<CommitChatTurn["lifetime"]>,
) => Promise<CanonicalResourceRef[]>

export class ChatTurnApplicationService {
  public constructor(
    private readonly repository: AgentDispatchOutboxRepository,
    private readonly stableIdGenerator: Readonly<{
      generate(material: string): string
    }>,
    private readonly resolveSelectedResources?: ResolveSelectedResources,
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
      ...(frozen.selected_mcp_connection_ids === undefined
        ? {}
        : {
            selectedMcpConnectionIds: [...frozen.selected_mcp_connection_ids],
          }),
      ...(frozen.selected_custom_api_profiles === undefined
        ? {}
        : {
            selectedCustomApiProfiles: frozen.selected_custom_api_profiles.map((profile) => ({ ...profile })),
          }),
      ...(frozen.selected_resource_refs === undefined
        ? {}
        : {
            selectedResourceRefs: frozen.selected_resource_refs.map(({ kind, resource_id }) => ({ kind, resource_id })),
          }),
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
      payload: buildAgentDispatchPayload(next, { runId, userMessageId }, frozen.selected_resource_refs),
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
    resolveProjectSkills?: (projectId: string, installationIds: string[], lifetime: NonNullable<CommitChatTurn["lifetime"]>) => Promise<string[]>,
    lifetime?: NonNullable<CommitChatTurn["lifetime"]>,
  ): Promise<AgentDispatchReceipt | null> {
    const controller = new AbortController()
    const signal = lifetime === undefined ? controller.signal : AbortSignal.any([controller.signal, lifetime.signal])
    const deadlineAt = Math.min(performance.now() + CHAT_TURN_TOTAL_BUDGET_MS, lifetime?.deadlineAt ?? Infinity)
    const admissionLifetime = { signal, deadlineAt }
    const check = (): void => {
      if (!Number.isFinite(deadlineAt) || performance.now() >= deadlineAt) controller.abort(new Error("CHAT_TURN_BUDGET_EXHAUSTED"))
      signal.throwIfAborted()
    }
    check()
    const timer = setTimeout(() => controller.abort(new Error("CHAT_TURN_BUDGET_EXHAUSTED")), Math.max(0, deadlineAt - performance.now()))
    const within = async <T>(start: () => Promise<T>): Promise<T> => {
      check()
      let onAbort!: () => void
      const interrupted = new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(signal.reason)
      })
      signal.addEventListener("abort", onAbort, { once: true })
      try {
        check()
        const result = await Promise.race([start(), interrupted])
        check()
        return result
      } finally {
        signal.removeEventListener("abort", onAbort)
      }
    }
    try {
      const suffix = this.stableIdGenerator.generate(agentDispatchIdentityMaterial(input))
      // The same connector intent must bind both digest and payload across awaited defaults.
      if (input.selectedMcpConnectionIds !== undefined)
        input = {
          ...input,
          selectedMcpConnectionIds: [...input.selectedMcpConnectionIds],
        }
      if (input.selectedCustomApiProfiles !== undefined)
        input = {
          ...input,
          selectedCustomApiProfiles: input.selectedCustomApiProfiles.map((profile) => ({ ...profile })),
        }
      if (input.selectedResourceRefs !== undefined)
        input = {
          ...input,
          selectedResourceRefs: input.selectedResourceRefs.map((ref) => ({
            ...ref,
          })),
        }
      const runId = `run_bff_${suffix}`
      const userMessageId = `msg_bff_${suffix}_user`
      const assistantMessageId = `msg_bff_${suffix}_assistant`
      const requestDigest = this.stableIdGenerator.generate(agentDispatchRequestMaterial(input))
      const current = await within(() =>
        this.repository.prepareChatTurnSelection({
          ...input,
          requestDigest,
          lifetime: admissionLifetime,
        }),
      )
      check()
      if (current === null) return null
      if (current.kind === "replay") return current.receipt
      let skillSelection: { projectId: string | null; installationIds: string[] } | undefined
      let selectedSkillSourceRefs = input.selectedSkillSourceRefs
      if (selectedSkillSourceRefs === undefined) {
        skillSelection = {
          projectId: current.projectId,
          installationIds: current.installationIds,
        }
        if (current.installationIds.length === 0) selectedSkillSourceRefs = []
        else {
          const projectId = current.projectId
          const resolve = resolveProjectSkills
          if (projectId === null || resolve === undefined) throw new Error("CHAT_SKILL_SELECTION_UNAVAILABLE")
          selectedSkillSourceRefs = await within(() => resolve(projectId, current.installationIds, admissionLifetime))
          if (parseSkillSourceSelection(selectedSkillSourceRefs) === null || selectedSkillSourceRefs.length !== current.installationIds.length)
            throw new Error("CHAT_SKILL_SELECTION_INVALID")
        }
      }
      let resources: CanonicalResourceRef[] = []
      if (input.selectedResourceRefs?.length) {
        const resolve = this.resolveSelectedResources
        if (resolve === undefined) throw new Error("CHAT_RESOURCE_SELECTION_UNAVAILABLE")
        const resolved = await within(() =>
          resolve(
            {
              tenantId: input.tenantId,
              subjectId: input.subjectId,
              requestId: input.requestId,
              projectId: current.projectId,
              refs: input.selectedResourceRefs!,
            },
            admissionLifetime,
          ),
        )
        const parsed = parseCanonicalResourceReferences(resolved)
        if (parsed === null || JSON.stringify(parsed.map(({ kind, resource_id }) => ({ kind, resource_id }))) !== JSON.stringify(input.selectedResourceRefs))
          throw new Error("CHAT_RESOURCE_SELECTION_INVALID")
        resources = parsed
      }
      check()
      // Once commit is invoked, its bounded owner lifetime classifies dispatched COMMIT/ACK loss.
      // Do not race it with another rejection that could mask CHAT_TURN_COMMIT_UNKNOWN.
      const receipt = await this.repository.commitChatTurn({
        lifetime: admissionLifetime,
        outboxId: `agent_outbox_${suffix.slice(0, 32)}`,
        tenantId: input.tenantId,
        conversationId: input.conversationId,
        ...(input.projectRef === undefined ? {} : { projectRef: input.projectRef }),
        ...(input.interruptRunId === undefined ? {} : { interruptRunId: input.interruptRunId }),
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
        ...(resources.length ? { resourceSelection: { projectId: current.projectId } } : {}),
        payload: buildAgentDispatchPayload({ ...input, selectedSkillSourceRefs }, { runId, userMessageId }, resources),
      })
      check()
      return receipt
    } finally {
      clearTimeout(timer)
    }
  }
}
