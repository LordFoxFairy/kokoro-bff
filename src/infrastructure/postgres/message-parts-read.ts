import { Buffer } from "node:buffer"
import type { Pool, PoolClient, QueryResultRow } from "pg"
import { EventSchemas } from "@ag-ui/core"

import type { AgUiEvent } from "../../application/agui/project-chat-event.js"
import type { AgUiAssistantUpdate } from "../../application/agui/ports/agui-projection-repository.js"
import type { MessagePartsQuery, MessageReadLifetime, PrivateMessageRead } from "../../application/ports/chat-repository.js"
import type { MessagePartsPage, OrderedMessageRendering } from "../../contracts/chat.js"
import { parseSkillSourceSelection } from "../../domain/chat/skill-source-selection.js"
import { messageFromRow, instant, type MessageRow } from "./chat-repository-mappers.js"
import { foldMessageParts, messagePartsContent, type MessageParts } from "./message-parts.js"
import { parseAgentProcessPayload } from "../clients/agent/process-state.js"

const CURSOR_PREFIX = "mparts_"
const FRAME_CURSOR = /^agui_[0-9a-f]{32}$/u
const MAX_I64 = 9223372036854775807n
const MAX_PAGE_BYTES = 1048576
const MAX_LEGACY_BYTES = 4 * 1048576
const MAX_LEGACY_FRAMES = 512
const TEXT_SCALARS = 4096

function failed(code = "MESSAGE_PARTS_UNAVAILABLE"): never {
  throw new Error(code)
}
function decimal(value: unknown, positive = false): string {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,18})$/u.test(value) || BigInt(value) > MAX_I64 || (positive && value === "0")) return failed()
  return value
}
function identity(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") return failed()
  return value
}
function watermark(value: unknown): string | null {
  if (value !== null && (typeof value !== "string" || !FRAME_CURSOR.test(value))) return failed()
  return value
}
function scalars(value: string): string[] {
  const result = Array.from(value)
  if (
    result.some((scalar) => {
      const point = scalar.codePointAt(0) ?? 0
      return point >= 0xd800 && point <= 0xdfff
    })
  )
    return failed()
  return result
}
function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return failed()
  return value as Record<string, unknown>
}

export type MessagePartsScope = Readonly<{
  tenantId: string
  subjectId: string
  conversationId: string
  messageId: string
  runId: string
  projectRef: string | null
  requestedProjectRef: string | null
  scope: "all" | "direct"
}>
export type MessagePartsCursor = MessagePartsScope & {
  format: 1
  revision: string
  watermark: string | null
  source: "message" | "ledger"
  ordinal: string
  offset: string
}

export function encodeMessagePartsCursor(value: MessagePartsCursor): string {
  return CURSOR_PREFIX + Buffer.from(JSON.stringify(value)).toString("base64url")
}

export function decodeMessagePartsCursor(value: string): MessagePartsCursor {
  try {
    if (!value.startsWith(CURSOR_PREFIX) || value.length > 8192) return failed("MESSAGE_PARTS_CURSOR_INVALID")
    const encoded = value.slice(CURSOR_PREFIX.length)
    if (!/^[A-Za-z0-9_-]+$/u.test(encoded)) return failed("MESSAGE_PARTS_CURSOR_INVALID")
    const bytes = Buffer.from(encoded, "base64url")
    if (bytes.toString("base64url") !== encoded) return failed("MESSAGE_PARTS_CURSOR_INVALID")
    const parsed = object(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)))
    const fields = [
      "tenantId",
      "subjectId",
      "conversationId",
      "messageId",
      "runId",
      "projectRef",
      "requestedProjectRef",
      "scope",
      "format",
      "revision",
      "watermark",
      "source",
      "ordinal",
      "offset",
    ]
    if (Object.keys(parsed).sort().join(",") !== fields.sort().join(",")) return failed("MESSAGE_PARTS_CURSOR_INVALID")
    for (const key of ["tenantId", "subjectId", "conversationId", "messageId", "runId"]) identity(parsed[key])
    for (const key of ["projectRef", "requestedProjectRef"]) if (parsed[key] !== null) identity(parsed[key])
    if (parsed.scope !== "all" && parsed.scope !== "direct") return failed("MESSAGE_PARTS_CURSOR_INVALID")
    if (parsed.format !== 1 || (parsed.source !== "message" && parsed.source !== "ledger")) return failed("MESSAGE_PARTS_CURSOR_INVALID")
    decimal(parsed.revision)
    decimal(parsed.ordinal)
    decimal(parsed.offset)
    watermark(parsed.watermark)
    return parsed as unknown as MessagePartsCursor
  } catch {
    return failed("MESSAGE_PARTS_CURSOR_INVALID")
  }
}

