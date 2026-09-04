export type ConversationStatus = "active" | "deleted"

export type Conversation = {
  conversationId: string
  tenantId: string
  ownerId: string
  projectRef: string | null
  title: string
  status: ConversationStatus
  createdAt: Date
  updatedAt: Date
  deletedAt: Date | null
}
