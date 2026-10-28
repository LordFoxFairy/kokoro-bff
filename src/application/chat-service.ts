import type { MessageFeedbackQuery, SetMessageFeedback } from "./chat/message-feedback-input.js"
import type { ArchivedTasksQuery, ArchiveStateQuery, ArchiveStateCommand } from "./ports/chat-repository.js"
import type { ChatMessageRead, ChatSessionDetail, PrivateChatSessionDetail, ChatSessionSummary } from "../contracts/index.js"
import type { PrivateMessageReadContext, MessagePartsQuery, MessageReadLifetime } from "./ports/chat-repository.js"
import type { ChatRepository, ConversationCollectionFilter, SharedTasksPosition, SharedTasksRead } from "./ports/chat-repository.js"
import { createHash } from "node:crypto"
import { mutationScope } from "./idempotency.js"
import type { RequestContext } from "../domain/request-context.js"
import { privateChatMessage, conversationSummary } from "./chat/mappers.js"

export class ChatApplicationService {
  public readMessageFeedback(input: MessageFeedbackQuery) {
    return this.repository.readMessageFeedback(input)
  }
  public setMessageFeedback(input: SetMessageFeedback) {
    return this.repository.setMessageFeedback(input)
  }
  private readonly repository: ChatRepository

  public listOwnedArchivedTasks(query: ArchivedTasksQuery) {
    return this.repository.listOwnedArchivedTasks(query)
  }
  public readArchiveState(query: ArchiveStateQuery) {
    return this.repository.readArchiveState(query)
  }
  public changeArchiveState(command: ArchiveStateCommand) {
    return this.repository.changeArchiveState(command)
  }

  public constructor(repository: ChatRepository) {
    this.repository = repository
  }

  public listOwnedSharedTasks(
    tenantId: string,
    subjectId: string,
    limit: number,
    position: SharedTasksPosition | null,
    signal: AbortSignal,
    deadlineAt: number,
  ): Promise<SharedTasksRead> {
    return this.repository.listOwnedSharedTasks(tenantId, subjectId, limit, position, signal, deadlineAt)
  }

  public async listConversations(
    tenantId: string,
    subjectId: string,
    filter: ConversationCollectionFilter,
    limit: number,
    cursor: string | null,
  ): Promise<{ sessions: ChatSessionSummary[]; next_cursor: string | null }> {
    const page = await this.repository.listConversations(tenantId, subjectId, filter, limit, cursor)
    return { sessions: page.conversations.map(conversationSummary), next_cursor: page.next_cursor }
  }

  public async findConversation(
    tenantId: string,
    subjectId: string,
    conversationId: string,
    projectRef: string | undefined,
    lifetime?: MessageReadLifetime,
  ): Promise<ChatSessionDetail["session"] | null> {
    const conversation = await (lifetime === undefined
      ? this.repository.findConversation(tenantId, subjectId, conversationId, projectRef)
      : this.repository.findConversation(tenantId, subjectId, conversationId, projectRef, lifetime))
    if (conversation === null) return null
    return {
      session_id: conversation.conversationId,
      title: conversation.title,
      owner_id: conversation.ownerId,
      created_at: conversation.createdAt.toISOString(),
      updated_at: conversation.updatedAt.toISOString(),
    }
  }