export function assertMessagePartsCursorScope(cursor: MessagePartsCursor, scope: MessagePartsScope): void {
  if (Object.entries(scope).some(([key, value]) => cursor[key as keyof MessagePartsCursor] !== value)) failed("MESSAGE_PARTS_CURSOR_INVALID")
}

export function messageReadLifetime(lifetime?: MessageReadLifetime): MessageReadLifetime {
  if (lifetime !== undefined && !Number.isFinite(lifetime.deadlineAt)) return failed()
  const deadlineAt = Math.min(lifetime?.deadlineAt ?? Infinity, performance.now() + 10000)
  return { signal: lifetime?.signal ?? new AbortController().signal, deadlineAt }
}

/** A Message read owns one lease and one absolute lifetime, never the shared pool. */
export async function withMessageReadClient<T>(
  pool: Pick<Pool, "connect">,
  lifetime: MessageReadLifetime,
  read: (client: PoolClient) => Promise<T>,
): Promise<T> {
  lifetime = messageReadLifetime(lifetime)
  let client: PoolClient | undefined
  let lease: PoolClient | undefined
  let retired = false
  let broken = false
  let interrupt!: (error: Error) => void
  const interrupted = new Promise<never>((_, reject) => {
    interrupt = reject
  })
  const stop = () => {
    retired = true
    broken = true
    interrupt(new Error("MESSAGE_PARTS_UNAVAILABLE"))
    if (client) {
      client.release(true)
      client = undefined
    }
  }
  const active = () => {
    if (retired || lifetime.signal.aborted || performance.now() >= lifetime.deadlineAt) failed()
  }
  const timer = setTimeout(stop, Math.max(0, lifetime.deadlineAt - performance.now()))
  lifetime.signal.addEventListener("abort", stop, { once: true })
  try {
    active()
    const acquisition = pool.connect()
    void acquisition.then(
      (late) => {
        if (retired) late.release()
      },
      () => undefined,
    )
    client = await Promise.race([acquisition, interrupted])
    lease = client
    lease.on("error", stop)
    active()
    await Promise.race([client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"), interrupted])
    const remaining = String(Math.max(1, Math.floor(lifetime.deadlineAt - performance.now())))
    await Promise.race([client.query("SELECT set_config('statement_timeout',$1,true),set_config('lock_timeout',$1,true)", [remaining]), interrupted])
    const result = await Promise.race([read(client), interrupted])
    active()
    await Promise.race([client.query("COMMIT"), interrupted])
    active()
    return result
  } catch (error) {
    broken = true
    if (client && !retired) await Promise.race([client.query("ROLLBACK"), interrupted]).catch(() => undefined)
    throw error
  } finally {
    retired = true
    clearTimeout(timer)
    lifetime.signal.removeEventListener("abort", stop)
    lease?.removeListener("error", stop)
    client?.release(broken)
  }
}

export type PrivateMessageRow = Omit<MessageRow, "content"> & {
  content: string | null
  parts_format_version: number | null
  parts_public_sequence: string | null
  parts_count: number | null
}

function cursorFor(
  scope: MessagePartsScope,
  revision: string,
  head: string | null,
  source: "message" | "ledger",
  ordinal = "0",
  offset = "0",
): MessagePartsCursor {
  return { ...scope, format: 1, revision: decimal(revision), watermark: watermark(head), source, ordinal: decimal(ordinal), offset: decimal(offset) }
}

export function messageRendering(
  scope: MessagePartsScope,
  revision: string,
  head: string | null,
  source: "message" | "ledger" = "message",
): OrderedMessageRendering {
  return {
    mode: "ordered",
    format_version: 1,
    revision,
    event_watermark: head,
    parts_cursor: encodeMessagePartsCursor(cursorFor(scope, revision, head, source)),
  }
}

export function privateMessageFromRow(row: PrivateMessageRow, scope: Omit<MessagePartsScope, "messageId" | "runId">, head: string | null): PrivateMessageRead {
  if (row.parts_format_version === null && row.parts_public_sequence === null && row.parts_count === null) {
    if (typeof row.content !== "string") return failed()
    return messageFromRow({ ...row, content: row.content })
  }
  if (
    row.role !== "assistant" ||
    row.content !== null ||
    row.parts_format_version !== 1 ||
    !Number.isSafeInteger(row.parts_count) ||
    (row.parts_count ?? -1) < 0
  )
    return failed()
  if (row.parts_count !== 0 && decimal(row.parts_public_sequence) === "0") return failed()
  const selected = parseSkillSourceSelection(row.selected_skill_source_refs)
  if (selected === null || (row.agent_failure_code === null) !== (row.agent_failure_retryable === null)) return failed()
  const runId = identity(row.run_id)
  return {
    messageId: row.message_id,
    tenantId: row.tenant_id,
    conversationId: row.conversation_id,
    runId,
    role: "assistant",
    content: null,
    selectedSkillSourceRefs: selected,
    status: row.status,
    failure: row.agent_failure_code === null ? null : { source: "agent", code: row.agent_failure_code, retryable: row.agent_failure_retryable as boolean },
    messageSeq: decimal(String(row.message_seq), true),
    createdAt: instant(row.created_at),
    updatedAt: instant(row.updated_at),
    rendering: messageRendering({ ...scope, messageId: row.message_id, runId }, decimal(row.parts_public_sequence), head),
  }
}

type OwnerRow = {
  message_id: string
  run_id: string
  project_ref: string | null
  status: string
  parts_format_version: number | null
  parts_public_sequence: string | null
  parts_count: number | null
  legacy_text: string | null
  legacy_bytes: string
  selected_run_id: string | null
  latest_assistant_id: string | null
}

async function currentWatermark(client: PoolClient, tenantId: string, sessionId: string): Promise<string | null> {
  const result = await client.query<{ cursor: string }>(
    "SELECT cursor FROM bff_agui_event WHERE tenant_id=$1 AND session_id=$2 ORDER BY public_sequence DESC LIMIT 1",
    [tenantId, sessionId],
  )
  return watermark(result.rows[0]?.cursor ?? null)
}

function parsePositionedPart(raw: unknown, revision: string): Record<string, unknown> {
  const value = object(raw)
  identity(value.part_id)
  const first = decimal(value.first_sequence, true),
    latest = decimal(value.latest_sequence, true)
  if (BigInt(first) > BigInt(latest) || BigInt(latest) > BigInt(revision)) return failed()
  const fields =
    value.kind === "text"
      ? ["kind", "part_id", "segment_id", "first_sequence", "latest_sequence", "completed"]
      : ["kind", "part_id", "first_sequence", "latest_sequence", "activity"]
  if (Object.keys(value).sort().join(",") !== fields.sort().join(",")) return failed()
  return value
}

type SliceRow = { ordinal: string; item: unknown; text_slice: string | null; total_scalars: string | null; metadata_bytes?: string }

/** Pack only already-bounded SQL slices. No complete ordered document is loaded here. */
export function messagePartsPageFromSlices(cursor: MessagePartsCursor, count: number, rows: readonly SliceRow[], limit: number): MessagePartsPage {
  const items: MessagePartsPage["items"] = []
  let ordinal = BigInt(cursor.ordinal),
    offset = BigInt(cursor.offset),
    previousFirst = 0n
  if (!Number.isSafeInteger(count) || count < 0 || ordinal > BigInt(count) || (ordinal === BigInt(count) && offset !== 0n))
    return failed("MESSAGE_PARTS_CURSOR_INVALID")
  for (const row of rows) {
    if (items.length >= limit || ordinal >= BigInt(count)) break
    if (decimal(row.ordinal) !== String(ordinal)) return failed()
    if (row.metadata_bytes !== undefined && BigInt(decimal(row.metadata_bytes)) > BigInt(MAX_PAGE_BYTES)) return failed("MESSAGE_PARTS_BUDGET_EXCEEDED")
    const part = parsePositionedPart(row.item, cursor.revision)
    if (BigInt(part.first_sequence as string) <= previousFirst) return failed()
    previousFirst = BigInt(part.first_sequence as string)
    if (part.kind === "text") {
      const segmentId = identity(part.segment_id)
      const total = BigInt(decimal(row.total_scalars)),
        value = row.text_slice
      if (
        part.part_id !== `text:${segmentId}` ||
        typeof part.completed !== "boolean" ||
        typeof value !== "string" ||
        offset > total ||
        scalars(value).length > TEXT_SCALARS
      )
        return failed()
      if (offset > 0n && offset >= total) return failed("MESSAGE_PARTS_CURSOR_INVALID")
      const end = offset + BigInt(scalars(value).length)
      if (end > total || (end === offset && end < total)) return failed()
      items.push({
        kind: "text",
        part_id: part.part_id as string,
        segment_id: segmentId,
        first_sequence: part.first_sequence as string,
        latest_sequence: part.latest_sequence as string,
        text: value,
        offset: String(offset),
        end: String(end),
        total_scalars: String(total),
        completed: part.completed,
      })
      if (end < total) {
        offset = end
        break
      }
    } else if (part.kind === "activity") {
      if (offset !== 0n) return failed("MESSAGE_PARTS_CURSOR_INVALID")
      const safe = parseAgentProcessPayload("activity", JSON.stringify(part.activity))
      if (safe?.kind !== "activity.updated" || part.part_id !== `activity:${safe.value.activity_id}`) return failed()
      items.push({
        kind: "activity",
        part_id: part.part_id as string,
        first_sequence: part.first_sequence as string,
        latest_sequence: part.latest_sequence as string,
        activity: { ...safe.value },
      })
    } else return failed()
    ordinal += 1n
    offset = 0n
  }
  if (ordinal < BigInt(count) && items.length === 0) return failed()
  return {
    session_id: cursor.conversationId,
    message_id: cursor.messageId,
    run_id: cursor.runId,
    format_version: 1,
    revision: cursor.revision,
    event_watermark: cursor.watermark,
    items,
    next_cursor: ordinal === BigInt(count) ? null : encodeMessagePartsCursor({ ...cursor, ordinal: String(ordinal), offset: String(offset) }),
  }
}

async function persistedPage(client: PoolClient, cursor: MessagePartsCursor, count: number, limit: number): Promise<MessagePartsPage> {
  if (BigInt(cursor.ordinal) > 2147483647n || BigInt(cursor.offset) > 2147483647n) return failed("MESSAGE_PARTS_CURSOR_INVALID")
  const rows = await client.query<SliceRow>(
    `SELECT slot.ordinal::text AS ordinal,
       CASE WHEN sum(octet_length((CASE WHEN slot.value->>'kind'='text' THEN slot.value-'text' ELSE slot.value END)::text)) OVER()<=1048576
         THEN CASE WHEN slot.value->>'kind'='text' THEN slot.value-'text' ELSE slot.value END END AS item,
       sum(octet_length((CASE WHEN slot.value->>'kind'='text' THEN slot.value-'text' ELSE slot.value END)::text)) OVER()::text AS metadata_bytes,
       CASE WHEN slot.value->>'kind'='text' THEN substring(slot.value->>'text' FROM (CASE WHEN slot.ordinal=$4::int THEN $5::int ELSE 0 END)+1 FOR 4096) END AS text_slice,
       CASE WHEN slot.value->>'kind'='text' THEN char_length(slot.value->>'text')::text END AS total_scalars
     FROM bff_message message CROSS JOIN LATERAL
       (SELECT n AS ordinal, message.ordered_parts->n AS value FROM generate_series($4::int,LEAST($4::int+$6::int-1,jsonb_array_length(message.ordered_parts)-1)) n) slot
     WHERE message.tenant_id=$1 AND message.conversation_id=$2 AND message.message_id=$3 ORDER BY slot.ordinal`,
    [cursor.tenantId, cursor.conversationId, cursor.messageId, Number(cursor.ordinal), Number(cursor.offset), limit],
  )
  return messagePartsPageFromSlices(cursor, count, rows.rows, limit)
}

type LegacyFrameRow = QueryResultRow & {
  public_sequence: string
  frame_index: number
  source_sequence: string
  source_event_id: string
  source_digest: string
  event_payload: unknown
  source_valid: boolean
}

/** Only a complete retained single-segment transcript can prove an old overwritten-body row. */
export async function recoverLegacyMessageParts(
  client: PoolClient,
  scope: MessagePartsScope,
  head: string | null,
  body: string,
  status: string,
): Promise<MessageParts | null> {
  if (head === null || !["completed", "failed"].includes(status) || Buffer.byteLength(body) > MAX_LEGACY_BYTES) return null
  const context = await client.query<{
    start_public_sequence: string
    first_public_sequence: string
    retention_floor_sequence: string
    subject_id: string
    source_valid: boolean
  }>(
    `SELECT process.start_public_sequence, LEAST(process.start_public_sequence,COALESCE((SELECT min(activity.first_public_sequence) FROM bff_agui_run_activity activity WHERE activity.tenant_id=process.tenant_id AND activity.session_id=process.session_id AND activity.run_id=process.run_id AND activity.subject_id=$3),process.start_public_sequence))::text AS first_public_sequence,
       stream.retention_floor_sequence,process.subject_id,
       (EXISTS(SELECT 1 FROM bff_agent_dispatch_outbox dispatch WHERE dispatch.tenant_id=process.tenant_id AND dispatch.conversation_id=process.session_id AND dispatch.run_id=process.run_id AND dispatch.subject_id=$3 AND dispatch.assistant_message_id=$5)
        AND EXISTS(SELECT 1 FROM bff_agui_source_event source JOIN bff_agui_event event ON event.tenant_id=source.tenant_id AND event.session_id=source.session_id AND event.source_owner=source.source_owner AND event.source_event_id=source.source_event_id
          WHERE source.tenant_id=process.tenant_id AND source.session_id=process.session_id AND source.source_owner=process.start_source_owner AND source.source_event_id=process.start_source_event_id
            AND source.source_sequence=process.start_source_sequence AND source.source_digest=process.start_source_digest AND source.source_occurred_at=process.start_source_occurred_at
            AND event.public_sequence=process.start_public_sequence AND event.cursor=process.start_public_cursor AND event.source_occurred_at=source.source_occurred_at AND event.event_type='RUN_STARTED'
            AND COALESCE(event.event_payload->>'runId',event.event_payload #>> '{metadata,kokoro,run_id}')=process.run_id)) AS source_valid
     FROM bff_agui_run_process process JOIN bff_agui_stream stream ON stream.tenant_id=process.tenant_id AND stream.session_id=process.session_id
     WHERE process.tenant_id=$1 AND process.session_id=$2 AND process.run_id=$4 AND process.subject_id=$3`,
    [scope.tenantId, scope.conversationId, scope.subjectId, scope.runId, scope.messageId],
  )
  const proof = context.rows[0]
  if (!proof || proof.subject_id !== scope.subjectId) return null
  if (BigInt(decimal(proof.retention_floor_sequence)) >= BigInt(decimal(proof.first_public_sequence, true))) return failed("MESSAGE_PARTS_GONE")
  if (!proof.source_valid) return null
  const bounds = await client.query<{ count: string; bytes: string; first: string | null; last: string | null }>(
    `SELECT count(*)::text AS count,COALESCE(sum(octet_length(event.event_payload::text)),0)::text AS bytes,min(event.public_sequence)::text AS first,max(event.public_sequence)::text AS last
     FROM bff_agui_event event WHERE event.tenant_id=$1 AND event.session_id=$2 AND event.source_owner='kokoro-agent'
       AND COALESCE(event.event_payload->>'runId',event.event_payload #>> '{metadata,kokoro,run_id}')=$3
       AND event.public_sequence>=$4::bigint AND event.public_sequence<=(SELECT public_sequence FROM bff_agui_event WHERE tenant_id=$1 AND session_id=$2 AND cursor=$5)`,
    [scope.tenantId, scope.conversationId, scope.runId, proof.first_public_sequence, head],
  )
  const bound = bounds.rows[0]
  if (!bound || bound.first === null || bound.last === null) return failed("MESSAGE_PARTS_GONE")
  if (BigInt(bound.count) > BigInt(MAX_LEGACY_FRAMES) || BigInt(bound.bytes) + BigInt(Buffer.byteLength(body)) > BigInt(MAX_LEGACY_BYTES)) return null
  if (bound.first !== proof.first_public_sequence || BigInt(bound.count) !== BigInt(bound.last) - BigInt(bound.first) + 1n) return null
  const frames = await client.query<LegacyFrameRow>(
    `SELECT event.public_sequence,event.frame_index,source.source_sequence,event.source_event_id,source.source_digest,event.event_payload,
       (source.source_owner='kokoro-agent' AND source.source_occurred_at=event.source_occurred_at AND source.source_digest~'^[0-9a-f]{64}$') AS source_valid
     FROM bff_agui_event event LEFT JOIN bff_agui_source_event source ON source.tenant_id=event.tenant_id AND source.session_id=event.session_id AND source.source_owner=event.source_owner AND source.source_event_id=event.source_event_id
     WHERE event.tenant_id=$1 AND event.session_id=$2 AND event.source_owner='kokoro-agent' AND event.public_sequence BETWEEN $3::bigint AND $4::bigint
     ORDER BY event.public_sequence LIMIT 513`,
    [scope.tenantId, scope.conversationId, bound.first, bound.last],
  )
  const firstSource = frames.rows[0]?.source_sequence,
    lastSource = frames.rows.at(-1)?.source_sequence
  if (!firstSource || !lastSource) return null
  const sources = await client.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM bff_agui_source_event WHERE tenant_id=$1 AND session_id=$2 AND source_owner='kokoro-agent' AND source_sequence BETWEEN $3::bigint AND $4::bigint",
    [scope.tenantId, scope.conversationId, firstSource, lastSource],
  )
  if (BigInt(sources.rows[0]?.count ?? "0") !== BigInt(lastSource) - BigInt(firstSource) + 1n) return null
  return recoverLegacyFrames(scope, body, status, proof.start_public_sequence, frames.rows)
}

export function recoverLegacyFrames(
  scope: MessagePartsScope,
  body: string,
  status: string,
  start: string,
  rows: readonly LegacyFrameRow[],
): MessageParts | null {
  try {
    if (rows.length === 0 || rows.length > MAX_LEGACY_FRAMES || Buffer.byteLength(body) > MAX_LEGACY_BYTES) return null
    const groups: Array<{ sequence: string; id: string; frames: Array<{ publicSequence: number; frame: AgUiEvent }> }> = []
    let textId: string | undefined,
      text = "",
      ends = 0,
      starts = 0,
      runStarts = 0,
      terminals = 0,
      previousPublic = 0n,
      lastSource = 0n
    for (const row of rows) {
      const position = BigInt(decimal(row.public_sequence, true)),
        source = BigInt(decimal(row.source_sequence, true))
      if (!row.source_valid || !/^[0-9a-f]{64}$/u.test(row.source_digest) || (previousPublic !== 0n && position !== previousPublic + 1n)) return null
      previousPublic = position
      if (!Number.isSafeInteger(Number(position))) return null
      const parsed = EventSchemas.parse(row.event_payload) as AgUiEvent
      if (
        parsed.metadata.kokoro.session_id !== scope.conversationId ||
        parsed.metadata.kokoro.run_id !== scope.runId ||
        parsed.metadata.kokoro.event_id !== row.source_event_id ||
        BigInt(parsed.metadata.kokoro.seq) !== source ||
        (parsed.runId !== undefined && parsed.runId !== scope.runId)
      )
        return null
      const group = groups.at(-1)
      if (group?.id === row.source_event_id) {
        if (group.sequence !== row.source_sequence || row.frame_index !== group.frames.length) return null
        group.frames.push({ publicSequence: Number(position), frame: parsed })
      } else {
        if (source <= lastSource || row.frame_index !== 0) return null
        lastSource = source
        groups.push({ sequence: row.source_sequence, id: row.source_event_id, frames: [{ publicSequence: Number(position), frame: parsed }] })
      }
      if (parsed.type === "TEXT_MESSAGE_START") {
        if (++starts !== 1 || parsed.role !== "assistant" || runStarts !== 1) return null
        textId = identity(parsed.messageId)
      } else if (parsed.type === "TEXT_MESSAGE_CONTENT") {
        if (parsed.messageId !== textId || typeof parsed.delta !== "string" || ends > 0) return null
        text += parsed.delta
      } else if (parsed.type === "TEXT_MESSAGE_END") {
        if (parsed.messageId !== textId || ++ends !== 1) return null
      } else if (parsed.type === "RUN_STARTED") {
        if (++runStarts !== 1 || row.public_sequence !== start) return null
      } else if (parsed.type === "RUN_FINISHED" || parsed.type === "RUN_ERROR") terminals += 1
      else if (parsed.type !== "CUSTOM" || !["kokoro.activity.updated", "kokoro.todo.updated", "kokoro.interaction.state"].includes(parsed.name ?? ""))
        return null
    }
    const terminal = groups.at(-1)?.frames.at(-1)?.frame
    const lastType = terminal?.type
    if (status === "completed" && (lastType !== "RUN_FINISHED" || terminal?.status !== "completed" || terminal.outcome?.type !== "success")) return null
    if (status === "failed" && lastType === "RUN_FINISHED" && (terminal?.status !== "cancelled" || terminal.outcome?.type !== "interrupt")) return null
    if (
      starts !== 1 ||
      runStarts !== 1 ||
      terminals !== 1 ||
      !["RUN_FINISHED", "RUN_ERROR"].includes(lastType ?? "") ||
      text !== body ||
      (status === "completed" && ends !== 1)
    )
      return null
    let state: MessageParts | null = { parts: [], formatVersion: 1, publicSequence: "0" }
    for (const group of groups) {
      const content = group.frames.find(({ frame }) => frame.type === "TEXT_MESSAGE_CONTENT")?.frame
      const end = group.frames.find(({ frame }) => frame.type === "TEXT_MESSAGE_END")?.frame
      const update: AgUiAssistantUpdate | undefined = content
        ? {
            runId: scope.runId,
            kind: group.frames.some(({ frame }) => frame.type === "TEXT_MESSAGE_START") ? "replace" : "append",
            segmentId: identity(content.messageId),
            completed: false,
            content: content.delta ?? "",
          }
        : end
          ? { runId: scope.runId, kind: "replace", segmentId: identity(end.messageId), completed: true, content: text }
          : undefined
      state = foldMessageParts(state, scope.runId, group.frames, update)
    }
    return state !== null && messagePartsContent(state) === body ? state : null
  } catch {
    return null
  }
}

function legacyPage(state: MessageParts, cursor: MessagePartsCursor, limit: number): MessagePartsPage {
  const ordinal = Number(cursor.ordinal),
    offset = Number(cursor.offset)
  if (!Number.isSafeInteger(ordinal) || !Number.isSafeInteger(offset)) return failed("MESSAGE_PARTS_CURSOR_INVALID")
  const rows: SliceRow[] = state.parts.slice(ordinal, ordinal + limit).map((part, index) => {
    if (part.kind !== "text") return { ordinal: String(ordinal + index), item: part, text_slice: null, total_scalars: null }
    const textScalars = scalars(part.text)
    const item = {
      kind: part.kind,
      part_id: part.part_id,
      segment_id: part.segment_id,
      first_sequence: part.first_sequence,
      latest_sequence: part.latest_sequence,
      completed: part.completed,
    }
    return {
      ordinal: String(ordinal + index),
      item,
      text_slice: textScalars.slice(index === 0 ? offset : 0, (index === 0 ? offset : 0) + TEXT_SCALARS).join(""),
      total_scalars: String(textScalars.length),
    }
  })
  return messagePartsPageFromSlices(cursor, state.parts.length, rows, limit)
}

export async function readMessageParts(pool: Pick<Pool, "connect">, query: MessagePartsQuery): Promise<MessagePartsPage | null> {
  if (query.scope === "direct" && query.projectRef !== undefined) return failed("MESSAGE_PARTS_SCOPE_INVALID")
  if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 32) return failed("MESSAGE_PARTS_CURSOR_INVALID")
  const parsed = query.cursor === null ? null : decodeMessagePartsCursor(query.cursor)
  try {
    return await withMessageReadClient(pool, query, async (client) => {
      const result = await client.query<OwnerRow>(
        `SELECT message.message_id,message.run_id,conversation.project_ref,message.status,message.parts_format_version,message.parts_public_sequence,
        CASE WHEN message.ordered_parts IS NOT NULL THEN jsonb_array_length(message.ordered_parts) END AS parts_count,
        CASE WHEN message.ordered_parts IS NULL AND octet_length(message.content)<=4194304 THEN message.content END AS legacy_text,
        octet_length(message.content)::text AS legacy_bytes, stream.latest_run_id AS selected_run_id,
        (SELECT latest.message_id FROM bff_message latest WHERE latest.tenant_id=message.tenant_id AND latest.conversation_id=message.conversation_id AND latest.role='assistant' ORDER BY latest.message_seq DESC,latest.message_id DESC LIMIT 1) AS latest_assistant_id
       FROM bff_message message JOIN bff_conversation conversation ON conversation.tenant_id=message.tenant_id AND conversation.conversation_id=message.conversation_id
       LEFT JOIN bff_agui_stream stream ON stream.tenant_id=message.tenant_id AND stream.session_id=message.conversation_id
       WHERE message.tenant_id=$1 AND conversation.owner_id=$2 AND message.conversation_id=$3 AND message.message_id=$4 AND message.role='assistant' AND message.run_id IS NOT NULL
         AND conversation.status='active' AND ($5::text IS NULL OR conversation.project_ref=$5) AND ($6::boolean=FALSE OR conversation.project_ref IS NULL)
         AND (conversation.project_ref IS NULL OR EXISTS(SELECT 1 FROM bff_project project WHERE project.tenant_id=conversation.tenant_id AND project.owner_id=conversation.owner_id AND project.deleted_at IS NULL AND (project.project_id=conversation.project_ref OR project.slug=conversation.project_ref)))`,
        [query.tenantId, query.subjectId, query.conversationId, query.messageId, query.projectRef ?? null, query.scope === "direct"],
      )
      const row = result.rows[0]
      if (!row) return null
      const scope: MessagePartsScope = {
        tenantId: query.tenantId,
        subjectId: query.subjectId,
        conversationId: query.conversationId,
        messageId: row.message_id,
        runId: identity(row.run_id),
        projectRef: row.project_ref,
        requestedProjectRef: query.projectRef ?? null,
        scope: query.scope,
      }
      if (parsed) assertMessagePartsCursorScope(parsed, scope)
      const head = parsed === null ? await currentWatermark(client, query.tenantId, query.conversationId) : parsed.watermark
      if (parsed?.watermark !== null && parsed !== null) {
        const known = await client.query<{ retained: boolean }>(
          "SELECT TRUE AS retained FROM bff_agui_event WHERE tenant_id=$1 AND session_id=$2 AND cursor=$3 UNION ALL SELECT FALSE AS retained FROM bff_agui_cursor_tombstone WHERE tenant_id=$1 AND session_id=$2 AND cursor=$3 LIMIT 1",
          [query.tenantId, query.conversationId, parsed.watermark],
        )
        if (known.rows.length === 0) return failed("MESSAGE_PARTS_CURSOR_INVALID")
        if (parsed.source === "ledger" && known.rows[0]?.retained === false) return failed("MESSAGE_PARTS_GONE")
      }
      let page: MessagePartsPage
      if (row.parts_format_version === null && row.parts_public_sequence === null && row.parts_count === null) {
        if ((parsed && parsed.source !== "ledger") || (!parsed && (row.latest_assistant_id !== row.message_id || row.selected_run_id !== row.run_id)))
          return failed()
        if (row.legacy_text === null || BigInt(decimal(row.legacy_bytes)) > BigInt(MAX_LEGACY_BYTES)) return failed()
        const state = await recoverLegacyMessageParts(client, scope, head, row.legacy_text, row.status)
        if (state === null) return failed()
        const cursor = parsed ?? cursorFor(scope, state.publicSequence, head, "ledger")
        if (cursor.revision !== state.publicSequence) return failed("MESSAGE_PARTS_CHANGED")
        page = legacyPage(state, cursor, query.limit)
      } else {
        if (row.parts_format_version !== 1 || row.parts_count === null || row.parts_public_sequence === null || (parsed && parsed.source !== "message"))
          return failed()
        const revision = decimal(row.parts_public_sequence)
        if (parsed && parsed.revision !== revision) return failed("MESSAGE_PARTS_CHANGED")
        page = await persistedPage(client, parsed ?? cursorFor(scope, revision, head, "message"), row.parts_count, query.limit)
      }
      if (Buffer.byteLength(JSON.stringify({ data: page, meta: { request_id: "r".repeat(256) } })) > MAX_PAGE_BYTES)
        return failed("MESSAGE_PARTS_BUDGET_EXCEEDED")
      return page
    })
  } catch (error) {
    if (error instanceof Error && /^MESSAGE_PARTS_(?:CURSOR_INVALID|SCOPE_INVALID|CHANGED|GONE|UNAVAILABLE|BUDGET_EXCEEDED)$/u.test(error.message)) throw error
    return failed()
  }
}

