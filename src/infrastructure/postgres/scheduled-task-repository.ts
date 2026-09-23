import { randomUUID } from "node:crypto"
import type { PoolClient } from "pg"

import {
  assertScheduledTaskOutboxLineage,
  buildScheduledTaskOutboxPayload,
  commandType,
  parseScheduledTaskOutboxPayload,
  scheduledTaskOutboxTaskFromPayload,
  type ScheduledTaskOutboxCommand,
  type ScheduledTaskOutboxLease,
  type ScheduledTaskOutboxOperation,
  type ScheduledTaskOutboxPayload,
  type ScheduledTaskOutboxStatus,
  type ScheduledTaskOutboxTask,
} from "../../domain/scheduled-task/outbox.js"
import { utcDate, type ScheduledTaskFact } from "../../domain/scheduled-task/task.js"
import type { ScheduledTaskOutboxClaimInput, ScheduledTaskOutboxRepository } from "../../application/ports/scheduled-task-outbox-repository.js"
import type {
  ScheduledTaskCreateInput,
  ScheduledTaskMutationLineage,
  ScheduledTaskOwnerScope,
  ScheduledTaskPatch,
  ScheduledTaskRecord,
  ScheduledTaskRepository,
} from "../../application/ports/scheduled-task-repository.js"
import type { PostgresBffDatabase } from "./client.js"
import type { StableIdGenerator } from "../../application/ports/stable-id-generator.js"
import {
  scheduledTaskOutboxId,
  Sha256StableIdGenerator,
} from "../identifiers/scheduled-task-outbox-id.js"

type ScheduledTaskRow = {
  task_id: string
  tenant_id: string
  project_id: string | null
  owner_id: string
  title: string
  prompt: string
  frequency: "daily" | "weekly"
  task_time: string
  timezone: string
  next_run_at: Date | string
  expires_at: Date | string | null
  auto_approve: boolean
  enabled: boolean
  status: "active" | "paused" | "failed"
  revision: string | number
  created_at: Date | string
  updated_at: Date | string
}

type ScheduledTaskOutboxRow = {
  outbox_id: string
  tenant_id: string
  task_id: string
  command_type: `scheduler.${ScheduledTaskOutboxOperation}`
  aggregate_revision: string | number
  payload: unknown
  actor_id: string
  request_id: string
  idempotency_key: string
  status: ScheduledTaskOutboxStatus
  attempt_count: string | number
  available_at: Date | string
  lease_owner: string | null
  lease_token: string | null
  lease_until: Date | string | null
  fence: string | number
  last_error_code: string | null
}

const TASK_COLUMNS = `task_id, tenant_id, project_id, owner_id, title, prompt, frequency, task_time, timezone,
              next_run_at, expires_at, auto_approve, enabled, status, revision, created_at, updated_at`

function dbDate(value: Date | string, errorCode: string): Date {
  const parsed = value instanceof Date ? value : new Date(value)
  return utcDate(parsed, errorCode)
}

