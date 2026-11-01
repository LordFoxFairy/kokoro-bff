/** Stable intent identifiers supplied by the authenticated execution verifier. */
export type ProjectExecutionBindingInput = Readonly<{
  tenantId: string
  subjectId: string
  actorId: string
  runId: string
  sessionId: string
  identityAssertionRef: string
  projectId: string | null
  selectionDigest: string
  signal?: AbortSignal
}>

export type ProjectExecutionBinding = Readonly<{
  projectId: string | null
  selectedSkillSourceRefs: readonly string[]
  selectionDigest: string
}>

/** Current BFF-owned facts only. This does not replace IAM or issue a permit. */
export interface ProjectExecutionBindingReader {
  readProjectExecutionBinding(input: ProjectExecutionBindingInput): Promise<ProjectExecutionBinding | null>
}
