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

/** Account-owned caller facts; this provider is feature-local, not a global application port. */
export interface PersonalizationProvider {
  read(scope: PersonalizationScope, options: PersonalizationReadOptions): Promise<PersonalizationReadResult>
  replace(scope: PersonalizationScope, replacement: PersonalizationReplacement, options: PersonalizationReadOptions): Promise<PersonalizationSaveResult>
}

export const PERSONALIZATION_PROVIDER = Symbol("PERSONALIZATION_PROVIDER")
