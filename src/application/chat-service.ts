import type { ChatMessage, ChatSessionDetail, ChatSessionSummary } from "../contracts/index.js"
import type { ChatRepository } from "./ports/chat-repository.js"
import { chatMessage, conversationSummary } from "./chat/mappers.js"

export class ChatApplicationService {
  private readonly repository: ChatRepository

  public constructor(repository: ChatRepository) {
    this.repository = repository
  }

  public async listConversations(tenantId: string, subjectId: string, projectRef: string | undefined, limit: number, cursor: string | null): Promise<{ sessions: ChatSessionSummary[]; next_cursor: string | null }> {
    const page = await this.repository.listConversations(tenantId, subjectId, projectRef, limit, cursor)
    return { sessions: page.conversations.map(conversationSummary), next_cursor: page.next_cursor }
  }

  public async findConversation(tenantId: string, subjectId: string, conversationId: string, projectRef: string | undefined): Promise<ChatSessionDetail["session"] | null> {
    const conversation = await this.repository.findConversation(tenantId, subjectId, conversationId, projectRef)
    if (conversation === null) return null
    return {
      session_id: conversation.conversationId,
      title: conversation.title,
      owner_id: conversation.ownerId,
      created_at: conversation.createdAt.toISOString(),
      updated_at: conversation.updatedAt.toISOString(),
    }
  }

  public async listMessages(tenantId: string, subjectId: string, conversationId: string, limit: number, cursor: string | null, projectRef?: string): Promise<{ messages: ChatMessage[]; next_cursor: string | null } | null> {
    const page = await this.repository.listMessages(tenantId, subjectId, conversationId, limit, cursor, projectRef)
    return page === null ? null : { messages: page.messages.map(chatMessage), next_cursor: page.next_cursor }
  }

  public renameConversation(tenantId: string, subjectId: string, conversationId: string, title: string, projectRef?: string): ReturnType<ChatRepository["renameConversation"]> {
    return this.repository.renameConversation(tenantId, subjectId, conversationId, title, projectRef)
  }

  public deleteConversation(tenantId: string, subjectId: string, conversationId: string, projectRef?: string): ReturnType<ChatRepository["deleteConversation"]> {
    return this.repository.deleteConversation(tenantId, subjectId, conversationId, projectRef)
  }

  public createShare(tenantId: string, subjectId: string, conversationId: string, projectRef?: string): ReturnType<ChatRepository["createShare"]> {
    return this.repository.createShare(tenantId, subjectId, conversationId, projectRef)
  }

  public revokeShare(tenantId: string, subjectId: string, conversationId: string, projectRef?: string): ReturnType<ChatRepository["revokeShare"]> {
    return this.repository.revokeShare(tenantId, subjectId, conversationId, projectRef)
  }
}
