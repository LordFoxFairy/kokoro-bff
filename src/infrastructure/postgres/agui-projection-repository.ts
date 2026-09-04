import { randomUUID } from "node:crypto"

import { AgUiSourceIdentityConflictError } from "../../application/agui/errors.js"
import type {
  AgUiConsumerLease,
  AgUiExpiredCursor,
  AgUiInvalidCursor,
  AgUiProjectionRepository,
  AgUiProjectionStateSnapshot,
  AgUiProjectionStatus,
  AgUiSourceIdentity,
  AgUiStreamState,
  AgUiReplayPage,
  CommitAgUiProjection,
  StoredAgUiFrame,
} from "../../application/agui/ports/agui-projection-repository.js"
import type { PostgresBffDatabase } from "./client.js"

type StreamRow = {
  version: string
  source_high_watermark: string
  next_public_sequence: string
  projection_state: unknown
  expected_run_id: string | null
  latest_run_id: string | null
  latest_run_start_sequence: string | null
  terminal_run_id: string | null
  retention_floor_sequence: string
  consumer_subject_id: string | null
  consumer_state: "active" | "blocked" | "stopped"
  consumer_lease_owner: string | null
  consumer_lease_token: string | null
  consumer_lease_until: Date | null
  consumer_fence: string
}

type FrameRow = {
  public_sequence: string
  cursor: string
  event_type: string
  event_payload: unknown
}

type StatusRow = {
  source_high_watermark: string
  current_cursor: string | null
  retention_floor_sequence: string
  consumer_subject_id: string | null
  consumer_state: "active" | "blocked" | "stopped"
  consumer_last_error_code: string | null
  consumer_last_polled_at: Date | null
}

type ReplayRow = {
  cursor_valid: boolean
  cursor_expired: boolean
  after_sequence: string
  head_sequence: string
  terminal_run_id: string | null
  public_sequence: string | null
  cursor: string | null
  event_type: string | null
  event_payload: unknown | null
}

type SourceIdentityRow = {
  source_event_id: string
  source_sequence: string
  source_digest: string
  source_occurred_at: Date
}

function safeInteger(value: string | number, label: string): number {
  const parsed = typeof value === "number" ? value : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`Stored AG-UI ${label} is invalid`)
  return parsed
}

function instant(value: string, label: string): string {
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) throw new Error(`${label} is invalid`)
  return parsed.toISOString()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`Stored AG-UI projection ${label} is invalid`)
  }
  return value.map((item) => String(item))
}

function projectionState(value: unknown): AgUiProjectionStateSnapshot {
  if (!isRecord(value)) throw new Error("Stored AG-UI projection state is invalid")
  return {
    textMessageIds: stringArray(value.text_message_ids, "text_message_ids"),
    toolCallIds: stringArray(value.tool_call_ids, "tool_call_ids"),
  }
}

function storedFrame(row: FrameRow): StoredAgUiFrame {
  return {
    publicSequence: safeInteger(row.public_sequence, "public sequence"),
    cursor: row.cursor,
    eventType: row.event_type,
    payload: row.event_payload,
  }
}

function newCursor(): string {
  return `agui_${randomUUID().replaceAll("-", "")}`
}

function streamColumns(): string {
  return `version, source_high_watermark, next_public_sequence, projection_state,
          expected_run_id, latest_run_id, latest_run_start_sequence, terminal_run_id, retention_floor_sequence,
          consumer_subject_id, consumer_state,
          consumer_lease_owner, consumer_lease_token, consumer_lease_until, consumer_fence`
}

function leaseMatches(row: StreamRow, lease: AgUiConsumerLease): boolean {
  return row.consumer_subject_id === lease.subjectId
    && row.consumer_state === "active"
    && row.consumer_lease_owner === lease.leaseOwner
    && row.consumer_lease_token === lease.leaseToken
    && safeInteger(row.consumer_fence, "consumer fence") === lease.fence
    && row.consumer_lease_until !== null
}

export class PostgresAgUiProjectionRepository implements AgUiProjectionRepository {
  public constructor(private readonly database: PostgresBffDatabase) {}

