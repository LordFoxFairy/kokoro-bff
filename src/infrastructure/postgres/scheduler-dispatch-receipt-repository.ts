import { randomUUID } from "node:crypto"
import type { Pool, PoolClient } from "pg"

import type {
  SchedulerDispatchClaim,
  SchedulerDispatchClaimResult,
  SchedulerDispatchReceiptRepository,
  SchedulerDispatchResponse,
  SchedulerDispatchSnapshot,
} from "../../application/ports/scheduler-dispatch-receipt-repository.js"
import { isRecord } from "../../domain/json.js"

const PENDING_STATUS = 102
const LEASE_MILLISECONDS = 60_000

type ReceiptEnvelope = {
  schema_version: 1
  state: "pending" | "retryable" | "terminal"
  claim_token: string | null
  lease_until: string | null
  retry_at: string | null
  snapshot: SchedulerDispatchSnapshot | null
  last_error_code: string | null
  response: SchedulerDispatchResponse | null
}

function isString(value: unknown): value is string {
  return typeof value === "string"
}

function parseSnapshot(value: unknown): SchedulerDispatchSnapshot | null {
  if (
    !isRecord(value) ||
    !isString(value.tenantId) ||
    !isString(value.schedule) ||
    !isString(value.occurrence) ||
    !isString(value.idempotencyKey) ||
    !isString(value.actorId) ||
    !isString(value.taskId) ||
    !isRecord(value.launch) ||
    !isString(value.launch.requestId) ||
    !isRecord(value.launch.body) ||
    !isString(value.launch.identityAssertionRef) ||
    !isRecord(value.launch.receipt) ||
    !isString(value.launch.receipt.run_id) ||
    !isString(value.launch.receipt.user_message_id) ||
    !isString(value.launch.receipt.assistant_message_id)
  )
    return null
  return value as SchedulerDispatchSnapshot
}

function parseResponse(value: unknown): SchedulerDispatchResponse | null {
  if (!isRecord(value) || typeof value.status !== "number" || !Number.isInteger(value.status) || value.status < 100 || value.status > 599 || !("body" in value))
    return null
  return { status: value.status, body: value.body }
}

function parseEnvelope(value: unknown): ReceiptEnvelope {
  if (!isRecord(value) || value.schema_version !== 1 || (value.state !== "pending" && value.state !== "retryable" && value.state !== "terminal")) {
    throw new Error("Scheduler dispatch receipt envelope is invalid")
  }
  const claimToken = value.claim_token === null || isString(value.claim_token) ? value.claim_token : undefined
  const leaseUntil = value.lease_until === null || isString(value.lease_until) ? value.lease_until : undefined
  const retryAt = value.retry_at === null || isString(value.retry_at) ? value.retry_at : undefined
  const lastErrorCode = value.last_error_code === null || isString(value.last_error_code) ? value.last_error_code : undefined
  const snapshot = value.snapshot === null ? null : parseSnapshot(value.snapshot)
  const response = value.response === null ? null : parseResponse(value.response)
  if (
    claimToken === undefined ||
    leaseUntil === undefined ||
    retryAt === undefined ||
    lastErrorCode === undefined ||
    (snapshot === null && value.snapshot !== null) ||
    (response === null && value.response !== null)
  )
    throw new Error("Scheduler dispatch receipt envelope is invalid")
  if (value.state === "terminal" && response === null) throw new Error("Scheduler terminal receipt response is invalid")
  return {
    schema_version: 1,
    state: value.state,
    claim_token: claimToken,
    lease_until: leaseUntil,
    retry_at: retryAt,
    snapshot,
    last_error_code: lastErrorCode,
    response,
  }
}

function claimedEnvelope(claimToken: string, leaseUntil: string | null, snapshot: SchedulerDispatchSnapshot | null): ReceiptEnvelope {
  return {
    schema_version: 1,
    state: "pending",
    claim_token: claimToken,
    lease_until: leaseUntil,
    retry_at: null,
    snapshot,
    last_error_code: null,
    response: null,
  }
}

async function databaseNow(client: PoolClient): Promise<Date> {
  const result = await client.query<{ now: Date }>("SELECT clock_timestamp() AS now")
  const now = result.rows[0]?.now
  if (!(now instanceof Date)) throw new Error("PostgreSQL did not return its current time")
  return now
}

