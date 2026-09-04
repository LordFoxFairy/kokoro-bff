export type Share = {
  shareId: string
  tenantId: string
  conversationId: string
  url: string
  createdAt: Date
  expiresAt: Date | null
  revokedAt: Date | null
}
