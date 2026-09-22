import type { BffConfig } from "../../../config/runtime.js"
import { isRecord } from "../../../domain/json.js"
import type { ScheduledTaskFact } from "../../../domain/scheduled-task/task.js"
import type { ScheduledTaskOutboxDeliveryPort, ScheduledTaskOutboxDeliveryResult } from "../../../application/ports/scheduled-task-outbox-delivery.js"
import {
  scheduledTaskOutboxTaskFromPayload,
  type ScheduledTaskOutboxCommand,
  type ScheduledTaskOutboxOperation,
} from "../../../domain/scheduled-task/outbox.js"
import { SchedulerControlClient, type SchedulerControlAttempt } from "./control-client.js"
import { buildSchedulerSchedule, schedulerScheduleName } from "./schedule.js"

function schedulerErrorCode(body: unknown): string | null {
  return isRecord(body) && isRecord(body.error) && typeof body.error.code === "string" ? body.error.code : null
}

function operationOf(commandType: ScheduledTaskOutboxCommand["commandType"]): ScheduledTaskOutboxOperation {
  if (commandType === "scheduler.register") return "register"
  if (commandType === "scheduler.replace") return "replace"
  return "delete"
}

function classify(attempt: SchedulerControlAttempt): ScheduledTaskOutboxDeliveryResult {
  if (attempt.kind === "transport") return { outcome: "retryable", errorCode: attempt.errorCode }
  if (attempt.status >= 200 && attempt.status < 300) return { outcome: "succeeded" }
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
      const scheduledTask: ScheduledTaskFact = {
        id: task.taskId,
        ...(task.projectId === undefined ? {} : { projectId: task.projectId }),
        title: task.title,
        prompt: task.prompt,
        frequency: task.frequency,
        time: task.time,
        timezone: task.timezone,
        nextRunAt: task.nextRunAt,
        ...(task.expiresAt === undefined ? {} : { expiresAt: task.expiresAt }),
        autoApprove: task.autoApprove,
        enabled: task.enabled,
        status: task.status,
        revision: task.revision,
      }
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
        return classify(await client.replace(name, body as NonNullable<typeof body>, lineage))
      }
      if (operation === "replace" && first.kind === "response" && first.status === 404 && schedulerErrorCode(first.body) === "schedule_not_found") {
        return classify(await client.create(name, body as NonNullable<typeof body>, lineage))
      }
      return classify(first)
    } catch {
      return { outcome: "failed", errorCode: "scheduled_task_outbox_payload_invalid" }
    }
  }
}