  public async readStream(tenantId: string, sessionId: string): Promise<AgUiStreamState> {
    const result = await this.database.pool.query<StreamRow>(
      `SELECT ${streamColumns()}
         FROM bff_agui_stream
        WHERE tenant_id = $1 AND session_id = $2`,
      [tenantId, sessionId],
    )
    const row = result.rows[0]
    if (row === undefined) {
      return {
        version: 0,
        sourceHighWatermark: 0,
        projectionState: { textMessageIds: [], toolCallIds: [] },
        expectedRunId: null,
        latestRunId: null,
        terminalRunId: null,
        retentionFloorSequence: 0,
      }
    }
    return {
      version: safeInteger(row.version, "stream version"),
      sourceHighWatermark: safeInteger(row.source_high_watermark, "source high watermark"),
      projectionState: projectionState(row.projection_state),
      expectedRunId: row.expected_run_id,
      latestRunId: row.latest_run_id,
      terminalRunId: row.terminal_run_id,
      retentionFloorSequence: safeInteger(row.retention_floor_sequence, "retention floor"),
    }
  }

  public async assertPersistedSources(
    tenantId: string,
    sessionId: string,
    sources: readonly AgUiSourceIdentity[],
  ): Promise<void> {
    if (sources.length === 0) return
    const result = await this.database.pool.query<SourceIdentityRow>(
      `SELECT source_event_id, source_sequence, source_digest, source_occurred_at
         FROM bff_agui_source_event
        WHERE tenant_id = $1
          AND session_id = $2
          AND source_owner = 'kokoro-agent'
          AND (source_event_id = ANY($3::text[]) OR source_sequence = ANY($4::bigint[]))`,
      [
        tenantId,
        sessionId,
        sources.map((source) => source.sourceEventId),
        sources.map((source) => source.sourceSequence),
      ],
    )
    const byEventId = new Map(result.rows.map((row) => [row.source_event_id, row]))
    const bySequence = new Map(result.rows.map((row) => [safeInteger(row.source_sequence, "source sequence"), row]))
    for (const source of sources) {
      const eventRow = byEventId.get(source.sourceEventId)
      const sequenceRow = bySequence.get(source.sourceSequence)
      if (
        eventRow === undefined
        || sequenceRow === undefined
        || eventRow !== sequenceRow
        || eventRow.source_digest !== source.sourceDigest
        || eventRow.source_occurred_at.toISOString() !== new Date(source.sourceOccurredAt).toISOString()
      ) throw new AgUiSourceIdentityConflictError()
    }
  }

