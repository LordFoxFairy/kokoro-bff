import { randomUUID } from "node:crypto"

import type {
  AgUiConsumerClaimInput,
  AgUiConsumerLease,
  AgUiGarbageCollectionCommand,
  AgUiGarbageCollectionResult,
  AgUiProjectionConsumerRepository,
} from "../../application/agui/ports/agui-projection-repository.js"
import type { PostgresBffDatabase } from "./client.js"
import { agUiConsumerRegistration } from "./agui-consumer-registration.js"
import { PostgresAgentDispatchOutboxRepository } from "./agent-dispatch-outbox-repository.js"

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
  effective_retain_from: string
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

function signedSafeInteger(value: string | number, label: string): number {
  const parsed = typeof value === "number" ? value : Number(value)
  if (!Number.isSafeInteger(parsed)) throw new Error(`Stored AG-UI ${label} is invalid`)
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
    const registration = agUiConsumerRegistration(tenantId, sessionId, subjectId, expectedRunId)
    const client = await this.database.pool.connect()
    try {
      await client.query("BEGIN")
      const conversations = await PostgresAgentDispatchOutboxRepository.lockConversationsInTransaction(client, [{ tenantId, conversationId: sessionId }])
      const conversation = conversations[0]
      if (conversation === undefined || conversation.status !== "active" || conversation.owner_id !== subjectId) {
        throw new Error("AG-UI consumer subject does not match the registered session owner")
      }
      const result = await client.query(registration.text, registration.values)
      if (result.rowCount !== 1) throw new Error("AG-UI consumer subject does not match the registered session owner")
      await client.query("COMMIT")
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  public async seedConsumers(limit: number): Promise<number> {
    positiveInteger(limit, "AG-UI consumer seed limit")
    const client = await this.database.pool.connect()
    try {
      await client.query("BEGIN")
      const candidates = await client.query<{ tenant_id: string; conversation_id: string; owner_id: string }>(
        [
          "SELECT conversation_id,tenant_id,owner_id FROM bff_conversation",
          "WHERE status='active' AND tenant_id<>'' AND owner_id<>''",
          "AND EXISTS (SELECT 1 FROM bff_message AS message",
          "WHERE message.tenant_id=bff_conversation.tenant_id AND message.conversation_id=bff_conversation.conversation_id AND message.run_id IS NOT NULL)",
          "AND NOT EXISTS (SELECT 1 FROM bff_agui_stream AS stream",
          "WHERE stream.tenant_id=bff_conversation.tenant_id AND stream.session_id=bff_conversation.conversation_id AND stream.consumer_subject_id IS NOT NULL)",
          "ORDER BY tenant_id,conversation_id FOR UPDATE SKIP LOCKED LIMIT $1",
        ].join("\n"),
        [limit],
      )
      // The whole ordered parent result is materialized before the first stream write.
      for (const candidate of candidates.rows) {
        const registration = agUiConsumerRegistration(candidate.tenant_id, candidate.conversation_id, candidate.owner_id)
        const registered = await client.query(registration.text, registration.values)
        if (registered.rowCount !== 1) throw new Error("AG-UI consumer subject does not match the registered session owner")
      }
      await client.query("COMMIT")
      return candidates.rows.length
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
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
      const parents = await client.query<{ tenant_id: string; conversation_id: string }>(
        [
          "SELECT conversation.tenant_id,conversation.conversation_id FROM bff_conversation AS conversation",
          "JOIN bff_agui_stream AS stream ON stream.tenant_id=conversation.tenant_id AND stream.session_id=conversation.conversation_id",
          "WHERE conversation.status='active' AND conversation.owner_id=stream.consumer_subject_id",
          "AND stream.consumer_state='active' AND stream.consumer_subject_id IS NOT NULL",
          "AND stream.consumer_next_poll_at<=CURRENT_TIMESTAMP(3)",
          "AND (stream.consumer_lease_until IS NULL OR stream.consumer_lease_until<=CURRENT_TIMESTAMP(3))",
          "ORDER BY conversation.tenant_id,conversation.conversation_id FOR UPDATE OF conversation SKIP LOCKED LIMIT $1",
        ].join("\n"),
        [input.limit],
      )
      const candidates = await client.query<ConsumerRow>(
        [
          "SELECT tenant_id,session_id,consumer_subject_id,source_high_watermark,consumer_failure_count FROM bff_agui_stream",
          "WHERE consumer_state='active' AND consumer_subject_id IS NOT NULL",
          "AND consumer_next_poll_at<=CURRENT_TIMESTAMP(3)",
          "AND (consumer_lease_until IS NULL OR consumer_lease_until<=CURRENT_TIMESTAMP(3))",
          "AND EXISTS (SELECT 1 FROM jsonb_to_recordset($1::jsonb) AS scope(tenant_id text,conversation_id text)",
          "WHERE scope.tenant_id=bff_agui_stream.tenant_id AND scope.conversation_id=bff_agui_stream.session_id)",
          "AND EXISTS (SELECT 1 FROM bff_conversation AS conversation",
          "WHERE conversation.tenant_id=bff_agui_stream.tenant_id AND conversation.conversation_id=bff_agui_stream.session_id",
          "AND conversation.owner_id=bff_agui_stream.consumer_subject_id AND conversation.status='active')",
          "ORDER BY tenant_id,session_id FOR UPDATE SKIP LOCKED",
        ].join("\n"),
        [JSON.stringify(parents.rows)],
      )
      const clock = await client.query<{ db_now: Date }>("SELECT clock_timestamp() AS db_now")
      const dbNow = clock.rows[0]?.db_now
      if (dbNow === undefined) throw new Error("AG-UI database clock unavailable")
      for (const candidate of candidates.rows) {
        const token = randomUUID()
        const updated = await client.query<ClaimedConsumerRow>(
          `UPDATE bff_agui_stream
              SET consumer_lease_owner = $3,
                  consumer_lease_token = $4,
                  consumer_lease_until = $7::timestamptz + ($5::double precision * INTERVAL '1 millisecond'),
                  consumer_fence = consumer_fence + 1,
                  updated_at = CURRENT_TIMESTAMP(3)
            WHERE tenant_id = $1
              AND session_id = $2
              AND consumer_state = 'active'
              AND consumer_subject_id = $6
              AND consumer_next_poll_at <= $7::timestamptz
              AND (consumer_lease_until IS NULL OR consumer_lease_until <= $7::timestamptz)
            RETURNING consumer_fence AS fence,
                      consumer_lease_until AS lease_until,
                      floor(EXTRACT(EPOCH FROM (consumer_lease_until - $7::timestamptz)) * 1000)::bigint AS lease_remaining_ms`,
          [candidate.tenant_id, candidate.session_id, input.workerId, token, leaseDurationMs, candidate.consumer_subject_id, dbNow],
        )
        const row = updated.rows[0]
        if (row === undefined || signedSafeInteger(row.lease_remaining_ms, "consumer lease remaining budget") < 1) {
          await client.query("ROLLBACK")
          return []
        }
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
      const finalObservedAt = performance.now()
      const finalClock = await client.query<{ db_now: Date }>("SELECT clock_timestamp() AS db_now")
      const finalDbNow = finalClock.rows[0]?.db_now
      if (finalDbNow === undefined) throw new Error("AG-UI database clock unavailable")
      const remaining = await client.query<{ tenant_id: string; session_id: string; lease_remaining_ms: string }>(
        `SELECT tenant_id, session_id, FLOOR(EXTRACT(EPOCH FROM (consumer_lease_until - $2::timestamptz)) * 1000)::bigint AS lease_remaining_ms
           FROM bff_agui_stream WHERE (tenant_id || E'\x1f' || session_id) = ANY($1::text[])`,
        [leases.map((lease) => `${lease.tenantId}\u001f${lease.sessionId}`), finalDbNow],
      )
      const remainingBySession = new Map(remaining.rows.map((row) => [`${row.tenant_id}\u001f${row.session_id}`, row.lease_remaining_ms]))
      if (
        leases.some(
          (lease) => signedSafeInteger(remainingBySession.get(`${lease.tenantId}\u001f${lease.sessionId}`) ?? "0", "consumer lease remaining budget") < 1,
        )
      ) {
        await client.query("ROLLBACK")
        return []
      }
      await client.query("COMMIT")
      const commitElapsedMs = Math.ceil(performance.now() - finalObservedAt)
      return leases.flatMap((lease) => {
        const remainingMs =
          signedSafeInteger(remainingBySession.get(`${lease.tenantId}\u001f${lease.sessionId}`) ?? "0", "consumer lease remaining budget") - commitElapsedMs
        return remainingMs > 0 ? [{ ...lease, leaseRemainingMs: remainingMs }] : []
      })
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
    const client = await this.database.pool.connect()
    try {
      await client.query("BEGIN")
      await PostgresAgentDispatchOutboxRepository.lockConversationsInTransaction(client, [{ tenantId: lease.tenantId, conversationId: lease.sessionId }])
      await client.query(
        `SELECT 1 FROM bff_agui_stream
          WHERE tenant_id=$1 AND session_id=$2 AND consumer_subject_id=$3
            AND consumer_lease_owner=$4 AND consumer_lease_token=$5 AND consumer_fence=$6
          FOR UPDATE`,
        [lease.tenantId, lease.sessionId, lease.subjectId, lease.leaseOwner, lease.leaseToken, lease.fence],
      )
      const clock = await client.query<{ db_now: Date }>("SELECT clock_timestamp() AS db_now")
      const dbNow = clock.rows[0]?.db_now
      if (dbNow === undefined) throw new Error("AG-UI database clock unavailable")
      const result = await client.query(
        `UPDATE bff_agui_stream
            SET consumer_lease_until = $8::timestamptz + ($7::double precision * INTERVAL '1 millisecond'),
                updated_at = $8::timestamptz
          WHERE tenant_id=$1 AND session_id=$2 AND consumer_state='active' AND consumer_subject_id=$3
            AND consumer_lease_owner=$4 AND consumer_lease_token=$5 AND consumer_fence=$6
            AND consumer_lease_until > $8::timestamptz`,
        [lease.tenantId, lease.sessionId, lease.subjectId, lease.leaseOwner, lease.leaseToken, lease.fence, renewalDurationMs, dbNow],
      )
      await client.query("COMMIT")
      return result.rowCount === 1
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
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
    const client = await this.database.pool.connect()
    try {
      await client.query("BEGIN")
      await PostgresAgentDispatchOutboxRepository.lockConversationsInTransaction(client, [{ tenantId: lease.tenantId, conversationId: lease.sessionId }])
      const result = await client.query(
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
      await client.query("COMMIT")
      return result.rowCount === 1
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
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
    const client = await this.database.pool.connect()
    try {
      await client.query("BEGIN")
      await PostgresAgentDispatchOutboxRepository.lockConversationsInTransaction(client, [{ tenantId: lease.tenantId, conversationId: lease.sessionId }])
      await client.query(
        `SELECT 1 FROM bff_agui_stream
          WHERE tenant_id=$1 AND session_id=$2 AND consumer_subject_id=$3
            AND consumer_lease_owner=$4 AND consumer_lease_token=$5 AND consumer_fence=$6
          FOR UPDATE`,
        [lease.tenantId, lease.sessionId, lease.subjectId, lease.leaseOwner, lease.leaseToken, lease.fence],
      )
      const clock = await client.query<{ db_now: Date }>("SELECT clock_timestamp() AS db_now")
      const dbNow = clock.rows[0]?.db_now
      if (dbNow === undefined) throw new Error("AG-UI database clock unavailable")
      const result = await client.query(
        `UPDATE bff_agui_stream
            SET consumer_state=$7,
                consumer_next_poll_at=$11::timestamptz + ($8::double precision * INTERVAL '1 millisecond'),
                consumer_last_error_code=$9,
                consumer_last_error_at=CASE WHEN $9::text IS NULL THEN NULL ELSE $11::timestamptz END,
                consumer_last_polled_at=$11::timestamptz,
                consumer_failure_count=CASE WHEN $10::boolean THEN 0 ELSE consumer_failure_count + 1 END,
                consumer_lease_owner=NULL, consumer_lease_token=NULL, consumer_lease_until=NULL,
                updated_at=$11::timestamptz
          WHERE tenant_id=$1 AND session_id=$2 AND consumer_subject_id=$3
            AND consumer_lease_owner=$4 AND consumer_lease_token=$5 AND consumer_fence=$6
            AND consumer_lease_until > $11::timestamptz`,
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
          dbNow,
        ],
      )
      await client.query("COMMIT")
      return result.rowCount === 1
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
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
      // Discovery and locked requery must exclude streams with no deletable prefix
      // before LIMIT; deletion consumes this same boundary, preserving live queued pins.
      const effectiveRetainFrom = `LEAST(bff_agui_stream.latest_run_start_sequence, COALESCE(
                (SELECT min(queued.public_sequence)
                   FROM bff_agui_event AS queued
                   JOIN bff_agent_dispatch_outbox AS dispatch
                     ON dispatch.tenant_id=queued.tenant_id AND dispatch.conversation_id=queued.session_id
                    AND dispatch.run_id=queued.event_payload #>> '{value,run_id}'
                  WHERE queued.tenant_id=bff_agui_stream.tenant_id AND queued.session_id=bff_agui_stream.session_id
                    AND queued.source_owner='kokoro-bff' AND queued.event_type='CUSTOM'
                    AND queued.event_payload->>'name'='kokoro.run.queued'
                    AND dispatch.status IN ('pending','leased','retryable','admitted')),
                bff_agui_stream.latest_run_start_sequence), COALESCE(
                (SELECT min(interaction.public_sequence)
                   FROM bff_agui_run_interaction AS interaction
                   JOIN bff_agent_dispatch_outbox AS dispatch
                     ON dispatch.tenant_id=interaction.tenant_id AND dispatch.conversation_id=interaction.session_id AND dispatch.run_id=interaction.run_id
                  WHERE interaction.tenant_id=bff_agui_stream.tenant_id AND interaction.session_id=bff_agui_stream.session_id
                    AND dispatch.status IN ('pending','leased','retryable','admitted')),
                bff_agui_stream.latest_run_start_sequence))`
      const streamCandidatesQuery = `SELECT tenant_id, session_id, ${effectiveRetainFrom}::text AS effective_retain_from
           FROM bff_agui_stream
          WHERE latest_run_start_sequence IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM bff_conversation AS conversation
               WHERE conversation.tenant_id=bff_agui_stream.tenant_id
                 AND conversation.conversation_id=bff_agui_stream.session_id
            )
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
                 AND NOT (retained.source_owner='kokoro-bff' AND retained.event_type='CUSTOM'
                   AND COALESCE(retained.event_payload->>'name','')='kokoro.run.queued')
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
               AND event.public_sequence < ${effectiveRetainFrom}
          )
            AND ($3::jsonb IS NULL OR EXISTS (
              SELECT 1 FROM jsonb_to_recordset($3::jsonb) AS scope(tenant_id text,conversation_id text)
               WHERE scope.tenant_id=bff_agui_stream.tenant_id AND scope.conversation_id=bff_agui_stream.session_id
            ))
          ORDER BY tenant_id ASC, session_id ASC`
      const streamCandidates = await client.query<GarbageStreamRow>(streamCandidatesQuery + "\nLIMIT $2", [cutoff, command.batchSize, null])
      const scopes = streamCandidates.rows.map((stream) => ({ tenantId: stream.tenant_id, conversationId: stream.session_id }))
      const parents = await PostgresAgentDispatchOutboxRepository.lockConversationsInTransaction(client, scopes)
      // A parent may disappear between discovery and locking. Only actually locked
      // identities may enter; a newly inserted parent outside that result is excluded.
      const lockedScopes = parents.map((parent) => ({ tenant_id: parent.tenant_id, conversation_id: parent.conversation_id }))
      const streams = await client.query<GarbageStreamRow>(streamCandidatesQuery + "\nFOR UPDATE SKIP LOCKED LIMIT $2", [
        cutoff,
        command.batchSize,
        JSON.stringify(lockedScopes),
      ])
      streamsScanned = streams.rows.length
      for (const stream of streams.rows) {
        const retainFrom = safeInteger(stream.effective_retain_from, "effective retain-from sequence")
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
          [stream.tenant_id, stream.session_id, cutoff, retainFrom, command.batchSize, now],
        )
        const batch = collected.rows[0]
        if (batch === undefined) throw new Error("AG-UI garbage collection did not return its settlement")
        const batchFrames = safeInteger(batch.frames_deleted, "garbage-collected frame count")
        framesDeleted += batchFrames
        tombstonesInserted += safeInteger(batch.tombstones_inserted, "garbage-collected tombstone count")
        if (batchFrames === 0 || batch.retention_floor === null) continue
        await client.query(
          `DELETE FROM bff_agui_run_interaction AS interaction
            WHERE tenant_id=$1 AND session_id=$2
              AND EXISTS (SELECT 1 FROM bff_agent_dispatch_outbox AS dispatch
                WHERE dispatch.tenant_id=interaction.tenant_id AND dispatch.conversation_id=interaction.session_id
                  AND dispatch.run_id=interaction.run_id AND dispatch.status IN ('terminal','failed'))
              AND NOT EXISTS (SELECT 1 FROM bff_agui_event AS frame
                WHERE frame.tenant_id=interaction.tenant_id AND frame.session_id=interaction.session_id AND frame.public_sequence=interaction.public_sequence)`,
          [stream.tenant_id, stream.session_id],
        )
        await client.query(
          `DELETE FROM bff_agui_run_activity AS activity
            WHERE tenant_id=$1 AND session_id=$2
              AND NOT EXISTS (SELECT 1 FROM bff_agui_event AS frame
                WHERE frame.tenant_id=activity.tenant_id AND frame.session_id=activity.session_id
                  AND COALESCE(NULLIF(frame.event_payload->>'runId',''),NULLIF(frame.event_payload #>> '{metadata,kokoro,run_id}',''))=activity.run_id)`,
          [stream.tenant_id, stream.session_id],
        )
        await client.query(
          `DELETE FROM bff_agui_run_process AS process
            WHERE tenant_id=$1 AND session_id=$2
              AND NOT EXISTS (SELECT 1 FROM bff_agui_event AS frame
                WHERE frame.tenant_id=process.tenant_id AND frame.session_id=process.session_id
                  AND COALESCE(NULLIF(frame.event_payload->>'runId',''),NULLIF(frame.event_payload #>> '{metadata,kokoro,run_id}',''))=process.run_id)`,
          [stream.tenant_id, stream.session_id],
        )
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
