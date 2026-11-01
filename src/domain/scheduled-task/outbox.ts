import { canonicalEpoch, triggerFromWire, triggerWire, type ScheduledTrigger } from "./trigger.js"
import { isRecord } from "../json.js"
import { parseUtcTimestamp, utcDate, type ScheduledTaskStatus } from "./task.js"

export const SCHEDULED_TASK_OUTBOX_SCHEMA_VERSION = 5 as const

export type ScheduledTaskOutboxOperation = "register" | "replace" | "delete"
export type ScheduledTaskOutboxCommandType = `scheduler.${ScheduledTaskOutboxOperation}`
export type ScheduledTaskOutboxStatus = "pending" | "leased" | "retryable" | "succeeded" | "failed"

export type ScheduledTaskOutboxLineage = {
  tenantId: string
  actorId: string
  requestId: string
  idempotencyKey: string
}

/** Internal command snapshot. Instants are aware UTC Date values. */
export type ScheduledTaskOutboxTask = ScheduledTrigger & {
  triggerEpoch: string
  taskId: string
  projectId?: string
  ownerId: string
  title: string
  prompt: string
  expiresAt?: Date
  autoApprove: boolean
  enabled: boolean
  status: ScheduledTaskStatus
  revision: number
}

/** JSONB/HTTP representation. This is the explicit wire boundary. */
export type ScheduledTaskOutboxTaskWire = {
  task_id: string
  project_id?: string
  owner_id: string
  title: string
  prompt: string
  trigger_kind: "calendar" | "rss"
  trigger_epoch: string
  feed_url?: string
  conditions?: import("./rss-conditions.js").RssConditionGroups
  frequency?: "daily" | "weekly" | "monthly" | "once"
  time?: string
  timezone?: string
  weekdays?: number[]
  month_days?: number[]
  local_date?: string
  run_at?: string
  expires_at?: string
  auto_approve: boolean
  enabled: boolean
  status: ScheduledTaskStatus
  revision: number
}

export type ScheduledTaskOutboxPayload = {
  schema_version: typeof SCHEDULED_TASK_OUTBOX_SCHEMA_VERSION
  command_type: ScheduledTaskOutboxCommandType
  lineage: {
    tenant_id: string
    actor_id: string
    request_id: string
    idempotency_key: string
  }
  task: ScheduledTaskOutboxTaskWire
}

export type ScheduledTaskOutboxLease = {
  outboxId: string
  leaseOwner: string
  leaseToken: string
  fence: number
}

export type ScheduledTaskOutboxCommand = ScheduledTaskOutboxLease & {
  tenantId: string
  taskId: string
  commandType: ScheduledTaskOutboxCommandType
  payload: ScheduledTaskOutboxPayload
  actorId: string
  requestId: string
  idempotencyKey: string
  taskRevision: number
  status: "leased"
  attemptCount: number
  availableAt: Date
  leaseUntil: Date
  lastErrorCode?: string
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  if (typeof value !== "string" || value.trim() === "") throw new Error(`SCHEDULED_TASK_OUTBOX_${key.toUpperCase()}_INVALID`)
  return value.trim()
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  if (value === undefined) return undefined
  if (typeof value !== "string" || value.trim() === "") throw new Error(`SCHEDULED_TASK_OUTBOX_${key.toUpperCase()}_INVALID`)
  return value.trim()
}

function requiredBoolean(record: Record<string, unknown>, key: string): boolean {
  const value = record[key]
  if (typeof value !== "boolean") throw new Error(`SCHEDULED_TASK_OUTBOX_${key.toUpperCase()}_INVALID`)
  return value
}

function requiredRevision(record: Record<string, unknown>, key: string): number {
  const value = record[key]
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new Error(`SCHEDULED_TASK_OUTBOX_${key.toUpperCase()}_INVALID`)
  return value
}

function requiredChoice<T extends string>(record: Record<string, unknown>, key: string, choices: readonly T[]): T {
  const value = record[key]
  const choice = choices.find((candidate) => candidate === value)
  if (choice === undefined) throw new Error(`SCHEDULED_TASK_OUTBOX_${key.toUpperCase()}_INVALID`)
  return choice
}

function requiredTimestamp(record: Record<string, unknown>, key: string): string {
  const value = requiredString(record, key)
  const canonical = parseUtcTimestamp(value, `SCHEDULED_TASK_OUTBOX_${key.toUpperCase()}_INVALID`).toISOString()
  if (record[key] !== canonical) throw new Error(`SCHEDULED_TASK_OUTBOX_${key.toUpperCase()}_INVALID`)
  return canonical
}