  public async snapshot(
    tenantId: string,
    subjectId: string,
    conversationId: string,
    projectRef: string | undefined,
    context?: PrivateMessageReadContext,
  ): Promise<PrivateChatSessionDetail | null> {
    const snapshot = await (context === undefined
      ? this.repository.readSnapshot(tenantId, subjectId, conversationId, projectRef)
      : this.repository.readSnapshot(tenantId, subjectId, conversationId, projectRef, context))
    if (snapshot === null) return null
    const { conversation, messages, deliveries, deliveriesHasMore, eventWatermark, executionHead, executionProcess } = snapshot
    return {
      session: {
        session_id: conversation.conversationId,
        title: conversation.title,
        owner_id: conversation.ownerId,
        created_at: conversation.createdAt.toISOString(),
        updated_at: conversation.updatedAt.toISOString(),
      },
      ...(messages.length === 0 ? {} : { messages: messages.map(privateChatMessage) }),
      files: [],
      deliveries: deliveries.map((delivery) => ({
        conversation_id: delivery.conversationId,
        artifact_id: delivery.artifactId,
        asset_id: delivery.assetId,
        artifact_kind: delivery.artifactKind,
        title: delivery.title,
        mime: delivery.mime,
        size: delivery.size,
        run_id: delivery.runId,
        created_at: delivery.deliveredAt.toISOString(),
      })),
      deliveries_has_more: deliveriesHasMore,
      event_watermark: eventWatermark,
      execution_process: executionProcess,
      ...(executionHead === undefined
        ? {}
        : { execution_head: { run_id: executionHead.runId, state: executionHead.state, pending_pauses: executionHead.pendingPauses } }),
    }
  }

  public readRunProcessPage(
    tenantId: string,
    subjectId: string,
    conversationId: string,
    runId: string,
    projectRef: string | undefined,
    watermark: string,
    cursor: string | null,
    limit: number,
  ): ReturnType<ChatRepository["readRunProcessPage"]> {
    return this.repository.readRunProcessPage(tenantId, subjectId, conversationId, runId, projectRef, watermark, cursor, limit)
  }

  public readRunControlState(
    tenantId: string,
    subjectId: string,
    conversationId: string,
    projectRef: string | undefined,
  ): ReturnType<ChatRepository["readRunControlState"]> {
    return this.repository.readRunControlState(tenantId, subjectId, conversationId, projectRef)
  }

  public async listMessages(
    tenantId: string,
    subjectId: string,
    conversationId: string,
    limit: number,
    cursor: string | null,
    projectRef?: string,
    context?: PrivateMessageReadContext,
  ): Promise<{ messages: ChatMessageRead[]; next_cursor: string | null } | null> {
    const page = await (context === undefined
      ? this.repository.listMessages(tenantId, subjectId, conversationId, limit, cursor, projectRef)
      : this.repository.listMessages(tenantId, subjectId, conversationId, limit, cursor, projectRef, context))
    return page === null ? null : { messages: page.messages.map(privateChatMessage), next_cursor: page.next_cursor }
  }

  public readMessageParts(query: MessagePartsQuery): ReturnType<ChatRepository["readMessageParts"]> {
    return this.repository.readMessageParts(query)
  }

  public renameConversation(
    tenantId: string,
    subjectId: string,
    conversationId: string,
    title: string,
    projectRef?: string,
  ): ReturnType<ChatRepository["renameConversation"]> {
    return this.repository.renameConversation(tenantId, subjectId, conversationId, title, projectRef)
  }

  public moveConversation(context: RequestContext, conversationId: string, targetProjectId: string | null, key: string, signal: AbortSignal) {
    const scope = mutationScope(context, "POST", `/sessions/${conversationId}/move`, key)
    const fingerprint = createHash("sha256")
      .update(JSON.stringify(["moveSession", targetProjectId]))
      .digest("hex")
    return this.repository.moveConversation({
      tenantId: context.identity.namespace,
      subjectId: context.identity.userId,
      conversationId,
      targetProjectId,
      scope,
      fingerprint,
      signal,
    })
  }

  public deleteConversation(
    tenantId: string,
    subjectId: string,
    conversationId: string,
    requestId: string,
    projectRef?: string,
  ): ReturnType<ChatRepository["deleteConversation"]> {
    return this.repository.deleteConversation(tenantId, subjectId, conversationId, requestId, projectRef)
  }

  public createShare(tenantId: string, subjectId: string, conversationId: string, projectRef?: string): ReturnType<ChatRepository["createShare"]> {
    return this.repository.createShare(tenantId, subjectId, conversationId, projectRef)
  }

  public revokeShare(tenantId: string, subjectId: string, conversationId: string, projectRef?: string): ReturnType<ChatRepository["revokeShare"]> {
    return this.repository.revokeShare(tenantId, subjectId, conversationId, projectRef)
  }
}