/** Snapshot/list may advertise only one selected, latest legacy assistant per read. */
export async function privateMessagesFromRows(
  client: PoolClient,
  rows: readonly PrivateMessageRow[],
  scope: Omit<MessagePartsScope, "messageId" | "runId">,
  head: string | null,
  selectedRun: string | null,
  latestAssistantId: string | null,
): Promise<PrivateMessageRead[]> {
  const messages = rows.map((row) => privateMessageFromRow(row, scope, head))
  let index = rows.length - 1
  while (index >= 0 && rows[index]?.role !== "assistant") index -= 1
  const row = rows[index],
    message = messages[index]
  if (
    !row ||
    !message ||
    message.content === null ||
    row.run_id === null ||
    row.run_id !== selectedRun ||
    row.message_id !== latestAssistantId ||
    head === null
  )
    return messages
  try {
    const exact = { ...scope, messageId: row.message_id, runId: row.run_id }
    const recovered = await recoverLegacyMessageParts(client, exact, head, message.content, row.status)
    if (recovered)
      messages[index] = {
        ...message,
        role: "assistant",
        runId: row.run_id,
        content: null,
        rendering: messageRendering(exact, recovered.publicSequence, head, "ledger"),
      }
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "MESSAGE_PARTS_GONE") throw error
  }
  return messages
}