function validateTask(task: ScheduledTaskOutboxTask): void {
  if (task.taskId.trim() === "" || task.ownerId.trim() === "" || task.title.trim() === "" || task.prompt.trim() === "") {
    throw new Error("SCHEDULED_TASK_OUTBOX_TASK_INVALID")
  }
  canonicalEpoch(task.triggerEpoch)
  if (triggerFromWire(triggerWire(task)) === null) throw Error("SCHEDULED_TASK_OUTBOX_TRIGGER_INVALID")
  if (task.expiresAt !== undefined) utcDate(task.expiresAt, "SCHEDULED_TASK_OUTBOX_EXPIRES_INVALID")
  if (!Number.isSafeInteger(task.revision) || task.revision < 1) throw new Error("SCHEDULED_TASK_OUTBOX_REVISION_INVALID")
}

function wireTask(task: ScheduledTaskOutboxTask): ScheduledTaskOutboxTaskWire {
  validateTask(task)
  return {
    task_id: task.taskId,
    ...(task.projectId === undefined ? {} : { project_id: task.projectId }),
    owner_id: task.ownerId,
    title: task.title,
    prompt: task.prompt,
    ...triggerWire(task),
    ...(task.triggerKind === "calendar" && task.frequency === "once"
      ? { run_at: utcDate(task.runAt as Date, "SCHEDULED_TASK_OUTBOX_RUN_AT_INVALID").toISOString() }
      : {}),
    trigger_kind: task.triggerKind,
    trigger_epoch: canonicalEpoch(task.triggerEpoch),
    ...(task.expiresAt === undefined ? {} : { expires_at: utcDate(task.expiresAt, "SCHEDULED_TASK_OUTBOX_EXPIRES_INVALID").toISOString() }),
    auto_approve: task.autoApprove,
    enabled: task.enabled,
    status: task.status,
    revision: task.revision,
  }
}

export function commandType(operation: ScheduledTaskOutboxOperation): ScheduledTaskOutboxCommandType {
  return `scheduler.${operation}`
}

export function assertScheduledTaskOutboxLineage(lineage: ScheduledTaskOutboxLineage): void {
  for (const [name, value] of Object.entries(lineage)) {
    if (typeof value !== "string" || value.trim() === "") throw new Error(`SCHEDULED_TASK_OUTBOX_LINEAGE_${name.toUpperCase()}_INVALID`)
  }
}

export function buildScheduledTaskOutboxPayload(
  operation: ScheduledTaskOutboxOperation,
  lineage: ScheduledTaskOutboxLineage,
  task: ScheduledTaskOutboxTask,
): ScheduledTaskOutboxPayload {
  assertScheduledTaskOutboxLineage(lineage)
  return {
    schema_version: SCHEDULED_TASK_OUTBOX_SCHEMA_VERSION,
    command_type: commandType(operation),
    lineage: {
      tenant_id: lineage.tenantId,
      actor_id: lineage.actorId,
      request_id: lineage.requestId,
      idempotency_key: lineage.idempotencyKey,
    },
    task: wireTask(task),
  }
}

/** Canonical input for the infrastructure-owned stable ID generator. */
export function scheduledTaskOutboxIdentityMaterial(tenantId: string, taskId: string, operation: ScheduledTaskOutboxOperation, idempotencyKey: string): string {
  return [tenantId, taskId, commandType(operation), idempotencyKey].join("\u001f")
}