function safeInteger(value: string | number, label: string): number {
  const parsed = typeof value === "number" ? value : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${label}_INVALID`)
  return parsed
}

function scheduledTaskFromRow(row: ScheduledTaskRow): ScheduledTaskFact {
  return {
    id: row.task_id,
    ...(row.project_id === null ? {} : { projectId: row.project_id }),
    title: row.title,
    prompt: row.prompt,
    frequency: row.frequency,
    time: row.task_time,
    timezone: row.timezone,
    nextRunAt: dbDate(row.next_run_at, "SCHEDULED_TASK_NEXT_RUN_INVALID"),
    ...(row.expires_at === null ? {} : { expiresAt: dbDate(row.expires_at, "SCHEDULED_TASK_EXPIRES_INVALID") }),
    autoApprove: row.auto_approve,
    enabled: row.enabled,
    status: row.status,
    revision: safeInteger(row.revision, "SCHEDULED_TASK_REVISION"),
  }
}

function outboxTaskFromRow(row: ScheduledTaskRow): ScheduledTaskOutboxTask {
  return {
    taskId: row.task_id,
    ...(row.project_id === null ? {} : { projectId: row.project_id }),
    ownerId: row.owner_id,
    title: row.title,
    prompt: row.prompt,
    frequency: row.frequency,
    time: row.task_time,
    timezone: row.timezone,
    nextRunAt: dbDate(row.next_run_at, "SCHEDULED_TASK_NEXT_RUN_INVALID"),
    ...(row.expires_at === null ? {} : { expiresAt: dbDate(row.expires_at, "SCHEDULED_TASK_EXPIRES_INVALID") }),
    autoApprove: row.auto_approve,
    enabled: row.enabled,
    status: row.status,
    revision: safeInteger(row.revision, "SCHEDULED_TASK_REVISION"),
  }
}

function requireLineage(scope: ScheduledTaskOwnerScope, lineage: ScheduledTaskMutationLineage | undefined): ScheduledTaskMutationLineage {
  if (lineage === undefined) throw new Error("SCHEDULED_TASK_LINEAGE_REQUIRED")
  if (scope.tenantId.trim() === "") throw new Error("SCHEDULED_TASK_TENANT_REQUIRED")
  if (scope.subjectId.trim() === "") throw new Error("SCHEDULED_TASK_OWNER_REQUIRED")
  assertScheduledTaskOutboxLineage(lineage)
  if (lineage.tenantId !== scope.tenantId) throw new Error("SCHEDULED_TASK_LINEAGE_TENANT_MISMATCH")
  if (lineage.actorId !== scope.subjectId) throw new Error("SCHEDULED_TASK_LINEAGE_ACTOR_MISMATCH")
  return lineage
}

function requiredIdentity(value: string, name: string): string {
  if (value.trim() === "") throw new Error(`${name}_REQUIRED`)
  return value
}

function validPositiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name}_INVALID`)
  return value
}

function commandLineageMatches(row: ScheduledTaskOutboxRow, payload: ScheduledTaskOutboxPayload, stableIdGenerator: StableIdGenerator): boolean {
  const operation = row.command_type === "scheduler.register"
    ? "register"
    : row.command_type === "scheduler.replace"
      ? "replace"
      : row.command_type === "scheduler.delete"
        ? "delete"
        : null
  if (operation === null) return false
  return payload.command_type === row.command_type
    && payload.lineage.tenant_id === row.tenant_id
    && payload.lineage.actor_id === row.actor_id
    && payload.lineage.request_id === row.request_id
    && payload.lineage.idempotency_key === row.idempotency_key
    && payload.task.task_id === row.task_id
    && payload.task.revision === safeInteger(row.aggregate_revision, "SCHEDULED_TASK_OUTBOX_REVISION")
    && scheduledTaskOutboxId(row.tenant_id, row.task_id, operation, row.idempotency_key, stableIdGenerator) === row.outbox_id
}

function claimedCommandFromRow(row: ScheduledTaskOutboxRow, stableIdGenerator: StableIdGenerator): ScheduledTaskOutboxCommand {
  if (row.status !== "leased" || row.lease_owner === null || row.lease_token === null || row.lease_until === null) {
    throw new Error("SCHEDULED_TASK_OUTBOX_LEASE_INVALID")
  }
  const payload = parseScheduledTaskOutboxPayload(row.payload)
  if (!commandLineageMatches(row, payload, stableIdGenerator)) throw new Error("SCHEDULED_TASK_OUTBOX_LINEAGE_MISMATCH")
  scheduledTaskOutboxTaskFromPayload(payload.task)
  return {
    outboxId: row.outbox_id,
    tenantId: row.tenant_id,
    taskId: row.task_id,
    commandType: row.command_type,
    payload,
    actorId: row.actor_id,
    requestId: row.request_id,
    idempotencyKey: row.idempotency_key,
    taskRevision: safeInteger(row.aggregate_revision, "SCHEDULED_TASK_OUTBOX_REVISION"),
    status: "leased",
    attemptCount: safeInteger(row.attempt_count, "SCHEDULED_TASK_OUTBOX_ATTEMPTS"),
    availableAt: dbDate(row.available_at, "SCHEDULED_TASK_OUTBOX_AVAILABLE_AT_INVALID"),
    leaseOwner: row.lease_owner,
    leaseToken: row.lease_token,
    leaseUntil: dbDate(row.lease_until, "SCHEDULED_TASK_OUTBOX_LEASE_UNTIL_INVALID"),
    fence: safeInteger(row.fence, "SCHEDULED_TASK_OUTBOX_FENCE"),
    ...(row.last_error_code === null ? {} : { lastErrorCode: row.last_error_code }),
  }
}

