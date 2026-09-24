export type ConversationStatus = "active" | "deleted"

/** A Web-local candidate ID is not evidence of ownership of an existing row. */
export function isClientCreatedConversationId(value: string): boolean {
  return /^conv_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(value)
}

/** The first accepted user message supplies a bounded, non-empty server title. */
export function firstMessageConversationTitle(content: string): string {
  const characters = Array.from(content.trim())
  if (characters.length === 0) throw new Error("CHAT_TURN_INPUT_INVALID")
  return characters.slice(0, 24).join("") + (characters.length > 24 ? "…" : "")
}

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
