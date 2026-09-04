import type { AgUiEvent } from "../project-chat-event.js"

export type AgUiProjectionStateSnapshot = {
  textMessageIds: string[]
  toolCallIds: string[]
}

export type AgUiStreamState = {
  version: number
  sourceHighWatermark: number
  projectionState: AgUiProjectionStateSnapshot
}

export type AgUiSourceProjection = {
  sourceOwner: "kokoro-agent"
  sourceEventId: string
  sourceSequence: number
  sourceDigest: string
  sourceOccurredAt: string
  frames: AgUiEvent[]
}

export type CommitAgUiProjection = {
  tenantId: string
  sessionId: string
  expectedVersion: number
  sourceHighWatermark: number
  projectionState: AgUiProjectionStateSnapshot
  sources: AgUiSourceProjection[]
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
}

export type AgUiInvalidCursor = {
  kind: "invalid_cursor"
}

export type AgUiProjectionStatus = {
  sourceHighWatermark: number
  currentCursor: string | null
}

export interface AgUiProjectionRepository {
  readStream(tenantId: string, sessionId: string): Promise<AgUiStreamState>
  commitProjection(command: CommitAgUiProjection): Promise<"committed" | "version_conflict">
  replay(tenantId: string, sessionId: string, cursor: string | null, limit: number): Promise<AgUiReplayPage | AgUiInvalidCursor>
  status(tenantId: string, sessionId: string): Promise<AgUiProjectionStatus>
}
