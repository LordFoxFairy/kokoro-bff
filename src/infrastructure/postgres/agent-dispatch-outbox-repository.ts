import { createHash, randomUUID } from "node:crypto"

import { EventSchemas, EventType } from "@ag-ui/core"

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
  admission_unknown_seen: boolean
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
  "admission_unknown_seen",
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

function signedSafeInteger(value: string | number, code: string): number {
  const parsed = typeof value === "number" ? value : Number(value)
  if (!Number.isSafeInteger(parsed)) throw new Error(code)
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

function claimedAgentDispatch(row: AgentDispatchRow): AgentDispatchCommand {
  if (row.status !== "leased" || row.lease_owner === null || row.lease_token === null || row.lease_until === null) {
    throw new Error("AGENT_DISPATCH_LEASE_INVALID")
  }
  if (row.lease_remaining_ms === undefined) throw new Error("AGENT_DISPATCH_LEASE_BUDGET_INVALID")
  const leaseRemainingMs = safeInteger(row.lease_remaining_ms, "AGENT_DISPATCH_LEASE_BUDGET_INVALID")
  if (leaseRemainingMs < 1) throw new Error("AGENT_DISPATCH_LEASE_BUDGET_EXHAUSTED")
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
    admissionUnknownSeen: row.admission_unknown_seen,
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

  /** Every batch locks all parent Conversations before entering any stream/tail. */
  public static async lockConversationsInTransaction(
    client: PoolClient,
    scopes: readonly { tenantId: string; conversationId: string }[],
    skipLocked = false,
  ): Promise<{ tenant_id: string; conversation_id: string; owner_id: string; status: string }[]> {
    if (scopes.length === 0) return []
    const result = await client.query<{ tenant_id: string; conversation_id: string; owner_id: string; status: string }>(
      [
        "SELECT conversation.tenant_id, conversation.conversation_id, conversation.owner_id, conversation.status",
        "FROM bff_conversation AS conversation",
        "WHERE EXISTS (SELECT 1 FROM jsonb_to_recordset($1::jsonb)",
        "AS scope(tenant_id text, conversation_id text)",
        "WHERE scope.tenant_id=conversation.tenant_id AND scope.conversation_id=conversation.conversation_id)",
        "ORDER BY conversation.tenant_id, conversation.conversation_id FOR UPDATE OF conversation",
      ].join("\n") + (skipLocked ? " SKIP LOCKED" : ""),
      [JSON.stringify(scopes.map((scope) => ({ tenant_id: scope.tenantId, conversation_id: scope.conversationId })))],
    )
    return result.rows
  }

  /** Caller owns Conversation -> stream; writes no Agent source/fence and never commits. */
  public static async projectQueuedHeadInTransaction(
    client: PoolClient,
    tenantId: string,
    conversationId: string,
  ): Promise<string | null> {
    const heads = await client.query<{
      outbox_id: string; run_id: string; subject_id: string; owner_id: string;
      conversation_dispatch_seq: string; created_at: Date | string;
    }>(
      [
        "SELECT dispatch.outbox_id, dispatch.run_id, dispatch.subject_id, conversation.owner_id,",
        "dispatch.conversation_dispatch_seq, dispatch.created_at",
        "FROM bff_agent_dispatch_outbox AS dispatch JOIN bff_conversation AS conversation",
        "ON conversation.tenant_id=dispatch.tenant_id AND conversation.conversation_id=dispatch.conversation_id",
        "WHERE dispatch.tenant_id=$1 AND dispatch.conversation_id=$2 AND conversation.status='active'",
        "AND dispatch.status IN ('pending','leased','retryable','admitted')",
        "ORDER BY dispatch.conversation_dispatch_seq, dispatch.outbox_id LIMIT 1",
      ].join("\n"),
      [tenantId, conversationId],
    )
    const head = heads.rows[0]
    if (head === undefined) return null
    if (head.subject_id !== head.owner_id) throw new Error("CHAT_EXECUTION_HEAD_IDENTITY_INVALID")
    const streams = await client.query<{
      next_public_sequence: string; consumer_subject_id: string | null; expected_run_id: string | null;
    }>(
      "SELECT next_public_sequence,consumer_subject_id,expected_run_id FROM bff_agui_stream WHERE tenant_id=$1 AND session_id=$2 FOR UPDATE",
      [tenantId, conversationId],
    )
    const stream = streams.rows[0]
    if (stream === undefined || stream.consumer_subject_id !== head.subject_id
      || (stream.expected_run_id !== null && stream.expected_run_id !== head.run_id)) {
      throw new Error("CHAT_EXECUTION_HEAD_IDENTITY_INVALID")
    }
    const sequence = positiveDecimal(head.conversation_dispatch_seq, "AGENT_DISPATCH_SEQUENCE_INVALID")
    const sourceEventId = "dispatch_queued:" + head.outbox_id
    const cursor = "agui_" + createHash("sha256")
      .update(JSON.stringify([tenantId, conversationId, sourceEventId])).digest("hex").slice(0, 32)
    const value = { run_id: head.run_id, dispatch_sequence: sequence }
    const existing = await client.query<{ cursor: string; event_type: string; name: string; matches_value: boolean }>(
      [
        "SELECT cursor,event_type,event_payload->>'name' AS name,event_payload->'value'=$4::jsonb AS matches_value",
        "FROM bff_agui_event WHERE tenant_id=$1 AND session_id=$2 AND source_owner='kokoro-bff'",
        "AND source_event_id=$3 AND frame_index=0",
      ].join("\n"),
      [tenantId, conversationId, sourceEventId, JSON.stringify(value)],
    )
    const recorded = existing.rows[0]
    if (recorded !== undefined) {
      if (recorded.cursor !== cursor || recorded.event_type !== "CUSTOM"
        || recorded.name !== "kokoro.run.queued" || !recorded.matches_value) {
        throw new Error("CHAT_QUEUED_EVENT_IDENTITY_CONFLICT")
      }
      return null
    }
    const occurredAt = instant(head.created_at).toISOString()
    const payload = EventSchemas.parse({
      type: EventType.CUSTOM, timestamp: Date.parse(occurredAt), name: "kokoro.run.queued", value,
      metadata: { kokoro: {
        event_id: sourceEventId, seq: sequence, session_id: conversationId, run_id: head.run_id,
        timestamp: occurredAt, source_owner: "kokoro-bff",
      } },
    })
    await client.query(
      [
        "INSERT INTO bff_agui_event",
        "(tenant_id,session_id,public_sequence,cursor,source_owner,source_event_id,frame_index,event_type,event_payload,source_occurred_at)",
        "VALUES ($1,$2,$3::bigint,$4,'kokoro-bff',$5,0,'CUSTOM',$6::jsonb,$7::timestamptz)",
      ].join("\n"),
      [tenantId, conversationId, stream.next_public_sequence, cursor, sourceEventId, JSON.stringify(payload), occurredAt],
    )
    const advanced = await client.query(
      [
        "UPDATE bff_agui_stream SET version=version+1,next_public_sequence=next_public_sequence+1,updated_at=CURRENT_TIMESTAMP(3)",
        "WHERE tenant_id=$1 AND session_id=$2 AND next_public_sequence=$3::bigint",
      ].join("\n"),
      [tenantId, conversationId, stream.next_public_sequence],
    )
    if (advanced.rowCount !== 1) throw new Error("CHAT_QUEUED_CURSOR_ALLOCATION_FAILED")
    return cursor
  }

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

      const registration = agUiConsumerRegistration(
        command.tenantId,
        command.conversationId,
        command.subjectId,
        undefined,
      )
      const registered = await client.query(registration.text, registration.values)
      if (registered.rowCount !== 1) throw new Error("AGENT_DISPATCH_CONSUMER_REGISTRATION_FAILED")
      await client.query("SELECT 1 FROM bff_agui_stream WHERE tenant_id=$1 AND session_id=$2 FOR UPDATE", [command.tenantId, command.conversationId])

      const sequence = await client.query<{ next_seq: string | number }>(
        `SELECT COALESCE(MAX(message_seq), 0) + 1 AS next_seq
           FROM bff_message
          WHERE tenant_id = $1 AND conversation_id = $2`,
        [command.tenantId, command.conversationId],
      )
      const nextSequenceRow = sequence.rows[0]
      if (nextSequenceRow === undefined) throw new Error("CHAT_MESSAGE_SEQUENCE_INVALID")
      const nextSequence = positiveDecimal(nextSequenceRow.next_seq, "CHAT_MESSAGE_SEQUENCE_INVALID")

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

      const queuedCursor = await PostgresAgentDispatchOutboxRepository.projectQueuedHeadInTransaction(client, command.tenantId, command.conversationId)
      await client.query(
        `UPDATE bff_conversation
            SET updated_at = CURRENT_TIMESTAMP(3)
          WHERE tenant_id = $1 AND conversation_id = $2`,
        [command.tenantId, command.conversationId],
      )
      await client.query("COMMIT")
      if (queuedCursor !== null) await this.database.notifyAgUiProjection(command.tenantId, command.conversationId, queuedCursor).catch(() => undefined)
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
    try {
      await client.query("BEGIN")
      const exhausted = await this.failOneExhaustedHead(client, input)
      if (exhausted.settled) {
        await client.query("COMMIT")
        if (exhausted.notificationCursor !== null && exhausted.tenantId !== null && exhausted.sessionId !== null) {
          await this.database.notifyAgUiProjection(
            exhausted.tenantId,
            exhausted.sessionId,
            exhausted.notificationCursor,
          ).catch(() => undefined)
        }
        return []
      }
      // Exhaustion probing is its own lock phase even when a concurrent worker
      // wins the revalidation. Release that stream lock before selecting the
      // globally ordered claim set, otherwise X -> A can deadlock A -> X.
      await client.query("COMMIT")
      await client.query("BEGIN")
      const identities = await client.query<{ outbox_id: string; tenant_id: string; conversation_id: string }>(
        `SELECT current.outbox_id, current.tenant_id, current.conversation_id
           FROM bff_agent_dispatch_outbox AS current
          WHERE (((current.status IN ('pending', 'retryable') AND current.available_at <= CURRENT_TIMESTAMP(3))
                   OR (current.status = 'leased' AND current.lease_until <= CURRENT_TIMESTAMP(3)))
             AND (current.attempt_count < $2 OR current.admission_unknown_seen OR current.status = 'leased'))
            AND EXISTS (SELECT 1 FROM bff_conversation AS conversation
                         WHERE conversation.tenant_id=current.tenant_id
                           AND conversation.conversation_id=current.conversation_id
                           AND conversation.owner_id=current.subject_id AND conversation.status='active')
            AND NOT EXISTS (SELECT 1 FROM bff_agent_dispatch_outbox AS earlier
                             WHERE earlier.tenant_id=current.tenant_id
                               AND earlier.conversation_id=current.conversation_id
                               AND (earlier.conversation_dispatch_seq, earlier.outbox_id)
                                   < (current.conversation_dispatch_seq, current.outbox_id)
                               AND earlier.status IN ('pending','retryable','leased','admitted'))
          ORDER BY current.tenant_id, current.conversation_id, current.conversation_dispatch_seq, current.outbox_id
          LIMIT $1`,
        [input.limit, input.maxAttempts],
      )
      await PostgresAgentDispatchOutboxRepository.lockConversationsInTransaction(client, identities.rows.map((identity) => ({
        tenantId: identity.tenant_id, conversationId: identity.conversation_id,
      })))
      for (const identity of identities.rows) {
        await client.query(
          `SELECT 1 FROM bff_agui_stream WHERE tenant_id=$1 AND session_id=$2 FOR UPDATE`,
          [identity.tenant_id, identity.conversation_id],
        )
      }
      const candidateIds = identities.rows.map((row) => row.outbox_id)
      if (candidateIds.length === 0) {
        await client.query("COMMIT")
        return []
      }
      await client.query(
        `SELECT outbox_id FROM bff_agent_dispatch_outbox
          WHERE outbox_id = ANY($1::text[]) ORDER BY tenant_id, conversation_id, conversation_dispatch_seq, outbox_id
          FOR UPDATE`,
        [candidateIds],
      )
      const claimClock = await client.query<{ db_now: Date }>("SELECT clock_timestamp() AS db_now")
      const claimDbNow = claimClock.rows[0]?.db_now
      if (claimDbNow === undefined) throw new Error("AGENT_DISPATCH_DATABASE_CLOCK_UNAVAILABLE")
      const result = await client.query<AgentDispatchRow>(
        `WITH candidates AS MATERIALIZED (
           SELECT current.outbox_id
             FROM bff_agent_dispatch_outbox AS current
            WHERE (
                (current.status IN ('pending', 'retryable') AND current.available_at <= $6::timestamptz)
                OR (current.status = 'leased' AND current.lease_until <= $6::timestamptz)
              )
              AND (current.attempt_count < $4 OR current.admission_unknown_seen OR current.status = 'leased')
              AND current.outbox_id = ANY($5::text[])
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
                   AND earlier.status IN ('pending', 'retryable', 'leased', 'admitted')
              )
            ORDER BY current.available_at ASC, current.tenant_id ASC, current.conversation_id ASC,
                     current.conversation_dispatch_seq ASC, current.outbox_id ASC
            LIMIT $1
         )
         UPDATE bff_agent_dispatch_outbox AS dispatch
            SET status = 'leased',
                admission_unknown_seen = dispatch.admission_unknown_seen OR dispatch.status = 'leased',
                attempt_count = dispatch.attempt_count + 1,
                lease_owner = $2,
                lease_token = gen_random_uuid()::text,
                lease_until = $6::timestamptz + ($3::double precision * INTERVAL '1 millisecond'),
                fence = dispatch.fence + 1,
                updated_at = $6::timestamptz
           FROM candidates
          WHERE dispatch.outbox_id = candidates.outbox_id
         RETURNING ${CLAIMED_AGENT_DISPATCH_COLUMNS},
                   FLOOR(EXTRACT(EPOCH FROM (dispatch.lease_until - $6::timestamptz)) * 1000)::bigint AS lease_remaining_ms`,
        [input.limit, input.workerId, input.leaseDurationMs, input.maxAttempts, candidateIds, claimDbNow],
      )
      for (const row of result.rows) {
        const registration = agUiConsumerRegistration(row.tenant_id, row.conversation_id, row.subject_id, row.run_id)
        const registered = await client.query(registration.text, registration.values)
        if (registered.rowCount !== 1) throw new Error("AGENT_DISPATCH_CONSUMER_REGISTRATION_FAILED")
      }
      const finalObservedAt = performance.now()
      const finalClock = await client.query<{ db_now: Date }>("SELECT clock_timestamp() AS db_now")
      const finalDbNow = finalClock.rows[0]?.db_now
      if (finalDbNow === undefined) throw new Error("AGENT_DISPATCH_DATABASE_CLOCK_UNAVAILABLE")
      const remaining = await client.query<{ outbox_id: string; lease_remaining_ms: string }>(
        `SELECT outbox_id, FLOOR(EXTRACT(EPOCH FROM (lease_until - $2::timestamptz)) * 1000)::bigint AS lease_remaining_ms
           FROM bff_agent_dispatch_outbox WHERE outbox_id = ANY($1::text[])`,
        [result.rows.map((row) => row.outbox_id), finalDbNow],
      )
      const remainingById = new Map(remaining.rows.map((row) => [row.outbox_id, row.lease_remaining_ms]))
      if (result.rows.some((row) => signedSafeInteger(remainingById.get(row.outbox_id) ?? "0", "AGENT_DISPATCH_LEASE_BUDGET_INVALID") < 1)) {
        await client.query("ROLLBACK")
        return []
      }
      for (const row of result.rows) row.lease_remaining_ms = remainingById.get(row.outbox_id) ?? "0"
      await client.query("COMMIT")
      const commitElapsedMs = Math.ceil(performance.now() - finalObservedAt)
      const liveRows = result.rows.filter((row) => {
        const remainingMs = signedSafeInteger(row.lease_remaining_ms ?? "0", "AGENT_DISPATCH_LEASE_BUDGET_INVALID") - commitElapsedMs
        row.lease_remaining_ms = remainingMs
        return remainingMs > 0
      })
      if (exhausted.notificationCursor !== null && exhausted.tenantId !== null && exhausted.sessionId !== null) {
        await this.database.notifyAgUiProjection(
          exhausted.tenantId,
          exhausted.sessionId,
          exhausted.notificationCursor,
        ).catch(() => undefined)
      }
      return liveRows.map((row) => claimedAgentDispatch(row))
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
    const identity = await client.query<{ outbox_id: string; tenant_id: string; conversation_id: string }>(
      `SELECT current.outbox_id, current.tenant_id, current.conversation_id
         FROM bff_agent_dispatch_outbox AS current
        WHERE current.status IN ('pending','retryable') AND current.available_at <= CURRENT_TIMESTAMP(3)
          AND current.attempt_count >= $1 AND current.admission_unknown_seen = FALSE
          AND EXISTS (SELECT 1 FROM bff_conversation AS conversation
                       WHERE conversation.tenant_id=current.tenant_id
                         AND conversation.conversation_id=current.conversation_id
                         AND conversation.owner_id=current.subject_id AND conversation.status='active')
          AND NOT EXISTS (SELECT 1 FROM bff_agent_dispatch_outbox AS earlier
                           WHERE earlier.tenant_id=current.tenant_id
                             AND earlier.conversation_id=current.conversation_id
                             AND (earlier.conversation_dispatch_seq, earlier.outbox_id)
                                 < (current.conversation_dispatch_seq, current.outbox_id)
                             AND earlier.status IN ('pending','retryable','leased','admitted'))
        ORDER BY current.tenant_id, current.conversation_id, current.conversation_dispatch_seq, current.outbox_id LIMIT 1`,
      [input.maxAttempts],
    )
    const candidate = identity.rows[0]
    if (candidate === undefined) return { settled: false, notificationCursor: null, tenantId: null, sessionId: null }
    await PostgresAgentDispatchOutboxRepository.lockConversationsInTransaction(client, [{ tenantId: candidate.tenant_id, conversationId: candidate.conversation_id }])
    await client.query(
      `SELECT 1 FROM bff_agui_stream WHERE tenant_id=$1 AND session_id=$2 FOR UPDATE`,
      [candidate.tenant_id, candidate.conversation_id],
    )
    const exhausted = await client.query<AgentDispatchRow>(
      `WITH candidate AS MATERIALIZED (
         SELECT current.outbox_id
           FROM bff_agent_dispatch_outbox AS current
          WHERE current.status IN ('pending', 'retryable')
            AND current.available_at <= CURRENT_TIMESTAMP(3)
            AND current.attempt_count >= $1
            AND current.admission_unknown_seen = FALSE
            AND current.outbox_id = $4
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
                 AND earlier.status IN ('pending', 'retryable', 'leased', 'admitted')
            )
          ORDER BY current.available_at ASC, current.tenant_id ASC, current.conversation_id ASC,
                   current.conversation_dispatch_seq ASC, current.outbox_id ASC
          LIMIT 1
       )
       UPDATE bff_agent_dispatch_outbox AS dispatch
          SET status = 'leased',
              lease_owner = $2,
              lease_token = gen_random_uuid()::text,
              lease_until = clock_timestamp() + ($3::double precision * INTERVAL '1 millisecond'),
              fence = dispatch.fence + 1,
              updated_at = CURRENT_TIMESTAMP(3)
         FROM candidate
        WHERE dispatch.outbox_id = candidate.outbox_id
       RETURNING ${CLAIMED_AGENT_DISPATCH_COLUMNS}`,
      [input.maxAttempts, input.workerId, input.leaseDurationMs, candidate.outbox_id],
    )
    const row = exhausted.rows[0]
    if (row === undefined || row.lease_owner === null || row.lease_token === null) {
      return { settled: false, notificationCursor: null, tenantId: null, sessionId: null }
    }
    const failureClock = await client.query<{ db_now: Date }>("SELECT clock_timestamp() AS db_now")
    const failureDbNow = failureClock.rows[0]?.db_now
    if (failureDbNow === undefined) throw new Error("AGENT_DISPATCH_DATABASE_CLOCK_UNAVAILABLE")
    const settled = await this.markAgentDispatchFailedInTransaction(client, {
      tenantId: row.tenant_id,
      outboxId: row.outbox_id,
      leaseOwner: row.lease_owner,
      leaseToken: row.lease_token,
      fence: safeInteger(row.fence, "AGENT_DISPATCH_FENCE_INVALID"),
    }, "agent_dispatch_attempts_exhausted", failureDbNow)
    if (!settled.settled) throw new Error("AGENT_DISPATCH_EXHAUSTED_SETTLEMENT_FAILED")
    return settled
  }

  public async markAgentDispatchAdmitted(lease: AgentDispatchLease): Promise<boolean> {
    this.assertAgentDispatchLease(lease)
    const client = await this.database.pool.connect()
    try {
      await client.query("BEGIN")
      await client.query(
        `SELECT 1 FROM bff_agent_dispatch_outbox
          WHERE tenant_id=$1 AND outbox_id=$2 AND status='leased' AND lease_owner=$3 AND lease_token=$4 AND fence=$5
          FOR UPDATE`,
        [lease.tenantId, lease.outboxId, lease.leaseOwner, lease.leaseToken, lease.fence],
      )
      const clock = await client.query<{ db_now: Date }>("SELECT clock_timestamp() AS db_now")
      const dbNow = clock.rows[0]?.db_now
      if (dbNow === undefined) throw new Error("AGENT_DISPATCH_DATABASE_CLOCK_UNAVAILABLE")
      const result = await client.query(
        `UPDATE bff_agent_dispatch_outbox
            SET status='admitted', admitted_at=$6::timestamptz, completed_at=NULL,
                last_error_code=NULL, last_error_at=NULL, lease_owner=NULL, lease_token=NULL, lease_until=NULL,
                updated_at=$6::timestamptz
          WHERE tenant_id=$1 AND outbox_id=$2 AND status='leased' AND lease_owner=$3
            AND lease_token=$4 AND fence=$5 AND lease_until>$6::timestamptz`,
        [lease.tenantId, lease.outboxId, lease.leaseOwner, lease.leaseToken, lease.fence, dbNow],
      )
      await client.query("COMMIT")
      return result.rowCount === 1
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined)
      throw error
    } finally { client.release() }
  }

  public async markAgentDispatchUnknown(
    lease: AgentDispatchLease,
    delayMs: number,
    errorCode: string,
  ): Promise<boolean> {
    this.assertAgentDispatchLease(lease)
    if (!Number.isSafeInteger(delayMs) || delayMs < 1) throw new Error("AGENT_DISPATCH_RETRY_DELAY_INVALID")
    requiredIdentity(errorCode, "AGENT_DISPATCH_ERROR_CODE_REQUIRED")
    const client = await this.database.pool.connect()
    try {
      await client.query("BEGIN")
      await client.query(
        `SELECT 1 FROM bff_agent_dispatch_outbox
          WHERE tenant_id=$1 AND outbox_id=$2 AND status='leased' AND lease_owner=$3 AND lease_token=$4 AND fence=$5
          FOR UPDATE`,
        [lease.tenantId, lease.outboxId, lease.leaseOwner, lease.leaseToken, lease.fence],
      )
      const clock = await client.query<{ db_now: Date }>("SELECT clock_timestamp() AS db_now")
      const dbNow = clock.rows[0]?.db_now
      if (dbNow === undefined) throw new Error("AGENT_DISPATCH_DATABASE_CLOCK_UNAVAILABLE")
      const result = await client.query(
        `UPDATE bff_agent_dispatch_outbox
            SET status='retryable', admission_unknown_seen=TRUE,
                available_at=$8::timestamptz + ($6::double precision * INTERVAL '1 millisecond'),
                last_error_code=$7, last_error_at=$8::timestamptz, completed_at=NULL,
                lease_owner=NULL, lease_token=NULL, lease_until=NULL, updated_at=$8::timestamptz
          WHERE tenant_id=$1 AND outbox_id=$2 AND status='leased' AND lease_owner=$3
            AND lease_token=$4 AND fence=$5 AND lease_until>$8::timestamptz`,
        [lease.tenantId, lease.outboxId, lease.leaseOwner, lease.leaseToken, lease.fence, delayMs, errorCode, dbNow],
      )
      await client.query("COMMIT")
      return result.rowCount === 1
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined)
      throw error
    } finally { client.release() }
  }

  public async markAgentDispatchNotAdmitted(lease: AgentDispatchLease, delayMs: number, errorCode: string): Promise<boolean> {
    this.assertAgentDispatchLease(lease)
    if (!Number.isSafeInteger(delayMs) || delayMs < 1) throw new Error("AGENT_DISPATCH_RETRY_DELAY_INVALID")
    requiredIdentity(errorCode, "AGENT_DISPATCH_ERROR_CODE_REQUIRED")
    const client = await this.database.pool.connect()
    try {
      await client.query("BEGIN")
      const identity = await client.query<{ conversation_id: string }>(
        `SELECT conversation_id FROM bff_agent_dispatch_outbox
          WHERE tenant_id=$1 AND outbox_id=$2 AND status='leased' AND lease_owner=$3
            AND lease_token=$4 AND fence=$5`,
        [lease.tenantId, lease.outboxId, lease.leaseOwner, lease.leaseToken, lease.fence],
      )
      if (identity.rows[0] !== undefined) {
        await PostgresAgentDispatchOutboxRepository.lockConversationsInTransaction(client, [{ tenantId: lease.tenantId, conversationId: identity.rows[0].conversation_id }])
        await client.query(
          `SELECT 1 FROM bff_agui_stream WHERE tenant_id=$1 AND session_id=$2 FOR UPDATE`,
          [lease.tenantId, identity.rows[0].conversation_id],
        )
      }
      await client.query(
        `SELECT 1 FROM bff_agent_dispatch_outbox
          WHERE tenant_id=$1 AND outbox_id=$2 AND status='leased' AND lease_owner=$3 AND lease_token=$4 AND fence=$5
          FOR UPDATE`,
        [lease.tenantId, lease.outboxId, lease.leaseOwner, lease.leaseToken, lease.fence],
      )
      const clock = await client.query<{ db_now: Date }>("SELECT clock_timestamp() AS db_now")
      const dbNow = clock.rows[0]?.db_now
      if (dbNow === undefined) throw new Error("AGENT_DISPATCH_DATABASE_CLOCK_UNAVAILABLE")
      const sticky = await client.query(
        `UPDATE bff_agent_dispatch_outbox SET status = 'retryable',
                available_at = $8::timestamptz + ($6::double precision * INTERVAL '1 millisecond'),
                last_error_code = $7, last_error_at = $8::timestamptz,
                lease_owner = NULL, lease_token = NULL, lease_until = NULL, updated_at = $8::timestamptz
          WHERE tenant_id=$1 AND outbox_id=$2 AND status='leased' AND lease_owner=$3 AND lease_token=$4
            AND fence=$5 AND lease_until > $8::timestamptz AND admission_unknown_seen`,
        [lease.tenantId, lease.outboxId, lease.leaseOwner, lease.leaseToken, lease.fence, delayMs, errorCode, dbNow],
      )
      const settled = sticky.rowCount === 1
        ? { settled: true, notificationCursor: null, tenantId: null, sessionId: null }
        : await this.markAgentDispatchFailedInTransaction(client, lease, errorCode, dbNow)
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
    dbNow: Date,
  ): Promise<DispatchFailureSettlement> {
    const settled = await client.query<FailedDispatchRow>(
      `UPDATE bff_agent_dispatch_outbox
          SET status = 'failed', completed_at = $7::timestamptz,
              last_error_code = $6, last_error_at = $7::timestamptz,
              lease_owner = NULL, lease_token = NULL, lease_until = NULL,
              updated_at = $7::timestamptz
        WHERE tenant_id = $1 AND outbox_id = $2 AND status = 'leased' AND lease_owner = $3
          AND lease_token = $4 AND fence = $5 AND lease_until > $7::timestamptz
          AND admission_unknown_seen = FALSE
        RETURNING outbox_id, tenant_id, conversation_id, conversation_dispatch_seq, run_id,
                  $7::timestamptz AS failed_at`,
      [lease.tenantId, lease.outboxId, lease.leaseOwner, lease.leaseToken, lease.fence, errorCode, dbNow],
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
    // Caller already owns Conversation -> stream, then settles Message/ledger.
    await client.query(
      `UPDATE bff_message
          SET status = 'failed', agent_failure_code = NULL, agent_failure_retryable = NULL,
              updated_at = CURRENT_TIMESTAMP(3)
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
              latest_run_id = CASE WHEN expected_run_id IS NULL OR expected_run_id = $3 THEN $3 ELSE latest_run_id END,
              terminal_run_id = CASE WHEN expected_run_id IS NULL OR expected_run_id = $3 THEN $3 ELSE terminal_run_id END,
              expected_run_id = CASE WHEN expected_run_id = $3 THEN NULL ELSE expected_run_id END,
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
    const nextCursor = await PostgresAgentDispatchOutboxRepository.projectQueuedHeadInTransaction(client, row.tenant_id, row.conversation_id)
    return {
      settled: true,
      notificationCursor: nextCursor ?? cursor,
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