async function leaseObservation(client: PoolClient, leaseUntil: string): Promise<{ leaseRemainingMs: number; leaseObservedAt: number }> {
  const leaseObservedAt = performance.now()
  const result = await client.query<{ remaining_ms: string }>(
    "SELECT GREATEST(0, FLOOR(EXTRACT(EPOCH FROM ($1::timestamptz - clock_timestamp())) * 1000))::bigint::text AS remaining_ms",
    [leaseUntil],
  )
  const remaining = Number(result.rows[0]?.remaining_ms)
  if (!Number.isSafeInteger(remaining) || remaining < 0) throw new Error("PostgreSQL returned an invalid Scheduler lease budget")
  return { leaseRemainingMs: remaining, leaseObservedAt }
}

function activeClaim(envelope: ReceiptEnvelope, claim: SchedulerDispatchClaim, now: Date): boolean {
  return (
    envelope.state === "pending" &&
    envelope.claim_token === claim.claimToken &&
    envelope.lease_until !== null &&
    Date.parse(envelope.lease_until) > now.getTime()
  )
}

export class PostgresSchedulerDispatchReceiptRepository implements SchedulerDispatchReceiptRepository {
  public constructor(private readonly pool: Pool) {}

  public async claim(scope: string, digest: string): Promise<SchedulerDispatchClaimResult> {
    const client = await this.pool.connect()
    try {
      await client.query("BEGIN")
      const claimToken = randomUUID()
      const inserted = await client.query(
        `INSERT INTO bff_idempotency_receipt (scope, fingerprint, status, response_body)
         VALUES ($1, $2, $3, $4::jsonb)
         ON CONFLICT (scope) DO NOTHING
         RETURNING scope`,
        [scope, digest, PENDING_STATUS, JSON.stringify(claimedEnvelope(claimToken, null, null))],
      )
      if (inserted.rowCount === 1) {
        const now = await databaseNow(client)
        const leaseUntil = new Date(now.getTime() + LEASE_MILLISECONDS).toISOString()
        const initialized = await client.query(
          `UPDATE bff_idempotency_receipt SET response_body = $3::jsonb
            WHERE scope = $1 AND fingerprint = $2 AND status = $4`,
          [scope, digest, JSON.stringify(claimedEnvelope(claimToken, leaseUntil, null)), PENDING_STATUS],
        )
        if (initialized.rowCount !== 1) throw new Error("Scheduler receipt initialization lost its fenced row")
        const observation = await leaseObservation(client, leaseUntil)
        await client.query("COMMIT")
        return { outcome: "claimed", claim: { scope, digest, claimToken, ...observation, snapshot: null } }
      }
      const selected = await client.query<{ fingerprint: string; status: number; response_body: unknown }>(
        "SELECT fingerprint, status, response_body FROM bff_idempotency_receipt WHERE scope = $1 FOR UPDATE",
        [scope],
      )
      const row = selected.rows[0]
      if (row === undefined) throw new Error("Scheduler receipt disappeared while claimed")
      const now = await databaseNow(client)
      if (row.fingerprint !== digest) {
        await client.query("COMMIT")
        return { outcome: "conflict" }
      }
      const envelope = parseEnvelope(row.response_body)
      if (envelope.state === "terminal") {
        await client.query("COMMIT")
        return { outcome: "terminal", response: envelope.response as SchedulerDispatchResponse }
      }
      const available =
        envelope.state === "pending"
          ? envelope.lease_until !== null && Date.parse(envelope.lease_until) <= now.getTime()
          : envelope.retry_at === null || Date.parse(envelope.retry_at) <= now.getTime()
      if (!available) {
        await client.query("COMMIT")
        return { outcome: "pending" }
      }
      const leaseUntil = new Date(now.getTime() + LEASE_MILLISECONDS).toISOString()
      const nextEnvelope = claimedEnvelope(claimToken, leaseUntil, envelope.snapshot)
      const updated = await client.query(
        `UPDATE bff_idempotency_receipt SET response_body = $3::jsonb
          WHERE scope = $1 AND fingerprint = $2 AND status = $4`,
        [scope, digest, JSON.stringify(nextEnvelope), PENDING_STATUS],
      )
      if (updated.rowCount !== 1) throw new Error("Scheduler receipt reclaim lost its fenced row")
      const observation = await leaseObservation(client, leaseUntil)
      await client.query("COMMIT")
      return { outcome: "claimed", claim: { scope, digest, claimToken, ...observation, snapshot: envelope.snapshot } }
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  public async prepareSnapshot(
    claim: SchedulerDispatchClaim,
    snapshot: SchedulerDispatchSnapshot,
  ): Promise<{ leaseRemainingMs: number; leaseObservedAt: number } | null> {
    const client = await this.pool.connect()
    try {
      await client.query("BEGIN")
      const selected = await client.query<{ fingerprint: string; status: number; response_body: unknown }>(
        "SELECT fingerprint, status, response_body FROM bff_idempotency_receipt WHERE scope = $1 FOR UPDATE",
        [claim.scope],
      )
      const row = selected.rows[0]
      const now = await databaseNow(client)
      if (row === undefined || row.fingerprint !== claim.digest || row.status !== PENDING_STATUS) {
        await client.query("COMMIT")
        return null
      }
      const envelope = parseEnvelope(row.response_body)
      if (!activeClaim(envelope, claim, now)) {
        await client.query("COMMIT")
        return null
      }
      const updated = await client.query(
        `UPDATE bff_idempotency_receipt
            SET response_body = jsonb_set(response_body, '{snapshot}', $4::jsonb, true)
          WHERE scope = $1 AND fingerprint = $2 AND status = $5
            AND response_body->>'state' = 'pending' AND response_body->>'claim_token' = $3
            AND (response_body->'snapshot' = 'null'::jsonb OR response_body->'snapshot' = $4::jsonb)`,
        [claim.scope, claim.digest, claim.claimToken, JSON.stringify(snapshot), PENDING_STATUS],
      )
      if (updated.rowCount !== 1) {
        await client.query("COMMIT")
        return null
      }
      const observation = await leaseObservation(client, envelope.lease_until as string)
      await client.query("COMMIT")
      return observation
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  public async complete(claim: SchedulerDispatchClaim, response: SchedulerDispatchResponse): Promise<boolean> {
    const envelope: ReceiptEnvelope = {
      schema_version: 1,
      state: "terminal",
      claim_token: null,
      lease_until: null,
      retry_at: null,
      snapshot: claim.snapshot,
      last_error_code: null,
      response,
    }
    const client = await this.pool.connect()
    try {
      await client.query("BEGIN")
      const selected = await client.query<{ fingerprint: string; status: number; response_body: unknown }>(
        "SELECT fingerprint, status, response_body FROM bff_idempotency_receipt WHERE scope = $1 FOR UPDATE",
        [claim.scope],
      )
      const row = selected.rows[0]
      const now = await databaseNow(client)
      if (
        row === undefined ||
        row.fingerprint !== claim.digest ||
        row.status !== PENDING_STATUS ||
        !activeClaim(parseEnvelope(row.response_body), claim, now)
      ) {
        await client.query("COMMIT")
        return false
      }
      const updated = await client.query(
        `UPDATE bff_idempotency_receipt SET status = $4, response_body = $5::jsonb
          WHERE scope = $1 AND fingerprint = $2 AND status = $6
            AND response_body->>'state' = 'pending' AND response_body->>'claim_token' = $3`,
        [claim.scope, claim.digest, claim.claimToken, response.status, JSON.stringify(envelope), PENDING_STATUS],
      )
      await client.query("COMMIT")
      return updated.rowCount === 1
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  public async releaseRetryable(claim: SchedulerDispatchClaim, errorCode: string, retryAfterMs = 1000): Promise<boolean> {
    const boundedRetryAfterMs = Math.max(0, Math.trunc(retryAfterMs))
    const client = await this.pool.connect()
    try {
      await client.query("BEGIN")
      const selected = await client.query<{ fingerprint: string; status: number; response_body: unknown }>(
        "SELECT fingerprint, status, response_body FROM bff_idempotency_receipt WHERE scope = $1 FOR UPDATE",
        [claim.scope],
      )
      const row = selected.rows[0]
      const now = await databaseNow(client)
      if (row === undefined || row.fingerprint !== claim.digest || row.status !== PENDING_STATUS) {
        await client.query("COMMIT")
        return false
      }
      const current = parseEnvelope(row.response_body)
      if (!activeClaim(current, claim, now)) {
        await client.query("COMMIT")
        return false
      }
      const retryable: ReceiptEnvelope = {
        schema_version: 1,
        state: "retryable",
        claim_token: null,
        lease_until: null,
        retry_at: new Date(now.getTime() + boundedRetryAfterMs).toISOString(),
        snapshot: current.snapshot,
        last_error_code: errorCode,
        response: null,
      }
      const updated = await client.query(
        `UPDATE bff_idempotency_receipt SET response_body = $4::jsonb
          WHERE scope = $1 AND fingerprint = $2 AND status = $5
            AND response_body->>'state' = 'pending' AND response_body->>'claim_token' = $3`,
        [claim.scope, claim.digest, claim.claimToken, JSON.stringify(retryable), PENDING_STATUS],
      )
      await client.query("COMMIT")
      return updated.rowCount === 1
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }
}