export class PostgresScheduledTaskRepository implements ScheduledTaskRepository, ScheduledTaskOutboxRepository {
  public constructor(
    private readonly database: PostgresBffDatabase,
    private readonly stableIdGenerator: StableIdGenerator = new Sha256StableIdGenerator(),
  ) {}

  public async listScheduledTasks(scope: ScheduledTaskOwnerScope): Promise<ScheduledTaskFact[]> {
    const result = await this.database.pool.query<ScheduledTaskRow>(
      `SELECT ${TASK_COLUMNS}
         FROM bff_scheduled_task
        WHERE tenant_id = $1 AND owner_id = $2
        ORDER BY created_at ASC, task_id ASC`,
      [scope.tenantId, scope.subjectId],
    )
    return result.rows.map(scheduledTaskFromRow)
  }

  public async findScheduledTask(scope: ScheduledTaskOwnerScope, taskId: string): Promise<ScheduledTaskFact | null> {
    const result = await this.database.pool.query<ScheduledTaskRow>(
      `SELECT ${TASK_COLUMNS}
         FROM bff_scheduled_task
        WHERE tenant_id = $1 AND owner_id = $2 AND task_id = $3`,
      [scope.tenantId, scope.subjectId, taskId],
    )
    const row = result.rows[0]
    return row === undefined ? null : scheduledTaskFromRow(row)
  }

  public async findScheduledTaskRecord(tenantId: string, taskId: string): Promise<ScheduledTaskRecord | null> {
    const result = await this.database.pool.query<ScheduledTaskRow>(
      `SELECT ${TASK_COLUMNS}
         FROM bff_scheduled_task WHERE tenant_id = $1 AND task_id = $2`,
      [tenantId, taskId],
    )
    const row = result.rows[0]
    return row === undefined ? null : { task: scheduledTaskFromRow(row), ownerId: row.owner_id }
  }

  public async createScheduledTask(
    scope: ScheduledTaskOwnerScope,
    input: ScheduledTaskCreateInput,
    requestedTaskId: string | undefined,
    lineage: ScheduledTaskMutationLineage,
  ): Promise<ScheduledTaskFact> {
    const taskLineage = requireLineage(scope, lineage)
    const taskId = requiredIdentity(requestedTaskId ?? `scheduled_${randomUUID()}`, "SCHEDULED_TASK_ID")
    return this.transaction(async (client) => {
      const commandAlreadyExists = await this.outboxExists(client, scope.tenantId, taskId, "register", taskLineage.idempotencyKey, scope.subjectId)
      if (commandAlreadyExists) {
        const existing = await this.lockedTask(client, scope, taskId)
        if (existing === null) throw new Error("SCHEDULED_TASK_CREATE_CONFLICT")
        return scheduledTaskFromRow(existing)
      }
      const ownedProjectId = input.projectId === undefined ? null : await this.ownedProjectId(client, scope, input.projectId)
      if (input.projectId !== undefined && ownedProjectId === null) {
        throw new Error("PROJECT_NOT_FOUND")
      }
      const inserted = await client.query<ScheduledTaskRow>(
        `INSERT INTO bff_scheduled_task
          (task_id, tenant_id, project_id, owner_id, title, prompt, frequency, task_time, timezone,
           next_run_at, expires_at, auto_approve, enabled, status, revision)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz, $11::timestamptz, $12, true, 'active', 1)
         ON CONFLICT (task_id) DO NOTHING
         RETURNING ${TASK_COLUMNS}`,
        [taskId, scope.tenantId, ownedProjectId, scope.subjectId, input.title, input.prompt, input.frequency, input.time, input.timezone, input.nextRunAt, input.expiresAt ?? null, input.autoApprove],
      )
      const row = inserted.rows[0]
      if (row === undefined) {
        // A concurrent request with the same deterministic task id may have
        // committed first. Re-check the command identity after the conflict
        // wait so an identical retry remains idempotent.
        if (await this.outboxExists(client, scope.tenantId, taskId, "register", taskLineage.idempotencyKey, scope.subjectId)) {
          const existing = await this.lockedTask(client, scope, taskId)
          if (existing !== null) return scheduledTaskFromRow(existing)
        }
        throw new Error("SCHEDULED_TASK_CREATE_CONFLICT")
      }
      await this.insertOutbox(client, "register", taskLineage, row)
      return scheduledTaskFromRow(row)
    })
  }

