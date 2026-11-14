import type { MessageReadLifetime } from "./types.js"
import type { ChatMessageRead, MessagePartsPage, PrivateChatSessionDetail, ChatSessionSummary } from "../../contracts/index.js"
import type { ChatSnapshot, ConversationCollectionFilter, ConversationPage, MessagePartsQuery, PrivateMessagePage, PrivateMessageReadContext } from "./types.js"
import type { ShareMetadataQuery, ShareMetadataRead } from "./types.js"
import { privateChatMessage, conversationSummary } from "./mappers.js"

type ChatSessionReadSource = {
  readShareMetadata(query: ShareMetadataQuery): Promise<ShareMetadataRead | null>
  listConversations(
    tenantId: string,
    subjectId: string,
    filter: ConversationCollectionFilter,
    limit: number,
    cursor: string | null,
    lifetime?: MessageReadLifetime,
  ): Promise<ConversationPage>
  readSnapshot(
    tenantId: string,
    subjectId: string,
    conversationId: string,
    projectRef: string | undefined,
    context?: PrivateMessageReadContext,
  ): Promise<ChatSnapshot | null>
  listMessages(
    tenantId: string,
    subjectId: string,
    conversationId: string,
    limit: number,
    cursor: string | null,
    projectRef?: string,
    context?: PrivateMessageReadContext,
  ): Promise<PrivateMessagePage | null>
  readMessageParts(query: MessagePartsQuery): Promise<MessagePartsPage | null>
}

export function createChatSessionReads(source: ChatSessionReadSource) {
  return {
    readShareMetadata(query: ShareMetadataQuery): Promise<ShareMetadataRead | null> {
      return source.readShareMetadata(query)
    },

    async listConversations(
      tenantId: string,
      subjectId: string,
      filter: ConversationCollectionFilter,
      limit: number,
      cursor: string | null,
      lifetime?: MessageReadLifetime,
    ): Promise<{ sessions: ChatSessionSummary[]; next_cursor: string | null }> {
      const page = await source.listConversations(tenantId, subjectId, filter, limit, cursor, lifetime)
      return { sessions: page.conversations.map(conversationSummary), next_cursor: page.next_cursor }
    },

    async snapshot(
      tenantId: string,
      subjectId: string,
      conversationId: string,
      projectRef: string | undefined,
      context?: PrivateMessageReadContext,
    ): Promise<PrivateChatSessionDetail | null> {
      const snapshot = await (context === undefined
        ? source.readSnapshot(tenantId, subjectId, conversationId, projectRef)
        : source.readSnapshot(tenantId, subjectId, conversationId, projectRef, context))
      if (snapshot === null) return null
      const { conversation, messages, deliveries, deliveriesHasMore, eventWatermark, executionHead, executionProcess, composerSelection } = snapshot
      return {
        ...(snapshot.projectAccess === undefined ? {} : { project_access: snapshot.projectAccess }),
        session: {
          session_id: conversation.conversationId,
          title: conversation.title,
          owner_id: conversation.ownerId,
          created_at: conversation.createdAt.toISOString(),
          updated_at: conversation.updatedAt.toISOString(),
        },
        ...(messages.length === 0 ? {} : { messages: messages.map(privateChatMessage) }),
        ...(composerSelection === undefined ? {} : { composer_selection: composerSelection }),
        files: [],
        deliveries: deliveries.map((delivery) => ({
          conversation_id: delivery.conversationId,
          artifact_id: delivery.artifactId,
          ...(delivery.assetId === undefined ? {} : { asset_id: delivery.assetId }),
          artifact_kind: delivery.artifactKind,
          title: delivery.title,
          mime: delivery.mime,
          size: delivery.size,
          run_id: delivery.runId,
          created_at: delivery.deliveredAt.toISOString(),
          ...(delivery.displayPath === undefined ? {} : { display_path: delivery.displayPath }),
        })),
        deliveries_has_more: deliveriesHasMore,
        event_watermark: eventWatermark,
        execution_process: executionProcess,
        ...(executionHead === undefined
          ? {}
          : {
              execution_head: {
                run_id: executionHead.runId,
                state: executionHead.state,
                pending_pauses: executionHead.pendingPauses,
                ...(executionHead.canControl === undefined ? {} : { can_control: executionHead.canControl }),
              },
            }),
      }
    },

    async listMessages(
      tenantId: string,
      subjectId: string,
      conversationId: string,
      limit: number,
      cursor: string | null,
      projectRef?: string,
      context?: PrivateMessageReadContext,
    ): Promise<{ messages: ChatMessageRead[]; next_cursor: string | null; project_access?: import("../../domain/project/access.js").ProjectAccess } | null> {
      const page = await (context === undefined
        ? source.listMessages(tenantId, subjectId, conversationId, limit, cursor, projectRef)
        : source.listMessages(tenantId, subjectId, conversationId, limit, cursor, projectRef, context))
      return page === null
        ? null
        : {
            messages: page.messages.map(privateChatMessage),
            next_cursor: page.next_cursor,
            ...(page.projectAccess ? { project_access: page.projectAccess } : {}),
          }
    },

    readMessageParts(query: MessagePartsQuery): Promise<MessagePartsPage | null> {
      return source.readMessageParts(query)
    },
  }
}

export type ChatSessionReads = ReturnType<typeof createChatSessionReads>
