import type { SkillRevisionShare } from "../../domain/chat/share.js"

export type SkillShareScope = { tenantId: string; creatorSubjectId: string }

export interface SkillShareRepository {
  create(scope: SkillShareScope, sourceRef: string, urlFor: (shareId: string) => string, expiresAt: Date | null): Promise<SkillRevisionShare>
  revoke(scope: SkillShareScope, shareId: string): Promise<SkillRevisionShare | null>
  findActive(tenantId: string, shareId: string): Promise<SkillRevisionShare | null>
}
