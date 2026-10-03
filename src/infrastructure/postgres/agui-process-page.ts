import type { PoolClient } from "pg"
import { createHash } from "node:crypto"

import type { RunProcessPage } from "../../application/ports/chat-repository.js"

const CURSOR = /^agui_[0-9a-f]{32}$/u
const MAX_PAGE_BYTES = 1024 * 1024

type AnchorRow = { public_sequence: string }
type ProcessRow = {
  run_id: string
  start_source_owner: string
  start_source_event_id: string
  start_source_sequence: string
  start_source_digest: string
  start_source_occurred_at: Date
  start_public_sequence: string
  start_public_cursor: string
  source_owner: string | null
  source_event_id: string | null
  source_sequence: string | null
  source_digest: string | null
  source_occurred_at: Date | null
  frame_cursor: string | null
  frame_source_owner: string | null
  frame_source_event_id: string | null
  frame_run_id: string | null
  frame_source_occurred_at: Date | null
  source_high_watermark: string
  retention_floor_sequence: string
  start_tombstoned: boolean
}
type ActivityRow = {
  activity_id: string
  first_sequence: string
  latest_sequence: string
  latest_cursor: string
  safe_payload: unknown
  source_valid: boolean
  compact_activity_id: string | null
  compact_first_sequence: string | null
  compact_latest_sequence: string | null
  compact_payload: unknown | null
  compact_digest: string | null
  compact_first_valid: boolean
  compact_latest_valid: boolean
}
type ActivityProvenanceRow = {
  activity_id: string
  activity_kind: string
  safe_payload: unknown
  payload_digest: string
  first_source_sequence: string
  latest_source_sequence: string
  first_public_sequence: string
  first_public_cursor: string
  latest_public_sequence: string
  latest_public_cursor: string
  latest_source_event_id: string
  first_valid: boolean
  latest_valid: boolean
  latest_ledger_sequence: string | null
  latest_ledger_cursor: string | null
  latest_ledger_source_event_id: string | null
  latest_ledger_payload: unknown | null
  source_high_watermark: string
}

export class ProcessCursorInvalidError extends Error {
  public constructor() {
    super("PROCESS_CURSOR_INVALID")
  }
}
export class ProcessCursorExpiredError extends Error {
  public constructor() {
    super("PROCESS_CURSOR_EXPIRED")
  }
}
export class ProcessProjectionUnavailableError extends Error {
  public constructor() {
    super("PROCESS_PROJECTION_UNAVAILABLE")
  }
}

