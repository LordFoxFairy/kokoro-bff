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

export type ChatRepository = {
  listConversations(tenantId: string, projectRef: string | undefined, limit: number, cursor: string | null): Promise<ConversationPage>
  findConversation(tenantId: string, conversationId: string, projectRef: string | undefined): Promise<Conversation | null>
  listMessages(tenantId: string, conversationId: string, limit: number, cursor: string | null, projectRef?: string): Promise<MessagePage | null>
  renameConversation(tenantId: string, conversationId: string, title: string, projectRef?: string): Promise<Conversation | null>
  deleteConversation(tenantId: string, conversationId: string, projectRef?: string): Promise<boolean>
  createShare(tenantId: string, conversationId: string, projectRef?: string): Promise<Share | null>
  revokeShare(tenantId: string, conversationId: string, projectRef?: string): Promise<Share | null>
  findActiveShare(shareId: string, tenantId?: string, projectRef?: string): Promise<{ share: Share; conversation: Conversation } | null>
}
