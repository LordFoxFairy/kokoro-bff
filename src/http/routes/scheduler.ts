import { createHash } from "node:crypto"
import type { IncomingMessage, ServerResponse } from "node:http"

import type { BffConfig } from "../../config.js"
import { failure, ok, type ScheduledTask } from "../../contracts/index.js"
import { PostgresBffRepositories } from "../../infrastructure/postgres/repositories.js"
import { proxyUpstream } from "../../upstream.js"
import { buildAgentLaunch } from "../../adapters/agent.js"
import { buildSchedulerJob, schedulerJobName, type SchedulerJob } from "../../adapters/scheduler.js"
import { mutationTicket, type IdempotencyEntry } from "../../application/idempotency.js"
import { dataOf, ownerIdentityHeaders } from "../../application/projections.js"
import { normalizeUpstreamResponse, reply, send } from "../response.js"
import { headerString, idempotencyKey, incomingHeaders, isRecord, readBody, requestBodyJson, requestId, type Context } from "../request.js"
import { callAgent } from "./agent.js"
import type { LiveOwnerResult } from "./types.js"

export function scheduledTaskId(context: Context, path: string, key: string): string {
  const digest = createHash("sha256")
    .update(`${context.identity.namespace}\u001f${path}\u001f${key}`)
    .digest("hex")
    .slice(0, 32)
  return `scheduled_${digest}`
}

function schedulerErrorCode(body: unknown): string | null {
  return isRecord(body) && isRecord(body.error) && typeof body.error.code === "string" ? body.error.code : null
}

async function liveSchedulerRequest(
  request: IncomingMessage,
  config: BffConfig,
  context: Context,
  method: string,
  path: string,
  body?: Buffer,
): Promise<LiveOwnerResult> {
  const schedulerBase = config.upstreams.scheduler ?? null
  if (schedulerBase === null) {
    return { status: 503, body: failure("scheduler_not_configured", "Scheduler upstream is not configured", context.requestId) }
  }
  if (config.schedulerTargetUrl === null) {
    return { status: 503, body: failure("scheduler_target_not_configured", "Scheduler target URL is not configured", context.requestId) }
  }
  try {
    const upstream = await proxyUpstream(
      config,
      schedulerBase,
      path,
      method,
      context.requestId,
      incomingHeaders(request),
      body,
      ownerIdentityHeaders(context),
      "web-bff",
      config.schedulerServiceToken ?? config.upstreamSecret,
    )
    return normalizeUpstreamResponse(upstream, context.requestId)
  } catch {
    return { status: 502, body: failure("scheduler_unreachable", "The configured Scheduler upstream is unavailable", context.requestId) }
  }
}

export async function reconcileSchedulerTask(
  request: IncomingMessage,
  config: BffConfig,
  context: Context,
  task: ScheduledTask,
  ownerId: string,
  operation: "register" | "replace" | "delete",
): Promise<LiveOwnerResult> {
  const job = buildSchedulerJob(task, context.identity.namespace, ownerId, config.schedulerTargetUrl ?? "")
  const path = `/internal/scheduler/v1/jobs/${encodeURIComponent(schedulerJobName(task.id))}`
  if (operation === "delete") {
    const result = await liveSchedulerRequest(request, config, context, "DELETE", path)
    if (result.status === 404 && schedulerErrorCode(result.body) === "job_not_found") {
      return { status: 200, body: ok({ name: schedulerJobName(task.id), status: "deleted" }, context.requestId) }
    }
    return result
  }

  const method = operation === "register" ? "POST" : "PUT"
  const first = await liveSchedulerRequest(request, config, context, method, path, Buffer.from(JSON.stringify(job)))
  // A BFF retry may arrive after Scheduler committed the registration but
  // before the original response reached us. Reconcile by replacing the
  // existing job instead of treating that state as a permanent failure.
  if (operation === "register" && first.status === 409 && schedulerErrorCode(first.body) === "job_already_exists") {
    return liveSchedulerRequest(request, config, context, "PUT", path, Buffer.from(JSON.stringify(job)))
  }
  if (operation === "replace" && first.status === 404 && schedulerErrorCode(first.body) === "job_not_found") {
    return liveSchedulerRequest(request, config, context, "POST", path, Buffer.from(JSON.stringify(job)))
  }
  return first
}

export async function markScheduledTaskFailed(store: PostgresBffRepositories, tenantId: string, taskId: string): Promise<void> {
  await store.services.scheduledTasks.update(tenantId, taskId, { status: "failed", enabled: false })
}