function integer(value: string): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new ProcessProjectionUnavailableError()
  return parsed
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (typeof value !== "object") throw new ProcessProjectionUnavailableError()
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`
}

function digest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex")
}

async function cursorSequence(client: PoolClient, tenantId: string, sessionId: string, cursor: string): Promise<number> {
  if (!CURSOR.test(cursor)) throw new ProcessCursorInvalidError()
  const found = await client.query<AnchorRow>("SELECT public_sequence FROM bff_agui_event WHERE tenant_id=$1 AND session_id=$2 AND cursor=$3", [
    tenantId,
    sessionId,
    cursor,
  ])
  if (found.rows[0] !== undefined) return integer(found.rows[0].public_sequence)
  const expired = await client.query("SELECT 1 FROM bff_agui_cursor_tombstone WHERE tenant_id=$1 AND session_id=$2 AND cursor=$3", [
    tenantId,
    sessionId,
    cursor,
  ])
  if (expired.rows[0] !== undefined) throw new ProcessCursorExpiredError()
  throw new ProcessCursorInvalidError()
}

async function processAt(
  client: PoolClient,
  tenantId: string,
  sessionId: string,
  subjectId: string,
  anchor: number,
  runId?: string,
): Promise<ProcessRow | null> {
  const result = await client.query<ProcessRow>(
    `SELECT process.run_id,process.start_source_owner,process.start_source_event_id,process.start_source_sequence,
            process.start_source_digest,process.start_source_occurred_at,process.start_public_sequence,process.start_public_cursor,
            source.source_owner,source.source_event_id,source.source_sequence,source.source_digest,source.source_occurred_at,
            event.cursor AS frame_cursor,event.source_owner AS frame_source_owner,event.source_event_id AS frame_source_event_id,
            COALESCE(event.event_payload->>'runId',event.event_payload #>> '{metadata,kokoro,run_id}') AS frame_run_id,
            event.source_occurred_at AS frame_source_occurred_at,
            stream.source_high_watermark,stream.retention_floor_sequence,
            EXISTS (SELECT 1 FROM bff_agui_cursor_tombstone AS tombstone
              WHERE tombstone.tenant_id=process.tenant_id AND tombstone.session_id=process.session_id
                AND tombstone.cursor=process.start_public_cursor AND tombstone.public_sequence=process.start_public_sequence) AS start_tombstoned
       FROM bff_agui_run_process AS process
       JOIN bff_agui_stream AS stream ON stream.tenant_id=process.tenant_id AND stream.session_id=process.session_id
        AND stream.consumer_subject_id=process.subject_id
       LEFT JOIN bff_agui_source_event AS source
         ON source.tenant_id=process.tenant_id AND source.session_id=process.session_id
        AND source.source_owner=process.start_source_owner AND source.source_event_id=process.start_source_event_id
       LEFT JOIN bff_agui_event AS event
         ON event.tenant_id=process.tenant_id AND event.session_id=process.session_id
        AND event.public_sequence=process.start_public_sequence AND event.cursor=process.start_public_cursor
        AND event.event_type='RUN_STARTED'
      WHERE process.tenant_id=$1 AND process.session_id=$2 AND process.subject_id=$3
        AND process.start_public_sequence<=$4 AND ($5::text IS NULL OR process.run_id=$5)
      ORDER BY process.start_public_sequence DESC LIMIT 1`,
    [tenantId, sessionId, subjectId, anchor, runId ?? null],
  )
  const row = result.rows[0]
  if (row === undefined) return null
  if (
    row.start_source_owner !== "kokoro-agent" ||
    integer(row.start_source_sequence) > integer(row.source_high_watermark) ||
    row.source_owner !== row.start_source_owner ||
    row.source_event_id !== row.start_source_event_id ||
    row.source_sequence !== row.start_source_sequence ||
    row.source_digest !== row.start_source_digest ||
    row.source_occurred_at?.getTime() !== row.start_source_occurred_at.getTime()
  )
    throw new ProcessProjectionUnavailableError()
  if (row.frame_cursor === null && row.start_tombstoned && integer(row.retention_floor_sequence) >= integer(row.start_public_sequence))
    throw new ProcessCursorExpiredError()
  if (
    row.frame_source_owner !== row.start_source_owner ||
    row.frame_source_event_id !== row.start_source_event_id ||
    row.frame_cursor !== row.start_public_cursor ||
    row.frame_run_id !== row.run_id ||
    row.frame_source_occurred_at?.getTime() !== row.start_source_occurred_at.getTime()
  )
    throw new ProcessProjectionUnavailableError()
  return row
}

async function todosAt(client: PoolClient, tenantId: string, sessionId: string, runId: string, anchor: number): Promise<unknown[] | null> {
  const compact = await client.query<{
    todo_observed: boolean
    todos: unknown
    todo_digest: string | null
    todo_source_event_id: string | null
    todo_source_sequence: string | null
    todo_public_sequence: string | null
    todo_public_cursor: string | null
    compact_valid: boolean
    latest_sequence: string | null
    latest_cursor: string | null
    latest_source_event_id: string | null
    latest_value: unknown | null
    source_high_watermark: string
  }>(
    `SELECT process.todo_observed,process.todos,process.todo_digest,process.todo_source_event_id,process.todo_source_sequence,
            process.todo_public_sequence,process.todo_public_cursor,stream.source_high_watermark,
            EXISTS (SELECT 1 FROM bff_agui_event AS frame JOIN bff_agui_source_event AS source
              ON source.tenant_id=frame.tenant_id AND source.session_id=frame.session_id
             AND source.source_owner=process.todo_source_owner AND source.source_event_id=process.todo_source_event_id
             AND source.source_sequence=process.todo_source_sequence AND source.source_digest=process.todo_source_digest
             AND source.source_occurred_at=process.todo_source_occurred_at
             AND frame.source_occurred_at=source.source_occurred_at
             WHERE frame.tenant_id=process.tenant_id AND frame.session_id=process.session_id
               AND frame.public_sequence=process.todo_public_sequence AND frame.cursor=process.todo_public_cursor
               AND frame.source_owner=process.todo_source_owner AND frame.source_event_id=process.todo_source_event_id
               AND frame.event_type='CUSTOM' AND frame.event_payload->>'name'='kokoro.todo.updated'
               AND COALESCE(frame.event_payload->>'runId',frame.event_payload #>> '{metadata,kokoro,run_id}')=process.run_id
               AND frame.event_payload->'value'->'todos'=process.todos) AS compact_valid,
            latest.public_sequence::text AS latest_sequence,latest.cursor AS latest_cursor,
            latest.source_event_id AS latest_source_event_id,latest.event_payload->'value'->'todos' AS latest_value
       FROM bff_agui_run_process AS process
       JOIN bff_agui_stream AS stream ON stream.tenant_id=process.tenant_id AND stream.session_id=process.session_id
       LEFT JOIN LATERAL (
         SELECT event.public_sequence,event.cursor,event.source_event_id,event.event_payload
           FROM bff_agui_event AS event
          WHERE event.tenant_id=process.tenant_id AND event.session_id=process.session_id
            AND event.event_type='CUSTOM' AND event.event_payload->>'name'='kokoro.todo.updated'
            AND COALESCE(event.event_payload->>'runId',event.event_payload #>> '{metadata,kokoro,run_id}')=process.run_id
          ORDER BY event.public_sequence DESC LIMIT 1
       ) AS latest ON TRUE
      WHERE process.tenant_id=$1 AND process.session_id=$2 AND process.run_id=$3`,
    [tenantId, sessionId, runId],
  )
  const current = compact.rows[0]
  if (current === undefined) throw new ProcessProjectionUnavailableError()
  if (!current.todo_observed) {
    if (current.latest_sequence !== null) throw new ProcessProjectionUnavailableError()
    return null
  }
  if (
    current.todo_source_sequence === null ||
    current.todo_public_sequence === null ||
    current.todo_public_cursor === null ||
    current.todo_digest === null ||
    !Array.isArray(current.todos) ||
    !current.compact_valid ||
    integer(current.todo_source_sequence) > integer(current.source_high_watermark) ||
    current.latest_sequence !== current.todo_public_sequence ||
    current.latest_cursor !== current.todo_public_cursor ||
    current.latest_source_event_id !== current.todo_source_event_id ||
    current.latest_value === null ||
    !Array.isArray(current.latest_value) ||
    canonicalJson(current.latest_value) !== canonicalJson(current.todos) ||
    current.todo_digest !== digest(current.todos)
  )
    throw new ProcessProjectionUnavailableError()
  const anchored = await client.query<{
    value: unknown
    public_sequence: string
    cursor: string
    source_valid: boolean
  }>(
    `SELECT event.event_payload->'value'->'todos' AS value,event.public_sequence,event.cursor,
            EXISTS (SELECT 1 FROM bff_agui_source_event AS source
              WHERE source.tenant_id=event.tenant_id AND source.session_id=event.session_id
                AND source.source_owner=event.source_owner AND source.source_event_id=event.source_event_id
                AND source.source_occurred_at=event.source_occurred_at) AS source_valid
       FROM bff_agui_event AS event
      WHERE event.tenant_id=$1 AND event.session_id=$2 AND event.public_sequence<=$4
        AND event.event_type='CUSTOM' AND event.event_payload->>'name'='kokoro.todo.updated'
        AND COALESCE(event.event_payload->>'runId',event.event_payload #>> '{metadata,kokoro,run_id}')=$3
      ORDER BY event.public_sequence DESC LIMIT 1`,
    [tenantId, sessionId, runId, anchor],
  )
  const row = anchored.rows[0]
  if (row === undefined) {
    if (integer(current.todo_public_sequence) <= anchor) throw new ProcessProjectionUnavailableError()
    return null
  }
  if (!Array.isArray(row.value) || !row.source_valid) throw new ProcessProjectionUnavailableError()
  if (
    integer(current.todo_public_sequence) <= anchor &&
    (row.public_sequence !== current.todo_public_sequence ||
      row.cursor !== current.todo_public_cursor ||
      canonicalJson(row.value) !== canonicalJson(current.todos))
  )
    throw new ProcessProjectionUnavailableError()
  return row.value
}

async function validateActivityProvenance(client: PoolClient, tenantId: string, sessionId: string, runId: string): Promise<void> {
  const compact = await client.query<ActivityProvenanceRow>(
    `SELECT activity.activity_id,activity.activity_kind,activity.safe_payload,activity.payload_digest,
            activity.first_source_sequence,activity.latest_source_sequence,
            activity.first_public_sequence,activity.first_public_cursor,
            activity.latest_public_sequence,activity.latest_public_cursor,activity.latest_source_event_id,
            stream.source_high_watermark,
            EXISTS (SELECT 1 FROM bff_agui_event AS frame JOIN bff_agui_source_event AS source
              ON source.tenant_id=frame.tenant_id AND source.session_id=frame.session_id
             AND source.source_owner=activity.first_source_owner AND source.source_event_id=activity.first_source_event_id
             AND source.source_sequence=activity.first_source_sequence AND source.source_digest=activity.first_source_digest
             AND source.source_occurred_at=activity.first_source_occurred_at
             AND frame.source_occurred_at=source.source_occurred_at
             WHERE frame.tenant_id=activity.tenant_id AND frame.session_id=activity.session_id
               AND frame.public_sequence=activity.first_public_sequence AND frame.cursor=activity.first_public_cursor
               AND frame.source_owner=activity.first_source_owner AND frame.source_event_id=activity.first_source_event_id
               AND frame.event_type='CUSTOM' AND frame.event_payload->>'name'='kokoro.activity.updated'
               AND COALESCE(frame.event_payload->>'runId',frame.event_payload #>> '{metadata,kokoro,run_id}')=activity.run_id
               AND frame.event_payload #>> '{value,activity_id}'=activity.activity_id) AS first_valid,
            EXISTS (SELECT 1 FROM bff_agui_event AS frame JOIN bff_agui_source_event AS source
              ON source.tenant_id=frame.tenant_id AND source.session_id=frame.session_id
             AND source.source_owner=activity.latest_source_owner AND source.source_event_id=activity.latest_source_event_id
             AND source.source_sequence=activity.latest_source_sequence AND source.source_digest=activity.latest_source_digest
             AND source.source_occurred_at=activity.latest_source_occurred_at
             AND frame.source_occurred_at=source.source_occurred_at
             WHERE frame.tenant_id=activity.tenant_id AND frame.session_id=activity.session_id
               AND frame.public_sequence=activity.latest_public_sequence AND frame.cursor=activity.latest_public_cursor
               AND frame.source_owner=activity.latest_source_owner AND frame.source_event_id=activity.latest_source_event_id
               AND frame.event_type='CUSTOM' AND frame.event_payload->>'name'='kokoro.activity.updated'
               AND COALESCE(frame.event_payload->>'runId',frame.event_payload #>> '{metadata,kokoro,run_id}')=activity.run_id
               AND frame.event_payload #>> '{value,activity_id}'=activity.activity_id
               AND frame.event_payload->'value'=activity.safe_payload) AS latest_valid,
            latest.public_sequence::text AS latest_ledger_sequence,latest.cursor AS latest_ledger_cursor,
            latest.source_event_id AS latest_ledger_source_event_id,latest.event_payload->'value' AS latest_ledger_payload
       FROM bff_agui_run_activity AS activity
       JOIN bff_agui_stream AS stream ON stream.tenant_id=activity.tenant_id AND stream.session_id=activity.session_id
       LEFT JOIN LATERAL (
         SELECT event.public_sequence,event.cursor,event.source_event_id,event.event_payload
           FROM bff_agui_event AS event
          WHERE event.tenant_id=activity.tenant_id AND event.session_id=activity.session_id
            AND event.event_type='CUSTOM' AND event.event_payload->>'name'='kokoro.activity.updated'
            AND COALESCE(event.event_payload->>'runId',event.event_payload #>> '{metadata,kokoro,run_id}')=activity.run_id
            AND event.event_payload #>> '{value,activity_id}'=activity.activity_id
          ORDER BY event.public_sequence DESC LIMIT 1
       ) AS latest ON TRUE
      WHERE activity.tenant_id=$1 AND activity.session_id=$2 AND activity.run_id=$3
      ORDER BY activity.first_public_sequence,activity.activity_id`,
    [tenantId, sessionId, runId],
  )
  for (const row of compact.rows) {
    const value =
      typeof row.safe_payload === "object" && row.safe_payload !== null && !Array.isArray(row.safe_payload)
        ? (row.safe_payload as Record<string, unknown>)
        : null
    if (
      value === null ||
      value.activity_id !== row.activity_id ||
      value.activity !== row.activity_kind ||
      !row.first_valid ||
      !row.latest_valid ||
      integer(row.first_source_sequence) > integer(row.source_high_watermark) ||
      integer(row.latest_source_sequence) > integer(row.source_high_watermark) ||
      integer(row.first_public_sequence) > integer(row.latest_public_sequence) ||
      row.latest_ledger_sequence !== row.latest_public_sequence ||
      row.latest_ledger_cursor !== row.latest_public_cursor ||
      row.latest_ledger_source_event_id !== row.latest_source_event_id ||
      canonicalJson(row.latest_ledger_payload) !== canonicalJson(row.safe_payload) ||
      row.payload_digest !== digest(row.safe_payload)
    )
      throw new ProcessProjectionUnavailableError()
  }
  const orphan = await client.query(
    `SELECT 1 FROM bff_agui_event AS event
      LEFT JOIN bff_agui_run_activity AS activity
        ON activity.tenant_id=event.tenant_id AND activity.session_id=event.session_id AND activity.run_id=$3
       AND activity.activity_id=event.event_payload #>> '{value,activity_id}'
     WHERE event.tenant_id=$1 AND event.session_id=$2 AND event.event_type='CUSTOM'
       AND event.event_payload->>'name'='kokoro.activity.updated'
       AND COALESCE(event.event_payload->>'runId',event.event_payload #>> '{metadata,kokoro,run_id}')=$3
       AND (activity.activity_id IS NULL OR NOT EXISTS (SELECT 1 FROM bff_agui_source_event AS source
         WHERE source.tenant_id=event.tenant_id AND source.session_id=event.session_id
           AND source.source_owner=event.source_owner AND source.source_event_id=event.source_event_id
           AND source.source_occurred_at=event.source_occurred_at)) LIMIT 1`,
    [tenantId, sessionId, runId],
  )
  if (orphan.rows[0] !== undefined) throw new ProcessProjectionUnavailableError()
}

export async function readRunProcessPage(
  client: PoolClient,
  input: Readonly<{
    tenantId: string
    sessionId: string
    subjectId: string
    runId?: string
    watermark: string
    cursor: string | null
    limit: number
  }>,
): Promise<RunProcessPage | null> {
  const anchor = await cursorSequence(client, input.tenantId, input.sessionId, input.watermark)
  const process = await processAt(client, input.tenantId, input.sessionId, input.subjectId, anchor, input.runId)
  if (process === null) {
    const orphan = await client.query(
      `SELECT 1 FROM bff_agui_event WHERE tenant_id=$1 AND session_id=$2 AND public_sequence<=$3 AND event_type='RUN_STARTED'
        AND ($4::text IS NULL OR COALESCE(event_payload->>'runId',event_payload #>> '{metadata,kokoro,run_id}')=$4) LIMIT 1`,
      [input.tenantId, input.sessionId, anchor, input.runId ?? null],
    )
    if (orphan.rows[0] !== undefined) throw new ProcessProjectionUnavailableError()
    return null
  }
  await validateActivityProvenance(client, input.tenantId, input.sessionId, process.run_id)
  const rows = await client.query<ActivityRow>(
    `WITH revisions AS MATERIALIZED (
       SELECT event.public_sequence,event.cursor,event.event_payload->'value' AS safe_payload,
              EXISTS (SELECT 1 FROM bff_agui_source_event AS source
                WHERE source.tenant_id=event.tenant_id AND source.session_id=event.session_id
                  AND source.source_owner=event.source_owner AND source.source_event_id=event.source_event_id
                  AND source.source_occurred_at=event.source_occurred_at) AS source_valid,
              event.event_payload #>> '{value,activity_id}' AS activity_id
         FROM bff_agui_event AS event
        WHERE event.tenant_id=$1 AND event.session_id=$2 AND event.public_sequence<=$4
          AND event.event_type='CUSTOM' AND event.event_payload->>'name'='kokoro.activity.updated'
          AND COALESCE(event.event_payload->>'runId',event.event_payload #>> '{metadata,kokoro,run_id}')=$3
     ), latest AS (
       SELECT DISTINCT ON (activity_id) activity_id,safe_payload,source_valid,cursor AS latest_cursor,public_sequence AS latest_sequence
         FROM revisions ORDER BY activity_id,public_sequence DESC
     ), positioned AS (
       SELECT latest.activity_id,latest.safe_payload,latest.source_valid,latest.latest_cursor,latest.latest_sequence,
              (SELECT min(first.public_sequence) FROM revisions AS first WHERE first.activity_id=latest.activity_id) AS first_sequence
         FROM latest
     ), after_position AS (
       SELECT first_sequence,activity_id FROM positioned WHERE latest_cursor=$5
     )
     SELECT positioned.activity_id,positioned.first_sequence::text,positioned.latest_sequence::text,positioned.latest_cursor,positioned.safe_payload,positioned.source_valid,
            compact.activity_id AS compact_activity_id,compact.first_public_sequence::text AS compact_first_sequence,
            compact.latest_public_sequence::text AS compact_latest_sequence,compact.safe_payload AS compact_payload,compact.payload_digest AS compact_digest,
            EXISTS (SELECT 1 FROM bff_agui_event AS first_frame JOIN bff_agui_source_event AS first_source
              ON first_source.tenant_id=first_frame.tenant_id AND first_source.session_id=first_frame.session_id
             AND first_source.source_owner=compact.first_source_owner AND first_source.source_event_id=compact.first_source_event_id
             AND first_source.source_sequence=compact.first_source_sequence AND first_source.source_digest=compact.first_source_digest
             WHERE first_frame.tenant_id=compact.tenant_id AND first_frame.session_id=compact.session_id
               AND first_frame.public_sequence=compact.first_public_sequence AND first_frame.cursor=compact.first_public_cursor
               AND first_frame.source_owner=compact.first_source_owner AND first_frame.source_event_id=compact.first_source_event_id) AS compact_first_valid,
            EXISTS (SELECT 1 FROM bff_agui_event AS latest_frame JOIN bff_agui_source_event AS latest_source
              ON latest_source.tenant_id=latest_frame.tenant_id AND latest_source.session_id=latest_frame.session_id
             AND latest_source.source_owner=compact.latest_source_owner AND latest_source.source_event_id=compact.latest_source_event_id
             AND latest_source.source_sequence=compact.latest_source_sequence AND latest_source.source_digest=compact.latest_source_digest
             WHERE latest_frame.tenant_id=compact.tenant_id AND latest_frame.session_id=compact.session_id
               AND latest_frame.public_sequence=compact.latest_public_sequence AND latest_frame.cursor=compact.latest_public_cursor
               AND latest_frame.source_owner=compact.latest_source_owner AND latest_frame.source_event_id=compact.latest_source_event_id) AS compact_latest_valid
       FROM positioned
       LEFT JOIN bff_agui_run_activity AS compact
         ON compact.tenant_id=$1 AND compact.session_id=$2 AND compact.run_id=$3 AND compact.activity_id=positioned.activity_id
      WHERE $5::text IS NULL OR (positioned.first_sequence,positioned.activity_id) > ((SELECT first_sequence FROM after_position),(SELECT activity_id FROM after_position))
      ORDER BY positioned.first_sequence,positioned.activity_id LIMIT $6`,
    [input.tenantId, input.sessionId, process.run_id, anchor, input.cursor, input.limit + 1],
  )
  if (input.cursor !== null && !CURSOR.test(input.cursor)) throw new ProcessCursorInvalidError()
  if (input.cursor !== null) {
    const cursorExists = await client.query(
      `SELECT 1 FROM (
         SELECT DISTINCT ON (event_payload #>> '{value,activity_id}') cursor
           FROM bff_agui_event WHERE tenant_id=$1 AND session_id=$2 AND public_sequence<=$4
            AND event_type='CUSTOM' AND event_payload->>'name'='kokoro.activity.updated'
            AND COALESCE(event_payload->>'runId',event_payload #>> '{metadata,kokoro,run_id}')=$5
          ORDER BY event_payload #>> '{value,activity_id}',public_sequence DESC
       ) AS latest WHERE cursor=$3`,
      [input.tenantId, input.sessionId, input.cursor, anchor, process.run_id],
    )
    if (cursorExists.rows[0] === undefined) {
      const expired = await client.query("SELECT 1 FROM bff_agui_cursor_tombstone WHERE tenant_id=$1 AND session_id=$2 AND cursor=$3", [
        input.tenantId,
        input.sessionId,
        input.cursor,
      ])
      if (expired.rows[0] !== undefined) throw new ProcessCursorExpiredError()
      throw new ProcessCursorInvalidError()
    }
  }
  for (const row of rows.rows) {
    if (!row.source_valid || row.compact_activity_id !== row.activity_id || row.compact_first_sequence !== row.first_sequence || !row.compact_first_valid) {
      throw new ProcessProjectionUnavailableError()
    }
    if (
      row.compact_latest_sequence !== null &&
      integer(row.compact_latest_sequence) <= anchor &&
      (row.compact_latest_sequence !== row.latest_sequence ||
        !row.compact_latest_valid ||
        canonicalJson(row.compact_payload) !== canonicalJson(row.safe_payload) ||
        row.compact_digest !== digest(row.safe_payload))
    )
      throw new ProcessProjectionUnavailableError()
  }
  const todos = await todosAt(client, input.tenantId, input.sessionId, process.run_id, anchor)
  const activities: Array<Record<string, unknown>> = []
  let nextCursor: string | null = null
  for (let index = 0; index < rows.rows.length && index < input.limit; index += 1) {
    const row = rows.rows[index]
    if (row === undefined) break
    const candidate = [...activities, row.safe_payload as Record<string, unknown>]
    const candidateNext = rows.rows.length > index + 1 ? row.latest_cursor : null
    const candidatePage = {
      run_id: process.run_id,
      todos,
      activities: candidate,
      next_cursor: candidateNext,
      event_watermark: input.watermark,
    }
    if (Buffer.byteLength(JSON.stringify(candidatePage), "utf8") > MAX_PAGE_BYTES) break
    activities.push(row.safe_payload as Record<string, unknown>)
    nextCursor = candidateNext
  }
  if (activities.length === 0 && rows.rows.length > 0) throw new ProcessProjectionUnavailableError()
  const page: RunProcessPage = {
    run_id: process.run_id,
    todos,
    activities,
    next_cursor: nextCursor,
    event_watermark: input.watermark,
  }
  if (Buffer.byteLength(JSON.stringify(page), "utf8") > MAX_PAGE_BYTES) throw new ProcessProjectionUnavailableError()
  return page
}
