import { randomUUID } from "node:crypto"

import type {
  AgUiConsumerClaimInput,
  AgUiConsumerLease,
  AgUiGarbageCollectionCommand,
  AgUiGarbageCollectionResult,
  AgUiProjectionConsumerRepository,
} from "../../application/agui/ports/agui-projection-repository.js"
import type { PostgresBffDatabase } from "./client.js"

type ConsumerRow = {
  tenant_id: string
  session_id: string
  consumer_subject_id: string
  source_high_watermark: string
  consumer_failure_count: string
}

type ClaimedConsumerRow = {
  fence: string
  lease_until: Date
  lease_remaining_ms: string
}

type GarbageStreamRow = {
  tenant_id: string
  session_id: string
  latest_run_start_sequence: string
}

type GarbageBatchRow = {
  frames_deleted: string
  tombstones_inserted: string
  retention_floor: string | null
}

function safeInteger(value: string | number, label: string): number {
  const parsed = typeof value === "number" ? value : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`Stored AG-UI ${label} is invalid`)
  return parsed
}

function positiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive safe integer`)
}

function instant(value: string, label: string): string {
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) throw new Error(`${label} is invalid`)
  return parsed.toISOString()
}

export class PostgresAgUiConsumerRepository implements AgUiProjectionConsumerRepository {
  public constructor(private readonly database: PostgresBffDatabase) {}

  public async registerConsumer(tenantId: string, sessionId: string, subjectId: string, expectedRunId?: string): Promise<void> {
    if (tenantId.trim() === "" || sessionId.trim() === "" || subjectId.trim() === "") throw new Error("AG-UI consumer identity is required")
    if (expectedRunId !== undefined && expectedRunId.trim() === "") throw new Error("AG-UI expected run identity must not be empty")
    const result = await this.database.pool.query(
      `INSERT INTO bff_agui_stream (tenant_id, session_id, consumer_subject_id, expected_run_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id, session_id) DO UPDATE
         SET version = bff_agui_stream.version + CASE
               WHEN EXCLUDED.expected_run_id IS NOT NULL
                AND bff_agui_stream.expected_run_id IS DISTINCT FROM EXCLUDED.expected_run_id THEN 1
               ELSE 0
             END,
             consumer_subject_id = COALESCE(bff_agui_stream.consumer_subject_id, EXCLUDED.consumer_subject_id),
             terminal_run_id = CASE
               WHEN EXCLUDED.expected_run_id IS NULL OR bff_agui_stream.expected_run_id = EXCLUDED.expected_run_id
                 THEN bff_agui_stream.terminal_run_id
               ELSE NULL
             END,
             latest_run_start_sequence = CASE
               WHEN EXCLUDED.expected_run_id IS NULL OR bff_agui_stream.expected_run_id = EXCLUDED.expected_run_id
                 THEN bff_agui_stream.latest_run_start_sequence
               ELSE NULL
             END,
             expected_run_id = COALESCE(EXCLUDED.expected_run_id, bff_agui_stream.expected_run_id),
             consumer_state = CASE
               WHEN EXCLUDED.expected_run_id IS NOT NULL
                AND bff_agui_stream.expected_run_id IS DISTINCT FROM EXCLUDED.expected_run_id THEN 'active'
               ELSE bff_agui_stream.consumer_state
             END,
             consumer_lease_owner = CASE
               WHEN EXCLUDED.expected_run_id IS NOT NULL
                AND bff_agui_stream.expected_run_id IS DISTINCT FROM EXCLUDED.expected_run_id THEN NULL
               ELSE bff_agui_stream.consumer_lease_owner
             END,
             consumer_lease_token = CASE
               WHEN EXCLUDED.expected_run_id IS NOT NULL
                AND bff_agui_stream.expected_run_id IS DISTINCT FROM EXCLUDED.expected_run_id THEN NULL
               ELSE bff_agui_stream.consumer_lease_token
             END,
             consumer_lease_until = CASE
               WHEN EXCLUDED.expected_run_id IS NOT NULL
                AND bff_agui_stream.expected_run_id IS DISTINCT FROM EXCLUDED.expected_run_id THEN NULL
               ELSE bff_agui_stream.consumer_lease_until
             END,
             consumer_fence = bff_agui_stream.consumer_fence + CASE
               WHEN EXCLUDED.expected_run_id IS NOT NULL
                AND bff_agui_stream.expected_run_id IS DISTINCT FROM EXCLUDED.expected_run_id THEN 1
               ELSE 0
             END,
             consumer_failure_count = CASE
               WHEN EXCLUDED.expected_run_id IS NOT NULL
                AND bff_agui_stream.expected_run_id IS DISTINCT FROM EXCLUDED.expected_run_id THEN 0
               ELSE bff_agui_stream.consumer_failure_count
             END,
             consumer_last_error_code = CASE
               WHEN EXCLUDED.expected_run_id IS NOT NULL
                AND bff_agui_stream.expected_run_id IS DISTINCT FROM EXCLUDED.expected_run_id THEN NULL
               ELSE bff_agui_stream.consumer_last_error_code
             END,
             consumer_last_error_at = CASE
               WHEN EXCLUDED.expected_run_id IS NOT NULL
                AND bff_agui_stream.expected_run_id IS DISTINCT FROM EXCLUDED.expected_run_id THEN NULL
               ELSE bff_agui_stream.consumer_last_error_at
             END,
             consumer_next_poll_at = LEAST(bff_agui_stream.consumer_next_poll_at, CURRENT_TIMESTAMP(3)),
             updated_at = CURRENT_TIMESTAMP(3)
       WHERE bff_agui_stream.consumer_subject_id IS NULL
          OR bff_agui_stream.consumer_subject_id = EXCLUDED.consumer_subject_id
       RETURNING session_id`,
      [tenantId, sessionId, subjectId, expectedRunId ?? null],
    )
    if (result.rowCount !== 1) throw new Error("AG-UI consumer subject does not match the registered session owner")
  }

  public async seedConsumers(limit: number): Promise<number> {
    positiveInteger(limit, "AG-UI consumer seed limit")
    const result = await this.database.pool.query<{ conversation_id: string }>(
      `WITH candidates AS (
         SELECT conversation_id, tenant_id, owner_id
           FROM bff_conversation
          WHERE status = 'active'
            AND tenant_id <> ''
            AND owner_id <> ''
            AND EXISTS (
              SELECT 1
                FROM bff_message AS message
               WHERE message.tenant_id = bff_conversation.tenant_id
                 AND message.conversation_id = bff_conversation.conversation_id
                 AND message.run_id IS NOT NULL
            )
            AND NOT EXISTS (
              SELECT 1
                FROM bff_agui_stream AS stream
               WHERE stream.tenant_id = bff_conversation.tenant_id
                 AND stream.session_id = bff_conversation.conversation_id
                 AND stream.consumer_subject_id IS NOT NULL
            )
          ORDER BY tenant_id ASC, conversation_id ASC
          LIMIT $1
       )
       INSERT INTO bff_agui_stream (tenant_id, session_id, consumer_subject_id)
       SELECT candidates.tenant_id, candidates.conversation_id, candidates.owner_id
         FROM candidates
       ON CONFLICT (tenant_id, session_id) DO UPDATE
         SET consumer_subject_id = COALESCE(bff_agui_stream.consumer_subject_id, EXCLUDED.consumer_subject_id)
       RETURNING session_id AS conversation_id`,
      [limit],
    )
    return result.rowCount ?? result.rows.length
  }

  public async claimConsumers(input: AgUiConsumerClaimInput): Promise<AgUiConsumerLease[]> {
    positiveInteger(input.limit, "AG-UI consumer claim limit")
    if (input.workerId.trim() === "") throw new Error("AG-UI consumer worker id is required")
    const now = instant(input.now, "AG-UI consumer claim time")
    const leaseUntil = instant(input.leaseUntil, "AG-UI consumer lease expiry")
    const leaseDurationMs = Date.parse(leaseUntil) - Date.parse(now)
    positiveInteger(leaseDurationMs, "AG-UI consumer lease duration")
    const client = await this.database.pool.connect()
    const leases: AgUiConsumerLease[] = []
    try {
      await client.query("BEGIN")
      const candidates = await client.query<ConsumerRow>(
        `SELECT tenant_id, session_id, consumer_subject_id, source_high_watermark, consumer_failure_count
           FROM bff_agui_stream
          WHERE consumer_state = 'active'
            AND consumer_subject_id IS NOT NULL
            AND consumer_next_poll_at <= CURRENT_TIMESTAMP(3)
            AND (consumer_lease_until IS NULL OR consumer_lease_until <= CURRENT_TIMESTAMP(3))
            AND EXISTS (
              SELECT 1
                FROM bff_conversation AS conversation
               WHERE conversation.tenant_id = bff_agui_stream.tenant_id
                 AND conversation.conversation_id = bff_agui_stream.session_id
                 AND conversation.owner_id = bff_agui_stream.consumer_subject_id
                 AND conversation.status = 'active'
            )
          ORDER BY consumer_next_poll_at ASC, tenant_id ASC, session_id ASC
          FOR UPDATE SKIP LOCKED
          LIMIT $1`,
        [input.limit],
      )
      for (const candidate of candidates.rows) {
        const token = randomUUID()
        const updated = await client.query<ClaimedConsumerRow>(
          `UPDATE bff_agui_stream
              SET consumer_lease_owner = $3,
                  consumer_lease_token = $4,
                  consumer_lease_until = CURRENT_TIMESTAMP(3) + ($5::double precision * INTERVAL '1 millisecond'),
                  consumer_fence = consumer_fence + 1,
                  updated_at = CURRENT_TIMESTAMP(3)
            WHERE tenant_id = $1
              AND session_id = $2
              AND consumer_state = 'active'
              AND consumer_subject_id = $6
            RETURNING consumer_fence AS fence,
                      consumer_lease_until AS lease_until,
                      GREATEST(1, floor(EXTRACT(EPOCH FROM (consumer_lease_until - CURRENT_TIMESTAMP(3))) * 1000))::bigint AS lease_remaining_ms`,
          [candidate.tenant_id, candidate.session_id, input.workerId, token, leaseDurationMs, candidate.consumer_subject_id],
        )
        const row = updated.rows[0]
        if (row === undefined) continue
        leases.push({
          tenantId: candidate.tenant_id,
          sessionId: candidate.session_id,
          subjectId: candidate.consumer_subject_id,
          leaseOwner: input.workerId,
          leaseToken: token,
          fence: safeInteger(row.fence, "consumer fence"),
          leaseUntil: row.lease_until.toISOString(),
          leaseRemainingMs: safeInteger(row.lease_remaining_ms, "consumer lease remaining budget"),
          sourceHighWatermark: safeInteger(candidate.source_high_watermark, "source high watermark"),
          failureCount: safeInteger(candidate.consumer_failure_count, "consumer failure count"),
        })
      }
      await client.query("COMMIT")
      return leases
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  public async renewConsumerLease(lease: AgUiConsumerLease, now: string, leaseUntil: string): Promise<boolean> {
    const renewalDurationMs = Date.parse(instant(leaseUntil, "AG-UI lease expiry")) - Date.parse(instant(now, "AG-UI lease time"))
    positiveInteger(renewalDurationMs, "AG-UI lease renewal duration")
    const result = await this.database.pool.query(
      `UPDATE bff_agui_stream
          SET consumer_lease_until = CURRENT_TIMESTAMP(3) + ($7::double precision * INTERVAL '1 millisecond'),
              updated_at = CURRENT_TIMESTAMP(3)
        WHERE tenant_id = $1
          AND session_id = $2
          AND consumer_state = 'active'
          AND consumer_subject_id = $3
          AND consumer_lease_owner = $4
          AND consumer_lease_token = $5
          AND consumer_fence = $6
          AND consumer_lease_until > CURRENT_TIMESTAMP(3)`,
      [lease.tenantId, lease.sessionId, lease.subjectId, lease.leaseOwner, lease.leaseToken, lease.fence, renewalDurationMs],
    )
    return result.rowCount === 1
  }

  public async markConsumerProgress(lease: AgUiConsumerLease, nextPollAt: string, now: string): Promise<boolean> {
    return this.settleConsumer(lease, {
      state: "active",
      nextPollAt,
      errorCode: null,
      errorAt: null,
      now,
      resetFailures: true,
    })
  }

  public async markConsumerRetryable(lease: AgUiConsumerLease, nextPollAt: string, errorCode: string, now: string): Promise<boolean> {
    return this.settleConsumer(lease, {
      state: "active",
      nextPollAt,
      errorCode,
      errorAt: now,
      now,
      resetFailures: false,
    })
  }

  public async markConsumerBlocked(lease: AgUiConsumerLease, errorCode: string, now: string): Promise<boolean> {
    return this.settleConsumer(lease, {
      state: "blocked",
      nextPollAt: now,
      errorCode,
      errorAt: now,
      now,
      resetFailures: false,
    })
  }

  public async releaseConsumer(lease: AgUiConsumerLease, now: string): Promise<boolean> {
    instant(now, "AG-UI release time")
    const result = await this.database.pool.query(
      `UPDATE bff_agui_stream
          SET consumer_lease_owner = NULL,
              consumer_lease_token = NULL,
              consumer_lease_until = NULL,
              consumer_next_poll_at = CURRENT_TIMESTAMP(3),
              updated_at = CURRENT_TIMESTAMP(3)
        WHERE tenant_id = $1
          AND session_id = $2
          AND consumer_subject_id = $3
          AND consumer_lease_owner = $4
          AND consumer_lease_token = $5
          AND consumer_fence = $6`,
      [lease.tenantId, lease.sessionId, lease.subjectId, lease.leaseOwner, lease.leaseToken, lease.fence],
    )
    return result.rowCount === 1
  }

  private async settleConsumer(
    lease: AgUiConsumerLease,
    values: {
      state: "active" | "blocked"
      nextPollAt: string
      errorCode: string | null
      errorAt: string | null
      now: string
      resetFailures: boolean
    },
  ): Promise<boolean> {
    const now = instant(values.now, "AG-UI poll completion time")
    const nextPollAt = instant(values.nextPollAt, "AG-UI next poll time")
    const nextPollDelayMs = Math.max(0, Date.parse(nextPollAt) - Date.parse(now))
    if (values.errorAt !== null) instant(values.errorAt, "AG-UI error time")
    const result = await this.database.pool.query(
      `UPDATE bff_agui_stream
          SET consumer_state = $7,
              consumer_next_poll_at = CURRENT_TIMESTAMP(3) + ($8::double precision * INTERVAL '1 millisecond'),
              consumer_last_error_code = $9,
              consumer_last_error_at = CASE WHEN $9::text IS NULL THEN NULL ELSE CURRENT_TIMESTAMP(3) END,
              consumer_last_polled_at = CURRENT_TIMESTAMP(3),
              consumer_failure_count = CASE WHEN $10::boolean THEN 0 ELSE consumer_failure_count + 1 END,
              consumer_lease_owner = NULL,
              consumer_lease_token = NULL,
              consumer_lease_until = NULL,
              updated_at = CURRENT_TIMESTAMP(3)
        WHERE tenant_id = $1
          AND session_id = $2
          AND consumer_subject_id = $3
          AND consumer_lease_owner = $4
          AND consumer_lease_token = $5
          AND consumer_fence = $6
          AND consumer_lease_until > CURRENT_TIMESTAMP(3)`,
      [
        lease.tenantId,
        lease.sessionId,
        lease.subjectId,
        lease.leaseOwner,
        lease.leaseToken,
        lease.fence,
        values.state,
        nextPollDelayMs,
        values.errorCode,
        values.resetFailures,
      ],
    )
    return result.rowCount === 1
  }

  public async collectGarbage(command: AgUiGarbageCollectionCommand): Promise<AgUiGarbageCollectionResult> {
    positiveInteger(command.retentionMs, "AG-UI retention")
    positiveInteger(command.tombstoneRetentionMs, "AG-UI tombstone retention")
    positiveInteger(command.batchSize, "AG-UI GC batch")
    const now = instant(command.now, "AG-UI GC time")
    const cutoff = new Date(Date.parse(now) - command.retentionMs).toISOString()
    const tombstoneCutoff = new Date(Date.parse(now) - command.tombstoneRetentionMs).toISOString()
    const client = await this.database.pool.connect()
    let framesDeleted = 0
    let tombstonesInserted = 0
    let tombstonesDeleted = 0
    let streamsScanned = 0
    try {
      await client.query("BEGIN")
      const streams = await client.query<GarbageStreamRow>(
        `SELECT tenant_id, session_id, latest_run_start_sequence
           FROM bff_agui_stream
          WHERE latest_run_start_sequence IS NOT NULL
            AND NOT EXISTS (
              SELECT 1
                FROM bff_agui_event AS retained
                CROSS JOIN LATERAL (
                  SELECT COALESCE(
                    NULLIF(retained.event_payload ->> 'runId', ''),
                    NULLIF(retained.event_payload #>> '{metadata,kokoro,run_id}', '')
                  ) AS run_id
                ) AS retained_ref
               WHERE retained.tenant_id = bff_agui_stream.tenant_id
                 AND retained.session_id = bff_agui_stream.session_id
                 AND retained.public_sequence >= bff_agui_stream.latest_run_start_sequence
                 AND retained.event_type <> 'RUN_STARTED'
                 AND (
                   retained_ref.run_id IS NULL
                   OR NOT EXISTS (
                     SELECT 1
                       FROM bff_agui_event AS started
                      WHERE started.tenant_id = retained.tenant_id
                        AND started.session_id = retained.session_id
                        AND started.public_sequence >= bff_agui_stream.latest_run_start_sequence
                        AND started.public_sequence <= retained.public_sequence
                        AND started.event_type = 'RUN_STARTED'
                        AND COALESCE(
                          NULLIF(started.event_payload ->> 'runId', ''),
                          NULLIF(started.event_payload #>> '{metadata,kokoro,run_id}', '')
                        ) = retained_ref.run_id
                   )
                 )
            )
            AND EXISTS (
            SELECT 1
              FROM bff_agui_event AS event
             WHERE event.tenant_id = bff_agui_stream.tenant_id
               AND event.session_id = bff_agui_stream.session_id
               AND event.recorded_at < $1::timestamptz
               AND event.public_sequence < bff_agui_stream.latest_run_start_sequence
          )
          ORDER BY updated_at ASC, tenant_id ASC, session_id ASC
          FOR UPDATE SKIP LOCKED
          LIMIT $2`,
        [cutoff, command.batchSize],
      )
      streamsScanned = streams.rows.length
      for (const stream of streams.rows) {
        const latestRunStart = safeInteger(stream.latest_run_start_sequence, "latest run start sequence")
        const collected = await client.query<GarbageBatchRow>(
          `WITH candidates AS MATERIALIZED (
             SELECT tenant_id, session_id, cursor, public_sequence
               FROM bff_agui_event
              WHERE tenant_id = $1
                AND session_id = $2
                AND recorded_at < $3::timestamptz
                AND public_sequence < $4
              ORDER BY public_sequence ASC
              LIMIT $5
           ),
           inserted AS (
             INSERT INTO bff_agui_cursor_tombstone
               (tenant_id, session_id, cursor, public_sequence, expired_at)
             SELECT tenant_id, session_id, cursor, public_sequence, $6::timestamptz
               FROM candidates
             ON CONFLICT (tenant_id, session_id, cursor) DO NOTHING
             RETURNING public_sequence
           ),
           deleted AS (
             DELETE FROM bff_agui_event AS event
              USING candidates
              WHERE event.tenant_id = candidates.tenant_id
                AND event.session_id = candidates.session_id
                AND event.public_sequence = candidates.public_sequence
             RETURNING event.public_sequence
           )
           SELECT (SELECT count(*)::text FROM inserted) AS tombstones_inserted,
                  (SELECT count(*)::text FROM deleted) AS frames_deleted,
                  (SELECT max(public_sequence)::text FROM deleted) AS retention_floor`,
          [stream.tenant_id, stream.session_id, cutoff, latestRunStart, command.batchSize, now],
        )
        const batch = collected.rows[0]
        if (batch === undefined) throw new Error("AG-UI garbage collection did not return its settlement")
        const batchFrames = safeInteger(batch.frames_deleted, "garbage-collected frame count")
        framesDeleted += batchFrames
        tombstonesInserted += safeInteger(batch.tombstones_inserted, "garbage-collected tombstone count")
        if (batchFrames === 0 || batch.retention_floor === null) continue
        const floor = safeInteger(batch.retention_floor, "retention floor")
        await client.query(
          `UPDATE bff_agui_stream
              SET retention_floor_sequence = GREATEST(retention_floor_sequence, $3),
                  updated_at = CURRENT_TIMESTAMP(3)
            WHERE tenant_id = $1 AND session_id = $2`,
          [stream.tenant_id, stream.session_id, floor],
        )
      }
      const removedTombstones = await client.query(
        `WITH expired AS (
           SELECT tenant_id, session_id, cursor
             FROM bff_agui_cursor_tombstone
            WHERE expired_at < $1::timestamptz
            ORDER BY expired_at ASC, tenant_id ASC, session_id ASC, cursor ASC
            LIMIT $2
         )
         DELETE FROM bff_agui_cursor_tombstone AS tombstone
          USING expired
          WHERE tombstone.tenant_id = expired.tenant_id
            AND tombstone.session_id = expired.session_id
            AND tombstone.cursor = expired.cursor`,
        [tombstoneCutoff, command.batchSize],
      )
      tombstonesDeleted = removedTombstones.rowCount ?? 0
      await client.query("COMMIT")
      return { streamsScanned, framesDeleted, tombstonesInserted, tombstonesDeleted }
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }
}
