import type { PoolClient } from "pg"

import type {
  AgentCancellationOutboxClaimInput,
  AgentCancellationOutboxRepository,
} from "../../application/ports/agent-cancellation-outbox-repository.js"
import {
  parseAgentCancellationPayload,
  type AgentCancellationCommand,
  type AgentCancellationLease,
  type AgentCancellationStatus,
} from "../../domain/chat/agent-cancellation.js"
import type { PostgresBffDatabase } from "./client.js"
import { instant } from "./chat-repository-mappers.js"

type AgentCancellationRow = {
  cancellation_id: string
  tenant_id: string
  conversation_id: string
  conversation_dispatch_seq: string | number
  run_id: string
  subject_id: string
  actor_id: string
  request_id: string
  command_id: string
  identity_assertion_ref: string
  payload: unknown
  status: AgentCancellationStatus
  attempt_count: string | number
  lease_owner: string | null
  lease_token: string | null
  lease_until: Date | string | null
  fence: string | number
  lease_remaining_ms?: string | number
}

const CANCELLATION_COLUMN_NAMES = [
  "cancellation_id",
  "tenant_id",
  "conversation_id",
  "conversation_dispatch_seq",
  "run_id",
  "subject_id",
  "actor_id",
  "request_id",
  "command_id",
  "identity_assertion_ref",
  "payload",
  "status",
  "attempt_count",
  "lease_owner",
  "lease_token",
  "lease_until",
  "fence",
] as const

const CLAIMED_CANCELLATION_COLUMNS = CANCELLATION_COLUMN_NAMES
  .map((column) => `cancellation.${column}`)
  .join(", ")

function requiredIdentity(value: string, code: string): void {
  if (value.trim() === "") throw new Error(code)
}

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

function claimedCancellation(row: AgentCancellationRow, queryElapsedMs: number): AgentCancellationCommand {
  if (row.status !== "leased" || row.lease_owner === null || row.lease_token === null || row.lease_until === null) {
    throw new Error("AGENT_CANCELLATION_LEASE_INVALID")
  }
  if (row.lease_remaining_ms === undefined) throw new Error("AGENT_CANCELLATION_LEASE_BUDGET_INVALID")
  const payload = parseAgentCancellationPayload(row.payload)
  if (payload.session_id !== row.conversation_id) throw new Error("AGENT_CANCELLATION_LINEAGE_MISMATCH")
  return {
    cancellationId: row.cancellation_id,
    tenantId: row.tenant_id,
    conversationId: row.conversation_id,
    conversationDispatchSeq: positiveDecimal(row.conversation_dispatch_seq, "AGENT_CANCELLATION_SEQUENCE_INVALID"),
    runId: row.run_id,
    subjectId: row.subject_id,
    actorId: row.actor_id,
    requestId: row.request_id,
    commandId: row.command_id,
    identityAssertionRef: row.identity_assertion_ref,
    payload,
    status: "leased",
    attemptCount: safeInteger(row.attempt_count, "AGENT_CANCELLATION_ATTEMPT_INVALID"),
    leaseOwner: row.lease_owner,
    leaseToken: row.lease_token,
    leaseUntil: instant(row.lease_until),
    leaseRemainingMs: Math.max(
      1,
      safeInteger(row.lease_remaining_ms, "AGENT_CANCELLATION_LEASE_BUDGET_INVALID") - queryElapsedMs,
    ),
    fence: safeInteger(row.fence, "AGENT_CANCELLATION_FENCE_INVALID"),
  }
}

export class PostgresAgentCancellationOutboxRepository implements AgentCancellationOutboxRepository {
  public constructor(private readonly database: PostgresBffDatabase) {}