  public async updateScheduledTask(
    scope: ScheduledTaskOwnerScope,
    taskId: string,
    input: ScheduledTaskPatch,
    lineage: ScheduledTaskMutationLineage,
  ): Promise<ScheduledTaskFact | null> {
    const taskLineage = requireLineage(scope, lineage)
    return this.transaction(async (client) => {
      const current = await this.lockedTask(client, scope, taskId)
      if (current === null) return null
      if (await this.outboxExists(client, scope.tenantId, taskId, "replace", taskLineage.idempotencyKey, scope.subjectId)) {
        return scheduledTaskFromRow(current)
      }
      const updated = await client.query<ScheduledTaskRow>(
        `UPDATE bff_scheduled_task SET title = $4, prompt = $5, frequency = $6, task_time = $7,
          timezone = $8, next_run_at = $9::timestamptz, expires_at = $10::timestamptz,
          auto_approve = $11, enabled = $12, status = $13, revision = revision + 1,
          updated_at = CURRENT_TIMESTAMP(3)
         WHERE tenant_id = $1 AND owner_id = $2 AND task_id = $3
         RETURNING ${TASK_COLUMNS}`,
        [scope.tenantId, scope.subjectId, taskId, input.title ?? current.title, input.prompt ?? current.prompt, input.frequency ?? current.frequency, input.time ?? current.task_time, input.timezone ?? current.timezone, input.nextRunAt ?? dbDate(current.next_run_at, "SCHEDULED_TASK_NEXT_RUN_INVALID"), input.expiresAt === undefined ? current.expires_at : input.expiresAt, input.autoApprove ?? current.auto_approve, input.enabled ?? current.enabled, input.status ?? current.status],
      )
      const row = updated.rows[0]
      if (row === undefined) return null
      await this.insertOutbox(client, "replace", taskLineage, row)
      return scheduledTaskFromRow(row)
    })
  }

  public async deleteScheduledTask(scope: ScheduledTaskOwnerScope, taskId: string, lineage: ScheduledTaskMutationLineage): Promise<boolean> {
    const taskLineage = requireLineage(scope, lineage)
    return this.transaction(async (client) => {
      const current = await this.lockedTask(client, scope, taskId)
      if (current === null) return this.outboxExists(client, scope.tenantId, taskId, "delete", taskLineage.idempotencyKey, scope.subjectId)
      if (await this.outboxExists(client, scope.tenantId, taskId, "delete", taskLineage.idempotencyKey, scope.subjectId)) return true
      await this.insertOutbox(client, "delete", taskLineage, current)
      const deleted = await client.query(
        "DELETE FROM bff_scheduled_task WHERE tenant_id = $1 AND owner_id = $2 AND task_id = $3",
        [scope.tenantId, scope.subjectId, taskId],
      )
      return deleted.rowCount === 1
    })
  }

