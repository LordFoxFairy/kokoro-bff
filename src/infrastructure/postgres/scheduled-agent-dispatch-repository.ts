import { createHash, randomUUID } from "node:crypto"
import type { PostgresBffDatabase } from "./client.js"
import type {
  ScheduledAgentAcceptInput,
  ScheduledAgentAcceptResult,
  ScheduledAgentRejectionReason,
  ScheduledAgentDispatchRepository,
} from "../../application/scheduled/scheduled-agent-dispatch-repository.js"
import type { ScheduledAgentDispatchCommand, ScheduledAgentDispatchLease } from "../../domain/scheduled-task/agent-dispatch.js"
import { scheduledOccurrenceOrderKey } from "../../domain/scheduled-task/agent-dispatch.js"
import { scheduledConversationId } from "../clients/agent/launch.js"

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
  execution_actor_id: string | null
  enabled: boolean
  status: string
  revision: string | number
}
type ScopeIdentityRow = { subject_id: string; session_id: string }
type ScopeHeadRow = {
  tenant_id: string
  task_id: string
  active_dispatch_id: string | null
  session_id: string
}
type DispatchHeadRow = { dispatch_id: string }
type DispatchLeaseRow = {
  tenant_id: string
  task_id: string
  dispatch_id: string
  run_id: string
  subject_id: string
  session_id: string
  user_message_id: string
  assistant_message_id: string
  request_digest: string
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
    conversationId: row.session_id,
    userMessageId: row.user_message_id,
    assistantMessageId: row.assistant_message_id,
    requestDigest: row.request_digest,
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
export class PostgresScheduledAgentDispatchRepository implements ScheduledAgentDispatchRepository {
  public constructor(private readonly database: PostgresBffDatabase) {}

  public async accept(input: ScheduledAgentAcceptInput): Promise<ScheduledAgentAcceptResult> {
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
        return { outcome: "claim_lost" }
      }
      const task = await client.query<TaskRow>(
        "SELECT owner_id,execution_actor_id,enabled,status,revision FROM bff_scheduled_task WHERE tenant_id=$1 AND task_id=$2 FOR UPDATE",
        [input.snapshot.tenantId, input.snapshot.taskId],
      )
      const taskRow = task.rows[0]
      // Classify while holding both locks; never re-read task state after this transaction.
      let rejection: ScheduledAgentRejectionReason | null = null
      if (!taskRow || taskRow.execution_actor_id !== input.snapshot.actorId) rejection = "task_not_found"
      else if (!taskRow.enabled || taskRow.status !== "active") rejection = "task_not_active"
      else if (Number(taskRow.revision) !== input.snapshot.taskRevision) rejection = "task_changed"
      const response = rejection === null ? input.response : input.rejections[rejection]
      if (rejection === null) {
        const sessionId = String(input.snapshot.launch.body.session_id ?? "")
        const runId = input.snapshot.launch.receipt.run_id
        if (sessionId !== scheduledConversationId(input.snapshot.tenantId, input.snapshot.taskId) || String(input.snapshot.launch.body.run_id ?? "") !== runId)
          throw new Error("SCHEDULED_AGENT_SNAPSHOT_INVALID")
        await client.query(
          `INSERT INTO bff_scheduled_agent_scope(tenant_id,task_id,session_id,subject_id) VALUES($1,$2,$3,$4)
          ON CONFLICT(tenant_id,task_id) DO NOTHING`,
          [input.snapshot.tenantId, input.snapshot.taskId, sessionId, taskRow!.owner_id],
        )
        const scope = await client.query<ScopeIdentityRow>(
          "SELECT subject_id,session_id FROM bff_scheduled_agent_scope WHERE tenant_id=$1 AND task_id=$2 FOR UPDATE",
          [input.snapshot.tenantId, input.snapshot.taskId],
        )
        if (scope.rows[0]?.session_id !== sessionId) throw new Error("SCHEDULED_AGENT_SCOPE_CONFLICT")
        const dispatchId = id(input.snapshot.tenantId, input.snapshot.taskId, input.snapshot.occurrence)
        const inserted = await client.query(
          `INSERT INTO bff_scheduled_agent_dispatch(
          dispatch_id,tenant_id,task_id,occurrence,occurrence_order_key,subject_id,request_id,idempotency_key,request_digest,run_id,identity_assertion_ref,payload,user_message_id,assistant_message_id,task_revision)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15) ON CONFLICT(tenant_id,task_id,occurrence) DO NOTHING`,
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
            input.snapshot.launch.receipt.user_message_id,
            input.snapshot.launch.receipt.assistant_message_id,
            input.snapshot.taskRevision,
          ],
        )
        if (inserted.rowCount !== 1) {
          const exact = await client.query(
            "SELECT 1 FROM bff_scheduled_agent_dispatch WHERE tenant_id=$1 AND task_id=$2 AND occurrence=$3 AND request_digest=$4 AND run_id=$5",
            [input.snapshot.tenantId, input.snapshot.taskId, input.snapshot.occurrence, input.claim.digest, runId],
          )
          if (exact.rowCount !== 1) throw new Error("SCHEDULED_AGENT_DISPATCH_CONFLICT")
        }
      }
      const terminal = {
        schema_version: 2,
        state: "terminal",
        claim_token: null,
        lease_until: null,
        retry_at: null,
        snapshot: input.snapshot,
        last_error_code: null,
        response,
      }
      const finalNow = (await client.query<{ now: Date }>("SELECT clock_timestamp() AS now")).rows[0]?.now
      if (!finalNow || Date.parse(envelope.lease_until) <= finalNow.getTime()) {
        await client.query("ROLLBACK")
        return { outcome: "claim_lost" }
      }
      const completed = await client.query(
        "UPDATE bff_idempotency_receipt SET status=$4,response_body=$5::jsonb WHERE scope=$1 AND fingerprint=$2 AND status=$3",
        [input.claim.scope, input.claim.digest, RECEIPT_PENDING, response.status, JSON.stringify(terminal)],
      )
      if (completed.rowCount !== 1) throw new Error("SCHEDULED_AGENT_RECEIPT_LOST")
      await client.query("COMMIT")
      return rejection === null ? { outcome: "accepted" } : { outcome: "rejected", response }
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
        await client.query<ScopeHeadRow>(`SELECT scope.tenant_id,scope.task_id,scope.active_dispatch_id,scope.session_id FROM bff_scheduled_agent_scope scope WHERE
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
          `SELECT dispatch_id FROM bff_scheduled_agent_dispatch WHERE tenant_id=$1 AND task_id=$2 AND status IN('pending','retryable','leased','submitted','admitted') ORDER BY occurrence_order_key,dispatch_id LIMIT 1 FOR UPDATE`,
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
      // Claim never upgrades an old known-unsent definition into a fresh execution. No reverse task lock:
      // an edit owns Task→scope, and the final Chat transaction rechecks the same revision/fence.
      const obsolete = await client.query(
        `UPDATE bff_scheduled_agent_dispatch d SET status='failed',lease_owner=NULL,lease_token=NULL,lease_until=NULL,
          fence=fence+1,completed_at=clock_timestamp(),last_error_code='scheduled_definition_changed',updated_at=clock_timestamp()
         WHERE d.dispatch_id=$1 AND d.status IN ('pending','retryable','leased') AND NOT d.admission_unknown_seen
           AND NOT EXISTS (SELECT 1 FROM bff_agent_dispatch_outbox ordinary WHERE ordinary.tenant_id=d.tenant_id AND ordinary.run_id=d.run_id)
           AND NOT EXISTS (SELECT 1 FROM bff_scheduled_task definition WHERE definition.tenant_id=d.tenant_id AND definition.task_id=d.task_id
             AND definition.revision=d.task_revision AND definition.execution_actor_id=d.subject_id AND definition.enabled AND definition.status='active')
         RETURNING d.dispatch_id`,
        [dispatchId],
      )
      if (obsolete.rowCount === 1) {
        await client.query(
          "UPDATE bff_scheduled_agent_scope SET active_dispatch_id=NULL,active_run_id=NULL,updated_at=clock_timestamp() WHERE tenant_id=$1 AND task_id=$2 AND active_dispatch_id=$3",
          [scope.tenant_id, scope.task_id, dispatchId],
        )
        await client.query("COMMIT")
        return null
      }
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
      const command = leaseOf({
        ...leased.rows[0],
        session_id: scope.session_id,
      })
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

  private async settle(lease: ScheduledAgentDispatchLease, kind: "unknown" | "not", delayMs = 0, errorCode = ""): Promise<boolean> {
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
      if (kind === "unknown") {
        sql = `UPDATE bff_scheduled_agent_dispatch SET status='retryable',admission_unknown_seen=TRUE,lease_owner=NULL,lease_token=NULL,lease_until=NULL,available_at=$7+($9::double precision*interval '1 millisecond'),last_error_code=$10,last_error_at=$7,updated_at=$7 WHERE tenant_id=$1 AND task_id=$2 AND dispatch_id=$3 AND run_id=$4 AND status='leased' AND lease_owner=$5 AND lease_token=$6 AND fence=$8 AND lease_until>$7`
        values = [lease.tenantId, lease.taskId, lease.dispatchId, lease.runId, lease.leaseOwner, lease.leaseToken, now, lease.fence, delayMs, errorCode]
      } else {
        sql = `UPDATE bff_scheduled_agent_dispatch SET status='failed',admission_unknown_seen=FALSE,lease_owner=NULL,lease_token=NULL,lease_until=NULL,available_at=$7+($9::double precision*interval '1 millisecond'),completed_at=$7,last_error_code=$10,last_error_at=$7,updated_at=$7 WHERE tenant_id=$1 AND task_id=$2 AND dispatch_id=$3 AND run_id=$4 AND status='leased' AND lease_owner=$5 AND lease_token=$6 AND fence=$8 AND lease_until>$7`
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
  markUnknown(l: ScheduledAgentDispatchLease, d: number, c: string) {
    return this.settle(l, "unknown", d, c)
  }
  markNotAdmitted(l: ScheduledAgentDispatchLease, d: number, c: string) {
    return this.settle(l, "not", d, c)
  }

  /** Observe only committed ordinary queue facts. No Agent I/O and no second event cursor. */
  public async reconcileActive(): Promise<boolean> {
    const client = await this.database.pool.connect()
    try {
      await client.query("BEGIN")
      const scope = (
        await client.query<{
          tenant_id: string
          task_id: string
          active_dispatch_id: string
        }>(
          `SELECT scope.tenant_id,scope.task_id,scope.active_dispatch_id
           FROM bff_scheduled_agent_scope scope
           JOIN bff_scheduled_agent_dispatch scheduled ON scheduled.dispatch_id=scope.active_dispatch_id
           JOIN bff_agent_dispatch_outbox ordinary ON ordinary.tenant_id=scope.tenant_id
             AND ordinary.conversation_id=scope.session_id AND ordinary.run_id=scope.active_run_id
             AND ordinary.subject_id=scope.subject_id
          WHERE (scheduled.status='submitted' AND ordinary.status='admitted')
             OR (scheduled.status IN ('submitted','admitted') AND ordinary.status='failed' AND ordinary.admission_unknown_seen=FALSE)
          ORDER BY scope.tenant_id,scope.task_id LIMIT 1 FOR UPDATE OF scope SKIP LOCKED`,
        )
      ).rows[0]
      if (!scope) {
        await client.query("COMMIT")
        return false
      }
      await client.query("SELECT 1 FROM bff_scheduled_agent_dispatch WHERE dispatch_id=$1 FOR UPDATE", [scope.active_dispatch_id])
      const result = await client.query(
        `UPDATE bff_scheduled_agent_dispatch scheduled
            SET status=CASE WHEN ordinary.status='admitted' THEN 'admitted' ELSE 'failed' END,
                admitted_at=ordinary.admitted_at, completed_at=ordinary.completed_at,
                admission_unknown_seen=CASE WHEN ordinary.status='failed' THEN FALSE ELSE scheduled.admission_unknown_seen END,
                last_error_code=ordinary.last_error_code,last_error_at=ordinary.last_error_at,updated_at=clock_timestamp()
           FROM bff_agent_dispatch_outbox ordinary,bff_scheduled_agent_scope scope
          WHERE scheduled.dispatch_id=$1 AND scope.tenant_id=scheduled.tenant_id AND scope.task_id=scheduled.task_id
            AND scope.active_dispatch_id=scheduled.dispatch_id AND scope.active_run_id=scheduled.run_id
            AND ordinary.tenant_id=scheduled.tenant_id AND ordinary.run_id=scheduled.run_id
            AND ordinary.conversation_id=scope.session_id AND ordinary.subject_id=scheduled.subject_id
            AND ((scheduled.status='submitted' AND ordinary.status='admitted')
              OR (scheduled.status IN ('submitted','admitted') AND ordinary.status='failed' AND ordinary.admission_unknown_seen=FALSE))`,
        [scope.active_dispatch_id],
      )
      await client.query(
        `UPDATE bff_scheduled_agent_scope SET active_dispatch_id=NULL,active_run_id=NULL,updated_at=clock_timestamp()
          WHERE tenant_id=$1 AND task_id=$2 AND active_dispatch_id=$3
            AND EXISTS(SELECT 1 FROM bff_scheduled_agent_dispatch WHERE dispatch_id=$3 AND status='failed')`,
        [scope.tenant_id, scope.task_id, scope.active_dispatch_id],
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