  public async commitProjection(command: CommitAgUiProjection): Promise<"committed" | "version_conflict" | "lease_conflict"> {
    const client = await this.database.pool.connect()
    let notificationCursor: string | null = null
    try {
      await client.query("BEGIN")
      await client.query(
        `INSERT INTO bff_agui_stream (tenant_id, session_id)
         VALUES ($1, $2)
         ON CONFLICT (tenant_id, session_id) DO NOTHING`,
        [command.tenantId, command.sessionId],
      )
      const locked = await client.query<StreamRow>(
        `SELECT ${streamColumns()}
           FROM bff_agui_stream
          WHERE tenant_id = $1 AND session_id = $2
          FOR UPDATE`,
        [command.tenantId, command.sessionId],
      )
      const stream = locked.rows[0]
      if (stream === undefined) throw new Error("AG-UI stream allocation failed")
      if (safeInteger(stream.version, "stream version") !== command.expectedVersion) {
        await client.query("ROLLBACK")
        return "version_conflict"
      }
      if (command.consumerLease !== undefined && !leaseMatches(stream, command.consumerLease)) {
        await client.query("ROLLBACK")
        return "lease_conflict"
      }

      const currentSourceHighWatermark = safeInteger(stream.source_high_watermark, "source high watermark")
      if (command.sourceHighWatermark < currentSourceHighWatermark) {
        await client.query("ROLLBACK")
        return "version_conflict"
      }
      let nextPublicSequence = safeInteger(stream.next_public_sequence, "next public sequence")
      let latestRunStartSequence = stream.latest_run_start_sequence === null
        ? null
        : safeInteger(stream.latest_run_start_sequence, "latest run start sequence")
      for (const source of command.sources) {
        const inserted = await client.query<{ source_event_id: string }>(
          `INSERT INTO bff_agui_source_event
             (tenant_id, session_id, source_owner, source_event_id, source_sequence, source_digest, source_occurred_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT DO NOTHING
           RETURNING source_event_id`,
          [
            command.tenantId,
            command.sessionId,
            source.sourceOwner,
            source.sourceEventId,
            source.sourceSequence,
            source.sourceDigest,
            instant(source.sourceOccurredAt, "source occurred at"),
          ],
        )
        if (inserted.rows[0] === undefined) throw new AgUiSourceIdentityConflictError()

        for (const [frameIndex, frame] of source.frames.entries()) {
          const frameCursor = newCursor()
          if (frame.type === "RUN_STARTED") latestRunStartSequence = nextPublicSequence
          await client.query(
            `INSERT INTO bff_agui_event
               (tenant_id, session_id, public_sequence, cursor, source_owner, source_event_id,
                frame_index, event_type, event_payload, source_occurred_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)`,
            [
              command.tenantId,
              command.sessionId,
              nextPublicSequence,
              frameCursor,
              source.sourceOwner,
              source.sourceEventId,
              frameIndex,
              frame.type,
              JSON.stringify(frame),
              instant(source.sourceOccurredAt, "source occurred at"),
            ],
          )
          nextPublicSequence += 1
          notificationCursor = frameCursor
        }
      }

      const updated = await client.query(
        `UPDATE bff_agui_stream
            SET version = version + 1,
                source_high_watermark = $3,
                next_public_sequence = $4,
                projection_state = $5::jsonb,
                latest_run_id = $6,
                latest_run_start_sequence = $7,
                terminal_run_id = CASE
                  WHEN $8::text IS NULL OR expected_run_id IS NULL OR expected_run_id = $8 THEN $8
                  ELSE terminal_run_id
                END,
                updated_at = CURRENT_TIMESTAMP(3)
          WHERE tenant_id = $1
            AND session_id = $2
            AND version = $9
            AND ($10::text IS NULL OR (
              consumer_lease_owner = $10
              AND consumer_lease_token = $11
              AND consumer_fence = $12
              AND consumer_lease_until > CURRENT_TIMESTAMP(3)
            ))`,
        [
          command.tenantId,
          command.sessionId,
          command.sourceHighWatermark,
          nextPublicSequence,
          JSON.stringify({
            text_message_ids: command.projectionState.textMessageIds,
            tool_call_ids: command.projectionState.toolCallIds,
          }),
          command.latestRunId ?? null,
          latestRunStartSequence,
          command.terminalRunId ?? null,
          command.expectedVersion,
          command.consumerLease?.leaseOwner ?? null,
          command.consumerLease?.leaseToken ?? null,
          command.consumerLease?.fence ?? null,
        ],
      )
      if (updated.rowCount !== 1) {
        await client.query("ROLLBACK")
        return command.consumerLease === undefined ? "version_conflict" : "lease_conflict"
      }
      await client.query("COMMIT")
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined)
      throw error
    } finally {
      client.release()
    }

