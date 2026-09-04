import { createHash } from "node:crypto"
import { EventSchemas } from "@ag-ui/core"

import type { ChatEvent } from "../../contracts/chat.js"
import {
  AgUiConsumerLeaseLostError,
  AgUiProjectionContentionError,
  AgUiSourceContractError,
  AgUiSourceContinuityError,
  AgUiSourceIdentityConflictError,
} from "./errors.js"
import {
  projectChatEvent,
  type AgUiEvent,
  type AgUiProjectionState,
} from "./project-chat-event.js"
import type {
  AgUiProjectionRepository,
  AgUiProjectionStateSnapshot,
  AgUiProjectionStatus,
  AgUiReplayPage,
  AgUiInvalidCursor,
  AgUiExpiredCursor,
  AgUiSourceIdentity,
  AgUiSourceProjection,
  AgUiConsumerLease,
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
  const ordered = [...sources]
  const eventIds = new Set<string>()
  let previousSequence: number | null = null
  for (const source of ordered) {
    assertSource(source, sessionId)
    if (eventIds.has(source.sourceEventId)) throw new AgUiSourceIdentityConflictError()
    if (previousSequence !== null && source.sourceSequence !== previousSequence + 1) throw new AgUiSourceContinuityError()
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
    frames: source.event === null ? [] : validateAgUiFrames(projectChatEvent(source.event, state)),
  }))
}

/** Keep schema-invalid frames outside the durable source/high-watermark transaction. */
export function validateAgUiFrames(frames: readonly AgUiEvent[]): AgUiEvent[] {
  try {
    return frames.map((frame) => {
      const parsed = EventSchemas.parse(frame)
      // @ag-ui/core marks required wire fields as optional in its inferred union;
      // successful runtime parsing is the authoritative boundary proof here.
      return parsed as AgUiEvent
    })
  } catch {
    throw new AgUiSourceContractError()
  }
}

type RunProjectionState = {
  latestRunId: string | null
  terminalRunId: string | null
}

function runProjectionState(
  stream: { expectedRunId?: string | null; latestRunId?: string | null; terminalRunId?: string | null },
  projections: readonly AgUiSourceProjection[],
): RunProjectionState {
  let latestRunId = stream.latestRunId ?? null
  let terminalRunId = stream.terminalRunId ?? null
  const expectedRunId = stream.expectedRunId ?? null
  for (const source of projections) {
    for (const frame of source.frames) {
      const runId = frame.runId ?? frame.metadata.kokoro.run_id
      if (frame.type === "RUN_STARTED" && runId !== null && runId !== undefined && runId !== "") {
        latestRunId = runId
        if (expectedRunId === null || expectedRunId === runId) terminalRunId = null
      } else if ((frame.type === "RUN_FINISHED" || frame.type === "RUN_ERROR") && runId !== null && runId !== undefined && runId !== "") {
        if (expectedRunId !== null && expectedRunId === runId) {
          latestRunId = runId
          terminalRunId = runId
        } else if (expectedRunId === null && (latestRunId === null || latestRunId === runId)) {
          latestRunId = runId
          terminalRunId = runId
        }
      }
    }
  }
  return { latestRunId, terminalRunId }
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
    consumerLease?: AgUiConsumerLease,
  ): Promise<AgUiIngestResult> {
    if (tenantId.trim() === "" || sessionId.trim() === "") throw new Error("AG-UI tenant and session are required")
    if (consumerLease !== undefined && (consumerLease.tenantId !== tenantId || consumerLease.sessionId !== sessionId)) {
      throw new AgUiConsumerLeaseLostError()
    }
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
      if (pending[0]?.sourceSequence !== stream.sourceHighWatermark + 1) throw new AgUiSourceContinuityError()

      const state = mutableState(stream.projectionState)
      const projections = projectSources(pending, state)
      const sourceHighWatermark = pending.at(-1)?.sourceSequence ?? stream.sourceHighWatermark
      const runState = runProjectionState(stream, projections)
      const result = await this.repository.commitProjection({
        tenantId,
        sessionId,
        expectedVersion: stream.version,
        sourceHighWatermark,
        projectionState: snapshotOf(state),
        sources: projections,
        latestRunId: runState.latestRunId,
        terminalRunId: runState.terminalRunId,
        ...(consumerLease === undefined ? {} : { consumerLease }),
      })
      if (result === "committed") {
        return {
          insertedSources: projections.length,
          insertedFrames: projections.reduce((count, source) => count + source.frames.length, 0),
          sourceHighWatermark,
        }
      }
      if (result === "lease_conflict") throw new AgUiConsumerLeaseLostError()
    }
    throw new AgUiProjectionContentionError()
  }

  public replay(
    tenantId: string,
    sessionId: string,
    cursor: string | null,
    limit = 1000,
    maxBytes = 1024 * 1024,
  ): Promise<AgUiReplayPage | AgUiInvalidCursor | AgUiExpiredCursor> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error("AG-UI replay limit must be between 1 and 1000")
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error("AG-UI replay byte limit must be a positive safe integer")
    if (cursor !== null && !OPAQUE_CURSOR_PATTERN.test(cursor)) return Promise.resolve({ kind: "invalid_cursor" })
    return this.repository.replay(tenantId, sessionId, cursor, limit, maxBytes)
  }

  public status(tenantId: string, sessionId: string): Promise<AgUiProjectionStatus> {
    return this.repository.status(tenantId, sessionId)
  }
}
