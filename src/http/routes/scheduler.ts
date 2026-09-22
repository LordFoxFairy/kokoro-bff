import { createHash } from "node:crypto"
import type { IncomingMessage, ServerResponse } from "node:http"

import type { BffConfig } from "../../config/runtime.js"
import type { RequestContext } from "../../domain/request-context.js"
import { failure, ok } from "../../contracts/index.js"
import type { BffBusinessStore } from "../../application/ports/bff-business-store.js"
import type { SchedulerDispatchClaim, SchedulerDispatchResponse } from "../../application/ports/scheduler-dispatch-receipt-repository.js"
import { agentIdentityHeaders, buildScheduledAgentLaunch } from "../../infrastructure/clients/agent/index.js"
import { schedulerDispatchDigest, schedulerDispatchScope, schedulerOccurrenceIdentity } from "../../infrastructure/clients/scheduler/dispatch-identity.js"
import { schedulerScheduleName } from "../../infrastructure/clients/scheduler/schedule.js"
import { parseSchedulerDispatchWebhook } from "../../infrastructure/clients/scheduler/webhook-contract.js"
import { normalizeUpstreamResponse } from "../../infrastructure/clients/upstream-response.js"
import { proxyUpstream } from "../../upstream.js"
import type { IdempotencyEntry } from "../../application/idempotency.js"
import { dataOf } from "../../application/projections.js"
import { send } from "../response.js"
import { headerString, incomingHeaders, readBody, requestBodyJson, requestId } from "../request.js"

const SCHEDULER_RECEIPT_SETTLEMENT_RESERVE_MS = 5_000

export function scheduledTaskId(context: RequestContext, path: string, key: string): string {
  const digest = createHash("sha256").update(`${context.identity.namespace}\u001f${path}\u001f${key}`).digest("hex").slice(0, 32)
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
): Promise<boolean> {
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
    body = await readBody(request)
  } catch {
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
  if (taskId === "" || ownerId === "" || wire.schedule !== schedulerScheduleName(taskId)) {
    send(response, 400, failure("invalid_scheduler_dispatch", "Scheduler dispatch payload or headers are invalid", responseRequestId))
    return true
  }

  const scope = schedulerDispatchScope(wire.tenantId, wire.idempotencyKey)
  const digest = schedulerDispatchDigest({ tenantId: wire.tenantId, schedule: wire.schedule, occurrence: wire.occurrence, body: wire.body })
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
      launch: { requestId: wire.requestId, ...launch },
    }
    const prepared = await receipts.prepareSnapshot(claim, snapshot)
    if (prepared === null) {
      send(response, 503, failure("scheduler_receipt_claim_lost", "Scheduler dispatch receipt claim was lost", responseRequestId))
      return true
    }
    claim = { ...claim, ...prepared, snapshot }
  }

  const agentUrl = config.upstreams.agents ?? null
  if (!config.agentEnabled || agentUrl === null) {
    if (await receipts.releaseRetryable(claim, "agent_not_configured"))
      send(response, 503, failure("agent_not_configured", "Agent upstream is not configured", responseRequestId))
    else send(response, 503, failure("scheduler_receipt_claim_lost", "Scheduler dispatch receipt claim was lost", responseRequestId))
    return true
  }
  const timeoutBudgetMs = Math.floor(claim.leaseRemainingMs - (performance.now() - claim.leaseObservedAt) - SCHEDULER_RECEIPT_SETTLEMENT_RESERVE_MS)
  if (timeoutBudgetMs < 1) {
    await releaseUnknown(
      response,
      receipts,
      claim,
      responseRequestId,
      "scheduler_lease_budget_exhausted",
      "Scheduler dispatch receipt lease cannot safely admit Agent I/O",
    )
    return true
  }
  try {
    const upstream = await proxyUpstream(
      config,
      agentUrl,
      "/v1/runs",
      "POST",
      snapshot.launch.requestId,
      incomingHeaders(request),
      Buffer.from(JSON.stringify(snapshot.launch.body)),
      agentIdentityHeaders({ namespace: snapshot.tenantId, userId: snapshot.actorId }, snapshot.launch.identityAssertionRef),
      "kokoro-bff",
      config.upstreamSecret,
      timeoutBudgetMs,
    )
    const result = normalizeUpstreamResponse(upstream, snapshot.launch.requestId)
    if (result.status >= 500 || result.status === 408 || result.status === 425 || result.status === 429) {
      await releaseUnknown(response, receipts, claim, responseRequestId, "agent_response_unknown", "The Agent launch result is unknown")
      return true
    }
    if (result.status >= 400) {
      await settle(response, receipts, claim, { status: result.status, body: result.body }, responseRequestId)
      return true
    }
    const data = dataOf(result.body)
    if (data === null || data.run_id !== snapshot.launch.receipt.run_id) {
      await releaseUnknown(
        response,
        receipts,
        claim,
        responseRequestId,
        "upstream_response_invalid",
        "Scheduled Agent launch receipt did not match the requested run",
      )
      return true
    }
    await settle(
      response,
      receipts,
      claim,
      { status: 202, body: ok({ task_id: snapshot.taskId, run_id: snapshot.launch.receipt.run_id }, responseRequestId) },
      responseRequestId,
    )
  } catch {
    await releaseUnknown(response, receipts, claim, responseRequestId, "agent_unreachable", "The configured Agent upstream is unavailable")
  }
  return true
}
