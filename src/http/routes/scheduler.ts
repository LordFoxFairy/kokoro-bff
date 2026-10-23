import { strictParseRawJson } from "../../infrastructure/raw-json.js"
import type { RssPollService } from "../../application/rss-poll-service.js"
import { canonicalEpoch } from "../../domain/scheduled-task/trigger.js"
import { createHash } from "node:crypto"
import type { IncomingMessage, ServerResponse } from "node:http"

import type { BffConfig } from "../../config/runtime.js"
import type { RequestContext } from "../../domain/request-context.js"
import { failure, ok } from "../../contracts/index.js"
import type { BffBusinessStore } from "../../application/ports/bff-business-store.js"
import type { SchedulerDispatchClaim, SchedulerDispatchResponse } from "../../application/ports/scheduler-dispatch-receipt-repository.js"
import { buildScheduledAgentLaunch } from "../../infrastructure/clients/agent/index.js"
import { schedulerDispatchDigest, schedulerDispatchScope, schedulerOccurrenceIdentity } from "../../infrastructure/clients/scheduler/dispatch-identity.js"
import { schedulerScheduleName } from "../../infrastructure/clients/scheduler/schedule.js"
import { parseSchedulerDispatchWebhook } from "../../infrastructure/clients/scheduler/webhook-contract.js"
import type { IdempotencyEntry } from "../../application/idempotency.js"
import { send } from "../response.js"
import { headerString, readBody, requestBodyJson, requestId } from "../request.js"

export function scheduledTaskId(context: RequestContext, path: string, key: string): string {
  const material = JSON.stringify([context.identity.namespace, context.identity.userId, path, key])
  const digest = createHash("sha256").update(material).digest("hex").slice(0, 32)
  return `scheduled_${digest}`
}

async function settle(
  response: ServerResponse,
  store: NonNullable<BffBusinessStore["schedulerDispatchReceipts"]>,
  claim: SchedulerDispatchClaim,
  result: SchedulerDispatchResponse,
  requestIdentifier: string,
): Promise<void> {
  if (await store.complete(claim, result)) send(response, result.status, result.body)
  else send(response, 503, failure("scheduler_receipt_claim_lost", "Scheduler dispatch receipt claim was lost", requestIdentifier))
}

async function releaseUnknown(
  response: ServerResponse,
  store: NonNullable<BffBusinessStore["schedulerDispatchReceipts"]>,
  claim: SchedulerDispatchClaim,
  requestIdentifier: string,
  code: string,
  message: string,
): Promise<void> {
  if (await store.releaseRetryable(claim, code)) send(response, 502, failure(code, message, requestIdentifier))
  else send(response, 503, failure("scheduler_receipt_claim_lost", "Scheduler dispatch receipt claim was lost", requestIdentifier))
}

