import { retireUnsentScheduledDefinition } from "./scheduled-definition-fence.js"
import { lockProjectForEdit, projectReadPredicate, projectEditPredicate } from "./project-access.js"
import { scheduledExecutionBinding } from "../../domain/scheduled-task/execution-binding.js"
import { calendarFromWire, calendarWire, freezeCalendar, type ScheduledCalendar, type ScheduledTaskFrequency } from "../../domain/scheduled-task/calendar.js"
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
import { utcDate, type ScheduledTaskFact, type ScheduledTaskMutationSnapshot } from "../../domain/scheduled-task/task.js"
import type { ScheduledTaskOutboxClaimInput, ScheduledTaskOutboxRepository } from "../../application/scheduled/scheduled-task-outbox-repository.js"
import type {
  ScheduledTaskCreateInput,
  ScheduledTaskMutationLineage,
  ScheduledTaskUpdateLineage,
  ScheduledTaskOwnerScope,
  ScheduledTaskPatch,
  ScheduledTaskRecord,
  ScheduledTaskReadSnapshot,
} from "../../application/scheduled/task-facts.js"
import type { PostgresBffDatabase } from "./client.js"
import { scheduledTaskOutboxId } from "../identifiers/scheduled-task-outbox-id.js"

type ScheduledTaskRow = {
  task_id: string
  tenant_id: string
  project_id: string | null
  owner_id: string
  execution_actor_id: string | null
  title: string
  prompt: string
  frequency: ScheduledTaskFrequency
  task_time: string
  timezone: string
  weekdays: number[] | null
  month_days: number[] | null
  local_date: string | null
  run_at: Date | string | null
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

type ScheduledTaskBindingRow = {
  project_id: string | null
}

type ScheduledTaskProjectRow = {
  deleted_at: Date | string | null
}

const TASK_COLUMNS = `task_id, tenant_id, project_id, owner_id, execution_actor_id, title, prompt, frequency, task_time, timezone,
              weekdays, month_days, to_char(local_date, 'YYYY-MM-DD') AS local_date, run_at, expires_at, auto_approve, enabled, status, revision, created_at, updated_at`

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
    ownerId: row.owner_id,
    executionActorId: row.execution_actor_id,
    ...(row.project_id === null ? {} : { projectId: row.project_id }),
    title: row.title,
    prompt: row.prompt,
    ...storedCalendar(row),
    ...(row.expires_at === null
      ? {}
      : {
          expiresAt: dbDate(row.expires_at, "SCHEDULED_TASK_EXPIRES_INVALID"),
        }),
    autoApprove: row.auto_approve,
    enabled: row.enabled,
    status: row.status,
    revision: safeInteger(row.revision, "SCHEDULED_TASK_REVISION"),
  }
}

function scheduledTaskMutationFromRow(row: ScheduledTaskRow): ScheduledTaskMutationSnapshot {
  const { ownerId: _ownerId, executionActorId: _executionActorId, ...snapshot } = scheduledTaskFromRow(row)
  return snapshot
}

function storedCalendar(row: ScheduledTaskRow): ScheduledCalendar {
  const calendar = calendarFromWire({
    frequency: row.frequency,
    time: row.task_time,
    timezone: row.timezone,
    ...(row.weekdays === null ? {} : { weekdays: row.weekdays }),
    ...(row.month_days === null ? {} : { month_days: row.month_days }),
    ...(row.local_date === null ? {} : { local_date: row.local_date }),
  })
  if (calendar === null || (row.frequency === "once") !== (row.run_at !== null)) throw new Error("SCHEDULED_TASK_CALENDAR_INVALID")
  return {
    ...calendar,
    ...(row.run_at === null ? {} : { runAt: dbDate(row.run_at, "SCHEDULED_TASK_RUN_AT_INVALID") }),
  }
}

