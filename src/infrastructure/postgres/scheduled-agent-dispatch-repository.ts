import { createHash, randomUUID } from "node:crypto"
import type { PostgresBffDatabase } from "./client.js"
import type {
  ScheduledAgentAcceptInput,
  ScheduledAgentConsumerLease,
  ScheduledAgentDispatchRepository,
} from "../../application/ports/scheduled-agent-dispatch-repository.js"
import type { ScheduledAgentDispatchCommand, ScheduledAgentDispatchLease, ScheduledAgentSourceEvent } from "../../domain/scheduled-task/agent-dispatch.js"
import { scheduledOccurrenceOrderKey } from "../../domain/scheduled-task/agent-dispatch.js"
import { scheduledSourceEventDigest } from "../../application/scheduled-source-event-digest.js"
import { parseAgentFailure } from "../../generated/agent-http/failure-profile.gen.js"

const RECEIPT_PENDING = 102
type ReceiptRow = {
  fingerprint: string
  status: number
  response_body: {
    state?: unknown
    claim_token?: unknown
    lease_until?: unknown
  }
}
type TaskRow = {
  owner_id: string
  enabled: boolean
  status: string
  revision: string | number
}
type ScopeIdentityRow = { subject_id: string; session_id: string }
type ScopeHeadRow = {
  tenant_id: string
  task_id: string
  active_dispatch_id: string | null
}
type DispatchHeadRow = { dispatch_id: string }
type DispatchLeaseRow = {
  tenant_id: string
  task_id: string
  dispatch_id: string
  run_id: string
  subject_id: string
  request_id: string
  idempotency_key: string
  identity_assertion_ref: string
  payload: Record<string, unknown>
  lease_owner: string
  lease_token: string
  fence: string | number
  attempt_count: string | number
  admission_unknown_seen: boolean
  lease_remaining_ms: string | number
}
type ConsumerScopeRow = {
  tenant_id: string
  task_id: string
  session_id: string
  subject_id: string
  source_high_watermark: string | number
  consumer_failure_count: string | number
  active_dispatch_id: string
}
type ConsumerUpdateRow = ConsumerScopeRow & { consumer_fence: string | number }
type ActiveDispatchRow = { status: string; lease_until: Date | null }
type SourceScopeRow = {
  active_dispatch_id: string | null
  active_run_id: string | null
  session_id: string
  source_high_watermark: string | number
  consumer_lease_owner: string | null
  consumer_lease_token: string | null
  consumer_lease_until: Date | null
  consumer_fence: string | number
}
function id(...parts: string[]): string {
  return `scheduled_agent_${createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 32)}`
}
function positive(value: number, code: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(code)
  return value
}
function nonnegative(value: string | number, code: string): number {
  const n = Number(value)
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(code)
  return n
}
function leaseOf(row: DispatchLeaseRow): ScheduledAgentDispatchCommand {
  return {
    tenantId: row.tenant_id,
    taskId: row.task_id,
    dispatchId: row.dispatch_id,
    runId: row.run_id,
    subjectId: row.subject_id,
    requestId: row.request_id,
    idempotencyKey: row.idempotency_key,
    identityAssertionRef: row.identity_assertion_ref,
    payload: row.payload,
    leaseOwner: row.lease_owner,
    leaseToken: row.lease_token,
    fence: nonnegative(row.fence, "SCHEDULED_AGENT_FENCE_INVALID"),
    attemptCount: nonnegative(row.attempt_count, "SCHEDULED_AGENT_ATTEMPT_INVALID"),
    admissionUnknownSeen: row.admission_unknown_seen,
    leaseRemainingMs: positive(Number(row.lease_remaining_ms), "SCHEDULED_AGENT_LEASE_BUDGET_INVALID"),
    leaseObservedAt: 0,
  }
}
function terminalType(value: string): boolean {
  return value === "run.completed" || value === "run.failed"
}
function validSourceEvent(event: ScheduledAgentSourceEvent, sessionId: string): boolean {
  const payload = event.sourcePayload
  if (
    payload.session_id !== sessionId ||
    payload.run_id !== event.sourceRunId ||
    payload.chat_event_id !== event.sourceEventId ||
    payload.seq !== event.sourceSequence ||
    payload.event_type !== event.eventType ||
    typeof payload.payload_json !== "string" ||
    event.sourceDigest !== scheduledSourceEventDigest(payload)
  )
    return false
  if (!terminalType(event.eventType)) return true
  try {
    const terminal = JSON.parse(payload.payload_json) as unknown
    if (typeof terminal !== "object" || terminal === null || Array.isArray(terminal)) return false
    if (event.eventType === "run.completed") {
      const status = (terminal as Record<string, unknown>).status
      return status === "completed" || status === "cancelled"
    }
    return parseAgentFailure(terminal) !== null
  } catch {
    return false
  }
}