  public async claimScheduledTaskOutbox(input: ScheduledTaskOutboxClaimInput): Promise<ScheduledTaskOutboxCommand[]> {
    const limit = validPositiveInteger(input.limit, "SCHEDULED_TASK_OUTBOX_LIMIT")
    const leaseDurationMs = validPositiveInteger(input.leaseDurationMs, "SCHEDULED_TASK_OUTBOX_LEASE_DURATION")
    const workerId = requiredIdentity(input.workerId, "SCHEDULED_TASK_OUTBOX_WORKER_ID")
    const now = dbDate(input.now, "SCHEDULED_TASK_OUTBOX_NOW_INVALID")
    const result = await this.database.pool.query<ScheduledTaskOutboxRow>(
      `WITH candidates AS (
        SELECT candidate.outbox_id
          FROM bff_scheduled_task_outbox AS candidate
         WHERE (
           (candidate.status IN ('pending', 'retryable') AND candidate.available_at <= $1::timestamptz)
           OR (candidate.status = 'leased' AND candidate.lease_until IS NOT NULL AND candidate.lease_until <= $1::timestamptz)
         )
           AND NOT EXISTS (
             SELECT 1
               FROM bff_scheduled_task_outbox AS prior
              WHERE prior.tenant_id = candidate.tenant_id
                AND prior.task_id = candidate.task_id
                AND prior.status IN ('pending', 'retryable', 'leased')
                AND (prior.created_at, prior.outbox_id) < (candidate.created_at, candidate.outbox_id)
           )
         ORDER BY candidate.created_at ASC, candidate.outbox_id ASC
         FOR UPDATE SKIP LOCKED
         LIMIT $2
      )
      UPDATE bff_scheduled_task_outbox AS claimed
         SET status = 'leased',
             lease_owner = $3,
             lease_token = md5($4 || ':' || claimed.outbox_id),
             lease_until = $1::timestamptz + ($5 * INTERVAL '1 millisecond'),
             fence = claimed.fence + 1,
             attempt_count = claimed.attempt_count + 1,
             updated_at = CURRENT_TIMESTAMP(3)
        FROM candidates
       WHERE claimed.outbox_id = candidates.outbox_id
      RETURNING claimed.outbox_id, claimed.tenant_id, claimed.task_id, claimed.command_type,
                claimed.aggregate_revision, claimed.payload, claimed.actor_id, claimed.request_id,
                claimed.idempotency_key, claimed.status, claimed.attempt_count, claimed.available_at,
                claimed.lease_owner, claimed.lease_token, claimed.lease_until, claimed.fence,
                claimed.last_error_code`,
      [now, limit, workerId, randomUUID(), leaseDurationMs],
    )
    return result.rows.map((row) => claimedCommandFromRow(row, this.stableIdGenerator))
  }

  public async markScheduledTaskOutboxSucceeded(lease: ScheduledTaskOutboxLease, completedAt: Date): Promise<boolean> {
    assertLease(lease)
    const completedTimestamp = dbDate(completedAt, "SCHEDULED_TASK_OUTBOX_COMPLETED_AT_INVALID")
    const result = await this.database.pool.query(
      `UPDATE bff_scheduled_task_outbox
          SET status = 'succeeded', completed_at = $5::timestamptz,
              lease_owner = NULL, lease_token = NULL, lease_until = NULL,
              last_error_code = NULL, last_error_at = NULL, updated_at = CURRENT_TIMESTAMP(3)
        WHERE outbox_id = $1 AND status = 'leased' AND lease_owner = $2
          AND lease_token = $3 AND fence = $4`,
      [lease.outboxId, lease.leaseOwner, lease.leaseToken, lease.fence, completedTimestamp],
    )
    return result.rowCount === 1
  }

  public async markScheduledTaskOutboxRetryable(
    lease: ScheduledTaskOutboxLease,
    nextAttemptAt: Date,
    errorCode: string,
    failedAt: Date,
  ): Promise<boolean> {
    assertLease(lease)
    const nextAttemptTimestamp = dbDate(nextAttemptAt, "SCHEDULED_TASK_OUTBOX_NEXT_ATTEMPT_AT_INVALID")
    const failedTimestamp = dbDate(failedAt, "SCHEDULED_TASK_OUTBOX_FAILED_AT_INVALID")
    if (errorCode.trim() === "") throw new Error("SCHEDULED_TASK_OUTBOX_ERROR_CODE_REQUIRED")
    const result = await this.database.pool.query(
      `UPDATE bff_scheduled_task_outbox
          SET status = 'retryable', available_at = $5::timestamptz,
              last_error_code = $6, last_error_at = $7::timestamptz,
              completed_at = NULL,
              lease_owner = NULL, lease_token = NULL, lease_until = NULL,
              updated_at = CURRENT_TIMESTAMP(3)
        WHERE outbox_id = $1 AND status = 'leased' AND lease_owner = $2
          AND lease_token = $3 AND fence = $4`,
      [lease.outboxId, lease.leaseOwner, lease.leaseToken, lease.fence, nextAttemptTimestamp, errorCode, failedTimestamp],
    )
    return result.rowCount === 1
  }