function newCalendar(input: ScheduledCalendar, now: Date, currentRunAt?: Date): ScheduledCalendar {
  const parsed = calendarFromWire(calendarWire(input))
  if (parsed === null) throw new Error("SCHEDULED_TASK_CALENDAR_INVALID")
  const calendar = freezeCalendar(parsed)
  if (calendar.runAt !== undefined && calendar.runAt.getTime() !== currentRunAt?.getTime() && calendar.runAt.getTime() <= now.getTime())
    throw new Error("SCHEDULED_TASK_ONCE_NOT_FUTURE")
  return calendar
}

function outboxTaskFromRow(row: ScheduledTaskRow): ScheduledTaskOutboxTask {
  const { id, ...task } = scheduledTaskMutationFromRow(row)
  return { ...task, taskId: id, ownerId: row.owner_id }
}

async function insertScheduledTaskOutbox(
  client: PoolClient,
  operation: ScheduledTaskOutboxOperation,
  lineage: ScheduledTaskMutationLineage,
  row: ScheduledTaskRow,
): Promise<void> {
  const payload = buildScheduledTaskOutboxPayload(operation, lineage, outboxTaskFromRow(row))
  const result = await client.query(
    `INSERT INTO bff_scheduled_task_outbox
      (outbox_id,tenant_id,task_id,command_type,aggregate_revision,payload,actor_id,request_id,idempotency_key,status,attempt_count,available_at,fence)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,'pending',0,CURRENT_TIMESTAMP(3),0)`,
    [
      scheduledTaskOutboxId(row.tenant_id, row.task_id, operation, lineage.idempotencyKey, lineage.actorId),
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

export async function pauseProjectScheduledTasks(
  client: PoolClient,
  scope: ScheduledTaskOwnerScope,
  projectId: string,
  requestId: string,
  deletionKey: string,
): Promise<void> {
  const tasks = await client.query<ScheduledTaskRow>(
    `SELECT ${TASK_COLUMNS} FROM bff_scheduled_task WHERE tenant_id=$1 AND project_id=$2 ORDER BY task_id FOR UPDATE`,
    [scope.tenantId, projectId],
  )
  for (const task of tasks.rows) {
    const updated = await client.query<ScheduledTaskRow>(
      `UPDATE bff_scheduled_task SET enabled=FALSE,status='paused',execution_actor_id=NULL,revision=revision+1,updated_at=CURRENT_TIMESTAMP(3) WHERE tenant_id=$1 AND task_id=$2 RETURNING ${TASK_COLUMNS}`,
      [scope.tenantId, task.task_id],
    )
    const row = updated.rows[0]
    if (row === undefined) throw new Error("PROJECT_DELETE_TASK_UPDATE_FAILED")
    await retireUnsentScheduledDefinition(client, scope.tenantId, task.task_id, Number(row.revision))
    await insertScheduledTaskOutbox(
      client,
      "replace",
      {
        tenantId: scope.tenantId,
        actorId: scope.subjectId,
        requestId,
        idempotencyKey: `project-delete:${projectId}:${deletionKey}:${task.task_id}`,
      },
      row,
    )
  }
}

function requireLineage(scope: ScheduledTaskOwnerScope, lineage: ScheduledTaskMutationLineage | undefined): ScheduledTaskMutationLineage {
  if (lineage === undefined) throw new Error("SCHEDULED_TASK_LINEAGE_REQUIRED")
  if (scope.tenantId.trim() === "") throw new Error("SCHEDULED_TASK_TENANT_REQUIRED")
  if (scope.subjectId.trim() === "") throw new Error("SCHEDULED_TASK_OWNER_REQUIRED")
  const confirmed = {
    tenantId: lineage.tenantId,
    actorId: lineage.actorId,
    requestId: lineage.requestId,
    idempotencyKey: lineage.idempotencyKey,
  }
  assertScheduledTaskOutboxLineage(confirmed)
  if (lineage.tenantId !== scope.tenantId) throw new Error("SCHEDULED_TASK_LINEAGE_TENANT_MISMATCH")
  if (lineage.actorId !== scope.subjectId) throw new Error("SCHEDULED_TASK_LINEAGE_ACTOR_MISMATCH")
  return confirmed
}

function requiredIdentity(value: string, name: string): string {
  if (value.trim() === "") throw new Error(`${name}_REQUIRED`)
  return value
}

function validPositiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name}_INVALID`)
  return value
}

function commandLineageMatches(
  row: Pick<
    ScheduledTaskOutboxRow,
    "outbox_id" | "tenant_id" | "task_id" | "command_type" | "aggregate_revision" | "actor_id" | "request_id" | "idempotency_key"
  >,
  payload: ScheduledTaskOutboxPayload,
): boolean {
  const operation =
    row.command_type === "scheduler.register"
      ? "register"
      : row.command_type === "scheduler.replace"
        ? "replace"
        : row.command_type === "scheduler.delete"
          ? "delete"
          : null
  if (operation === null) return false
  return (
    payload.command_type === row.command_type &&
    payload.lineage.tenant_id === row.tenant_id &&
    payload.lineage.actor_id === row.actor_id &&
    payload.lineage.request_id === row.request_id &&
    payload.lineage.idempotency_key === row.idempotency_key &&
    payload.task.task_id === row.task_id &&
    payload.task.revision === safeInteger(row.aggregate_revision, "SCHEDULED_TASK_OUTBOX_REVISION") &&
    /^scheduled_outbox_[0-9a-f]{32}$/u.test(row.outbox_id)
  )
}

function claimedCommandFromRow(row: ScheduledTaskOutboxRow): ScheduledTaskOutboxCommand {
  if (row.status !== "leased" || row.lease_owner === null || row.lease_token === null || row.lease_until === null) {
    throw new Error("SCHEDULED_TASK_OUTBOX_LEASE_INVALID")
  }
  const payload = parseScheduledTaskOutboxPayload(row.payload)
  if (!commandLineageMatches(row, payload)) throw new Error("SCHEDULED_TASK_OUTBOX_LINEAGE_MISMATCH")
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

export class PostgresScheduledTaskRepository implements ScheduledTaskOutboxRepository {
  public constructor(
    private readonly database: PostgresBffDatabase,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /** One owner-local snapshot, with cancellation of pool acquisition and blocked reads. */
  public async readScheduledTaskSnapshots(scope: ScheduledTaskOwnerScope, signal: AbortSignal, taskId?: string): Promise<ScheduledTaskReadSnapshot[]> {
    signal.throwIfAborted()
    let client: PoolClient | undefined
    let released = false
    const release = (destroy: boolean): void => {
      if (client !== undefined && !released) {
        released = true
        client.release(destroy)
      }
    }
    let cancel: (() => void) | undefined
    const aborted = new Promise<never>((_resolve, reject) => {
      cancel = (): void => {
        release(true)
        reject(Error("scheduled_task_read_cancelled"))
      }
      signal.addEventListener("abort", cancel, { once: true })
    })
    const acquisition = this.database.pool.connect().then((value) => {
      client = value
      if (signal.aborted) release(true)
      return value
    })
    try {
      await Promise.race([acquisition, aborted])
      signal.throwIfAborted()
      const result = await Promise.race([
        client!.query<
          ScheduledTaskRow & {
            delivery_status: ScheduledTaskOutboxStatus | null
            project_available: boolean
          }
        >(
          `SELECT ${TASK_COLUMNS},
                (SELECT o.status FROM bff_scheduled_task_outbox o
                  WHERE o.tenant_id = t.tenant_id AND o.task_id = t.task_id
                    AND o.aggregate_revision = t.revision
                    AND o.command_type IN ('scheduler.register', 'scheduler.replace')
                  ORDER BY o.created_at DESC, o.outbox_id DESC LIMIT 1) AS delivery_status,
                (t.project_id IS NULL OR EXISTS
                  (SELECT 1 FROM bff_project p WHERE p.project_id = t.project_id
                    AND p.tenant_id = t.tenant_id AND p.deleted_at IS NULL)) AS project_available
           FROM bff_scheduled_task t
          WHERE t.tenant_id = $1 AND ($3::text IS NULL OR t.task_id = $3)
            AND ((t.project_id IS NULL AND t.owner_id=$2) OR EXISTS (
              SELECT 1 FROM bff_project WHERE bff_project.tenant_id=t.tenant_id
                AND bff_project.project_id=t.project_id AND bff_project.deleted_at IS NULL AND ${projectReadPredicate}))
          ORDER BY t.created_at ASC, t.task_id ASC`,
          [scope.tenantId, scope.subjectId, taskId ?? null],
        ),
        aborted,
      ])
      signal.throwIfAborted()
      return result.rows.map((row) => ({
        task: scheduledTaskFromRow(row),
        deliveryStatus: row.delivery_status,
        projectAvailable: row.project_available,
      }))
    } finally {
      if (cancel !== undefined) signal.removeEventListener("abort", cancel)
      release(signal.aborted)
    }
  }

  public async findScheduledTask(scope: ScheduledTaskOwnerScope, taskId: string): Promise<ScheduledTaskFact | null> {
    const result = await this.database.pool.query<ScheduledTaskRow>(
      `SELECT ${TASK_COLUMNS}
         FROM bff_scheduled_task t
        WHERE tenant_id = $1 AND task_id = $3 AND ((project_id IS NULL AND owner_id=$2) OR EXISTS (
          SELECT 1 FROM bff_project WHERE bff_project.tenant_id=t.tenant_id AND bff_project.project_id=t.project_id
            AND bff_project.deleted_at IS NULL AND ${projectReadPredicate}))`,
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
  ): Promise<ScheduledTaskMutationSnapshot> {
    const taskLineage = requireLineage(scope, lineage)
    const taskId = requiredIdentity(requestedTaskId ?? `scheduled_${randomUUID()}`, "SCHEDULED_TASK_ID")
    return this.transaction(async (client) => {
      const original = await this.commandSnapshot(client, scope, taskId, "register", taskLineage.idempotencyKey)
      if (original) return original
      const ownedProjectId = input.projectId === undefined ? null : await this.ownedProjectId(client, scope, input.projectId)
      if (input.projectId !== undefined && ownedProjectId === null) {
        throw new Error("PROJECT_NOT_FOUND")
      }
      const calendar = newCalendar(input, this.clock())
      const inserted = await client.query<ScheduledTaskRow>(
        `INSERT INTO bff_scheduled_task
          (task_id, tenant_id, project_id, owner_id, execution_actor_id, title, prompt, frequency, task_time, timezone,
           weekdays, month_days, local_date, run_at, expires_at, auto_approve, enabled, status, revision)
         VALUES ($1, $2, $3, $4, $4, $5, $6, $7, $8, $9, $10::smallint[], $11::smallint[], $12::date, $13::timestamptz, $14::timestamptz, $15, true, 'active', 1)
         ON CONFLICT (task_id) DO NOTHING
         RETURNING ${TASK_COLUMNS}`,
        [
          taskId,
          scope.tenantId,
          ownedProjectId,
          scope.subjectId,
          input.title,
          input.prompt,
          calendar.frequency,
          calendar.time,
          calendar.timezone,
          calendar.weekdays ?? null,
          calendar.monthDays ?? null,
          calendar.localDate ?? null,
          calendar.runAt ?? null,
          input.expiresAt ?? null,
          input.autoApprove,
        ],
      )
      const row = inserted.rows[0]
      if (row === undefined) {
        // A concurrent request with the same deterministic task id may have
        // committed first. Re-check the command identity after the conflict
        // wait so an identical retry remains idempotent.
        const original = await this.commandSnapshot(client, scope, taskId, "register", taskLineage.idempotencyKey)
        if (original) return original
        throw new Error("SCHEDULED_TASK_CREATE_CONFLICT")
      }
      await this.insertOutbox(client, "register", taskLineage, row)
      return scheduledTaskMutationFromRow(row)
    })
  }

  public async updateScheduledTask(
    scope: ScheduledTaskOwnerScope,
    taskId: string,
    input: ScheduledTaskPatch,
    lineage: ScheduledTaskUpdateLineage,
  ): Promise<ScheduledTaskMutationSnapshot | null> {
    const taskLineage = requireLineage(scope, lineage)
    return this.transaction(async (client) => {
      const binding = await this.taskBinding(client, scope, taskId)
      if (binding === undefined) return null
      const project = binding.project_id === null ? null : await this.lockedProject(client, scope, binding.project_id)
      if (binding.project_id !== null && project === null) throw new Error("PROJECT_NOT_FOUND")
      const current = await this.lockedTask(client, scope, taskId)
      if (current === null) return null
      if (current.project_id !== binding.project_id) throw new Error("PROJECT_NOT_FOUND")
      const original = await this.commandSnapshot(client, scope, taskId, "replace", taskLineage.idempotencyKey)
      if (original) return original
      if (project !== null && project.deleted_at !== null) throw new Error("PROJECT_NOT_FOUND")
      if (
        !Number.isSafeInteger(lineage.expectedRevision) ||
        lineage.expectedRevision < 1 ||
        lineage.expectedRevision >= Number.MAX_SAFE_INTEGER ||
        Number(current.revision) !== lineage.expectedRevision
      )
        throw Error("SCHEDULED_TASK_PRECONDITION_FAILED")
      const executionChanged = Object.keys(input).some((key) => key !== "title")
      const execution = scheduledExecutionBinding(
        {
          executionActorId: current.execution_actor_id,
          enabled: current.enabled,
          status: current.status,
        },
        scope.subjectId,
        input,
        executionChanged,
      )
      const changedRule = ["frequency", "time", "timezone", "weekdays", "monthDays", "localDate", "runAt"].some((field) => Object.hasOwn(input, field))
      const priorCalendar = storedCalendar(current)
      const calendar = changedRule ? newCalendar(input as ScheduledCalendar, this.clock(), priorCalendar.runAt) : priorCalendar
      const updated = await client.query<ScheduledTaskRow>(
        `UPDATE bff_scheduled_task SET title = $3, prompt = $4, frequency = $5, task_time = $6,
          timezone = $7, weekdays = $8::smallint[], month_days = $9::smallint[], local_date = $10::date, run_at = $11::timestamptz, expires_at = $12::timestamptz,
          auto_approve = $13, enabled = $14, status = $15, execution_actor_id=$16, revision = revision + 1,
          updated_at = CURRENT_TIMESTAMP(3)
         WHERE tenant_id = $1 AND task_id = $2
         RETURNING ${TASK_COLUMNS}`,
        [
          scope.tenantId,
          taskId,
          input.title ?? current.title,
          input.prompt ?? current.prompt,
          calendar.frequency,
          calendar.time,
          calendar.timezone,
          calendar.weekdays ?? null,
          calendar.monthDays ?? null,
          calendar.localDate ?? null,
          calendar.runAt ?? null,
          input.expiresAt === undefined ? current.expires_at : input.expiresAt,
          input.autoApprove ?? current.auto_approve,
          execution.enabled,
          execution.status,
          execution.executionActorId,
        ],
      )
      const row = updated.rows[0]
      if (row === undefined) return null
      await retireUnsentScheduledDefinition(client, scope.tenantId, taskId, Number(row.revision))
      await this.insertOutbox(client, "replace", taskLineage, row)
      return scheduledTaskMutationFromRow(row)
    })
  }

  public hasCommittedDelete(scope: ScheduledTaskOwnerScope, taskId: string, key: string): Promise<boolean> {
    return this.outboxExists(this.database.pool, scope.tenantId, taskId, "delete", key, scope.subjectId)
  }

  public async deleteScheduledTask(scope: ScheduledTaskOwnerScope, taskId: string, lineage: ScheduledTaskMutationLineage): Promise<boolean> {
    const taskLineage = requireLineage(scope, lineage)
    return this.transaction(async (client) => {
      const binding = await this.taskBinding(client, scope, taskId)
      if (binding?.project_id) {
        if ((await this.lockedProject(client, scope, binding.project_id)) === null) throw Error("PROJECT_NOT_FOUND")
      }
      const current = await this.lockedTask(client, scope, taskId)
      if (current === null) return this.outboxExists(client, scope.tenantId, taskId, "delete", taskLineage.idempotencyKey, scope.subjectId)
      if (await this.outboxExists(client, scope.tenantId, taskId, "delete", taskLineage.idempotencyKey, scope.subjectId)) return true
      await retireUnsentScheduledDefinition(client, scope.tenantId, taskId, null)
      await this.insertOutbox(client, "delete", taskLineage, current)
      const deleted = await client.query("DELETE FROM bff_scheduled_task WHERE tenant_id = $1 AND task_id = $2", [scope.tenantId, taskId])
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
    return result.rows.map((row) => claimedCommandFromRow(row))
  }

  public async markScheduledTaskOutboxSucceeded(lease: ScheduledTaskOutboxLease, completedAt: Date): Promise<boolean> {
    assertLease(lease)
    const completedTimestamp = dbDate(completedAt, "SCHEDULED_TASK_OUTBOX_COMPLETED_AT_INVALID")
    const settled = await this.database.pool.query(
      `UPDATE bff_scheduled_task_outbox
          SET status = 'succeeded', completed_at = $5::timestamptz,
              lease_owner = NULL, lease_token = NULL, lease_until = NULL,
              last_error_code = NULL, last_error_at = NULL, updated_at = CURRENT_TIMESTAMP(3)
        WHERE outbox_id = $1 AND status = 'leased' AND lease_owner = $2
          AND lease_token = $3 AND fence = $4`,
      [lease.outboxId, lease.leaseOwner, lease.leaseToken, lease.fence, completedTimestamp],
    )
    return settled.rowCount === 1
  }

  public async markScheduledTaskOutboxRetryable(lease: ScheduledTaskOutboxLease, nextAttemptAt: Date, errorCode: string, failedAt: Date): Promise<boolean> {
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

  public async markScheduledTaskOutboxFailed(lease: ScheduledTaskOutboxLease, errorCode: string, failedAt: Date): Promise<boolean> {
    assertLease(lease)
    const failedTimestamp = dbDate(failedAt, "SCHEDULED_TASK_OUTBOX_FAILED_AT_INVALID")
    if (errorCode.trim() === "") throw new Error("SCHEDULED_TASK_OUTBOX_ERROR_CODE_REQUIRED")
    return this.transaction(async (client) => {
      const command = await client.query<ScheduledTaskOutboxRow>(
        `SELECT outbox_id, tenant_id, task_id, command_type, aggregate_revision, payload,
                actor_id, request_id, idempotency_key, status, attempt_count, available_at,
                lease_owner, lease_token, lease_until, fence, last_error_code
           FROM bff_scheduled_task_outbox
          WHERE outbox_id = $1 AND status = 'leased' AND lease_owner = $2
            AND lease_token = $3 AND fence = $4
          FOR UPDATE`,
        [lease.outboxId, lease.leaseOwner, lease.leaseToken, lease.fence],
      )
      const row = command.rows[0]
      if (row === undefined) return false
      if (row.command_type === "scheduler.register" || row.command_type === "scheduler.replace") {
        await client.query(
          `UPDATE bff_scheduled_task
              SET status = 'failed', updated_at = CURRENT_TIMESTAMP(3)
            WHERE tenant_id = $1 AND task_id = $2 AND revision = $3
              AND enabled AND status = 'active'`,
          [row.tenant_id, row.task_id, safeInteger(row.aggregate_revision, "SCHEDULED_TASK_OUTBOX_REVISION")],
        )
      }
      const settled = await client.query(
        `UPDATE bff_scheduled_task_outbox
            SET status = 'failed', last_error_code = $5, last_error_at = $6::timestamptz,
                completed_at = $6::timestamptz,
                lease_owner = NULL, lease_token = NULL, lease_until = NULL,
                updated_at = CURRENT_TIMESTAMP(3)
          WHERE outbox_id = $1 AND status = 'leased' AND lease_owner = $2
            AND lease_token = $3 AND fence = $4`,
        [lease.outboxId, lease.leaseOwner, lease.leaseToken, lease.fence, errorCode, failedTimestamp],
      )
      return settled.rowCount === 1
    })
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
    const access = await lockProjectForEdit(client, scope, idOrSlug)
    if (access.kind === "forbidden") throw Error("SCHEDULED_TASK_EDIT_FORBIDDEN")
    return access.kind === "editable" ? access.projectId : null
  }

  private async lockedTask(client: PoolClient, scope: ScheduledTaskOwnerScope, taskId: string): Promise<ScheduledTaskRow | null> {
    const result = await client.query<ScheduledTaskRow>(
      `SELECT ${TASK_COLUMNS}
         FROM bff_scheduled_task t WHERE tenant_id = $1 AND task_id = $3
           AND ((project_id IS NULL AND owner_id=$2) OR EXISTS (
             SELECT 1 FROM bff_project WHERE bff_project.tenant_id=t.tenant_id AND bff_project.project_id=t.project_id
               AND bff_project.deleted_at IS NULL AND ${projectEditPredicate})) FOR UPDATE`,
      [scope.tenantId, scope.subjectId, taskId],
    )
    return result.rows[0] ?? null
  }

  private async taskBinding(client: PoolClient, scope: ScheduledTaskOwnerScope, taskId: string): Promise<ScheduledTaskBindingRow | undefined> {
    const result = await client.query<ScheduledTaskBindingRow>(
      `SELECT project_id
         FROM bff_scheduled_task
        WHERE tenant_id = $1 AND task_id = $2`,
      [scope.tenantId, taskId],
    )
    return result.rows[0]
  }

  private async lockedProject(client: PoolClient, scope: ScheduledTaskOwnerScope, projectId: string): Promise<ScheduledTaskProjectRow | null> {
    const access = await lockProjectForEdit(client, scope, projectId)
    if (access.kind === "forbidden") throw Error("SCHEDULED_TASK_EDIT_FORBIDDEN")
    return access.kind === "editable" ? { deleted_at: null } : null
  }

  private async commandSnapshot(
    client: PoolClient,
    scope: ScheduledTaskOwnerScope,
    taskId: string,
    operation: ScheduledTaskOutboxOperation,
    key: string,
  ): Promise<ScheduledTaskMutationSnapshot | null> {
    const row = (
      await client.query<
        Pick<
          ScheduledTaskOutboxRow,
          "outbox_id" | "tenant_id" | "task_id" | "command_type" | "aggregate_revision" | "actor_id" | "request_id" | "idempotency_key" | "payload"
        >
      >(
        `SELECT outbox_id,tenant_id,task_id,command_type,aggregate_revision,actor_id,request_id,idempotency_key,payload
        FROM bff_scheduled_task_outbox WHERE tenant_id=$1 AND task_id=$2 AND command_type=$3 AND actor_id=$4 AND idempotency_key=$5`,
        [scope.tenantId, taskId, commandType(operation), scope.subjectId, key],
      )
    ).rows[0]
    if (!row) return null
    const payload = parseScheduledTaskOutboxPayload(row.payload)
    if (!commandLineageMatches(row, payload)) throw Error("SCHEDULED_TASK_OUTBOX_LINEAGE_MISMATCH")
    const { taskId: id, ownerId: _ownerId, ...snapshot } = scheduledTaskOutboxTaskFromPayload(payload.task)
    return { id, ...snapshot }
  }

  private async outboxExists(
    client: Pick<PoolClient, "query">,
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
    await insertScheduledTaskOutbox(client, operation, lineage, row)
  }
}

function assertLease(lease: ScheduledTaskOutboxLease): void {
  requiredIdentity(lease.outboxId, "SCHEDULED_TASK_OUTBOX_ID")
  requiredIdentity(lease.leaseOwner, "SCHEDULED_TASK_OUTBOX_LEASE_OWNER")
  requiredIdentity(lease.leaseToken, "SCHEDULED_TASK_OUTBOX_LEASE_TOKEN")
  if (!Number.isSafeInteger(lease.fence) || lease.fence < 1) throw new Error("SCHEDULED_TASK_OUTBOX_FENCE_INVALID")
}