export async function schedulerDispatch(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  businessStore: BffBusinessStore | null,
  _idempotency: Map<string, IdempotencyEntry>,
  rssPollService: RssPollService | null = null,
): Promise<boolean> {
  const deadlineAt = performance.now() + 20000
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort()
    if (!request.complete) request.destroy()
  }, 20000)
  timer.unref()
  request.once("aborted", () => controller.abort())
  response.once("close", () => {
    clearTimeout(timer)
    if (!response.writableFinished) controller.abort()
  })
  const fallbackRequestId = requestId(request)
  if (request.method !== "POST") {
    send(response, 405, failure("method_not_allowed", "Only POST is supported", fallbackRequestId))
    return true
  }
  const schedulerToken = config.schedulerServiceToken
  if (schedulerToken === null || headerString(request.headers.authorization) !== `Bearer ${schedulerToken}`) {
    send(response, 401, failure("service_auth_failed", "Scheduler dispatch authentication failed", fallbackRequestId))
    return true
  }
  const receipts = businessStore?.schedulerDispatchReceipts
  if (businessStore === null || receipts === undefined) {
    send(response, 503, failure("business_store_not_configured", "BFF Scheduler receipt store is not configured", fallbackRequestId))
    return true
  }
  let body: Buffer
  try {
    let stop: (() => void) | undefined
    try {
      controller.signal.throwIfAborted()
      body = await Promise.race([
        readBody(request),
        new Promise<never>((_, reject) => {
          stop = () => reject(Error("rss_poll_deadline"))
          controller.signal.addEventListener("abort", stop, { once: true })
        }),
      ])
    } finally {
      if (stop) controller.signal.removeEventListener("abort", stop)
    }
  } catch {
    if (controller.signal.aborted) {
      if (!response.destroyed) send(response, 503, failure("rss_poll_deadline", "Scheduler request deadline exceeded", fallbackRequestId))
      return true
    }
    send(response, 413, failure("request_body_too_large", "Request body is too large", fallbackRequestId))
    return true
  }
  const json = requestBodyJson(request, body)
  const wire = json === null ? null : parseSchedulerDispatchWebhook(request.headers, json)
  const responseRequestId = wire?.requestId ?? fallbackRequestId
  if (wire === null || wire.body.tenant_id !== wire.tenantId) {
    send(response, 400, failure("invalid_scheduler_dispatch", "Scheduler dispatch payload or headers are invalid", responseRequestId))
    return true
  }
  const taskId = typeof wire.body.task_id === "string" ? wire.body.task_id : ""
  const ownerId = typeof wire.body.owner_id === "string" ? wire.body.owner_id : ""
  const taskRevision = wire.body.task_revision
  if (
    taskId === "" ||
    ownerId === "" ||
    typeof taskRevision !== "number" ||
    !Number.isSafeInteger(taskRevision) ||
    taskRevision < 1 ||
    wire.schedule !== schedulerScheduleName(taskId)
  ) {
    send(response, 400, failure("invalid_scheduler_dispatch", "Scheduler dispatch payload or headers are invalid", responseRequestId))
    return true
  }

  const scope = schedulerDispatchScope(wire.tenantId, wire.idempotencyKey)
  const digest = schedulerDispatchDigest({ tenantId: wire.tenantId, schedule: wire.schedule, occurrence: wire.occurrence, body: wire.body })
  if (wire.body.trigger_kind === "rss") {
    try {
      strictParseRawJson(body)
    } catch {
      send(response, 400, failure("invalid_scheduler_dispatch", "Invalid RSS callback JSON", responseRequestId))
      return true
    }
    const keys = ["tenant_id", "task_id", "task_revision", "owner_id", "project_id", "trigger_kind", "trigger_epoch"]
    let epoch: string
    try {
      epoch = canonicalEpoch(wire.body.trigger_epoch)
    } catch {
      send(response, 400, failure("invalid_scheduler_dispatch", "Invalid trigger epoch", responseRequestId))
      return true
    }
    if (
      Object.keys(wire.body).some((key) => !keys.includes(key)) ||
      (Object.hasOwn(wire.body, "project_id") &&
        (typeof wire.body.project_id !== "string" || wire.body.project_id.length === 0 || wire.body.project_id.trim() !== wire.body.project_id))
    ) {
      send(response, 400, failure("invalid_scheduler_dispatch", "Invalid RSS callback", responseRequestId))
      return true
    }
    if (!rssPollService) {
      send(response, 503, failure("business_store_unavailable", "RSS poll unavailable", responseRequestId))
      return true
    }
    try {
      const result = await rssPollService.poll({
        tenantId: wire.tenantId,
        subjectId: ownerId,
        taskId,
        revision: taskRevision,
        epoch,
        scope,
        digest,
        requestId: responseRequestId,
        signal: controller.signal,
        deadlineAt,
        ...(typeof wire.body.project_id === "string" ? { projectId: wire.body.project_id } : {}),
      })
      if (!controller.signal.aborted && !response.destroyed) {
        if (result.outcome === "terminal") send(response, 202, ok(result.summary, responseRequestId))
        else
          send(
            response,
            result.outcome === "conflict" ? 409 : 425,
            failure(result.outcome === "conflict" ? "idempotency_conflict" : "idempotency_in_progress", "RSS poll claim unavailable", responseRequestId),
          )
      }
    } catch {
      if (!response.destroyed && !response.writableEnded)
        send(response, 503, failure(controller.signal.aborted ? "rss_poll_deadline" : "rss_poll_unavailable", "RSS poll unavailable", responseRequestId))
    }
    return true
  }
  let claimResult
  try {
    claimResult = await receipts.claim(scope, digest)
  } catch {
    send(response, 503, failure("business_store_unavailable", "The BFF business store is unavailable", responseRequestId))
    return true
  }
  if (claimResult.outcome === "conflict") {
    send(response, 409, failure("idempotency_conflict", "Idempotency key already used with a different Scheduler dispatch", responseRequestId))
    return true
  }
  if (claimResult.outcome === "pending") {
    send(response, 425, failure("idempotency_in_progress", "An identical Scheduler dispatch is already in progress", responseRequestId))
    return true
  }
  if (claimResult.outcome === "terminal") {
    send(response, claimResult.response.status, claimResult.response.body)
    return true
  }

  let claim = claimResult.claim
  let snapshot = claim.snapshot
  if (snapshot === null) {
    let record
    try {
      record = await businessStore.services.scheduledTasks.findRecord(wire.tenantId, taskId)
    } catch {
      await releaseUnknown(response, receipts, claim, responseRequestId, "business_store_unavailable", "The BFF business store is unavailable")
      return true
    }
    if (record === null || record.ownerId !== ownerId) {
      await settle(
        response,
        receipts,
        claim,
        { status: 404, body: failure("scheduled_task_not_found", "Scheduled task was not found", responseRequestId) },
        responseRequestId,
      )
      return true
    }
    if (
      record.task.triggerKind !== "calendar" ||
      wire.body.trigger_kind !== "calendar" ||
      wire.body.trigger_epoch !== record.task.triggerEpoch ||
      taskRevision !== record.task.revision ||
      wire.body.prompt !== record.task.prompt ||
      wire.body.auto_approve !== record.task.autoApprove ||
      wire.body.timezone !== record.task.timezone ||
      (record.task.projectId === undefined ? wire.body.project_id !== undefined : wire.body.project_id !== record.task.projectId)
    ) {
      await settle(
        response,
        receipts,
        claim,
        { status: 409, body: failure("invalid_scheduler_dispatch", "Scheduler dispatch does not match the stored task", responseRequestId) },
        responseRequestId,
      )
      return true
    }
    if (!record.task.enabled || record.task.status !== "active") {
      await settle(
        response,
        receipts,
        claim,
        { status: 409, body: failure("scheduled_task_not_active", "Scheduled task is not active", responseRequestId) },
        responseRequestId,
      )
      return true
    }
    if (record.task.expiresAt !== undefined && record.task.expiresAt.getTime() <= Date.now()) {
      await settle(
        response,
        receipts,
        claim,
        { status: 410, body: failure("scheduled_task_expired", "Scheduled task has expired", responseRequestId) },
        responseRequestId,
      )
      return true
    }
    const identity = { namespace: wire.tenantId, userId: record.ownerId }
    const launch = buildScheduledAgentLaunch({
      identity,
      requestId: wire.requestId,
      sessionId: `scheduled:${taskId}`,
      occurrenceIdentity: schedulerOccurrenceIdentity({ tenantId: wire.tenantId, schedule: wire.schedule, occurrence: wire.occurrence }),
      content: record.task.prompt,
      ...(record.task.projectId === undefined ? {} : { projectRef: record.task.projectId }),
    })
    snapshot = {
      tenantId: wire.tenantId,
      schedule: wire.schedule,
      occurrence: wire.occurrence,
      idempotencyKey: wire.idempotencyKey,
      actorId: record.ownerId,
      taskId,
      taskRevision,
      launch: { requestId: wire.requestId, ...launch },
    }
    const prepared = await receipts.prepareSnapshot(claim, snapshot)
    if (prepared === null) {
      send(response, 503, failure("scheduler_receipt_claim_lost", "Scheduler dispatch receipt claim was lost", responseRequestId))
      return true
    }
    claim = { ...claim, ...prepared, snapshot }
  }

  if (snapshot.taskRevision !== taskRevision) {
    await settle(
      response,
      receipts,
      claim,
      { status: 409, body: failure("invalid_scheduler_dispatch", "Scheduler dispatch does not match the frozen task revision", responseRequestId) },
      responseRequestId,
    )
    return true
  }

  const dispatch = businessStore.scheduledAgentDispatch
  if (dispatch === undefined) {
    await releaseUnknown(response, receipts, claim, responseRequestId, "business_store_unavailable", "The BFF business store is unavailable")
    return true
  }
  const accepted = { status: 202, body: ok({ task_id: snapshot.taskId, run_id: snapshot.launch.receipt.run_id }, responseRequestId) }
  const result = await dispatch.accept({
    claim,
    snapshot,
    response: accepted,
    rejections: {
      task_not_found: { status: 404, body: failure("scheduled_task_not_found", "Scheduled task was not found", responseRequestId) },
      task_not_active: { status: 409, body: failure("scheduled_task_not_active", "Scheduled task is not active", responseRequestId) },
      task_changed: { status: 409, body: failure("invalid_scheduler_dispatch", "Scheduler dispatch does not match the stored task", responseRequestId) },
    },
  })
  if (result.outcome === "accepted") send(response, accepted.status, accepted.body)
  else if (result.outcome === "rejected") send(response, result.response.status, result.response.body)
  else send(response, 503, failure("scheduler_receipt_claim_lost", "Scheduler dispatch receipt claim was lost", responseRequestId))
  return true
}
