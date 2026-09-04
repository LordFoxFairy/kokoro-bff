import type { Conversation } from "../../domain/chat/conversation.js"
import type { Share } from "../../domain/chat/share.js"
import type { MessagePage } from "./chat-repository.js"

/** Capability-scoped reads; deliberately separate from trusted-subject Chat APIs. */
export interface PublicShareRepository {
  findActiveShare(shareId: string, tenantId?: string, projectRef?: string): Promise<{ share: Share; conversation: Conversation } | null>
  listSharedMessages(shareId: string, tenantId: string, conversationId: string, limit: number): Promise<MessagePage | null>
}
