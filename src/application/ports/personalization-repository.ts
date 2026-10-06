export type PersonalizationFields = Readonly<{
  nickname: string
  occupation: string
  about: string
  instructions: string
}>

export type PersonalizationScope = Readonly<{ tenantId: string; subjectId: string }>
export type PersonalizationReadOptions = Readonly<{ signal: AbortSignal; deadline: number }>
export type PersonalizationReplacement = Readonly<{ expectedRevision: number; fields: PersonalizationFields }>
export type PersonalizationSnapshot = Readonly<{ personalization: PersonalizationFields | null; revision: number }>
export type PersonalizationReadResult = Readonly<{ kind: "read"; snapshot: PersonalizationSnapshot }> | Readonly<{ kind: "unavailable" }>
export type PersonalizationSaveResult =
  Readonly<{ kind: "saved"; snapshot: PersonalizationSnapshot }> | Readonly<{ kind: "conflict" | "exhausted" | "unavailable" | "unknown" }>

/** Current caller-owned Product facts, not an IAM profile or a model instruction grant. */
export interface PersonalizationRepository {
  read(scope: PersonalizationScope, options: PersonalizationReadOptions): Promise<PersonalizationReadResult>
  replace(scope: PersonalizationScope, replacement: PersonalizationReplacement, options: PersonalizationReadOptions): Promise<PersonalizationSaveResult>
}
