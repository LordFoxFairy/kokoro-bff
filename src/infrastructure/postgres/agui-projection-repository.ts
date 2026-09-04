import { randomUUID } from "node:crypto"

import { AgUiSourceIdentityConflictError } from "../../application/agui/errors.js"
import type {
  AgUiProjectionRepository,
  AgUiProjectionStateSnapshot,
  AgUiStreamState,
  CommitAgUiProjection,
  StoredAgUiFrame,
} from "../../application/agui/ports/agui-projection-repository.js"
import type { PostgresBffDatabase } from "./client.js"

type StreamRow = {
  version: string
  source_high_watermark: string
  next_public_sequence: string
  projection_state: unknown
}

type FrameRow = {
  public_sequence: string
  cursor: string
  event_type: string
  event_payload: unknown
}

type CursorRow = {
  public_sequence: string
}

type StatusRow = {
  source_high_watermark: string
  current_cursor: string | null
}

function safeInteger(value: string | number, label: string): number {
  const parsed = typeof value === "number" ? value : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`Stored AG-UI ${label} is invalid`)
  return parsed
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

function cursor(): string {
  return `agui_${randomUUID().replaceAll("-", "")}`
}

export class PostgresAgUiProjectionRepository implements AgUiProjectionRepository {
  public constructor(private readonly database: PostgresBffDatabase) {}

  public async readStream(tenantId: string, sessionId: string): Promise<AgUiStreamState> {
    const result = await this.database.pool.query<StreamRow>(
      `SELECT version, source_high_watermark, next_public_sequence, projection_state
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
      }
    }
    return {
      version: safeInteger(row.version, "stream version"),
      sourceHighWatermark: safeInteger(row.source_high_watermark, "source high watermark"),
      projectionState: projectionState(row.projection_state),
    }
  }

  public async commitProjection(command: CommitAgUiProjection): Promise<"committed" | "version_conflict"> {
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
        `SELECT version, source_high_watermark, next_public_sequence, projection_state
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

      let nextPublicSequence = safeInteger(stream.next_public_sequence, "next public sequence")
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
            source.sourceOccurredAt,
          ],
        )
        if (inserted.rows[0] === undefined) throw new AgUiSourceIdentityConflictError()

        for (const [frameIndex, frame] of source.frames.entries()) {
          const frameCursor = cursor()
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
              source.sourceOccurredAt,
            ],
          )
          nextPublicSequence += 1
          notificationCursor = frameCursor
        }
      }

      await client.query(
        `UPDATE bff_agui_stream
            SET version = version + 1,
                source_high_watermark = $3,
                next_public_sequence = $4,
                projection_state = $5::jsonb,
                updated_at = CURRENT_TIMESTAMP(3)
          WHERE tenant_id = $1 AND session_id = $2`,
        [
          command.tenantId,
          command.sessionId,
          command.sourceHighWatermark,
          nextPublicSequence,
          JSON.stringify({
            text_message_ids: command.projectionState.textMessageIds,
            tool_call_ids: command.projectionState.toolCallIds,
          }),
        ],
      )
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

  public async replay(tenantId: string, sessionId: string, cursorValue: string | null, limit: number) {
    let afterSequence = 0
    if (cursorValue !== null) {
      const cursorResult = await this.database.pool.query<CursorRow>(
        `SELECT public_sequence
           FROM bff_agui_event
          WHERE tenant_id = $1 AND session_id = $2 AND cursor = $3`,
        [tenantId, sessionId, cursorValue],
      )
      const row = cursorResult.rows[0]
      if (row === undefined) return { kind: "invalid_cursor" as const }
      afterSequence = safeInteger(row.public_sequence, "cursor sequence")
    }

    const [framesResult, streamResult] = await Promise.all([
      this.database.pool.query<FrameRow>(
        `SELECT public_sequence, cursor, event_type, event_payload
           FROM bff_agui_event
          WHERE tenant_id = $1 AND session_id = $2 AND public_sequence > $3
          ORDER BY public_sequence ASC
          LIMIT $4`,
        [tenantId, sessionId, afterSequence, limit],
      ),
      this.database.pool.query<{ head_sequence: string; head_event_type: string | null }>(
        `SELECT stream.next_public_sequence - 1 AS head_sequence,
                (SELECT event.event_type
                   FROM bff_agui_event AS event
                  WHERE event.tenant_id = stream.tenant_id AND event.session_id = stream.session_id
                  ORDER BY event.public_sequence DESC
                  LIMIT 1) AS head_event_type
           FROM bff_agui_stream AS stream
          WHERE stream.tenant_id = $1 AND stream.session_id = $2`,
        [tenantId, sessionId],
      ),
    ])
    const frames = framesResult.rows.map(storedFrame)
    const deliveredSequence = frames.at(-1)?.publicSequence ?? afterSequence
    const headSequence = streamResult.rows[0] === undefined
      ? 0
      : safeInteger(streamResult.rows[0].head_sequence, "head sequence")
    return {
      kind: "page" as const,
      frames,
      atHead: deliveredSequence >= headSequence,
      headEventType: streamResult.rows[0]?.head_event_type ?? null,
    }
  }

  public async status(tenantId: string, sessionId: string) {
    const result = await this.database.pool.query<StatusRow>(
      `SELECT stream.source_high_watermark,
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
      ? { sourceHighWatermark: 0, currentCursor: null }
      : {
          sourceHighWatermark: safeInteger(row.source_high_watermark, "source high watermark"),
          currentCursor: row.current_cursor,
        }
  }
}
