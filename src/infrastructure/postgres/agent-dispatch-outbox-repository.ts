import { randomUUID } from "node:crypto"

import type {
  AgentDispatchOutboxClaimInput,
  AgentDispatchOutboxRepository,
  CommitChatTurn,
} from "../../application/ports/agent-dispatch-outbox-repository.js"
import { agentDispatchFailureProjection } from "../../application/agui/agent-dispatch-failure.js"
import {
  parseAgentDispatchPayload,
  type AgentDispatchCommand,
  type AgentDispatchLease,
  type AgentDispatchReceipt,
  type AgentDispatchStatus,
} from "../../domain/chat/agent-dispatch.js"
import type { PoolClient } from "pg"
import type { PostgresBffDatabase } from "./client.js"
import { agUiConsumerRegistration } from "./agui-consumer-registration.js"
import { instant } from "./chat-repository-mappers.js"
import { firstMessageConversationTitle, isClientCreatedConversationId } from "../../domain/chat/conversation.js"

type AgentDispatchRow = {
  outbox_id: string
  tenant_id: string
  conversation_id: string
  conversation_dispatch_seq: string | number
  subject_id: string
  actor_id: string
  request_id: string
  idempotency_key: string
  request_digest: string
  run_id: string
  user_message_id: string
  assistant_message_id: string
  identity_assertion_ref: string
  payload: unknown
  status: AgentDispatchStatus
  attempt_count: string | number
  lease_owner: string | null
  lease_token: string | null
  lease_until: Date | string | null
  fence: string | number
  lease_remaining_ms?: string | number
}

type FailedDispatchRow = {
  outbox_id: string
  tenant_id: string
  conversation_id: string
  conversation_dispatch_seq: string | number
  run_id: string
  failed_at: Date | string
}

type DispatchFailureSettlement = {
  settled: boolean
  notificationCursor: string | null
  tenantId: string | null
  sessionId: string | null
}

const AGENT_DISPATCH_COLUMN_NAMES = [
  "outbox_id",
  "tenant_id",
  "conversation_id",
  "conversation_dispatch_seq",
  "subject_id",
  "actor_id",
  "request_id",
  "idempotency_key",
  "request_digest",
  "run_id",
  "user_message_id",
  "assistant_message_id",
  "identity_assertion_ref",
  "payload",
  "status",
  "attempt_count",
  "lease_owner",
  "lease_token",
  "lease_until",
  "fence",
] as const

const AGENT_DISPATCH_COLUMNS = AGENT_DISPATCH_COLUMN_NAMES.join(", ")
const CLAIMED_AGENT_DISPATCH_COLUMNS = AGENT_DISPATCH_COLUMN_NAMES
  .map((column) => `dispatch.${column}`)
  .join(", ")

function safeInteger(value: string | number, code: string): number {
  const parsed = typeof value === "number" ? value : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(code)
  return parsed
}

function positiveDecimal(value: string | number, code: string): string {
  const normalized = String(value)
  if (!/^[1-9][0-9]*$/u.test(normalized)) throw new Error(code)
  return normalized
}

function requiredIdentity(value: string, code: string): void {
  if (value.trim() === "") throw new Error(code)
}

function receiptOf(row: Pick<AgentDispatchRow, "run_id" | "user_message_id" | "assistant_message_id">): AgentDispatchReceipt {
  return {
    run_id: row.run_id,
    user_message_id: row.user_message_id,
    assistant_message_id: row.assistant_message_id,
  }
}