  public async claimAgentCancellationOutbox(
    input: AgentCancellationOutboxClaimInput,
  ): Promise<AgentCancellationCommand[]> {
    this.assertClaimInput(input)
    const client = await this.database.pool.connect()
    const queryStartedAt = performance.now()
    try {
      await client.query("BEGIN")
      await this.failOneExhaustedHead(client, input)
      const result = await client.query<AgentCancellationRow>(
        `WITH candidates AS MATERIALIZED (
           SELECT current.cancellation_id
             FROM bff_agent_cancellation_outbox AS current
            WHERE (
                (current.status IN ('cancel_requested', 'retryable') AND current.available_at <= CURRENT_TIMESTAMP(3))
                OR (current.status = 'leased' AND current.lease_until <= CURRENT_TIMESTAMP(3))
              )
              AND current.attempt_count < $4
              AND NOT EXISTS (
                SELECT 1
                  FROM bff_agent_cancellation_outbox AS earlier
                 WHERE earlier.tenant_id = current.tenant_id
                   AND earlier.conversation_id = current.conversation_id
                   AND (earlier.conversation_dispatch_seq, earlier.cancellation_id)
                       < (current.conversation_dispatch_seq, current.cancellation_id)
                   AND earlier.status IN ('cancel_requested', 'retryable', 'leased')
              )
            ORDER BY current.available_at ASC, current.tenant_id ASC, current.conversation_id ASC,
                     current.conversation_dispatch_seq ASC, current.cancellation_id ASC
            FOR UPDATE SKIP LOCKED
            LIMIT $1
         )
         UPDATE bff_agent_cancellation_outbox AS cancellation
            SET status = 'leased',
                attempt_count = cancellation.attempt_count + 1,
                lease_owner = $2,
                lease_token = gen_random_uuid()::text,
                lease_until = CURRENT_TIMESTAMP(3) + ($3::double precision * INTERVAL '1 millisecond'),
                fence = cancellation.fence + 1,
                updated_at = CURRENT_TIMESTAMP(3)
           FROM candidates
          WHERE cancellation.cancellation_id = candidates.cancellation_id
         RETURNING ${CLAIMED_CANCELLATION_COLUMNS},
                   GREATEST(1, FLOOR(EXTRACT(EPOCH FROM (
                     cancellation.lease_until - CURRENT_TIMESTAMP(3)
                   )) * 1000))::bigint AS lease_remaining_ms`,
        [input.limit, input.workerId, input.leaseDurationMs, input.maxAttempts],
      )
      await client.query("COMMIT")
      const queryElapsedMs = Math.max(0, Math.ceil(performance.now() - queryStartedAt))
      return result.rows.map((row) => claimedCancellation(row, queryElapsedMs))
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  public async markAgentCancellationSucceeded(lease: AgentCancellationLease): Promise<boolean> {
    this.assertLease(lease)
    const result = await this.database.pool.query(
      `UPDATE bff_agent_cancellation_outbox
          SET status = 'succeeded', completed_at = CURRENT_TIMESTAMP(3),
              last_error_code = NULL, last_error_at = NULL,
              lease_owner = NULL, lease_token = NULL, lease_until = NULL,
              updated_at = CURRENT_TIMESTAMP(3)
        WHERE tenant_id = $1 AND cancellation_id = $2 AND status = 'leased'
          AND lease_owner = $3 AND lease_token = $4 AND fence = $5
          AND lease_until > CURRENT_TIMESTAMP(3)`,
      [lease.tenantId, lease.cancellationId, lease.leaseOwner, lease.leaseToken, lease.fence],
    )
    return result.rowCount === 1
  }

  public async markAgentCancellationRetryable(
    lease: AgentCancellationLease,
    delayMs: number,
    errorCode: string,
  ): Promise<boolean> {
    this.assertLease(lease)
    if (!Number.isSafeInteger(delayMs) || delayMs < 1) throw new Error("AGENT_CANCELLATION_RETRY_DELAY_INVALID")
    requiredIdentity(errorCode, "AGENT_CANCELLATION_ERROR_CODE_REQUIRED")
    const result = await this.database.pool.query(
      `UPDATE bff_agent_cancellation_outbox
          SET status = 'retryable',
              available_at = CURRENT_TIMESTAMP(3) + ($6::double precision * INTERVAL '1 millisecond'),
              last_error_code = $7, last_error_at = CURRENT_TIMESTAMP(3), completed_at = NULL,
              lease_owner = NULL, lease_token = NULL, lease_until = NULL,
              updated_at = CURRENT_TIMESTAMP(3)
        WHERE tenant_id = $1 AND cancellation_id = $2 AND status = 'leased'
          AND lease_owner = $3 AND lease_token = $4 AND fence = $5
          AND lease_until > CURRENT_TIMESTAMP(3)`,
      [lease.tenantId, lease.cancellationId, lease.leaseOwner, lease.leaseToken, lease.fence, delayMs, errorCode],
    )
    return result.rowCount === 1
  }

  public async markAgentCancellationFailed(lease: AgentCancellationLease, errorCode: string): Promise<boolean> {
    this.assertLease(lease)
    requiredIdentity(errorCode, "AGENT_CANCELLATION_ERROR_CODE_REQUIRED")
    return this.settleFailure(this.database.pool, lease, errorCode)
  }

  private async failOneExhaustedHead(
    client: PoolClient,
    input: AgentCancellationOutboxClaimInput,
  ): Promise<void> {
    const exhausted = await client.query<AgentCancellationRow>(
      `WITH candidate AS MATERIALIZED (
         SELECT current.cancellation_id
           FROM bff_agent_cancellation_outbox AS current
          WHERE (
              (current.status IN ('cancel_requested', 'retryable') AND current.available_at <= CURRENT_TIMESTAMP(3))
              OR (current.status = 'leased' AND current.lease_until <= CURRENT_TIMESTAMP(3))
            )
            AND current.attempt_count >= $1
            AND NOT EXISTS (
              SELECT 1
                FROM bff_agent_cancellation_outbox AS earlier
               WHERE earlier.tenant_id = current.tenant_id
                 AND earlier.conversation_id = current.conversation_id
                 AND (earlier.conversation_dispatch_seq, earlier.cancellation_id)
                     < (current.conversation_dispatch_seq, current.cancellation_id)
                 AND earlier.status IN ('cancel_requested', 'retryable', 'leased')
            )
          ORDER BY current.available_at ASC, current.tenant_id ASC, current.conversation_id ASC,
                   current.conversation_dispatch_seq ASC, current.cancellation_id ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
       )
       UPDATE bff_agent_cancellation_outbox AS cancellation
          SET status = 'leased',
              lease_owner = $2,
              lease_token = gen_random_uuid()::text,
              lease_until = CURRENT_TIMESTAMP(3) + ($3::double precision * INTERVAL '1 millisecond'),
              fence = cancellation.fence + 1,
              updated_at = CURRENT_TIMESTAMP(3)
         FROM candidate
        WHERE cancellation.cancellation_id = candidate.cancellation_id
       RETURNING ${CLAIMED_CANCELLATION_COLUMNS}`,
      [input.maxAttempts, input.workerId, input.leaseDurationMs],
    )
    const row = exhausted.rows[0]
    if (row === undefined || row.lease_owner === null || row.lease_token === null) return
    const settled = await this.settleFailure(client, {
      tenantId: row.tenant_id,
      cancellationId: row.cancellation_id,
      leaseOwner: row.lease_owner,
      leaseToken: row.lease_token,
      fence: safeInteger(row.fence, "AGENT_CANCELLATION_FENCE_INVALID"),
    }, "agent_cancellation_attempts_exhausted")
    if (!settled) throw new Error("AGENT_CANCELLATION_EXHAUSTED_SETTLEMENT_FAILED")
  }

  private async settleFailure(
    client: Pick<PoolClient, "query">,
    lease: AgentCancellationLease,
    errorCode: string,
  ): Promise<boolean> {
    const result = await client.query(
      `UPDATE bff_agent_cancellation_outbox
          SET status = 'failed', completed_at = CURRENT_TIMESTAMP(3),
              last_error_code = $6, last_error_at = CURRENT_TIMESTAMP(3),
              lease_owner = NULL, lease_token = NULL, lease_until = NULL,
              updated_at = CURRENT_TIMESTAMP(3)
        WHERE tenant_id = $1 AND cancellation_id = $2 AND status = 'leased'
          AND lease_owner = $3 AND lease_token = $4 AND fence = $5
          AND lease_until > CURRENT_TIMESTAMP(3)`,
      [lease.tenantId, lease.cancellationId, lease.leaseOwner, lease.leaseToken, lease.fence, errorCode],
    )
    return result.rowCount === 1
  }

  private assertClaimInput(input: AgentCancellationOutboxClaimInput): void {
    requiredIdentity(input.workerId, "AGENT_CANCELLATION_WORKER_ID_REQUIRED")
    if (!Number.isSafeInteger(input.limit) || input.limit < 1) throw new Error("AGENT_CANCELLATION_LIMIT_INVALID")
    if (!Number.isSafeInteger(input.leaseDurationMs) || input.leaseDurationMs < 1) {
      throw new Error("AGENT_CANCELLATION_LEASE_DURATION_INVALID")
    }
    if (!Number.isSafeInteger(input.maxAttempts) || input.maxAttempts < 1) {
      throw new Error("AGENT_CANCELLATION_MAX_ATTEMPTS_INVALID")
    }
  }

  private assertLease(lease: AgentCancellationLease): void {
    requiredIdentity(lease.tenantId, "AGENT_CANCELLATION_TENANT_ID_REQUIRED")
    requiredIdentity(lease.cancellationId, "AGENT_CANCELLATION_ID_REQUIRED")
    requiredIdentity(lease.leaseOwner, "AGENT_CANCELLATION_LEASE_OWNER_REQUIRED")
    requiredIdentity(lease.leaseToken, "AGENT_CANCELLATION_LEASE_TOKEN_REQUIRED")
    if (!Number.isSafeInteger(lease.fence) || lease.fence < 1) throw new Error("AGENT_CANCELLATION_FENCE_INVALID")
  }
}
