import type { BffConfig } from "../../../config/runtime.js"
import { isRecord } from "../../../domain/json.js"
import type { ScheduledTaskFact } from "../../../domain/scheduled-task/task.js"
import type { ScheduledTaskOutboxDeliveryPort, ScheduledTaskOutboxDeliveryResult } from "../../../application/ports/scheduled-task-outbox-delivery.js"
import { scheduledTaskOutboxTaskFromPayload, type ScheduledTaskOutboxCommand, type ScheduledTaskOutboxOperation } from "../../../domain/scheduled-task/outbox.js"
import { buildSchedulerJob, schedulerJobName } from "./job.js"
import { ownerIdentityHeaders } from "../owner/identity.js"
import { normalizeUpstreamResponse } from "../../../http/response.js"
import { proxyUpstream } from "../../../upstream.js"

type SchedulerAttempt =
  | { kind: "response"; status: number; body: unknown }
  | { kind: "transport"; errorCode: string }

function schedulerErrorCode(body: unknown): string | null {
  return isRecord(body) && isRecord(body.error) && typeof body.error.code === "string" ? body.error.code : null
}

function transportErrorCode(error: unknown): string {
  if (isRecord(error) && typeof error.code === "string" && error.code.trim() !== "") return error.code
  return "scheduler_transport_error"
}

function operationOf(commandType: ScheduledTaskOutboxCommand["commandType"]): ScheduledTaskOutboxOperation {
  if (commandType === "scheduler.register") return "register"
  if (commandType === "scheduler.replace") return "replace"
  return "delete"
}

function incomingHeaders(command: ScheduledTaskOutboxCommand, hasBody: boolean): Headers {
  const headers = new Headers({
    accept: "application/json",
    "idempotency-key": command.idempotencyKey,
  })
  if (hasBody) headers.set("content-type", "application/json")
  return headers
}

function classify(attempt: SchedulerAttempt): ScheduledTaskOutboxDeliveryResult {
  if (attempt.kind === "transport") return { outcome: "retryable", errorCode: attempt.errorCode }
  if (attempt.status >= 200 && attempt.status < 300) return { outcome: "succeeded" }
  const errorCode = schedulerErrorCode(attempt.body) ?? `scheduler_http_${attempt.status}`
  if (attempt.status === 408 || attempt.status === 425 || attempt.status === 429 || attempt.status >= 500) {
    return { outcome: "retryable", errorCode }
  }
  return { outcome: "failed", errorCode }
}

/** Scheduler HTTP adapter used only by the ScheduledTask outbox worker. */
export class SchedulerOutboxDelivery implements ScheduledTaskOutboxDeliveryPort {
  public constructor(private readonly config: BffConfig) {}

  public async deliver(command: ScheduledTaskOutboxCommand): Promise<ScheduledTaskOutboxDeliveryResult> {
    const operation = operationOf(command.commandType)
    const schedulerBase = this.config.upstreams.scheduler ?? null
    if (schedulerBase === null) return { outcome: "retryable", errorCode: "scheduler_not_configured" }
    if (operation !== "delete" && this.config.schedulerTargetUrl === null) {
      return { outcome: "retryable", errorCode: "scheduler_target_not_configured" }
    }
    try {
      const jobName = schedulerJobName(command.taskId)
      const path = `/internal/scheduler/v1/jobs/${encodeURIComponent(jobName)}`
      const task = scheduledTaskOutboxTaskFromPayload(command.payload.task)
      const schedulerTask: ScheduledTaskFact = {
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
      const body = operation === "delete"
        ? undefined
        : Buffer.from(JSON.stringify(buildSchedulerJob(schedulerTask, command.tenantId, task.ownerId, this.config.schedulerTargetUrl ?? "")))
      const first = await this.request(command, schedulerBase, path, operation === "register" ? "POST" : operation === "replace" ? "PUT" : "DELETE", body)
      if (operation === "delete" && first.kind === "response" && first.status === 404 && schedulerErrorCode(first.body) === "job_not_found") {
        return { outcome: "succeeded" }
      }
      if (operation === "register" && first.kind === "response" && first.status === 409 && schedulerErrorCode(first.body) === "job_already_exists") {
        return classify(await this.request(command, schedulerBase, path, "PUT", body))
      }
      if (operation === "replace" && first.kind === "response" && first.status === 404 && schedulerErrorCode(first.body) === "job_not_found") {
        return classify(await this.request(command, schedulerBase, path, "POST", body))
      }
      return classify(first)
    } catch {
      return { outcome: "failed", errorCode: "scheduled_task_outbox_payload_invalid" }
    }
  }

  private async request(
    command: ScheduledTaskOutboxCommand,
    schedulerBase: string,
    path: string,
    method: "POST" | "PUT" | "DELETE",
    body: Buffer | undefined,
  ): Promise<SchedulerAttempt> {
    try {
      const upstream = await proxyUpstream(
        this.config,
        schedulerBase,
        path,
        method,
        command.requestId,
        incomingHeaders(command, body !== undefined),
        body,
        ownerIdentityHeaders({ requestId: command.requestId, identity: { namespace: command.tenantId, userId: command.actorId } }),
        "web-bff",
        this.config.schedulerServiceToken ?? this.config.upstreamSecret,
      )
      const normalized = normalizeUpstreamResponse(upstream, command.requestId)
      return { kind: "response", status: normalized.status, body: normalized.body }
    } catch (error) {
      return { kind: "transport", errorCode: transportErrorCode(error) }
    }
  }
}
