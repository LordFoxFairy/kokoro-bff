import { createHash } from "node:crypto"

import type { ChatEvent } from "../../contracts/chat.js"
import { AgUiProjectionContentionError, AgUiSourceIdentityConflictError } from "./errors.js"
import {
  projectChatEvent,
  type AgUiProjectionState,
} from "./project-chat-event.js"
import type {
  AgUiProjectionRepository,
  AgUiProjectionStateSnapshot,
  AgUiProjectionStatus,
  AgUiReplayPage,
  AgUiInvalidCursor,
  AgUiSourceIdentity,
  AgUiSourceProjection,
} from "./ports/agui-projection-repository.js"

const MAX_COMMIT_ATTEMPTS = 5
const OPAQUE_CURSOR_PATTERN = /^agui_[0-9a-f]{32}$/u

export type AgentProjectionSource = {
  sourceEventId: string
  sourceSequence: number
  sourceOccurredAt: string
  sourcePayload: unknown
  event: ChatEvent | null
}

export type AgUiIngestResult = {
  insertedSources: number
  insertedFrames: number
  sourceHighWatermark: number
}

function canonicalJson(value: unknown): string {
  if (value === undefined || value === null) return "null"
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value)
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("AG-UI source payload contains a non-finite number")
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (typeof value !== "object") throw new Error("AG-UI source payload is not JSON-compatible")
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`
}

function digestOf(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex")
}

function mutableState(snapshot: AgUiProjectionStateSnapshot): AgUiProjectionState {
  return {
    textMessages: new Set(snapshot.textMessageIds),
    toolCalls: new Set(snapshot.toolCallIds),
  }
}

function snapshotOf(state: AgUiProjectionState): AgUiProjectionStateSnapshot {
  return {
    textMessageIds: [...state.textMessages].sort(),
    toolCallIds: [...state.toolCalls].sort(),
  }
}

function assertSource(source: AgentProjectionSource, sessionId: string): void {
  if (source.sourceEventId.trim() === "") throw new Error("AG-UI source event id is required")
  if (!Number.isSafeInteger(source.sourceSequence) || source.sourceSequence < 1) {
    throw new Error("AG-UI source sequence must be a positive safe integer")
  }
  if (!Number.isFinite(Date.parse(source.sourceOccurredAt))) throw new Error("AG-UI source timestamp is invalid")
  if (source.event === null) return
  if (
    source.event.event_id !== source.sourceEventId
    || source.event.seq !== source.sourceSequence
    || source.event.session_id !== sessionId
    || source.event.timestamp !== source.sourceOccurredAt
  ) {
    throw new Error("AG-UI source identity does not match its projected Chat event")
  }
}

function orderedSources(sources: readonly AgentProjectionSource[], sessionId: string): AgentProjectionSource[] {
  const ordered = [...sources].sort((left, right) => left.sourceSequence - right.sourceSequence)
  const eventIds = new Set<string>()
  let previousSequence = 0
  for (const source of ordered) {
    assertSource(source, sessionId)
    if (source.sourceSequence === previousSequence || eventIds.has(source.sourceEventId)) {
      throw new AgUiSourceIdentityConflictError()
    }
    previousSequence = source.sourceSequence
    eventIds.add(source.sourceEventId)
  }
  return ordered
}

function projectSources(
  sources: readonly AgentProjectionSource[],
  state: AgUiProjectionState,
): AgUiSourceProjection[] {
  return sources.map((source) => ({
    ...sourceIdentity(source),
    frames: source.event === null ? [] : projectChatEvent(source.event, state),
  }))
}

function sourceIdentity(source: AgentProjectionSource): AgUiSourceIdentity {
  return {
    sourceOwner: "kokoro-agent",
    sourceEventId: source.sourceEventId,
    sourceSequence: source.sourceSequence,
    sourceDigest: digestOf(source.sourcePayload),
    sourceOccurredAt: source.sourceOccurredAt,
  }
}

function sourceIdentities(sources: readonly AgentProjectionSource[]): AgUiSourceIdentity[] {
  return sources.map(sourceIdentity)
}

export class AgUiProjectionService {
  public constructor(private readonly repository: AgUiProjectionRepository) {}

  public async ingest(
    tenantId: string,
    sessionId: string,
    incoming: readonly AgentProjectionSource[],
  ): Promise<AgUiIngestResult> {
    if (tenantId.trim() === "" || sessionId.trim() === "") throw new Error("AG-UI tenant and session are required")
    const sources = orderedSources(incoming, sessionId)
    const identities = sourceIdentities(sources)

    for (let attempt = 0; attempt < MAX_COMMIT_ATTEMPTS; attempt += 1) {
      const stream = await this.repository.readStream(tenantId, sessionId)
      await this.repository.assertPersistedSources(
        tenantId,
        sessionId,
        identities.filter((source) => source.sourceSequence <= stream.sourceHighWatermark),
      )
      const pending = sources.filter((source) => source.sourceSequence > stream.sourceHighWatermark)
      if (pending.length === 0) {
        return { insertedSources: 0, insertedFrames: 0, sourceHighWatermark: stream.sourceHighWatermark }
      }

      const state = mutableState(stream.projectionState)
      const projections = projectSources(pending, state)
      const sourceHighWatermark = pending.at(-1)?.sourceSequence ?? stream.sourceHighWatermark
      const result = await this.repository.commitProjection({
        tenantId,
        sessionId,
        expectedVersion: stream.version,
        sourceHighWatermark,
        projectionState: snapshotOf(state),
        sources: projections,
      })
      if (result === "committed") {
        return {
          insertedSources: projections.length,
          insertedFrames: projections.reduce((count, source) => count + source.frames.length, 0),
          sourceHighWatermark,
        }
      }
    }
    throw new AgUiProjectionContentionError()
  }

  public replay(
    tenantId: string,
    sessionId: string,
    cursor: string | null,
    limit = 1000,
  ): Promise<AgUiReplayPage | AgUiInvalidCursor> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error("AG-UI replay limit must be between 1 and 1000")
    if (cursor !== null && !OPAQUE_CURSOR_PATTERN.test(cursor)) return Promise.resolve({ kind: "invalid_cursor" })
    return this.repository.replay(tenantId, sessionId, cursor, limit)
  }

  public status(tenantId: string, sessionId: string): Promise<AgUiProjectionStatus> {
    return this.repository.status(tenantId, sessionId)
  }
}