    await this.database.notifyAgUiProjection(command.tenantId, command.sessionId, notificationCursor).catch(() => undefined)
    return "committed"
  }

  public async replay(
    tenantId: string,
    sessionId: string,
    cursorValue: string | null,
    limit: number,
    maxBytes: number,
  ): Promise<AgUiReplayPage | AgUiInvalidCursor | AgUiExpiredCursor> {
    const result = await this.database.pool.query<ReplayRow>(
      `WITH cursor_position AS MATERIALIZED (
         SELECT CASE
                  WHEN $3::text IS NULL THEN 0::bigint
                  WHEN EXISTS (
                    SELECT 1
                      FROM bff_agui_event AS event
                     WHERE event.tenant_id = $1
                       AND event.session_id = $2
                       AND event.cursor = $3
                  ) THEN (
                    SELECT event.public_sequence
                      FROM bff_agui_event AS event
                     WHERE event.tenant_id = $1
                       AND event.session_id = $2
                       AND event.cursor = $3
                  )
                  ELSE -1::bigint
                END AS after_sequence,
                ($3::text IS NOT NULL AND EXISTS (
                  SELECT 1
                    FROM bff_agui_cursor_tombstone AS tombstone
                   WHERE tombstone.tenant_id = $1
                     AND tombstone.session_id = $2
                     AND tombstone.cursor = $3
                )) AS cursor_expired
       ),
       stream_head AS (
         SELECT COALESCE((
           SELECT stream.next_public_sequence - 1
             FROM bff_agui_stream AS stream
            WHERE stream.tenant_id = $1 AND stream.session_id = $2
         ), 0::bigint) AS head_sequence,
         (
           SELECT stream.terminal_run_id
             FROM bff_agui_stream AS stream
            WHERE stream.tenant_id = $1 AND stream.session_id = $2
         ) AS terminal_run_id
       ),
       frame_candidates AS (
         SELECT event.public_sequence,
                event.cursor,
                event.event_type,
                event.event_payload,
                octet_length(event.event_payload::text)
                  + octet_length(event.cursor)
                  + octet_length(event.event_type)
                  + 64 AS frame_bytes
           FROM bff_agui_event AS event
           CROSS JOIN cursor_position AS position
          WHERE position.after_sequence >= 0
            AND NOT position.cursor_expired
            AND event.tenant_id = $1
            AND event.session_id = $2
            AND event.public_sequence > position.after_sequence
          ORDER BY event.public_sequence ASC
          LIMIT $4
       ),
       sized_frame_page AS (
         SELECT candidate.*,
                row_number() OVER (ORDER BY candidate.public_sequence ASC) AS frame_number,
                sum(candidate.frame_bytes) OVER (ORDER BY candidate.public_sequence ASC) AS cumulative_bytes
           FROM frame_candidates AS candidate
       ),
       frame_page AS (
         SELECT page.public_sequence, page.cursor, page.event_type, page.event_payload
           FROM sized_frame_page AS page
          WHERE page.frame_number = 1 OR page.cumulative_bytes <= $5
       )
       SELECT position.after_sequence >= 0 AS cursor_valid,
              position.cursor_expired,
              position.after_sequence::text AS after_sequence,
              head.head_sequence::text AS head_sequence,
              head.terminal_run_id,
              frame.public_sequence::text AS public_sequence,
              frame.cursor,
              frame.event_type,
              frame.event_payload
         FROM cursor_position AS position
         CROSS JOIN stream_head AS head
         LEFT JOIN frame_page AS frame ON TRUE
        ORDER BY frame.public_sequence ASC NULLS LAST`,
      [tenantId, sessionId, cursorValue, limit, maxBytes],
    )
    const snapshot = result.rows[0]
    if (snapshot === undefined || snapshot.cursor_expired === true) return { kind: "expired_cursor" }
    if (!snapshot.cursor_valid) return { kind: "invalid_cursor" }
    const afterSequence = safeInteger(snapshot.after_sequence, "cursor sequence")
    const frames = result.rows.flatMap((row): StoredAgUiFrame[] => {
      if (row.public_sequence === null || row.cursor === null || row.event_type === null || row.event_payload === null) return []
      return [storedFrame({
        public_sequence: row.public_sequence,
        cursor: row.cursor,
        event_type: row.event_type,
        event_payload: row.event_payload,
      })]
    })
    const deliveredSequence = frames.at(-1)?.publicSequence ?? afterSequence
    const headSequence = safeInteger(snapshot.head_sequence, "head sequence")
    return {
      kind: "page",
      frames,
      atHead: deliveredSequence >= headSequence,
      terminalRunId: snapshot.terminal_run_id,
    }
  }

  public async status(tenantId: string, sessionId: string): Promise<AgUiProjectionStatus> {
    const result = await this.database.pool.query<StatusRow>(
      `SELECT stream.source_high_watermark,
              stream.retention_floor_sequence,
              stream.consumer_subject_id,
              stream.consumer_state,
              stream.consumer_last_error_code,
              stream.consumer_last_polled_at,
              (SELECT event.cursor
                 FROM bff_agui_event AS event
                WHERE event.tenant_id = stream.tenant_id AND event.session_id = stream.session_id
                ORDER BY event.public_sequence DESC
                LIMIT 1) AS current_cursor
         FROM bff_agui_stream AS stream
        WHERE stream.tenant_id = $1 AND stream.session_id = $2`,
      [tenantId, sessionId],
    )
    const row = result.rows[0]
    return row === undefined
      ? {
          sourceHighWatermark: 0,
          currentCursor: null,
          retentionFloorSequence: 0,
          consumerState: null,
          consumerLastErrorCode: null,
          consumerLastPolledAt: null,
        }
      : {
          sourceHighWatermark: safeInteger(row.source_high_watermark, "source high watermark"),
          currentCursor: row.current_cursor,
          retentionFloorSequence: safeInteger(row.retention_floor_sequence, "retention floor"),
          consumerState: row.consumer_subject_id === null ? null : row.consumer_state,
          consumerLastErrorCode: row.consumer_last_error_code,
          consumerLastPolledAt: row.consumer_last_polled_at?.toISOString() ?? null,
        }
  }

}
