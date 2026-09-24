import type { Conversation } from "../../domain/chat/conversation.js"
import type { Message } from "../../domain/chat/message.js"
import type { Share } from "../../domain/chat/share.js"

export type ConversationPage = {
  conversations: Conversation[]
  next_cursor: string | null
}

export type MessagePage = {
  messages: Message[]
  next_cursor: string | null
}

export type ChatSnapshot = {
  conversation: Conversation
  messages: Message[]
  eventWatermark: string | null
}

export type ChatRepository = {
  listConversations(tenantId: string, subjectId: string, projectRef: string | undefined, limit: number, cursor: string | null): Promise<ConversationPage>
  findConversation(tenantId: string, subjectId: string, conversationId: string, projectRef: string | undefined): Promise<Conversation | null>
  readSnapshot(tenantId: string, subjectId: string, conversationId: string, projectRef: string | undefined): Promise<ChatSnapshot | null>
  listMessages(tenantId: string, subjectId: string, conversationId: string, limit: number, cursor: string | null, projectRef?: string): Promise<MessagePage | null>
  renameConversation(tenantId: string, subjectId: string, conversationId: string, title: string, projectRef?: string): Promise<Conversation | null>
  deleteConversation(tenantId: string, subjectId: string, conversationId: string, requestId: string, projectRef?: string): Promise<boolean>
  createShare(tenantId: string, subjectId: string, conversationId: string, projectRef?: string): Promise<Share | null>
  revokeShare(tenantId: string, subjectId: string, conversationId: string, projectRef?: string): Promise<Share | null>
}
