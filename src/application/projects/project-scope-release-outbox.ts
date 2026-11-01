export type ProjectScopeReleaseKind = "project" | "conversation"

export type ProjectScopeReleaseCommand = Readonly<{
  commandId: string
  tenantId: string
  projectId: string
  ownerSubjectId: string
  actorId: string
  scopeKind: ProjectScopeReleaseKind
  scopeId: string
  requestDigest: string
  attemptCount: number
  leaseOwner: string
  fence: number
  leaseObservedAtMs: number
  leaseRemainingMs: number
}>

export type ProjectScopeReleaseLease = Pick<ProjectScopeReleaseCommand, "commandId" | "tenantId" | "projectId" | "leaseOwner" | "fence">

export interface ProjectScopeReleaseOutboxRepository {
  claimProjectScopeReleases(
    input: {
      workerId: string
      limit: number
      leaseDurationMs: number
      includeOneCredentialRecovery: boolean
    },
    signal: AbortSignal,
    timeoutMs: number,
  ): Promise<readonly ProjectScopeReleaseCommand[]>
  markProjectScopeReleased(lease: ProjectScopeReleaseLease, signal: AbortSignal, timeoutMs: number): Promise<boolean>
  markProjectScopeRetryable(lease: ProjectScopeReleaseLease, delayMs: number, errorCode: string, signal: AbortSignal, timeoutMs: number): Promise<boolean>
  markProjectScopeBlocked(lease: ProjectScopeReleaseLease, errorCode: string, signal: AbortSignal, timeoutMs: number): Promise<boolean>
}

export type ProjectScopeReleaseResult =
  Readonly<{ outcome: "released" }> | Readonly<{ outcome: "retryable"; errorCode: string }> | Readonly<{ outcome: "blocked"; errorCode: string }>

export interface ProjectScopeReleaseClient {
  release(command: ProjectScopeReleaseCommand, signal: AbortSignal, timeoutMs: number): Promise<ProjectScopeReleaseResult>
}
