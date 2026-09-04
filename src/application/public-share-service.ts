import type { ChatMessage } from "../contracts/chat.js"
import { chatMessage } from "./chat/mappers.js"
import type { PublicShareRepository } from "./ports/public-share-repository.js"

export class PublicShareApplicationService {
  public constructor(private readonly repository: PublicShareRepository) {}

  public findActiveShare(shareId: string, tenantId?: string, projectRef?: string): ReturnType<PublicShareRepository["findActiveShare"]> {
    return this.repository.findActiveShare(shareId, tenantId, projectRef)
  }

  public async listMessages(
    shareId: string,
    tenantId: string,
    conversationId: string,
    limit: number,
  ): Promise<{ messages: ChatMessage[] } | null> {
    const page = await this.repository.listSharedMessages(shareId, tenantId, conversationId, limit)
    return page === null ? null : { messages: page.messages.map(chatMessage) }
  }
}