/** Parse JSONB at the infrastructure boundary before a worker can deliver it. */
export function parseScheduledTaskOutboxPayload(value: unknown): ScheduledTaskOutboxPayload {
  if (!isRecord(value)) throw new Error("SCHEDULED_TASK_OUTBOX_PAYLOAD_INVALID")
  if (Object.keys(value).some((key) => !["schema_version", "command_type", "lineage", "task"].includes(key))) {
    throw new Error("SCHEDULED_TASK_OUTBOX_PAYLOAD_INVALID")
  }
  if (value.schema_version !== SCHEDULED_TASK_OUTBOX_SCHEMA_VERSION) throw new Error("SCHEDULED_TASK_OUTBOX_SCHEMA_VERSION_UNSUPPORTED")
  const command = requiredChoice(value, "command_type", ["scheduler.register", "scheduler.replace", "scheduler.delete"] as const)
  const lineageValue = value.lineage
  if (!isRecord(lineageValue)) throw new Error("SCHEDULED_TASK_OUTBOX_LINEAGE_INVALID")
  if (Object.keys(lineageValue).some((key) => !["tenant_id", "actor_id", "request_id", "idempotency_key"].includes(key))) {
    throw new Error("SCHEDULED_TASK_OUTBOX_LINEAGE_INVALID")
  }
  const lineage = {
    tenant_id: requiredString(lineageValue, "tenant_id"),
    actor_id: requiredString(lineageValue, "actor_id"),
    request_id: requiredString(lineageValue, "request_id"),
    idempotency_key: requiredString(lineageValue, "idempotency_key"),
  }
  const taskValue = value.task
  if (!isRecord(taskValue)) throw new Error("SCHEDULED_TASK_OUTBOX_TASK_INVALID")
  if (
    Object.keys(taskValue).some(
      (key) =>
        ![
          "task_id",
          "project_id",
          "owner_id",
          "title",
          "prompt",
          "trigger_kind",
          "trigger_epoch",
          "feed_url",
          "conditions",
          "frequency",
          "time",
          "timezone",
          "weekdays",
          "month_days",
          "local_date",
          "run_at",
          "expires_at",
          "auto_approve",
          "enabled",
          "status",
          "revision",
        ].includes(key),
    )
  )
    throw new Error("SCHEDULED_TASK_OUTBOX_TASK_INVALID")
  const projectId = optionalString(taskValue, "project_id")
  const expiresAt = optionalString(taskValue, "expires_at")
  const trigger = triggerFromWire(taskValue)
  if (trigger === null) throw Error("SCHEDULED_TASK_OUTBOX_TRIGGER_INVALID")
  if ((trigger.triggerKind !== "calendar" || trigger.frequency !== "once") && Object.hasOwn(taskValue, "run_at"))
    throw Error("SCHEDULED_TASK_OUTBOX_TRIGGER_INVALID")
  const task: ScheduledTaskOutboxTaskWire = {
    task_id: requiredString(taskValue, "task_id"),
    ...(projectId === undefined ? {} : { project_id: projectId }),
    owner_id: requiredString(taskValue, "owner_id"),
    title: requiredString(taskValue, "title"),
    prompt: requiredString(taskValue, "prompt"),
    ...triggerWire(trigger),
    trigger_kind: trigger.triggerKind,
    trigger_epoch: canonicalEpoch(taskValue.trigger_epoch),
    ...(trigger.triggerKind === "calendar" && trigger.frequency === "once" ? { run_at: requiredTimestamp(taskValue, "run_at") } : {}),
    ...(expiresAt === undefined ? {} : { expires_at: parseUtcTimestamp(expiresAt, "SCHEDULED_TASK_OUTBOX_EXPIRES_AT_INVALID").toISOString() }),
    auto_approve: requiredBoolean(taskValue, "auto_approve"),
    enabled: requiredBoolean(taskValue, "enabled"),
    status: requiredChoice(taskValue, "status", ["active", "paused", "failed"] as const),
    revision: requiredRevision(taskValue, "revision"),
  }
  return { schema_version: SCHEDULED_TASK_OUTBOX_SCHEMA_VERSION, command_type: command, lineage, task }
}

/** Convert the persisted JSON representation back to an internal UTC model. */
export function scheduledTaskOutboxTaskFromPayload(task: ScheduledTaskOutboxTaskWire): ScheduledTaskOutboxTask {
  const expiresAt = task.expires_at === undefined ? undefined : parseUtcTimestamp(task.expires_at, "SCHEDULED_TASK_OUTBOX_EXPIRES_INVALID")
  const internal: ScheduledTaskOutboxTask = {
    taskId: task.task_id,
    ...(task.project_id === undefined ? {} : { projectId: task.project_id }),
    ownerId: task.owner_id,
    title: task.title,
    prompt: task.prompt,
    ...(() => {
      const t = triggerFromWire(task)
      if (t === null) throw Error("SCHEDULED_TASK_OUTBOX_TRIGGER_INVALID")
      return t
    })(),
    triggerEpoch: canonicalEpoch(task.trigger_epoch),
    ...(expiresAt === undefined ? {} : { expiresAt }),
    autoApprove: task.auto_approve,
    enabled: task.enabled,
    status: task.status,
    revision: task.revision,
  }
  validateTask(internal)
  return internal
}

export function scheduledTaskRetryDelayMs(attemptCount: number, randomValue = 0): number {
  if (!Number.isSafeInteger(attemptCount) || attemptCount < 1) throw new Error("SCHEDULED_TASK_OUTBOX_ATTEMPT_INVALID")
  const jitter = Number.isFinite(randomValue) ? Math.min(1, Math.max(0, randomValue)) : 0
  const exponential = Math.min(300_000, 1_000 * 2 ** Math.min(attemptCount - 1, 8))
  return exponential + Math.floor(exponential * 0.2 * jitter)
}