export class PostgresScheduledAgentDispatchRepository implements ScheduledAgentDispatchRepository {
  public constructor(private readonly database: PostgresBffDatabase) {}

  public async accept(input: ScheduledAgentAcceptInput): Promise<boolean> {
    const client = await this.database.pool.connect()
    try {
      await client.query("BEGIN")
      const receipt = await client.query<ReceiptRow>("SELECT fingerprint,status,response_body FROM bff_idempotency_receipt WHERE scope=$1 FOR UPDATE", [
        input.claim.scope,
      ])
      const row = receipt.rows[0]
      const now = (await client.query<{ now: Date }>("SELECT clock_timestamp() AS now")).rows[0]?.now
      const envelope = row?.response_body
      if (
        !now ||
        !row ||
        row.fingerprint !== input.claim.digest ||
        row.status !== RECEIPT_PENDING ||
        envelope?.state !== "pending" ||
        envelope.claim_token !== input.claim.claimToken ||
        typeof envelope.lease_until !== "string" ||
        Date.parse(envelope.lease_until) <= now.getTime()
      ) {
        await client.query("ROLLBACK")
        return false
      }
      const task = await client.query<TaskRow>("SELECT owner_id,enabled,status,revision FROM bff_scheduled_task WHERE tenant_id=$1 AND task_id=$2 FOR UPDATE", [
        input.snapshot.tenantId,
        input.snapshot.taskId,
      ])
      const taskRow = task.rows[0]
      if (
        !taskRow ||
        taskRow.owner_id !== input.snapshot.actorId ||
        !taskRow.enabled ||
        taskRow.status !== "active" ||
        Number(taskRow.revision) !== input.snapshot.taskRevision
      ) {
        await client.query("ROLLBACK")
        return false
      }
      const sessionId = String(input.snapshot.launch.body.session_id ?? "")
      const runId = input.snapshot.launch.receipt.run_id
      if (sessionId !== `scheduled:${input.snapshot.taskId}` || String(input.snapshot.launch.body.run_id ?? "") !== runId)
        throw new Error("SCHEDULED_AGENT_SNAPSHOT_INVALID")
      await client.query(
        `INSERT INTO bff_scheduled_agent_scope(tenant_id,task_id,session_id,subject_id) VALUES($1,$2,$3,$4)
        ON CONFLICT(tenant_id,task_id) DO NOTHING`,
        [input.snapshot.tenantId, input.snapshot.taskId, sessionId, input.snapshot.actorId],
      )
      const scope = await client.query<ScopeIdentityRow>(
        "SELECT subject_id,session_id FROM bff_scheduled_agent_scope WHERE tenant_id=$1 AND task_id=$2 FOR UPDATE",
        [input.snapshot.tenantId, input.snapshot.taskId],
      )
      if (scope.rows[0]?.subject_id !== input.snapshot.actorId || scope.rows[0]?.session_id !== sessionId) throw new Error("SCHEDULED_AGENT_SCOPE_CONFLICT")
      const dispatchId = id(input.snapshot.tenantId, input.snapshot.taskId, input.snapshot.occurrence)
      const inserted = await client.query(
        `INSERT INTO bff_scheduled_agent_dispatch(
        dispatch_id,tenant_id,task_id,occurrence,occurrence_order_key,subject_id,request_id,idempotency_key,request_digest,run_id,identity_assertion_ref,payload)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb) ON CONFLICT(tenant_id,task_id,occurrence) DO NOTHING`,
        [
          dispatchId,
          input.snapshot.tenantId,
          input.snapshot.taskId,
          input.snapshot.occurrence,
          scheduledOccurrenceOrderKey(input.snapshot.occurrence),
          input.snapshot.actorId,
          input.snapshot.launch.requestId,
          input.snapshot.idempotencyKey,
          input.claim.digest,
          runId,
          input.snapshot.launch.identityAssertionRef,
          JSON.stringify(input.snapshot.launch.body),
        ],
      )
      if (inserted.rowCount !== 1) {
        const exact = await client.query(
          "SELECT 1 FROM bff_scheduled_agent_dispatch WHERE tenant_id=$1 AND task_id=$2 AND occurrence=$3 AND request_digest=$4 AND run_id=$5",
          [input.snapshot.tenantId, input.snapshot.taskId, input.snapshot.occurrence, input.claim.digest, runId],
        )
        if (exact.rowCount !== 1) throw new Error("SCHEDULED_AGENT_DISPATCH_CONFLICT")
      }
      const terminal = {
        schema_version: 2,
        state: "terminal",
        claim_token: null,
        lease_until: null,
        retry_at: null,
        snapshot: input.snapshot,
        last_error_code: null,
        response: input.response,
      }
      const completed = await client.query(
        "UPDATE bff_idempotency_receipt SET status=$4,response_body=$5::jsonb WHERE scope=$1 AND fingerprint=$2 AND status=$3",
        [input.claim.scope, input.claim.digest, RECEIPT_PENDING, input.response.status, JSON.stringify(terminal)],
      )
      if (completed.rowCount !== 1) throw new Error("SCHEDULED_AGENT_RECEIPT_LOST")
      await client.query("COMMIT")
      return true
    } catch (e) {
      await client.query("ROLLBACK").catch(() => undefined)
      throw e
    } finally {
      client.release()
    }
  }

