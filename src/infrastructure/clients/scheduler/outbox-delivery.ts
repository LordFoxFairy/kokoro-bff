import type { BffConfig } from "../../../config/runtime.js"
import { isRecord } from "../../../domain/json.js"
import { parseUtcTimestamp, type ScheduledTaskFact } from "../../../domain/scheduled-task/task.js"
import type { ScheduledTaskOutboxDeliveryPort, ScheduledTaskOutboxDeliveryResult } from "../../../application/ports/scheduled-task-outbox-delivery.js"
import {
  scheduledTaskOutboxTaskFromPayload,
  type ScheduledTaskOutboxCommand,
  type ScheduledTaskOutboxOperation,
} from "../../../domain/scheduled-task/outbox.js"
import { SchedulerControlClient, type SchedulerControlAttempt } from "./control-client.js"
import { buildSchedulerSchedule, schedulerScheduleName } from "./schedule.js"
import { isDeepStrictEqual } from "node:util"
import { canonicalSchedulerOccurrence } from "./dispatch-identity.js"

function matchesTrigger(schedule: Record<string, unknown>, expected: ReturnType<typeof buildSchedulerSchedule>): boolean {
  if (expected.run_at === undefined) return schedule.run_at === undefined && schedule.schedule === expected.schedule
  if (schedule.schedule !== undefined || typeof schedule.run_at !== "string") return false
  try {
    const instant = canonicalSchedulerOccurrence(expected.run_at)
    return (
      canonicalSchedulerOccurrence(schedule.run_at) === instant &&
      (schedule.next_due_at === null || (typeof schedule.next_due_at === "string" && canonicalSchedulerOccurrence(schedule.next_due_at) === instant))
    )
  } catch {
    return false
  }
}

function schedulerErrorCode(body: unknown): string | null {
  return isRecord(body) && isRecord(body.error) && typeof body.error.code === "string" ? body.error.code : null
}

function operationOf(commandType: ScheduledTaskOutboxCommand["commandType"]): ScheduledTaskOutboxOperation {
  if (commandType === "scheduler.register") return "register"
  if (commandType === "scheduler.replace") return "replace"
  return "delete"
}

function classify(
  attempt: SchedulerControlAttempt,
  expected: ReturnType<typeof buildSchedulerSchedule> | null,
  command: ScheduledTaskOutboxCommand,
): ScheduledTaskOutboxDeliveryResult {
  if (attempt.kind === "transport") return { outcome: "retryable", errorCode: attempt.errorCode }
  if (attempt.status >= 200 && attempt.status < 300) {
    const data = isRecord(attempt.body) && isRecord(attempt.body.data) ? attempt.body.data : null
    if (data === null) return { outcome: "failed", errorCode: "scheduler_response_invalid" }
    if (expected === null) {
      return data.name === schedulerScheduleName(command.taskId) && data.status === "deleted"
        ? { outcome: "succeeded" }
        : { outcome: "failed", errorCode: "scheduler_response_invalid" }
    }
    const schedule = isRecord(data.schedule) ? data.schedule : null
    const consumedOnce = expected.run_at !== undefined && data.status === "updated" && schedule?.next_due_at === null && schedule.paused === false
    if (
      schedule === null ||
      (data.status !== "registered" && data.status !== "updated") ||
      data.name !== expected.name ||
      schedule.name !== expected.name ||
      !matchesTrigger(schedule, expected) ||
      schedule.timezone !== expected.timezone ||
      schedule.url !== expected.url ||
      schedule.method !== expected.method ||
      !isDeepStrictEqual(schedule.body, expected.body) ||
      !isDeepStrictEqual(schedule.retry, expected.retry) ||
      schedule.misfire_policy !== expected.misfire_policy ||
      schedule.catch_up_limit !== expected.catch_up_limit ||
      schedule.overlap_policy !== expected.overlap_policy ||
      schedule.paused !== (consumedOnce ? false : expected.paused)
    ) {
      return { outcome: "failed", errorCode: "scheduler_response_invalid" }
    }
    if (typeof schedule.version !== "number" || !Number.isSafeInteger(schedule.version) || schedule.version < 1) {
      return { outcome: "failed", errorCode: "scheduler_response_invalid" }
    }
    if (!consumedOnce) {
      if (typeof schedule.next_due_at !== "string") return { outcome: "failed", errorCode: "scheduler_response_invalid" }
      try {
        parseUtcTimestamp(schedule.next_due_at, "SCHEDULER_NEXT_DUE_INVALID")
      } catch {
        return { outcome: "failed", errorCode: "scheduler_response_invalid" }
      }
    }
    return { outcome: "succeeded" }
  }
  const errorCode = schedulerErrorCode(attempt.body) ?? `scheduler_http_${attempt.status}`
  if (attempt.status === 408 || attempt.status === 425 || attempt.status === 429 || attempt.status >= 500) return { outcome: "retryable", errorCode }
  return { outcome: "failed", errorCode }
}

/** Scheduler HTTP adapter used only by the ScheduledTask outbox worker. */
export class SchedulerOutboxDelivery implements ScheduledTaskOutboxDeliveryPort {
  public constructor(private readonly config: BffConfig) {}

  public async deliver(command: ScheduledTaskOutboxCommand): Promise<ScheduledTaskOutboxDeliveryResult> {
    const operation = operationOf(command.commandType)
    const schedulerBase = this.config.upstreams.scheduler ?? null
    const token = this.config.schedulerServiceToken
    if (schedulerBase === null || token === null) return { outcome: "retryable", errorCode: "scheduler_not_configured" }
    if (operation !== "delete" && this.config.schedulerTargetUrl === null) return { outcome: "retryable", errorCode: "scheduler_target_not_configured" }
    try {
      const name = schedulerScheduleName(command.taskId)
      const task = scheduledTaskOutboxTaskFromPayload(command.payload.task)
      const { taskId: _taskId, ownerId: _ownerId, ...fact } = task
      const scheduledTask: ScheduledTaskFact = { ...fact, id: task.taskId }
      const body =
        operation === "delete" ? undefined : buildSchedulerSchedule(scheduledTask, command.tenantId, task.ownerId, this.config.schedulerTargetUrl ?? "")
      const lineage = { tenantId: command.tenantId, requestId: command.requestId, idempotencyKey: command.idempotencyKey }
      const client = new SchedulerControlClient(schedulerBase, token, this.config.upstreamTimeoutMs, this.config.upstreamMaxResponseBytes)
      const first =
        operation === "register"
          ? await client.create(name, body as NonNullable<typeof body>, lineage)
          : operation === "replace"
            ? await client.replace(name, body as NonNullable<typeof body>, lineage)
            : await client.delete(name, lineage)
      if (operation === "delete" && first.kind === "response" && first.status === 404 && schedulerErrorCode(first.body) === "schedule_not_found") {
        return { outcome: "succeeded" }
      }
      if (operation === "register" && first.kind === "response" && first.status === 409 && schedulerErrorCode(first.body) === "schedule_already_exists") {
        return classify(await client.replace(name, body as NonNullable<typeof body>, lineage), body as NonNullable<typeof body>, command)
      }
      if (operation === "replace" && first.kind === "response" && first.status === 404 && schedulerErrorCode(first.body) === "schedule_not_found") {
        return classify(await client.create(name, body as NonNullable<typeof body>, lineage), body as NonNullable<typeof body>, command)
      }
      return classify(first, body ?? null, command)
    } catch {
      return { outcome: "failed", errorCode: "scheduled_task_outbox_payload_invalid" }
    }
  }
}