function claimedAgentDispatch(row: AgentDispatchRow, queryElapsedMs: number): AgentDispatchCommand {
  if (row.status !== "leased" || row.lease_owner === null || row.lease_token === null || row.lease_until === null) {
    throw new Error("AGENT_DISPATCH_LEASE_INVALID")
  }
  if (row.lease_remaining_ms === undefined) throw new Error("AGENT_DISPATCH_LEASE_BUDGET_INVALID")
  const leaseRemainingMs = Math.max(
    1,
    safeInteger(row.lease_remaining_ms, "AGENT_DISPATCH_LEASE_BUDGET_INVALID") - queryElapsedMs,
  )
  const payload = parseAgentDispatchPayload(row.payload)
  if (
    payload.launch.request_id !== row.request_id
    || payload.launch.run_id !== row.run_id
    || payload.launch.session_id !== row.conversation_id
    || payload.launch.message_id !== row.user_message_id
  ) throw new Error("AGENT_DISPATCH_LINEAGE_MISMATCH")
  return {
    outboxId: row.outbox_id,
    tenantId: row.tenant_id,
    conversationId: row.conversation_id,
    conversationDispatchSeq: positiveDecimal(row.conversation_dispatch_seq, "AGENT_DISPATCH_SEQUENCE_INVALID"),
    subjectId: row.subject_id,
    actorId: row.actor_id,
    requestId: row.request_id,
    idempotencyKey: row.idempotency_key,
    requestDigest: row.request_digest,
    runId: row.run_id,
    userMessageId: row.user_message_id,
    assistantMessageId: row.assistant_message_id,
    identityAssertionRef: row.identity_assertion_ref,
    payload,
    status: "leased",
    attemptCount: safeInteger(row.attempt_count, "AGENT_DISPATCH_ATTEMPT_INVALID"),
    leaseOwner: row.lease_owner,
    leaseToken: row.lease_token,
    leaseUntil: instant(row.lease_until),
    leaseRemainingMs,
    fence: safeInteger(row.fence, "AGENT_DISPATCH_FENCE_INVALID"),
  }
}

/** PostgreSQL transaction boundary for Chat admission and Agent delivery. */
export class PostgresAgentDispatchOutboxRepository implements AgentDispatchOutboxRepository {
  public constructor(private readonly database: PostgresBffDatabase) {}

