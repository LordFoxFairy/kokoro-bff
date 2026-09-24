import type { AgUiEvent } from "../project-chat-event.js"

export type AgUiProjectionStateSnapshot = {
  textMessageIds: string[]
  toolCallIds: string[]
}

export type AgUiStreamState = {
  version: number
  sourceHighWatermark: number
  projectionState: AgUiProjectionStateSnapshot
  /** Most recently admitted run; only its terminal may close the public stream. */
  expectedRunId?: string | null
  /** Most recently projected run marker; separate from the admitted-run fence. */
  latestRunId?: string | null
  terminalRunId?: string | null
  retentionFloorSequence?: number
}

export type AgUiAssistantUpdate =
  | { runId: string; kind: "replace" | "append"; content: string }
  | { runId: string; kind: "complete" | "fail" }

export type AgUiSourceProjection = {
  sourceOwner: "kokoro-agent"
  sourceEventId: string
  sourceSequence: number
  sourceDigest: string
  sourceOccurredAt: string
  frames: AgUiEvent[]
  assistantUpdate?: AgUiAssistantUpdate
}

export type AgUiSourceIdentity = Omit<AgUiSourceProjection, "frames" | "assistantUpdate">

export type CommitAgUiProjection = {
  tenantId: string
  sessionId: string
  expectedVersion: number
  sourceHighWatermark: number
  projectionState: AgUiProjectionStateSnapshot
  sources: AgUiSourceProjection[]
  latestRunId?: string | null
  terminalRunId?: string | null
  consumerLease?: AgUiConsumerLease
}

export type StoredAgUiFrame = {
  publicSequence: number
  cursor: string
  eventType: string
  payload: unknown
}

export type AgUiReplayPage = {
  kind: "page"
  frames: StoredAgUiFrame[]
  atHead: boolean
  terminalRunId: string | null
}

export type AgUiInvalidCursor = {
  kind: "invalid_cursor"
}

export type AgUiExpiredCursor = {
  kind: "expired_cursor"
}

export type AgUiProjectionStatus = {
  sourceHighWatermark: number
  currentCursor: string | null
  retentionFloorSequence?: number
  consumerState: "active" | "blocked" | "stopped" | null
  consumerLastErrorCode: string | null
  consumerLastPolledAt: string | null
}

/** A database-backed lease for one tenant/session source consumer. */
export type AgUiConsumerLease = {
  tenantId: string
  sessionId: string
  subjectId: string
  leaseOwner: string
  leaseToken: string
  fence: number
  leaseUntil: string
  /** Remaining database-clock lease budget observed when this lease was returned. */
  leaseRemainingMs: number
  sourceHighWatermark: number
  failureCount: number
}

export type AgUiConsumerClaimInput = {
  workerId: string
  now: string
  leaseUntil: string
  limit: number
}

export type AgUiGarbageCollectionCommand = {
  now: string
  retentionMs: number
  tombstoneRetentionMs: number
  batchSize: number
}

export type AgUiGarbageCollectionResult = {
  streamsScanned: number
  framesDeleted: number
  tombstonesInserted: number
  tombstonesDeleted: number
}

export interface AgUiProjectionConsumerRepository {
  registerConsumer(tenantId: string, sessionId: string, subjectId: string, expectedRunId?: string): Promise<void>
  seedConsumers(limit: number): Promise<number>
  claimConsumers(input: AgUiConsumerClaimInput): Promise<AgUiConsumerLease[]>
  renewConsumerLease(lease: AgUiConsumerLease, now: string, leaseUntil: string): Promise<boolean>
  markConsumerProgress(lease: AgUiConsumerLease, nextPollAt: string, now: string): Promise<boolean>
  markConsumerRetryable(lease: AgUiConsumerLease, nextPollAt: string, errorCode: string, now: string): Promise<boolean>
  markConsumerBlocked(lease: AgUiConsumerLease, errorCode: string, now: string): Promise<boolean>
  releaseConsumer(lease: AgUiConsumerLease, now: string): Promise<boolean>
  collectGarbage(command: AgUiGarbageCollectionCommand): Promise<AgUiGarbageCollectionResult>
}

export interface AgUiProjectionRepository {
  readStream(tenantId: string, sessionId: string): Promise<AgUiStreamState>
  assertPersistedSources(tenantId: string, sessionId: string, sources: readonly AgUiSourceIdentity[]): Promise<void>
  commitProjection(command: CommitAgUiProjection): Promise<"committed" | "version_conflict" | "lease_conflict">
  replay(tenantId: string, sessionId: string, cursor: string | null, limit: number, maxBytes: number): Promise<AgUiReplayPage | AgUiInvalidCursor | AgUiExpiredCursor>
  status(tenantId: string, sessionId: string): Promise<AgUiProjectionStatus>
}
