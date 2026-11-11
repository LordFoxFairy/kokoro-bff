export type PersonalKnowledgeScope = Readonly<{ tenantId: string; subjectId: string }>
export type PersonalKnowledgeOptions = Readonly<{ signal: AbortSignal; deadline: number }>
export type PersonalKnowledgeFields = Readonly<{ name: string; when_to_use: string; content: string }>
export type PersonalKnowledgeItem = PersonalKnowledgeFields & Readonly<{ knowledge_id: string; revision: number; created_at: string; updated_at: string }>
export type PersonalKnowledgeUsage = Readonly<{ enabled: boolean; revision: number }>
export type PersonalKnowledgeOutcome<T> =
  Readonly<{ kind: "ok"; value: T }> | Readonly<{ kind: "not_found" | "conflict" | "exhausted" | "limit" | "unavailable" | "unknown" }>
export interface PersonalKnowledgeRepository {
  list(scope: PersonalKnowledgeScope, query: string, options: PersonalKnowledgeOptions): Promise<PersonalKnowledgeOutcome<readonly PersonalKnowledgeItem[]>>
  get(scope: PersonalKnowledgeScope, id: string, options: PersonalKnowledgeOptions): Promise<PersonalKnowledgeOutcome<PersonalKnowledgeItem>>
  replace(
    scope: PersonalKnowledgeScope,
    id: string,
    expectedRevision: number,
    fields: PersonalKnowledgeFields,
    options: PersonalKnowledgeOptions,
  ): Promise<PersonalKnowledgeOutcome<PersonalKnowledgeItem>>
  remove(scope: PersonalKnowledgeScope, id: string, expectedRevision: number, options: PersonalKnowledgeOptions): Promise<PersonalKnowledgeOutcome<null>>
  readUsage(scope: PersonalKnowledgeScope, options: PersonalKnowledgeOptions): Promise<PersonalKnowledgeOutcome<PersonalKnowledgeUsage>>
  replaceUsage(
    scope: PersonalKnowledgeScope,
    expectedRevision: number,
    enabled: boolean,
    options: PersonalKnowledgeOptions,
  ): Promise<PersonalKnowledgeOutcome<PersonalKnowledgeUsage>>
}