  public async markScheduledTaskOutboxFailed(
    lease: ScheduledTaskOutboxLease,
    errorCode: string,
    failedAt: Date,
  ): Promise<boolean> {
    assertLease(lease)
    const failedTimestamp = dbDate(failedAt, "SCHEDULED_TASK_OUTBOX_FAILED_AT_INVALID")
    if (errorCode.trim() === "") throw new Error("SCHEDULED_TASK_OUTBOX_ERROR_CODE_REQUIRED")
    const result = await this.database.pool.query(
      `UPDATE bff_scheduled_task_outbox
          SET status = 'failed', last_error_code = $5, last_error_at = $6::timestamptz,
              completed_at = $6::timestamptz,
              lease_owner = NULL, lease_token = NULL, lease_until = NULL,
              updated_at = CURRENT_TIMESTAMP(3)
        WHERE outbox_id = $1 AND status = 'leased' AND lease_owner = $2
          AND lease_token = $3 AND fence = $4`,
      [lease.outboxId, lease.leaseOwner, lease.leaseToken, lease.fence, errorCode, failedTimestamp],
    )
    return result.rowCount === 1
  }

  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.database.pool.connect()
    try {
      await client.query("BEGIN")
      const result = await work(client)
      await client.query("COMMIT")
      return result
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  private async ownedProjectId(client: PoolClient, scope: ScheduledTaskOwnerScope, idOrSlug: string): Promise<string | null> {
    const result = await client.query<{ project_id: string }>(
      `SELECT project_id FROM bff_project
        WHERE tenant_id = $1 AND owner_id = $2 AND (project_id = $3 OR slug = $3)
        LIMIT 1 FOR SHARE`,
      [scope.tenantId, scope.subjectId, idOrSlug],
    )
    return result.rows[0]?.project_id ?? null
  }

  private async lockedTask(client: PoolClient, scope: ScheduledTaskOwnerScope, taskId: string): Promise<ScheduledTaskRow | null> {
    const result = await client.query<ScheduledTaskRow>(
      `SELECT ${TASK_COLUMNS}
         FROM bff_scheduled_task WHERE tenant_id = $1 AND owner_id = $2 AND task_id = $3 FOR UPDATE`,
      [scope.tenantId, scope.subjectId, taskId],
    )
    return result.rows[0] ?? null
  }

  private async outboxExists(
    client: PoolClient,
    tenantId: string,
    taskId: string,
    operation: ScheduledTaskOutboxOperation,
    idempotencyKey: string,
    actorId: string,
  ): Promise<boolean> {
    const result = await client.query<{ outbox_id: string }>(
      `SELECT outbox_id FROM bff_scheduled_task_outbox
        WHERE tenant_id = $1 AND task_id = $2 AND command_type = $3 AND idempotency_key = $4 AND actor_id = $5
        LIMIT 1`,
      [tenantId, taskId, commandType(operation), idempotencyKey, actorId],
    )
    return result.rows[0] !== undefined
  }

  private async insertOutbox(
    client: PoolClient,
    operation: ScheduledTaskOutboxOperation,
    lineage: ScheduledTaskMutationLineage,
    row: ScheduledTaskRow,
  ): Promise<void> {
    const payload = buildScheduledTaskOutboxPayload(operation, lineage, outboxTaskFromRow(row))
    const result = await client.query(
      `INSERT INTO bff_scheduled_task_outbox
        (outbox_id, tenant_id, task_id, command_type, aggregate_revision, payload,
         actor_id, request_id, idempotency_key, status, attempt_count, available_at, fence)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, 'pending', 0, CURRENT_TIMESTAMP(3), 0)
       `,
      [
        scheduledTaskOutboxId(row.tenant_id, row.task_id, operation, lineage.idempotencyKey, this.stableIdGenerator),
        row.tenant_id,
        row.task_id,
        commandType(operation),
        row.revision,
        JSON.stringify(payload),
        lineage.actorId,
        lineage.requestId,
        lineage.idempotencyKey,
      ],
    )
    if (result.rowCount !== 1) throw new Error("SCHEDULED_TASK_OUTBOX_INSERT_FAILED")
  }
}

function assertLease(lease: ScheduledTaskOutboxLease): void {
  requiredIdentity(lease.outboxId, "SCHEDULED_TASK_OUTBOX_ID")
  requiredIdentity(lease.leaseOwner, "SCHEDULED_TASK_OUTBOX_LEASE_OWNER")
  requiredIdentity(lease.leaseToken, "SCHEDULED_TASK_OUTBOX_LEASE_TOKEN")
  if (!Number.isSafeInteger(lease.fence) || lease.fence < 1) throw new Error("SCHEDULED_TASK_OUTBOX_FENCE_INVALID")
}
