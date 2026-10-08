type ShareBase = {
  shareId: string
  tenantId: string
  url: string
  createdAt: Date
  expiresAt: Date | null
  revokedAt: Date | null
}

export type ConversationShare = ShareBase & { resourceKind: "conversation"; conversationId: string }
export type SkillRevisionShare = ShareBase & { resourceKind: "skill_revision"; creatorSubjectId: string; sourceRef: string }
export type Share = ConversationShare | SkillRevisionShare