  public async commitChatTurn(command: CommitChatTurn): Promise<AgentDispatchReceipt | null> {
    for (const value of [
      command.outboxId,
      command.tenantId,
      command.conversationId,
      command.subjectId,
      command.actorId,
      command.requestId,
      command.idempotencyKey,
      command.runId,
      command.userMessageId,
      command.assistantMessageId,
      command.identityAssertionRef,
      command.content,
    ]) requiredIdentity(value, "CHAT_TURN_INPUT_INVALID")
    if (!/^[0-9a-f]{64}$/u.test(command.requestDigest)) throw new Error("CHAT_TURN_DIGEST_INVALID")
    const payload = parseAgentDispatchPayload(command.payload)
    if (
      payload.launch.request_id !== command.requestId
      || payload.launch.run_id !== command.runId
      || payload.launch.session_id !== command.conversationId
      || payload.launch.message_id !== command.userMessageId
      || payload.launch.content !== command.content
    ) throw new Error("AGENT_DISPATCH_LINEAGE_MISMATCH")

    const client = await this.database.pool.connect()
    try {
      await client.query("BEGIN")
      if (command.projectRef !== undefined) {
        const project = await client.query<{ project_id: string }>(
          `SELECT project_id FROM bff_project
            WHERE tenant_id = $1 AND owner_id = $2
              AND (project_id = $3 OR slug = $3)
            LIMIT 1 FOR SHARE`,
          [command.tenantId, command.subjectId, command.projectRef],
        )
        if (project.rows[0] === undefined) {
          await client.query("ROLLBACK")
          return null
        }
      }
      if (isClientCreatedConversationId(command.conversationId)) {
        await client.query(
          `INSERT INTO bff_conversation (conversation_id, tenant_id, owner_id, project_ref, title, status)
           VALUES ($1, $2, $3, $4, $5, 'active')
           ON CONFLICT (conversation_id) DO NOTHING`,
          [
            command.conversationId,
            command.tenantId,
            command.subjectId,
            command.projectRef ?? null,
            firstMessageConversationTitle(command.content),
          ],
        )
      }
      const conversation = await client.query<{ conversation_id: string }>(
        `SELECT conversation_id
           FROM bff_conversation
          WHERE tenant_id = $1
            AND conversation_id = $2
            AND status = 'active'
            AND ($3::text IS NULL OR project_ref = $3)
            AND owner_id = $4
            AND (
              project_ref IS NULL
              OR EXISTS (
                SELECT 1 FROM bff_project AS project
                 WHERE project.tenant_id = bff_conversation.tenant_id
                   AND project.owner_id = bff_conversation.owner_id
                   AND (project.project_id = bff_conversation.project_ref OR project.slug = bff_conversation.project_ref)
              )
            )
          FOR UPDATE`,
        [command.tenantId, command.conversationId, command.projectRef ?? null, command.subjectId],
      )
      if (conversation.rows[0] === undefined) {
        await client.query("ROLLBACK")
        return null
      }

      const existing = await client.query<AgentDispatchRow>(
        `SELECT ${AGENT_DISPATCH_COLUMNS}
           FROM bff_agent_dispatch_outbox
          WHERE tenant_id = $1 AND conversation_id = $2 AND idempotency_key = $3
          LIMIT 1`,
        [command.tenantId, command.conversationId, command.idempotencyKey],
      )
      const existingRow = existing.rows[0]
      if (existingRow !== undefined) {
        if (existingRow.request_digest !== command.requestDigest) throw new Error("CHAT_TURN_IDEMPOTENCY_CONFLICT")
        await client.query("COMMIT")
        return receiptOf(existingRow)
      }

      const sequence = await client.query<{ next_seq: string | number }>(
        `SELECT COALESCE(MAX(message_seq), 0) + 1 AS next_seq
           FROM bff_message
          WHERE tenant_id = $1 AND conversation_id = $2`,
        [command.tenantId, command.conversationId],
      )
      const nextSequenceRow = sequence.rows[0]
      if (nextSequenceRow === undefined) throw new Error("CHAT_MESSAGE_SEQUENCE_INVALID")
      const nextSequence = positiveDecimal(nextSequenceRow.next_seq, "CHAT_MESSAGE_SEQUENCE_INVALID")

      const inserted = await client.query(
        `INSERT INTO bff_message
         (message_id, tenant_id, conversation_id, run_id, role, content, status, message_seq)
         VALUES ($1, $2, $3, $4, 'user', $5, 'completed', $6::bigint),
                ($7, $2, $3, $4, 'assistant', '', 'pending', $6::bigint + 1)`,
        [
          command.userMessageId,
          command.tenantId,
          command.conversationId,
          command.runId,
          command.content,
          nextSequence,
          command.assistantMessageId,
        ],
      )
      if (inserted.rowCount !== 2) throw new Error("CHAT_MESSAGE_INSERT_FAILED")

      const outbox = await client.query(
        `INSERT INTO bff_agent_dispatch_outbox
          (outbox_id, tenant_id, conversation_id, conversation_dispatch_seq, subject_id, actor_id, request_id,
           idempotency_key, request_digest, run_id, user_message_id, assistant_message_id,
           identity_assertion_ref, payload, status, attempt_count, available_at, fence)
         VALUES ($1, $2, $3, $4::bigint, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb,
                 'pending', 0, CURRENT_TIMESTAMP(3), 0)`,
        [
          command.outboxId,
          command.tenantId,
          command.conversationId,
          nextSequence,
          command.subjectId,
          command.actorId,
          command.requestId,
          command.idempotencyKey,
          command.requestDigest,
          command.runId,
          command.userMessageId,
          command.assistantMessageId,
          command.identityAssertionRef,
          JSON.stringify(payload),
        ],
      )
      if (outbox.rowCount !== 1) throw new Error("AGENT_DISPATCH_INSERT_FAILED")

      const registration = agUiConsumerRegistration(
        command.tenantId,
        command.conversationId,
        command.subjectId,
        command.runId,
      )
      const registered = await client.query(registration.text, registration.values)
      if (registered.rowCount !== 1) throw new Error("AGENT_DISPATCH_CONSUMER_REGISTRATION_FAILED")
      await client.query(
        `UPDATE bff_conversation
            SET updated_at = CURRENT_TIMESTAMP(3)
          WHERE tenant_id = $1 AND conversation_id = $2`,
        [command.tenantId, command.conversationId],
      )
      await client.query("COMMIT")
      return {
        run_id: command.runId,
        user_message_id: command.userMessageId,
        assistant_message_id: command.assistantMessageId,
      }
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  public async claimAgentDispatchOutbox(input: AgentDispatchOutboxClaimInput): Promise<AgentDispatchCommand[]> {
    requiredIdentity(input.workerId, "AGENT_DISPATCH_WORKER_ID_REQUIRED")
    if (!Number.isSafeInteger(input.limit) || input.limit < 1) throw new Error("AGENT_DISPATCH_LIMIT_INVALID")
    if (!Number.isSafeInteger(input.leaseDurationMs) || input.leaseDurationMs < 1) {
      throw new Error("AGENT_DISPATCH_LEASE_DURATION_INVALID")
    }
    if (!Number.isSafeInteger(input.maxAttempts) || input.maxAttempts < 1) {
      throw new Error("AGENT_DISPATCH_MAX_ATTEMPTS_INVALID")
    }
    const client = await this.database.pool.connect()
    const queryStartedAt = performance.now()
    try {
      await client.query("BEGIN")
      const exhausted = await this.failOneExhaustedHead(client, input)
      const result = await client.query<AgentDispatchRow>(
        `WITH candidates AS MATERIALIZED (
           SELECT current.outbox_id
             FROM bff_agent_dispatch_outbox AS current
            WHERE (
                (current.status IN ('pending', 'retryable') AND current.available_at <= CURRENT_TIMESTAMP(3))
                OR (current.status = 'leased' AND current.lease_until <= CURRENT_TIMESTAMP(3))
              )
              AND current.attempt_count < $4
              AND EXISTS (
                SELECT 1
                  FROM bff_conversation AS conversation
                 WHERE conversation.tenant_id = current.tenant_id
                   AND conversation.conversation_id = current.conversation_id
                   AND conversation.owner_id = current.subject_id
                   AND conversation.status = 'active'
              )
              AND NOT EXISTS (
                SELECT 1
                  FROM bff_agent_dispatch_outbox AS earlier
                 WHERE earlier.tenant_id = current.tenant_id
                   AND earlier.conversation_id = current.conversation_id
                   AND (earlier.conversation_dispatch_seq, earlier.outbox_id)
                       < (current.conversation_dispatch_seq, current.outbox_id)
                   AND earlier.status IN ('pending', 'retryable', 'leased')
              )
            ORDER BY current.available_at ASC, current.tenant_id ASC, current.conversation_id ASC,
                     current.conversation_dispatch_seq ASC, current.outbox_id ASC
            FOR UPDATE SKIP LOCKED
            LIMIT $1
         )
         UPDATE bff_agent_dispatch_outbox AS dispatch
            SET status = 'leased',
                attempt_count = dispatch.attempt_count + 1,
                lease_owner = $2,
                lease_token = gen_random_uuid()::text,
                lease_until = CURRENT_TIMESTAMP(3) + ($3::double precision * INTERVAL '1 millisecond'),
                fence = dispatch.fence + 1,
                updated_at = CURRENT_TIMESTAMP(3)
           FROM candidates
          WHERE dispatch.outbox_id = candidates.outbox_id
         RETURNING ${CLAIMED_AGENT_DISPATCH_COLUMNS},
                   GREATEST(1, FLOOR(EXTRACT(EPOCH FROM (
                     dispatch.lease_until - CURRENT_TIMESTAMP(3)
                   )) * 1000))::bigint AS lease_remaining_ms`,
        [input.limit, input.workerId, input.leaseDurationMs, input.maxAttempts],
      )
      await client.query("COMMIT")
      if (exhausted.notificationCursor !== null && exhausted.tenantId !== null && exhausted.sessionId !== null) {
        await this.database.notifyAgUiProjection(
          exhausted.tenantId,
          exhausted.sessionId,
          exhausted.notificationCursor,
        ).catch(() => undefined)
      }
      const queryElapsedMs = Math.max(0, Math.ceil(performance.now() - queryStartedAt))
      return result.rows.map((row) => claimedAgentDispatch(row, queryElapsedMs))
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  private async failOneExhaustedHead(
    client: PoolClient,
    input: AgentDispatchOutboxClaimInput,
  ): Promise<DispatchFailureSettlement> {
    const exhausted = await client.query<AgentDispatchRow>(
      `WITH candidate AS MATERIALIZED (
         SELECT current.outbox_id
           FROM bff_agent_dispatch_outbox AS current
          WHERE (
              (current.status IN ('pending', 'retryable') AND current.available_at <= CURRENT_TIMESTAMP(3))
              OR (current.status = 'leased' AND current.lease_until <= CURRENT_TIMESTAMP(3))
            )
            AND current.attempt_count >= $1
            AND EXISTS (
              SELECT 1
                FROM bff_conversation AS conversation
               WHERE conversation.tenant_id = current.tenant_id
                 AND conversation.conversation_id = current.conversation_id
                 AND conversation.owner_id = current.subject_id
                 AND conversation.status = 'active'
            )
            AND NOT EXISTS (
              SELECT 1
                FROM bff_agent_dispatch_outbox AS earlier
               WHERE earlier.tenant_id = current.tenant_id
                 AND earlier.conversation_id = current.conversation_id
                 AND (earlier.conversation_dispatch_seq, earlier.outbox_id)
                     < (current.conversation_dispatch_seq, current.outbox_id)
                 AND earlier.status IN ('pending', 'retryable', 'leased')
            )
          ORDER BY current.available_at ASC, current.tenant_id ASC, current.conversation_id ASC,
                   current.conversation_dispatch_seq ASC, current.outbox_id ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
       )
       UPDATE bff_agent_dispatch_outbox AS dispatch
          SET status = 'leased',
              lease_owner = $2,
              lease_token = gen_random_uuid()::text,
              lease_until = CURRENT_TIMESTAMP(3) + ($3::double precision * INTERVAL '1 millisecond'),
              fence = dispatch.fence + 1,
              updated_at = CURRENT_TIMESTAMP(3)
         FROM candidate
        WHERE dispatch.outbox_id = candidate.outbox_id
       RETURNING ${CLAIMED_AGENT_DISPATCH_COLUMNS}`,
      [input.maxAttempts, input.workerId, input.leaseDurationMs],
    )
    const row = exhausted.rows[0]
    if (row === undefined || row.lease_owner === null || row.lease_token === null) {
      return { settled: false, notificationCursor: null, tenantId: null, sessionId: null }
    }
    const settled = await this.markAgentDispatchFailedInTransaction(client, {
      tenantId: row.tenant_id,
      outboxId: row.outbox_id,
      leaseOwner: row.lease_owner,
      leaseToken: row.lease_token,
      fence: safeInteger(row.fence, "AGENT_DISPATCH_FENCE_INVALID"),
    }, "agent_dispatch_attempts_exhausted")
    if (!settled.settled) throw new Error("AGENT_DISPATCH_EXHAUSTED_SETTLEMENT_FAILED")
    return settled
  }

  public async markAgentDispatchSucceeded(lease: AgentDispatchLease): Promise<boolean> {
    this.assertAgentDispatchLease(lease)
    const result = await this.database.pool.query(
      `UPDATE bff_agent_dispatch_outbox
          SET status = 'succeeded', completed_at = CURRENT_TIMESTAMP(3),
              last_error_code = NULL, last_error_at = NULL,
              lease_owner = NULL, lease_token = NULL, lease_until = NULL,
              updated_at = CURRENT_TIMESTAMP(3)
        WHERE tenant_id = $1 AND outbox_id = $2 AND status = 'leased' AND lease_owner = $3
          AND lease_token = $4 AND fence = $5 AND lease_until > CURRENT_TIMESTAMP(3)`,
      [lease.tenantId, lease.outboxId, lease.leaseOwner, lease.leaseToken, lease.fence],
    )
    return result.rowCount === 1
  }

  public async markAgentDispatchRetryable(
    lease: AgentDispatchLease,
    delayMs: number,
    errorCode: string,
  ): Promise<boolean> {
    this.assertAgentDispatchLease(lease)
    if (!Number.isSafeInteger(delayMs) || delayMs < 1) throw new Error("AGENT_DISPATCH_RETRY_DELAY_INVALID")
    requiredIdentity(errorCode, "AGENT_DISPATCH_ERROR_CODE_REQUIRED")
    const result = await this.database.pool.query(
      `UPDATE bff_agent_dispatch_outbox
          SET status = 'retryable',
              available_at = CURRENT_TIMESTAMP(3) + ($6::double precision * INTERVAL '1 millisecond'),
              last_error_code = $7, last_error_at = CURRENT_TIMESTAMP(3), completed_at = NULL,
              lease_owner = NULL, lease_token = NULL, lease_until = NULL,
              updated_at = CURRENT_TIMESTAMP(3)
        WHERE tenant_id = $1 AND outbox_id = $2 AND status = 'leased' AND lease_owner = $3
          AND lease_token = $4 AND fence = $5 AND lease_until > CURRENT_TIMESTAMP(3)`,
      [lease.tenantId, lease.outboxId, lease.leaseOwner, lease.leaseToken, lease.fence, delayMs, errorCode],
    )
    return result.rowCount === 1
  }

  public async markAgentDispatchFailed(lease: AgentDispatchLease, errorCode: string): Promise<boolean> {
    this.assertAgentDispatchLease(lease)
    requiredIdentity(errorCode, "AGENT_DISPATCH_ERROR_CODE_REQUIRED")
    const client = await this.database.pool.connect()
    try {
      await client.query("BEGIN")
      const settled = await this.markAgentDispatchFailedInTransaction(client, lease, errorCode)
      await client.query("COMMIT")
      if (settled.notificationCursor !== null && settled.tenantId !== null && settled.sessionId !== null) {
        await this.database.notifyAgUiProjection(
          settled.tenantId,
          settled.sessionId,
          settled.notificationCursor,
        ).catch(() => undefined)
      }
      return settled.settled
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  private async markAgentDispatchFailedInTransaction(
    client: PoolClient,
    lease: AgentDispatchLease,
    errorCode: string,
  ): Promise<DispatchFailureSettlement> {
    const settled = await client.query<FailedDispatchRow>(
      `UPDATE bff_agent_dispatch_outbox
          SET status = 'failed', completed_at = CURRENT_TIMESTAMP(3),
              last_error_code = $6, last_error_at = CURRENT_TIMESTAMP(3),
              lease_owner = NULL, lease_token = NULL, lease_until = NULL,
              updated_at = CURRENT_TIMESTAMP(3)
        WHERE tenant_id = $1 AND outbox_id = $2 AND status = 'leased' AND lease_owner = $3
          AND lease_token = $4 AND fence = $5 AND lease_until > CURRENT_TIMESTAMP(3)
        RETURNING outbox_id, tenant_id, conversation_id, conversation_dispatch_seq, run_id,
                  CURRENT_TIMESTAMP(3) AS failed_at`,
      [lease.tenantId, lease.outboxId, lease.leaseOwner, lease.leaseToken, lease.fence, errorCode],
    )
    const row = settled.rows[0]
    if (row === undefined) {
      return { settled: false, notificationCursor: null, tenantId: null, sessionId: null }
    }
    const stream = await client.query<{ expected_run_id: string | null; next_public_sequence: string }>(
      `SELECT expected_run_id, next_public_sequence
         FROM bff_agui_stream
        WHERE tenant_id = $1 AND session_id = $2
        FOR UPDATE`,
      [row.tenant_id, row.conversation_id],
    )
    const streamRow = stream.rows[0]
    if (streamRow === undefined) throw new Error("AGENT_DISPATCH_AGUI_STREAM_MISSING")
    // Keep the same stream -> Message lock order as source projection.
    await client.query(
      `UPDATE bff_message
          SET status = 'failed', updated_at = CURRENT_TIMESTAMP(3)
        WHERE tenant_id = $1 AND conversation_id = $2 AND run_id = $3
          AND role = 'assistant' AND status IN ('pending', 'streaming')`,
      [row.tenant_id, row.conversation_id, row.run_id],
    )
    const projection = agentDispatchFailureProjection({
      outboxId: row.outbox_id,
      conversationId: row.conversation_id,
      conversationDispatchSeq: positiveDecimal(row.conversation_dispatch_seq, "AGENT_DISPATCH_SEQUENCE_INVALID"),
      runId: row.run_id,
      errorCode,
      failedAt: instant(row.failed_at).toISOString(),
    })
    const cursor = `agui_${randomUUID().replaceAll("-", "")}`
    await client.query(
      `INSERT INTO bff_agui_source_event
        (tenant_id, session_id, source_owner, source_event_id, source_sequence,
         source_digest, source_occurred_at)
       VALUES ($1, $2, $3, $4, $5::bigint, $6, $7::timestamptz)`,
      [
        row.tenant_id,
        row.conversation_id,
        projection.sourceOwner,
        projection.sourceEventId,
        projection.sourceSequence,
        projection.sourceDigest,
        projection.sourceOccurredAt,
      ],
    )
    await client.query(
      `INSERT INTO bff_agui_event
        (tenant_id, session_id, public_sequence, cursor, source_owner, source_event_id,
         frame_index, event_type, event_payload, source_occurred_at)
       VALUES ($1, $2, $3::bigint, $4, $5, $6, 0, $7, $8::jsonb, $9::timestamptz)`,
      [
        row.tenant_id,
        row.conversation_id,
        streamRow.next_public_sequence,
        cursor,
        projection.sourceOwner,
        projection.sourceEventId,
        projection.frameType,
        JSON.stringify(projection.framePayload),
        projection.sourceOccurredAt,
      ],
    )
    const updated = await client.query(
      `UPDATE bff_agui_stream
          SET version = version + 1,
              next_public_sequence = next_public_sequence + 1,
              latest_run_id = CASE WHEN expected_run_id = $3 THEN $3 ELSE latest_run_id END,
              terminal_run_id = CASE WHEN expected_run_id = $3 THEN $3 ELSE terminal_run_id END,
              consumer_state = CASE WHEN expected_run_id = $3 THEN 'stopped' ELSE consumer_state END,
              consumer_fence = consumer_fence + CASE WHEN expected_run_id = $3 THEN 1 ELSE 0 END,
              consumer_failure_count = consumer_failure_count + CASE WHEN expected_run_id = $3 THEN 1 ELSE 0 END,
              consumer_lease_owner = CASE WHEN expected_run_id = $3 THEN NULL ELSE consumer_lease_owner END,
              consumer_lease_token = CASE WHEN expected_run_id = $3 THEN NULL ELSE consumer_lease_token END,
              consumer_lease_until = CASE WHEN expected_run_id = $3 THEN NULL ELSE consumer_lease_until END,
              consumer_last_error_code = CASE WHEN expected_run_id = $3 THEN $4 ELSE consumer_last_error_code END,
              consumer_last_error_at = CASE WHEN expected_run_id = $3 THEN CURRENT_TIMESTAMP(3) ELSE consumer_last_error_at END,
              consumer_last_polled_at = CASE WHEN expected_run_id = $3 THEN CURRENT_TIMESTAMP(3) ELSE consumer_last_polled_at END,
              updated_at = CURRENT_TIMESTAMP(3)
        WHERE tenant_id = $1 AND session_id = $2`,
      [row.tenant_id, row.conversation_id, row.run_id, errorCode],
    )
    if (updated.rowCount !== 1) throw new Error("AGENT_DISPATCH_AGUI_SETTLEMENT_FAILED")
    return {
      settled: true,
      notificationCursor: cursor,
      tenantId: row.tenant_id,
      sessionId: row.conversation_id,
    }
  }

  private assertAgentDispatchLease(lease: AgentDispatchLease): void {
    requiredIdentity(lease.tenantId, "AGENT_DISPATCH_TENANT_ID_REQUIRED")
    requiredIdentity(lease.outboxId, "AGENT_DISPATCH_OUTBOX_ID_REQUIRED")
    requiredIdentity(lease.leaseOwner, "AGENT_DISPATCH_LEASE_OWNER_REQUIRED")
    requiredIdentity(lease.leaseToken, "AGENT_DISPATCH_LEASE_TOKEN_REQUIRED")
    if (!Number.isSafeInteger(lease.fence) || lease.fence < 1) throw new Error("AGENT_DISPATCH_FENCE_INVALID")
  }
}