  public async claim(input: {
    workerId: string
    leaseDurationMs: number
    settlementReserveMs: number
    maxAttempts: number
  }): Promise<ScheduledAgentDispatchCommand | null> {
    positive(input.leaseDurationMs, "SCHEDULED_AGENT_LEASE_INVALID")
    positive(input.maxAttempts, "SCHEDULED_AGENT_ATTEMPTS_INVALID")
    if (!Number.isSafeInteger(input.settlementReserveMs) || input.settlementReserveMs < 0 || input.settlementReserveMs >= input.leaseDurationMs)
      throw new Error("SCHEDULED_AGENT_LEASE_RESERVE_INVALID")
    const client = await this.database.pool.connect()
    try {
      await client.query("BEGIN")
      const scopeResult =
        await client.query<ScopeHeadRow>(`SELECT scope.tenant_id,scope.task_id,scope.active_dispatch_id FROM bff_scheduled_agent_scope scope WHERE
        (scope.active_dispatch_id IS NULL AND EXISTS(SELECT 1 FROM bff_scheduled_agent_dispatch d WHERE d.tenant_id=scope.tenant_id AND d.task_id=scope.task_id AND ((d.status IN('pending','retryable') AND d.available_at<=clock_timestamp()) OR (d.status='leased' AND d.lease_until<=clock_timestamp()))))
        OR EXISTS(SELECT 1 FROM bff_scheduled_agent_dispatch d WHERE d.dispatch_id=scope.active_dispatch_id AND (((d.status IN('pending','retryable') AND d.available_at<=clock_timestamp()) OR (d.status='leased' AND d.lease_until<=clock_timestamp()))))
        ORDER BY scope.tenant_id,scope.task_id LIMIT 1 FOR UPDATE SKIP LOCKED`)
      const scope = scopeResult.rows[0]
      if (!scope) {
        await client.query("COMMIT")
        return null
      }
      let dispatchId = scope.active_dispatch_id
      if (dispatchId === null) {
        const head = await client.query<DispatchHeadRow>(
          `SELECT dispatch_id FROM bff_scheduled_agent_dispatch WHERE tenant_id=$1 AND task_id=$2 AND status IN('pending','retryable','leased','admitted') ORDER BY occurrence_order_key,dispatch_id LIMIT 1 FOR UPDATE`,
          [scope.tenant_id, scope.task_id],
        )
        dispatchId = head.rows[0]?.dispatch_id ?? null
        if (!dispatchId) {
          await client.query("COMMIT")
          return null
        }
        await client.query(
          "UPDATE bff_scheduled_agent_scope SET active_dispatch_id=$3,active_run_id=(SELECT run_id FROM bff_scheduled_agent_dispatch WHERE dispatch_id=$3),updated_at=clock_timestamp() WHERE tenant_id=$1 AND task_id=$2",
          [scope.tenant_id, scope.task_id, dispatchId],
        )
      }
      await client.query("SELECT dispatch_id FROM bff_scheduled_agent_dispatch WHERE dispatch_id=$1 FOR UPDATE", [dispatchId])
      const observedAt = performance.now()
      const dbNow = (await client.query<{ now: Date }>("SELECT clock_timestamp() AS now")).rows[0]?.now
      if (!dbNow) throw new Error("SCHEDULED_AGENT_CLOCK_UNAVAILABLE")
      const leased = await client.query<DispatchLeaseRow>(
        `UPDATE bff_scheduled_agent_dispatch SET status='leased',admission_unknown_seen=admission_unknown_seen OR status='leased',attempt_count=attempt_count+1,
        lease_owner=$2,lease_token=$3,lease_until=$4::timestamptz+($5::double precision*interval '1 millisecond'),fence=fence+1,updated_at=$4
        WHERE dispatch_id=$1 AND ((status IN('pending','retryable') AND available_at<=$4) OR (status='leased' AND lease_until<=$4)) AND (attempt_count<$6 OR admission_unknown_seen OR status='leased')
        RETURNING *,FLOOR(EXTRACT(EPOCH FROM (lease_until-$4::timestamptz))*1000)::bigint lease_remaining_ms`,
        [dispatchId, input.workerId, randomUUID(), dbNow, input.leaseDurationMs, input.maxAttempts],
      )
      if (!leased.rows[0]) {
        await client.query("COMMIT")
        return null
      }
      const finalNow = (
        await client.query<{ remaining: string | number }>(
          "SELECT FLOOR(EXTRACT(EPOCH FROM (lease_until-clock_timestamp()))*1000)::bigint remaining FROM bff_scheduled_agent_dispatch WHERE dispatch_id=$1",
          [dispatchId],
        )
      ).rows[0]
      const remainingBeforeCommit = Number(finalNow?.remaining)
      if (!Number.isSafeInteger(remainingBeforeCommit) || remainingBeforeCommit <= input.settlementReserveMs) {
        await client.query("ROLLBACK")
        return null
      }
      await client.query("COMMIT")
      const command = leaseOf(leased.rows[0])
      command.leaseRemainingMs = remainingBeforeCommit - Math.ceil(performance.now() - observedAt)
      command.leaseObservedAt = performance.now()
      // COMMIT can consume the remaining budget. The runner needs the real
      // signed value to fence-release this exact known-never-sent lease.
      return command
    } catch (e) {
      await client.query("ROLLBACK").catch(() => undefined)
      throw e
    } finally {
      client.release()
    }
  }
  public async releaseNeverSent(lease: ScheduledAgentDispatchLease, delayMs: number): Promise<boolean> {
    if (!Number.isSafeInteger(delayMs) || delayMs < 0 || delayMs > 600000) throw new Error("SCHEDULED_AGENT_RETRY_DELAY_INVALID")
    const client = await this.database.pool.connect()
    try {
      await client.query("BEGIN")
      await client.query("SELECT 1 FROM bff_scheduled_agent_scope WHERE tenant_id=$1 AND task_id=$2 FOR UPDATE", [lease.tenantId, lease.taskId])
      await client.query("SELECT 1 FROM bff_scheduled_agent_dispatch WHERE dispatch_id=$1 FOR UPDATE", [lease.dispatchId])
      const now = (await client.query<{ now: Date }>("SELECT clock_timestamp() now")).rows[0]?.now
      if (!now) throw new Error("SCHEDULED_AGENT_CLOCK_UNAVAILABLE")
      const result = await client.query(
        "UPDATE bff_scheduled_agent_dispatch SET status='retryable',lease_owner=NULL,lease_token=NULL,lease_until=NULL,available_at=$7::timestamptz+($9::double precision*interval '1 millisecond'),updated_at=$7::timestamptz WHERE tenant_id=$1 AND task_id=$2 AND dispatch_id=$3 AND run_id=$4 AND status='leased' AND lease_owner=$5 AND lease_token=$6 AND fence=$8",
        [lease.tenantId, lease.taskId, lease.dispatchId, lease.runId, lease.leaseOwner, lease.leaseToken, now, lease.fence, delayMs],
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

  private async settle(lease: ScheduledAgentDispatchLease, kind: "admitted" | "unknown" | "not", delayMs = 0, errorCode = ""): Promise<boolean> {
    const client = await this.database.pool.connect()
    try {
      await client.query("BEGIN")
      await client.query("SELECT 1 FROM bff_scheduled_agent_scope WHERE tenant_id=$1 AND task_id=$2 FOR UPDATE", [lease.tenantId, lease.taskId])
      await client.query("SELECT 1 FROM bff_scheduled_agent_dispatch WHERE tenant_id=$1 AND task_id=$2 AND dispatch_id=$3 AND run_id=$4 FOR UPDATE", [
        lease.tenantId,
        lease.taskId,
        lease.dispatchId,
        lease.runId,
      ])
      const now = (await client.query<{ now: Date }>("SELECT clock_timestamp() AS now")).rows[0]?.now
      if (!now) throw new Error("SCHEDULED_AGENT_CLOCK_UNAVAILABLE")
      let sql: string, values: (string | number | Date)[]
      if (kind === "admitted") {
        sql = `UPDATE bff_scheduled_agent_dispatch SET status='admitted',lease_owner=NULL,lease_token=NULL,lease_until=NULL,admitted_at=$7,updated_at=$7 WHERE tenant_id=$1 AND task_id=$2 AND dispatch_id=$3 AND run_id=$4 AND status='leased' AND lease_owner=$5 AND lease_token=$6 AND fence=$8 AND lease_until>$7`
        values = [lease.tenantId, lease.taskId, lease.dispatchId, lease.runId, lease.leaseOwner, lease.leaseToken, now, lease.fence]
      } else if (kind === "unknown") {
        sql = `UPDATE bff_scheduled_agent_dispatch SET status='retryable',admission_unknown_seen=TRUE,lease_owner=NULL,lease_token=NULL,lease_until=NULL,available_at=$7+($9::double precision*interval '1 millisecond'),last_error_code=$10,last_error_at=$7,updated_at=$7 WHERE tenant_id=$1 AND task_id=$2 AND dispatch_id=$3 AND run_id=$4 AND status='leased' AND lease_owner=$5 AND lease_token=$6 AND fence=$8 AND lease_until>$7`
        values = [lease.tenantId, lease.taskId, lease.dispatchId, lease.runId, lease.leaseOwner, lease.leaseToken, now, lease.fence, delayMs, errorCode]
      } else {
        sql = `UPDATE bff_scheduled_agent_dispatch SET status=CASE WHEN admission_unknown_seen THEN 'retryable' ELSE 'failed' END,lease_owner=NULL,lease_token=NULL,lease_until=NULL,available_at=$7+($9::double precision*interval '1 millisecond'),completed_at=CASE WHEN admission_unknown_seen THEN NULL ELSE $7 END,last_error_code=$10,last_error_at=$7,updated_at=$7 WHERE tenant_id=$1 AND task_id=$2 AND dispatch_id=$3 AND run_id=$4 AND status='leased' AND lease_owner=$5 AND lease_token=$6 AND fence=$8 AND lease_until>$7`
        values = [lease.tenantId, lease.taskId, lease.dispatchId, lease.runId, lease.leaseOwner, lease.leaseToken, now, lease.fence, delayMs, errorCode]
      }
      const result = await client.query(sql, values)
      if (kind === "not" && result.rowCount === 1) {
        await client.query(
          "UPDATE bff_scheduled_agent_scope SET active_dispatch_id=NULL,active_run_id=NULL,updated_at=$3 WHERE tenant_id=$1 AND task_id=$2 AND active_dispatch_id=$4 AND NOT EXISTS(SELECT 1 FROM bff_scheduled_agent_dispatch WHERE dispatch_id=$4 AND status<>'failed')",
          [lease.tenantId, lease.taskId, now, lease.dispatchId],
        )
      }
      await client.query("COMMIT")
      return result.rowCount === 1
    } catch (e) {
      await client.query("ROLLBACK").catch(() => undefined)
      throw e
    } finally {
      client.release()
    }
  }
  markAdmitted(l: ScheduledAgentDispatchLease) {
    return this.settle(l, "admitted")
  }
  markUnknown(l: ScheduledAgentDispatchLease, d: number, c: string) {
    return this.settle(l, "unknown", d, c)
  }
  markNotAdmitted(l: ScheduledAgentDispatchLease, d: number, c: string) {
    return this.settle(l, "not", d, c)
  }

  public async claimConsumer(input: { workerId: string; leaseDurationMs: number; settlementReserveMs: number }): Promise<ScheduledAgentConsumerLease | null> {
    positive(input.leaseDurationMs, "SCHEDULED_AGENT_CONSUMER_LEASE_INVALID")
    if (!Number.isSafeInteger(input.settlementReserveMs) || input.settlementReserveMs < 0 || input.settlementReserveMs >= input.leaseDurationMs)
      throw new Error("SCHEDULED_AGENT_CONSUMER_RESERVE_INVALID")
    const client = await this.database.pool.connect()
    try {
      await client.query("BEGIN")
      const scope = (
        await client.query<ConsumerScopeRow>(
          `SELECT s.tenant_id,s.task_id,s.session_id,s.subject_id,s.source_high_watermark,s.consumer_failure_count,s.active_dispatch_id FROM bff_scheduled_agent_scope s JOIN bff_scheduled_agent_dispatch d ON d.dispatch_id=s.active_dispatch_id WHERE d.status IN('leased','retryable','admitted','terminal') AND (s.consumer_lease_until IS NULL OR s.consumer_lease_until<=clock_timestamp()) AND s.consumer_next_poll_at<=clock_timestamp() ORDER BY s.consumer_next_poll_at,s.tenant_id,s.task_id LIMIT 1 FOR UPDATE OF s SKIP LOCKED`,
        )
      ).rows[0]
      if (!scope) {
        await client.query("COMMIT")
        return null
      }
      await client.query("SELECT 1 FROM bff_scheduled_agent_dispatch WHERE dispatch_id=$1 FOR UPDATE", [scope.active_dispatch_id])
      const observed = performance.now()
      const now = (await client.query<{ now: Date }>("SELECT clock_timestamp() now")).rows[0]!.now
      const token = randomUUID()
      const until = new Date(now.getTime() + positive(input.leaseDurationMs, "SCHEDULED_AGENT_CONSUMER_LEASE_INVALID"))
      const updated = (
        await client.query<ConsumerUpdateRow>(
          `UPDATE bff_scheduled_agent_scope SET consumer_lease_owner=$3,consumer_lease_token=$4,consumer_lease_until=$5,consumer_fence=consumer_fence+1,updated_at=$6 WHERE tenant_id=$1 AND task_id=$2 AND active_dispatch_id=$7 AND (consumer_lease_until IS NULL OR consumer_lease_until<=$6) AND consumer_next_poll_at<=$6 AND EXISTS(SELECT 1 FROM bff_scheduled_agent_dispatch d WHERE d.dispatch_id=$7 AND d.status IN('leased','retryable','admitted','terminal')) RETURNING *`,
          [scope.tenant_id, scope.task_id, input.workerId, token, until, now, scope.active_dispatch_id],
        )
      ).rows[0]
      if (!updated) {
        await client.query("COMMIT")
        return null
      }
      const finalBudget = (
        await client.query<{ remaining: string | number }>(
          "SELECT FLOOR(EXTRACT(EPOCH FROM (consumer_lease_until-clock_timestamp()))*1000)::bigint remaining FROM bff_scheduled_agent_scope WHERE tenant_id=$1 AND task_id=$2",
          [scope.tenant_id, scope.task_id],
        )
      ).rows[0]
      const remaining = Number(finalBudget?.remaining)
      if (!Number.isSafeInteger(remaining) || remaining <= input.settlementReserveMs) {
        await client.query("ROLLBACK")
        return null
      }
      await client.query("COMMIT")
      const returnedRemaining = remaining - Math.ceil(performance.now() - observed)
      // Return an exhausted committed lease so the consumer can release its
      // exact nonce without attempting source I/O.
      return {
        tenantId: updated.tenant_id,
        taskId: updated.task_id,
        sessionId: updated.session_id,
        subjectId: updated.subject_id,
        leaseOwner: input.workerId,
        leaseToken: token,
        fence: nonnegative(updated.consumer_fence, "SCHEDULED_AGENT_CONSUMER_FENCE_INVALID"),
        sourceHighWatermark: nonnegative(updated.source_high_watermark, "SCHEDULED_AGENT_SOURCE_CURSOR_INVALID"),
        failureCount: nonnegative(scope.consumer_failure_count, "SCHEDULED_AGENT_CONSUMER_FAILURE_INVALID"),
        leaseRemainingMs: returnedRemaining,
        leaseObservedAt: performance.now(),
      }
    } catch (e) {
      await client.query("ROLLBACK").catch(() => undefined)
      throw e
    } finally {
      client.release()
    }
  }
  public async commitSourcePage(
    lease: ScheduledAgentConsumerLease,
    events: readonly ScheduledAgentSourceEvent[],
    nextSequence: number,
    exhausted: boolean,
  ): Promise<boolean> {
    const client = await this.database.pool.connect()
    try {
      await client.query("BEGIN")
      const scope = (
        await client.query<SourceScopeRow>(
          "SELECT active_dispatch_id,active_run_id,session_id,source_high_watermark,consumer_lease_owner,consumer_lease_token,consumer_lease_until,consumer_fence FROM bff_scheduled_agent_scope WHERE tenant_id=$1 AND task_id=$2 FOR UPDATE",
          [lease.tenantId, lease.taskId],
        )
      ).rows[0]
      const activeDispatch = scope?.active_dispatch_id
        ? (
            await client.query<ActiveDispatchRow>("SELECT status,lease_until FROM bff_scheduled_agent_dispatch WHERE dispatch_id=$1 AND run_id=$2 FOR UPDATE", [
              scope.active_dispatch_id,
              scope.active_run_id,
            ])
          ).rows[0]
        : undefined
      const now = (await client.query<{ now: Date }>("SELECT clock_timestamp() now")).rows[0]!.now
      if (
        !scope ||
        scope.consumer_lease_owner !== lease.leaseOwner ||
        scope.consumer_lease_token !== lease.leaseToken ||
        Number(scope.consumer_fence) !== lease.fence ||
        !scope.consumer_lease_until ||
        scope.consumer_lease_until <= now ||
        Number(scope.source_high_watermark) !== lease.sourceHighWatermark
      ) {
        await client.query("ROLLBACK")
        return false
      }
      let cursor = lease.sourceHighWatermark
      let terminal = activeDispatch?.status === "terminal"
      let newlyTerminal = false
      for (const event of events) {
        if (terminal && event.sourceRunId === scope.active_run_id) throw new Error("SCHEDULED_AGENT_SOURCE_AFTER_TERMINAL")
        if (event.sourceSequence !== cursor + 1) throw new Error("SCHEDULED_AGENT_SOURCE_GAP")
        if (!validSourceEvent(event, scope.session_id)) throw new Error("SCHEDULED_AGENT_SOURCE_IDENTITY_INVALID")
        await client.query(
          `INSERT INTO bff_scheduled_agent_source_event(tenant_id,task_id,source_sequence,source_event_id,source_run_id,source_owner,source_digest,source_occurred_at,event_type,source_payload) VALUES($1,$2,$3,$4,$5,'kokoro-agent',$6,$7,$8,$9::jsonb)`,
          [
            lease.tenantId,
            lease.taskId,
            event.sourceSequence,
            event.sourceEventId,
            event.sourceRunId,
            event.sourceDigest,
            event.sourceOccurredAt,
            event.eventType,
            JSON.stringify(event.sourcePayload),
          ],
        )
        cursor = event.sourceSequence
        if (event.sourceRunId === scope.active_run_id && terminalType(event.eventType)) {
          terminal = true
          newlyTerminal = true
        }
      }
      if (cursor !== nextSequence) throw new Error("SCHEDULED_AGENT_SOURCE_CURSOR_MISMATCH")
      const finalNow = (await client.query<{ now: Date }>("SELECT clock_timestamp() now")).rows[0]!.now
      if (!scope.consumer_lease_until || scope.consumer_lease_until <= finalNow) {
        await client.query("ROLLBACK")
        return false
      }
      if (newlyTerminal) {
        const settled = await client.query(
          "UPDATE bff_scheduled_agent_dispatch SET status='terminal',admitted_at=COALESCE(admitted_at,$3),completed_at=$3,lease_owner=NULL,lease_token=NULL,lease_until=NULL,updated_at=$3 WHERE dispatch_id=$1 AND run_id=$2 AND status IN('leased','retryable','admitted')",
          [scope.active_dispatch_id, scope.active_run_id, finalNow],
        )
        if (settled.rowCount !== 1) {
          await client.query("ROLLBACK")
          return false
        }
      }
      const releaseActive = terminal && exhausted
      await client.query(
        `UPDATE bff_scheduled_agent_scope SET source_high_watermark=$3,active_dispatch_id=CASE WHEN $4 THEN NULL ELSE active_dispatch_id END,active_run_id=CASE WHEN $4 THEN NULL ELSE active_run_id END,consumer_lease_owner=NULL,consumer_lease_token=NULL,consumer_lease_until=NULL,consumer_failure_count=0,consumer_next_poll_at=$5,updated_at=$6 WHERE tenant_id=$1 AND task_id=$2`,
        [lease.tenantId, lease.taskId, nextSequence, releaseActive, new Date(finalNow.getTime() + (exhausted ? 250 : 0)), finalNow],
      )
      await client.query("COMMIT")
      return true
    } catch (e) {
      await client.query("ROLLBACK").catch(() => undefined)
      throw e
    } finally {
      client.release()
    }
  }
  public async releaseConsumer(lease: ScheduledAgentConsumerLease, delayMs: number): Promise<boolean> {
    if (!Number.isSafeInteger(delayMs) || delayMs < 0 || delayMs > 600000) throw new Error("SCHEDULED_AGENT_RETRY_DELAY_INVALID")
    const client = await this.database.pool.connect()
    try {
      await client.query("BEGIN")
      await client.query("SELECT 1 FROM bff_scheduled_agent_scope WHERE tenant_id=$1 AND task_id=$2 FOR UPDATE", [lease.tenantId, lease.taskId])
      const now = (await client.query<{ now: Date }>("SELECT clock_timestamp() AS now")).rows[0]?.now
      if (!now) throw new Error("SCHEDULED_AGENT_CLOCK_UNAVAILABLE")
      const result = await client.query(
        `UPDATE bff_scheduled_agent_scope SET consumer_lease_owner=NULL,consumer_lease_token=NULL,consumer_lease_until=NULL,consumer_failure_count=consumer_failure_count+1,consumer_next_poll_at=$6::timestamptz+($7::double precision*interval '1 millisecond'),updated_at=$6 WHERE tenant_id=$1 AND task_id=$2 AND consumer_lease_owner=$3 AND consumer_lease_token=$4 AND consumer_fence=$5 AND consumer_lease_until>$6`,
        [lease.tenantId, lease.taskId, lease.leaseOwner, lease.leaseToken, lease.fence, now, delayMs],
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
}
