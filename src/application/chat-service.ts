import type { ChatMessage, ChatSessionDetail, ChatSessionSummary } from "../contracts/index.js"
import type { ChatRepository } from "./ports/chat-repository.js"
import { chatMessage, conversationSummary } from "./chat/mappers.js"

export class ChatApplicationService {
  private readonly repository: ChatRepository

  public constructor(repository: ChatRepository) {
    this.repository = repository
  }

  public async listConversations(tenantId: string, projectRef: string | undefined, limit: number, cursor: string | null): Promise<{ sessions: ChatSessionSummary[]; next_cursor: string | null }> {
    const page = await this.repository.listConversations(tenantId, projectRef, limit, cursor)
    return { sessions: page.conversations.map(conversationSummary), next_cursor: page.next_cursor }
  }

  public async findConversation(tenantId: string, conversationId: string, projectRef: string | undefined): Promise<ChatSessionDetail["session"] | null> {
    const conversation = await this.repository.findConversation(tenantId, conversationId, projectRef)
    if (conversation === null) return null
    return {
      session_id: conversation.conversationId,
      title: conversation.title,
      owner_id: conversation.ownerId,
      created_at: conversation.createdAt.toISOString(),
      updated_at: conversation.updatedAt.toISOString(),
    }
  }

  public async listMessages(tenantId: string, conversationId: string, limit: number, cursor: string | null, projectRef?: string): Promise<{ messages: ChatMessage[]; next_cursor: string | null } | null> {
    const page = await this.repository.listMessages(tenantId, conversationId, limit, cursor, projectRef)
    return page === null ? null : { messages: page.messages.map(chatMessage), next_cursor: page.next_cursor }
  }

  public renameConversation(tenantId: string, conversationId: string, title: string, projectRef?: string): ReturnType<ChatRepository["renameConversation"]> {
    return this.repository.renameConversation(tenantId, conversationId, title, projectRef)
  }

  public deleteConversation(tenantId: string, conversationId: string, projectRef?: string): ReturnType<ChatRepository["deleteConversation"]> {
    return this.repository.deleteConversation(tenantId, conversationId, projectRef)
  }

  public createShare(tenantId: string, conversationId: string, projectRef?: string): ReturnType<ChatRepository["createShare"]> {
    return this.repository.createShare(tenantId, conversationId, projectRef)
  }

  public revokeShare(tenantId: string, conversationId: string, projectRef?: string): ReturnType<ChatRepository["revokeShare"]> {
    return this.repository.revokeShare(tenantId, conversationId, projectRef)
  }

  public findActiveShare(shareId: string, tenantId?: string, projectRef?: string): ReturnType<ChatRepository["findActiveShare"]> {
    return this.repository.findActiveShare(shareId, tenantId, projectRef)
  }
}