export async function schedulerDispatch(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  businessStore: PostgresBffRepositories | null,
  idempotency: Map<string, IdempotencyEntry>,
): Promise<boolean> {
  const id = requestId(request)
  if (request.method !== "POST") {
    send(response, 405, failure("method_not_allowed", "Only POST is supported", id))
    return true
  }
  const schedulerToken = config.schedulerServiceToken ?? config.upstreamSecret
  const authorization = headerString(request.headers.authorization).trim()
  const bearer = authorization.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : ""
  const internalSecret = headerString(request.headers["x-kokoro-internal-secret"]).trim()
  if (schedulerToken === null || (bearer !== schedulerToken && internalSecret !== schedulerToken)) {
    send(response, 401, failure("service_auth_failed", "Scheduler dispatch authentication failed", id))
    return true
  }
  if (businessStore === null) {
    send(response, 503, failure("business_store_not_configured", "BFF business fact store is not configured", id))
    return true
  }
  let body: Buffer
  try {
    body = await readBody(request)
  } catch {
    send(response, 413, failure("request_body_too_large", "Request body is too large", id))
    return true
  }
  const json = requestBodyJson(request, body)
  const tenantId = typeof json?.tenant_id === "string" ? json.tenant_id.trim() : ""
  const taskId = typeof json?.task_id === "string" ? json.task_id.trim() : ""
  const ownerId = typeof json?.owner_id === "string" ? json.owner_id.trim() : ""
  const schedulerJob = headerString(request.headers["x-kokoro-scheduler-job"]).trim()
  const schedulerOccurrence = headerString(request.headers["x-kokoro-scheduler-occurrence"]).trim()
  const occurrenceKey = idempotencyKey(request)
  const expectedOccurrenceKey = schedulerOccurrence === "" ? null : `schedule:${schedulerJob}:${schedulerOccurrence}`
  if (
    json === null
    || tenantId === ""
    || taskId === ""
    || ownerId === ""
    || occurrenceKey === null
    || schedulerJob !== schedulerJobName(taskId)
    || !/^\d{8}T\d{6}Z$/u.test(schedulerOccurrence)
    || occurrenceKey !== expectedOccurrenceKey
  ) {
    send(response, 400, failure("invalid_scheduler_dispatch", "Scheduler dispatch payload or headers are invalid", id))
    return true
  }
  const context: Context = { requestId: id, identity: { namespace: tenantId, userId: ownerId } }
  const mutation = await mutationTicket(request, "POST", "/internal/bff/scheduled-tasks/dispatch", context, body, idempotency, businessStore)
  if (mutation.replay !== null) {
    send(response, mutation.replay.status, mutation.replay.body)
    return true
  }
  if (mutation.conflict) {
    send(response, 409, failure("idempotency_conflict", "Idempotency key already used with a different request payload", id))
    return true
  }
  if (mutation.pending) {
    send(response, 409, failure("idempotency_in_progress", "An identical mutation is already in progress", id))
    return true
  }
  const record = await businessStore.services.scheduledTasks.findRecord(tenantId, taskId)
  if (record === null || record.ownerId !== ownerId) {
    await reply(response, 404, failure("scheduled_task_not_found", "Scheduled task was not found", id), context, idempotency, mutation.ticket)
    return true
  }
  if (
    json.prompt !== record.task.prompt
    || json.auto_approve !== record.task.auto_approve
    || json.timezone !== record.task.timezone
    || (record.task.project_id === undefined ? json.project_id !== undefined : json.project_id !== record.task.project_id)
  ) {
    await reply(response, 409, failure("invalid_scheduler_dispatch", "Scheduler dispatch does not match the stored task", id), context, idempotency, mutation.ticket)
    return true
  }
  if (!record.task.enabled || record.task.status !== "active") {
    await reply(response, 409, failure("scheduled_task_not_active", "Scheduled task is not active", id), context, idempotency, mutation.ticket)
    return true
  }
  if (record.task.expires_at !== undefined && Date.parse(record.task.expires_at) <= Date.now()) {
    await reply(response, 410, failure("scheduled_task_expired", "Scheduled task has expired", id), context, idempotency, mutation.ticket)
    return true
  }
  const agentUrl = config.upstreams.agents ?? null
  if (!config.agentEnabled || agentUrl === null) {
    await reply(response, 503, failure("agent_not_configured", "Agent upstream is not configured", id), context, idempotency, mutation.ticket)
    return true
  }
  const launch = buildAgentLaunch({
    identity: context.identity,
    requestId: id,
    sessionId: `scheduled:${taskId}`,
    idempotencyKey: occurrenceKey,
    content: record.task.prompt,
    ...(record.task.project_id === undefined ? {} : { projectRef: record.task.project_id }),
  })
  try {
    const result = await callAgent(config, agentUrl, "/v1/runs", "POST", id, request, Buffer.from(JSON.stringify(launch.body)), context, String((launch.body.execution_identity as Record<string, unknown>).identity_assertion_ref))
    if (result.status >= 400) {
      await reply(response, result.status, result.body, context, idempotency, mutation.ticket)
      return true
    }
    const data = dataOf(result.body)
    if (data === null || data.run_id !== launch.receipt.run_id) {
      await reply(response, 502, failure("upstream_response_invalid", "Scheduled Agent launch receipt did not match the requested run", id), context, idempotency, mutation.ticket)
      return true
    }
    await reply(response, 202, ok({ task_id: taskId, run_id: launch.receipt.run_id }, id), context, idempotency, mutation.ticket)
  } catch {
    await reply(response, 502, failure("agent_unreachable", "The configured Agent upstream is unavailable", id), context, idempotency, mutation.ticket)
  }
  return true
}
