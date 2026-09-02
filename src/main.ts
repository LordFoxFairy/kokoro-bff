import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { createHash, randomUUID } from "node:crypto"

import { loadConfig, type BffConfig } from "./config.js"
import type {
  AgentConnectionSetup,
  BillingSummary,
  ChatEvent,
  ChatRun,
  ChatSessionDetail,
  ChatSessionSummary,
  ChatShare,
  LibraryItem,
  McpTransport,
  Project,
  ScheduledTask,
  Skill,
  Task,
} from "./contracts/index.js"
import { failure, ok } from "./contracts/index.js"
import { MockBffStore } from "./infrastructure/mock/bff-store.js"
import { PostgresBffRepositories } from "./infrastructure/postgres/repositories.js"
import { proxyUpstream } from "./upstream.js"
import {
  agentIdentityHeaders,
  buildAgentControl,
  buildAgentLaunch,
  buildSessionDetail,
  mapAgentEvent,
  type AgentChatEvent,
} from "./adapters/agent.js"
import type { AgentChatMessage } from "./adapters/agent.js"
import { buildSchedulerJob, schedulerJobName, type SchedulerJob } from "./adapters/scheduler.js"
import { MoriMockBffStore } from "./adapters/mori.js"
import { moriExportInput, moriGenerationInput, moriPageInput, moriProjectInput, moriSongPlanInput } from "./modules/mori/input.js"
import { scheduledCreateInput, scheduledPatchInput } from "./modules/scheduled/input.js"
import { mutationTicket, type IdempotencyEntry, type IdempotencyReceipt, type MutationTicket } from "./application/idempotency.js"
import {
  agentSessionAssertion,
  agentMessageListData,
  agentSessionListData,
  billingPlansData,
  capabilityMcpData,
  capabilitySkillsData,
  checkoutUrlData,
  dataOf,
  libraryData,
  libraryItemType,
  mappedOwnerQuery,
  messageCursor,
  modelCatalogData,
  ownerIdentityHeaders,
  resolveTenantForManifest,
  stringField,
  systemManifestData,
  type BillingPlanProjection,
  type CapabilitySkillProjection,
} from "./application/projections.js"
import { normalizeUpstreamResponse, reply, send } from "./http/response.js"
import {
  authorize,
  authorizeServerOnly,
  incomingHeaders,
  headerString,
  idempotencyKey,
  isMutation,
  isRecord,
  pathOf,
  queryOf,
  readBody,
  requestBodyJson,
  requestId,
  requiresIdempotency,
  stableStringify,
  type Context,
} from "./http/request.js"

const PLATFORMS = new Set<AgentConnectionSetup["platform"]>(["telegram", "line", "slack"])

type GithubSkillSource = {
  source_url: string
  owner: string
  repository: string
  name: string
  description: string
}

function mcpRegisterInput(value: Record<string, unknown>): {
  name: string
  transport: McpTransport
  url: string
  allowed_tools: string[]
  secret_ref: string | null
} | null {
  const name = typeof value.name === "string" ? value.name.trim() : ""
  const transport = value.transport
  const url = typeof value.url === "string" ? value.url.trim() : ""
  const allowedTools = value.allowed_tools
  const secretRef = value.secret_ref
  if (
    name === ""
    || (transport !== "http" && transport !== "streamable_http")
    || url === ""
    || !Array.isArray(allowedTools)
    || !allowedTools.every((tool): tool is string => typeof tool === "string")
    || (secretRef !== undefined && secretRef !== null && typeof secretRef !== "string")
  ) return null
  return {
    name,
    transport,
    url,
    allowed_tools: [...allowedTools],
    secret_ref: secretRef === undefined ? null : secretRef,
  }
}

function githubSkillSource(value: unknown): GithubSkillSource | null {
  if (typeof value !== "string" || value.trim() === "") return null
  const sourceUrl = value.trim().replace(/\/$/u, "")
  let parsed: URL
  try {
    parsed = new URL(sourceUrl)
  } catch {
    return null
  }
  if (parsed.protocol !== "https:" || !["github.com", "www.github.com"].includes(parsed.hostname) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    return null
  }

  const parts = parsed.pathname.split("/").filter(Boolean)
  if (parts.length !== 2) return null
  const owner = parts[0]
  const repository = parts[1]?.replace(/\.git$/u, "")
  if (owner === undefined || repository === undefined || !/^[A-Za-z0-9_.-]+$/u.test(owner) || !/^[A-Za-z0-9_.-]+$/u.test(repository)) {
    return null
  }
  const canonical = `https://github.com/${owner}/${repository}`
  return {
    source_url: canonical,
    owner,
    repository,
    name: repository,
    description: `Mock GitHub skill from ${owner}/${repository}`,
  }
}

function projectData(projects: Project[]): { projects: Project[] } { return { projects } }
function taskData(tasks: Task[]): { tasks: Task[] } { return { tasks } }
function skillData(skills: Skill[]): { skills: Skill[] } { return { skills } }
function scheduledData(tasks: ScheduledTask[]): { tasks: ScheduledTask[] } { return { tasks } }
function chatSessionsData(sessions: ChatSessionSummary[], nextCursor: string | null = null): { sessions: ChatSessionSummary[]; next_cursor: string | null } {
  return { sessions, next_cursor: nextCursor }
}

function sessionScope(request: IncomingMessage, context: Context): { scope: string; projectRef?: string } | { error: string } {
  const query = queryOf(request)
  const requestedScope = query.get("scope")?.trim()
  if (requestedScope !== undefined && requestedScope !== "" && requestedScope !== "direct") {
    return { error: "scope must be direct when provided" }
  }
  const projectRef = query.get("project_ref")?.trim() || undefined
  return { scope: context.identity.namespace, ...(projectRef === undefined ? {} : { projectRef }) }
}

function mockControlReceipt(runId: string, commandId: string, body: Record<string, unknown>): Record<string, unknown> {
  const requestDigest = createHash("sha256").update(stableStringify(body)).digest("hex")
  return {
    run_id: runId,
    command_id: commandId,
    request_digest: `sha256:${requestDigest}`,
    status: "succeeded",
    replayed: false,
  }
}
function chatSessionDetailData(detail: ChatSessionDetail): ChatSessionDetail {
  return detail
}
function chatShareData(shareId: string): { share_id: string } { return { share_id: shareId } }
function chatSseFrame(event: ChatEvent): string {
  return `id: ${event.seq}\nevent: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`
}

function waitForSsePoll(request: IncomingMessage, response: ServerResponse, delayMs: number): Promise<boolean> {
  if (request.aborted || response.destroyed || response.writableEnded) return Promise.resolve(false)
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      cleanup()
      resolve(true)
    }, delayMs)
    const stop = (): void => {
      cleanup()
      resolve(false)
    }
    const cleanup = (): void => {
      clearTimeout(timer)
      request.off("aborted", stop)
      response.off("close", stop)
    }
    request.once("aborted", stop)
    response.once("close", stop)
  })
}

type LiveOwnerResult = { status: number; body: unknown }

async function callAgent(
  config: BffConfig,
  baseUrl: string,
  path: string,
  method: string,
  requestId: string,
  request: IncomingMessage,
  body: Buffer | undefined,
  identity: Context,
  assertionRef: string,
): Promise<{ status: number; body: unknown }> {
  const upstream = await proxyUpstream(
    config,
    baseUrl,
    path,
    method,
    requestId,
    incomingHeaders(request),
    body,
    agentIdentityHeaders(identity.identity, assertionRef),
  )
  return normalizeUpstreamResponse(upstream, requestId)
}

function sendAgentFailure(
  response: ServerResponse,
  result: { status: number; body: unknown },
  context: Context,
  idempotency: Map<string, IdempotencyEntry>,
  mutation: MutationTicket | null,
): void {
  reply(response, result.status, result.body, context, idempotency, mutation)
}

async function liveAgentSession(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  context: Context,
  businessPath: string[],
  body: Buffer | undefined,
  json: Record<string, unknown>,
  mutation: MutationTicket | null,
  idempotency: Map<string, IdempotencyEntry>,
): Promise<boolean> {
  const baseUrl = config.upstreams.agents ?? null
  if (!config.agentEnabled || baseUrl === null) {
    reply(response, 503, failure("agent_not_configured", "Agent execution is disabled or not configured", context.requestId), context, idempotency, mutation)
    return true
  }
  const method = request.method || "GET"
  const sessionId = businessPath[1] || ""
  const assertion = agentSessionAssertion(context, sessionId)

  if (businessPath.length === 1 && method === "GET") {
    try {
      const incomingQuery = queryOf(request)
      const ownerQuery = new URLSearchParams()
      for (const key of ["project_ref", "limit", "cursor"]) {
        const value = incomingQuery.get(key)
        if (value !== null && value !== "") ownerQuery.set(key, value)
      }
      const ownerPath = `/v1/sessions${ownerQuery.size > 0 ? `?${ownerQuery.toString()}` : ""}`
      const result = await callAgent(config, baseUrl, ownerPath, "GET", context.requestId, request, undefined, context, agentSessionAssertion(context, "session-list"))
      if (result.status >= 400) {
        sendAgentFailure(response, result, context, idempotency, mutation)
        return true
      }
      const projected = agentSessionListData(result.body)
      if (projected === null) {
        reply(response, 502, failure("upstream_response_invalid", "Agent session list response is invalid", context.requestId), context, idempotency, mutation)
        return true
      }
      reply(response, 200, ok(projected, context.requestId), context, idempotency, mutation)
    } catch {
      reply(response, 502, failure("upstream_unreachable", "The configured Agent upstream is unavailable", context.requestId), context, idempotency, mutation)
    }
    return true
  }

  if (businessPath.length === 3 && businessPath[2] === "messages" && method === "GET") {
    const incomingQuery = queryOf(request)
    const rawLimit = incomingQuery.get("limit")
    const limit = rawLimit === null || rawLimit === "" ? 20 : Number(rawLimit)
    const cursor = messageCursor(incomingQuery.get("cursor")?.trim() || undefined)
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || cursor === null) {
      reply(response, 400, failure("invalid_pagination", "limit must be between 1 and 100 and cursor must be valid", context.requestId), context, idempotency, mutation)
      return true
    }
    try {
      const ownerPath = `/v1/sessions/${encodeURIComponent(sessionId)}/messages?after_seq=${cursor}&limit=${limit}`
      const result = await callAgent(config, baseUrl, ownerPath, "GET", context.requestId, request, undefined, context, assertion)
      if (result.status >= 400) {
        sendAgentFailure(response, result, context, idempotency, mutation)
        return true
      }
      const projected = agentMessageListData(result.body, limit)
      if (projected === null) {
        reply(response, 502, failure("upstream_response_invalid", "Agent message history response is invalid", context.requestId), context, idempotency, mutation)
        return true
      }
      reply(response, 200, ok(projected, context.requestId), context, idempotency, mutation)
    } catch {
      reply(response, 502, failure("upstream_unreachable", "The configured Agent upstream is unavailable", context.requestId), context, idempotency, mutation)
    }
    return true
  }

  if (businessPath.length === 3 && businessPath[2] === "messages" && method === "POST") {
    if (typeof json.content !== "string" || json.content.trim() === "") {
      reply(response, 400, failure("invalid_message", "Message content is required", context.requestId), context, idempotency, mutation)
      return true
    }
    const key = idempotencyKey(request)
    if (key === null) {
      reply(response, 400, failure("idempotency_key_required", "Mutations require Idempotency-Key", context.requestId), context, idempotency, mutation)
      return true
    }
    const launch = buildAgentLaunch({
      identity: context.identity,
      requestId: context.requestId,
      sessionId,
      idempotencyKey: key,
      content: json.content.trim(),
      ...(typeof json.model === "string" ? { model: json.model } : {}),
      ...(typeof json.agent === "string" ? { agent: json.agent } : {}),
      ...(typeof json.thinking === "boolean" ? { thinking: json.thinking } : {}),
      ...(Array.isArray(json.pinned_skills) ? { pinnedSkills: json.pinned_skills.filter((value): value is string => typeof value === "string") } : {}),
      ...(Array.isArray(json.mcp_servers) ? { mcpServers: json.mcp_servers.filter((value): value is string => typeof value === "string") } : {}),
      ...(typeof json.project_ref === "string" ? { projectRef: json.project_ref } : {}),
    })
    const launchBody = Buffer.from(JSON.stringify(launch.body))
    try {
      const result = await callAgent(config, baseUrl, "/v1/runs", "POST", context.requestId, request, launchBody, context, String((launch.body.execution_identity as Record<string, unknown>).identity_assertion_ref))
      if (result.status >= 400) {
        sendAgentFailure(response, result, context, idempotency, mutation)
        return true
      }
      const data = dataOf(result.body)
      if (data === null || data.run_id !== launch.receipt.run_id) {
        sendAgentFailure(response, { status: 502, body: failure("upstream_response_invalid", "Agent launch receipt did not match the requested run", context.requestId) }, context, idempotency, mutation)
        return true
      }
      reply(response, 202, ok(launch.receipt, context.requestId), context, idempotency, mutation)
    } catch {
      reply(response, 502, failure("upstream_unreachable", "The configured Agent upstream is unavailable", context.requestId), context, idempotency, mutation)
    }
    return true
  }

  if (businessPath.length === 5 && businessPath[2] === "runs" && businessPath[4] === "control" && method === "POST") {
    const control = buildAgentControl(sessionId, json)
    if (control === null) {
      reply(response, 400, failure("invalid_run_control", "Control request does not match the v1 contract", context.requestId), context, idempotency, mutation)
      return true
    }
    const runId = businessPath[3] || ""
    const commandId = idempotencyKey(request)
    if (commandId === null) {
      reply(response, 400, failure("idempotency_key_required", "Control requests require Idempotency-Key", context.requestId), context, idempotency, mutation)
      return true
    }
    try {
      const result = await callAgent(config, baseUrl, `/v1/runs/${encodeURIComponent(runId)}/control`, "POST", context.requestId, request, Buffer.from(JSON.stringify(control)), context, assertion)
      if (result.status >= 400) {
        sendAgentFailure(response, result, context, idempotency, mutation)
        return true
      }
      const receipt = dataOf(result.body)
      if (receipt === null || receipt.command_id !== commandId || receipt.run_id !== runId) {
        sendAgentFailure(response, { status: 502, body: failure("upstream_response_invalid", "Agent control receipt did not match the requested command", context.requestId) }, context, idempotency, mutation)
        return true
      }
      reply(response, 202, ok(receipt, context.requestId), context, idempotency, mutation)
    } catch {
      reply(response, 502, failure("upstream_unreachable", "The configured Agent upstream is unavailable", context.requestId), context, idempotency, mutation)
    }
    return true
  }

  if (businessPath.length === 3 && businessPath[2] === "events" && method === "GET") {
    const lastEventId = headerString(request.headers["last-event-id"]).trim()
    const cursor = lastEventId === "" ? 0 : Number(lastEventId)
    let afterSeq = Number.isInteger(cursor) && cursor >= 0 ? cursor : 0
    let streamStarted = false
    try {
      for (;;) {
        const result = await callAgent(config, baseUrl, `/v1/sessions/${encodeURIComponent(sessionId)}/events?after_seq=${afterSeq}&limit=1000`, "GET", context.requestId, request, undefined, context, assertion)
        if (result.status >= 400) {
          if (!streamStarted) sendAgentFailure(response, result, context, idempotency, mutation)
          else response.end(": upstream-error\n\n")
          return true
        }
        const data = dataOf(result.body)
        const rawEvents = Array.isArray(data?.events) ? data.events as AgentChatEvent[] : null
        if (data === null || rawEvents === null) {
          if (!streamStarted) sendAgentFailure(response, { status: 502, body: failure("upstream_response_invalid", "Agent event replay did not match the v1 contract", context.requestId) }, context, idempotency, mutation)
          else response.end(": upstream-response-invalid\n\n")
          return true
        }
        if (!streamStarted) {
          response.writeHead(200, {
            "content-type": "text/event-stream; charset=utf-8",
            "cache-control": "no-store",
            connection: "keep-alive",
            "x-kokoro-request-id": context.requestId,
          })
          streamStarted = true
        }
        const events = rawEvents.map(mapAgentEvent).filter((event): event is ChatEvent => event !== null)
        if (events.length > 0) {
          response.write(events.map(chatSseFrame).join(""))
          afterSeq = Math.max(afterSeq, ...events.map((event) => event.seq))
        } else {
          response.write(": keep-alive\n\n")
        }
        if (events.some((event) => event.kind === "run.completed" || event.kind === "run.failed")) break
        if (!await waitForSsePoll(request, response, 1000)) break
      }
      if (!response.writableEnded) response.end()
    } catch {
      if (!streamStarted) reply(response, 502, failure("upstream_response_invalid", "Agent event projection failed", context.requestId), context, idempotency, mutation)
      else if (!response.writableEnded) response.end(": upstream-error\n\n")
    }
    return true
  }

  if (businessPath.length === 2 && method === "GET") {
    try {
      const [messagesResult, eventsResult] = await Promise.all([
        callAgent(config, baseUrl, `/v1/sessions/${encodeURIComponent(sessionId)}/messages?after_seq=0&limit=1000`, "GET", context.requestId, request, undefined, context, assertion),
        callAgent(config, baseUrl, `/v1/sessions/${encodeURIComponent(sessionId)}/events?after_seq=0&limit=1000`, "GET", context.requestId, request, undefined, context, assertion),
      ])
      if (messagesResult.status >= 400) {
        sendAgentFailure(response, messagesResult, context, idempotency, mutation)
        return true
      }
      if (eventsResult.status >= 400) {
        sendAgentFailure(response, eventsResult, context, idempotency, mutation)
        return true
      }
      const messagesData = dataOf(messagesResult.body)
      const eventsData = dataOf(eventsResult.body)
      const messages = Array.isArray(messagesData?.messages) ? messagesData.messages as AgentChatMessage[] : null
      const events = Array.isArray(eventsData?.events) ? eventsData.events as AgentChatEvent[] : null
      const watermark = typeof eventsData?.watermark === "number" ? eventsData.watermark : null
      if (messagesData === null || eventsData === null || messages === null || events === null || watermark === null) {
        sendAgentFailure(response, { status: 502, body: failure("upstream_response_invalid", "Agent session projection did not match the v1 contract", context.requestId) }, context, idempotency, mutation)
        return true
      }
      reply(response, 200, ok(buildSessionDetail(context.identity, sessionId, messages, events, watermark), context.requestId), context, idempotency, mutation)
    } catch {
      reply(response, 502, failure("upstream_response_invalid", "Agent session projection failed", context.requestId), context, idempotency, mutation)
    }
    return true
  }

  reply(response, 503, failure("chat_projection_not_configured", "This Chat operation is not exposed by the Agent v1 adapter", context.requestId), context, idempotency, mutation)
  return true
}

async function liveOwnerRequest(
  request: IncomingMessage,
  config: BffConfig,
  context: Context,
  owner: string,
  path: string,
  method: string,
  body?: Buffer,
): Promise<LiveOwnerResult> {
  const baseUrl = config.upstreams[owner] ?? null
  if (baseUrl === null) {
    return { status: 503, body: failure("upstream_not_configured", `No upstream is configured for ${owner}`, context.requestId) }
  }
  try {
    const upstream = await proxyUpstream(
      config,
      baseUrl,
      path,
      method,
      context.requestId,
      incomingHeaders(request),
      body,
      ownerIdentityHeaders(context),
      "web-bff",
    )
    return normalizeUpstreamResponse(upstream, context.requestId)
  } catch {
    return { status: 502, body: failure("upstream_unreachable", `The configured ${owner} upstream is unavailable`, context.requestId) }
  }
}

function scheduledTaskId(context: Context, path: string, key: string): string {
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

async function reconcileSchedulerTask(
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

async function markScheduledTaskFailed(store: PostgresBffRepositories, tenantId: string, taskId: string): Promise<void> {
  await store.services.scheduledTasks.update(tenantId, taskId, { status: "failed", enabled: false })
}

async function schedulerDispatch(
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

async function liveBffBusiness(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  context: Context,
  businessPath: string[],
  json: Record<string, unknown>,
  mutation: MutationTicket | null,
  idempotency: Map<string, IdempotencyEntry>,
  store: PostgresBffRepositories,
): Promise<boolean> {
  const method = request.method || "GET"
  const tenantId = context.identity.namespace
  try {
    if (businessPath[0] === "projects") {
      const projectId = businessPath[1]
      if (businessPath.length === 1 && method === "GET") {
        await reply(response, 200, ok(projectData(await store.services.projects.list(tenantId)), context.requestId), context, idempotency, mutation)
        return true
      }
      if (businessPath.length === 1 && method === "POST") {
        const name = typeof json.name === "string" ? json.name.trim() : ""
        if (name === "") {
          await reply(response, 400, failure("invalid_project", "Project name is required", context.requestId), context, idempotency, mutation)
          return true
        }
        const project = await store.services.projects.create(tenantId, name, typeof json.description === "string" ? json.description : "")
        await reply(response, 200, ok({ project }, context.requestId), context, idempotency, mutation)
        return true
      }
      if (businessPath.length === 2 && projectId !== undefined && method === "GET") {
        const project = await store.services.projects.find(tenantId, projectId)
        await reply(response, project === null ? 404 : 200, project === null ? failure("project_not_found", "Project was not found", context.requestId) : ok({ project }, context.requestId), context, idempotency, mutation)
        return true
      }
      if (businessPath.length === 2 && projectId !== undefined && method === "PATCH") {
        if (typeof json.instruction !== "string") {
          await reply(response, 400, failure("invalid_project_instruction", "Project instruction must be a string", context.requestId), context, idempotency, mutation)
          return true
        }
        const project = await store.services.projects.updateInstruction(tenantId, projectId, json.instruction, context.identity.userId)
        await reply(response, project === null ? 404 : 200, project === null ? failure("project_not_found", "Project was not found", context.requestId) : ok({ project }, context.requestId), context, idempotency, mutation)
        return true
      }
      if (businessPath.length === 3 && projectId !== undefined && businessPath[2] === "instruction-revisions" && method === "GET") {
        const revisions = await store.services.projects.revisions(tenantId, projectId)
        await reply(response, revisions === null ? 404 : 200, revisions === null ? failure("project_not_found", "Project was not found", context.requestId) : ok({ items: revisions }, context.requestId), context, idempotency, mutation)
        return true
      }
      if (businessPath.length === 3 && projectId !== undefined && businessPath[2] === "tasks" && method === "GET") {
        if (await store.services.projects.find(tenantId, projectId) === null) {
          await reply(response, 404, failure("project_not_found", "Project was not found", context.requestId), context, idempotency, mutation)
        } else {
          await reply(response, 200, ok({ tasks: await store.services.projects.tasks(tenantId, projectId) }, context.requestId), context, idempotency, mutation)
        }
        return true
      }
      if (businessPath.length === 3 && projectId !== undefined && businessPath[2] === "resources" && method === "POST") {
        await reply(response, 503, failure("storage_projection_not_configured", "Storage resource projection is not configured", context.requestId), context, idempotency, mutation)
        return true
      }
      if (businessPath.length === 4 && projectId !== undefined && businessPath[2] === "skills" && businessPath[3] !== undefined && method === "PATCH") {
        if (typeof json.enabled !== "boolean") {
          await reply(response, 400, failure("invalid_project_skill", "Skill enabled must be a boolean", context.requestId), context, idempotency, mutation)
          return true
        }
        const project = await store.services.projects.find(tenantId, projectId)
        if (project === null) {
          await reply(response, 404, failure("project_not_found", "Project was not found", context.requestId), context, idempotency, mutation)
        } else {
          await store.services.projects.setSkill(tenantId, project.id, businessPath[3], json.enabled)
          await reply(response, 200, ok({ skill: { project_id: project.id, name: businessPath[3], enabled: json.enabled } }, context.requestId), context, idempotency, mutation)
        }
        return true
      }
      if (businessPath.length === 3 && projectId !== undefined && businessPath[2] === "scheduled-tasks" && method === "POST") {
        const input = scheduledCreateInput(json, projectId)
        if (input === null) {
          await reply(response, 400, failure("invalid_scheduled_task", "Scheduled task fields are invalid", context.requestId), context, idempotency, mutation)
          return true
        }
        let task = await store.services.scheduledTasks.create(
          tenantId,
          context.identity.userId,
          input,
          scheduledTaskId(context, `/${businessPath.join("/")}`, idempotencyKey(request) ?? randomUUID()),
        )
        if (task.status === "failed") {
          task = (await store.services.scheduledTasks.update(tenantId, task.id, { status: "active", enabled: true })) ?? task
        }
        const scheduleResult = await reconcileSchedulerTask(request, config, context, task, context.identity.userId, "register")
        if (scheduleResult.status >= 400) {
          await markScheduledTaskFailed(store, tenantId, task.id)
          await reply(response, 503, failure("scheduler_registration_failed", "Scheduled task could not be registered", context.requestId), context, idempotency, mutation)
        } else {
          await reply(response, 200, ok({ task }, context.requestId), context, idempotency, mutation)
        }
        return true
      }
    }

    if (businessPath[0] === "scheduled-tasks") {
      const taskId = businessPath[1]
      if (businessPath.length === 1 && method === "GET") {
        await reply(response, 200, ok(scheduledData(await store.services.scheduledTasks.list(tenantId)), context.requestId), context, idempotency, mutation)
        return true
      }
      if (businessPath.length === 1 && method === "POST") {
        const input = scheduledCreateInput(json, typeof json.project_id === "string" ? json.project_id : undefined)
        if (input === null) {
          await reply(response, 400, failure("invalid_scheduled_task", "Scheduled task fields are invalid", context.requestId), context, idempotency, mutation)
          return true
        }
        let task = await store.services.scheduledTasks.create(
          tenantId,
          context.identity.userId,
          input,
          scheduledTaskId(context, `/${businessPath.join("/")}`, idempotencyKey(request) ?? randomUUID()),
        )
        if (task.status === "failed") {
          task = (await store.services.scheduledTasks.update(tenantId, task.id, { status: "active", enabled: true })) ?? task
        }
        const scheduleResult = await reconcileSchedulerTask(request, config, context, task, context.identity.userId, "register")
        if (scheduleResult.status >= 400) {
          await markScheduledTaskFailed(store, tenantId, task.id)
          await reply(response, 503, failure("scheduler_registration_failed", "Scheduled task could not be registered", context.requestId), context, idempotency, mutation)
        } else {
          await reply(response, 200, ok({ task }, context.requestId), context, idempotency, mutation)
        }
        return true
      }
      if (businessPath.length === 2 && taskId !== undefined && method === "GET") {
        const task = await store.services.scheduledTasks.find(tenantId, taskId)
        await reply(response, task === null ? 404 : 200, task === null ? failure("scheduled_task_not_found", "Scheduled task was not found", context.requestId) : ok({ task }, context.requestId), context, idempotency, mutation)
        return true
      }
      if (businessPath.length === 2 && taskId !== undefined && method === "PATCH") {
        const patch = scheduledPatchInput(json)
        if (patch === null) {
          await reply(response, 400, failure("invalid_scheduled_task", "Scheduled task fields are invalid", context.requestId), context, idempotency, mutation)
          return true
        }
        const record = taskId === undefined ? null : await store.services.scheduledTasks.findRecord(tenantId, taskId)
        const task = record === null ? null : await store.services.scheduledTasks.update(tenantId, taskId, patch)
        if (task === null) {
          await reply(response, 404, failure("scheduled_task_not_found", "Scheduled task was not found", context.requestId), context, idempotency, mutation)
        } else {
          const scheduleResult = await reconcileSchedulerTask(request, config, context, task, record?.ownerId ?? context.identity.userId, "replace")
          if (scheduleResult.status >= 400) {
            await markScheduledTaskFailed(store, tenantId, task.id)
            await reply(response, 503, failure("scheduler_update_failed", "Scheduled task scheduler registration could not be updated", context.requestId), context, idempotency, mutation)
          } else {
            await reply(response, 200, ok({ task }, context.requestId), context, idempotency, mutation)
          }
        }
        return true
      }
      if (businessPath.length === 2 && taskId !== undefined && method === "DELETE") {
        const record = await store.services.scheduledTasks.findRecord(tenantId, taskId)
        if (record === null) {
          await reply(response, 404, failure("scheduled_task_not_found", "Scheduled task was not found", context.requestId), context, idempotency, mutation)
        } else {
          const scheduleResult = await reconcileSchedulerTask(request, config, context, record.task, record.ownerId, "delete")
          if (scheduleResult.status >= 400) {
            await reply(response, 503, failure("scheduler_delete_failed", "Scheduled task scheduler registration could not be removed", context.requestId), context, idempotency, mutation)
          } else {
            const deleted = await store.services.scheduledTasks.delete(tenantId, taskId)
            await reply(response, deleted ? 200 : 404, deleted ? ok({ ok: true }, context.requestId) : failure("scheduled_task_not_found", "Scheduled task was not found", context.requestId), context, idempotency, mutation)
          }
        }
        return true
      }
      if (businessPath.length === 3 && taskId !== undefined && businessPath[2] === "retry" && method === "POST") {
        const record = await store.services.scheduledTasks.findRecord(tenantId, taskId)
        const task = record === null ? null : await store.services.scheduledTasks.update(tenantId, taskId, { status: "active", enabled: true })
        if (task === null) {
          await reply(response, 404, failure("scheduled_task_not_found", "Scheduled task was not found", context.requestId), context, idempotency, mutation)
        } else {
          const scheduleResult = await reconcileSchedulerTask(request, config, context, task, record?.ownerId ?? context.identity.userId, "replace")
          if (scheduleResult.status >= 400) {
            await markScheduledTaskFailed(store, tenantId, task.id)
            await reply(response, 503, failure("scheduler_retry_failed", "Scheduled task could not be registered again", context.requestId), context, idempotency, mutation)
          } else {
            await reply(response, 200, ok({ task }, context.requestId), context, idempotency, mutation)
          }
        }
        return true
      }
    }
    return false
  } catch (error) {
    if (error instanceof Error && error.message === "PROJECT_SLUG_CONFLICT") {
      await reply(response, 409, failure("project_exists", "A project with this slug already exists", context.requestId), context, idempotency, mutation)
    } else if (error instanceof Error && error.message === "PROJECT_NOT_FOUND") {
      await reply(response, 404, failure("project_not_found", "Project was not found", context.requestId), context, idempotency, mutation)
    } else {
      await reply(response, 503, failure("business_store_unavailable", "The BFF business store is unavailable", context.requestId), context, idempotency, mutation)
    }
    return true
  }
}

async function liveOwnerBusiness(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  context: Context,
  businessPath: string[],
  json: Record<string, unknown>,
  mutation: MutationTicket | null,
  idempotency: Map<string, IdempotencyEntry>,
): Promise<boolean> {
  const method = request.method || "GET"

  if (businessPath.length === 2 && businessPath[0] === "system" && businessPath[1] === "runtime-manifest" && method === "GET") {
    const query = queryOf(request)
    const productId = query.get("product_id")?.trim() ?? ""
    const locale = query.get("locale")?.trim() || "en-US"
    const surfaceId = query.get("surface_id")?.trim() || "user-web"
    if (productId === "" || locale === "" || surfaceId === "") {
      await reply(response, 400, failure("invalid_runtime_manifest_request", "product_id, locale, and surface_id are required", context.requestId), context, idempotency, mutation)
      return true
    }
    const ownerQuery = new URLSearchParams({ product_id: productId, locale, surface_id: surfaceId })
    const result = await liveOwnerRequest(request, config, context, "system", `/system/runtime-manifest?${ownerQuery.toString()}`, method)
    if (result.status >= 400) {
      await reply(response, result.status, result.body, context, idempotency, mutation)
      return true
    }
    const projected = systemManifestData(result.body)
    if (projected === null || projected.product_id !== productId || projected.locale !== locale) {
      await reply(response, 502, failure("upstream_response_invalid", "System runtime manifest did not match the v1 owner contract", context.requestId), context, idempotency, mutation)
      return true
    }
    await reply(response, result.status, ok(projected, context.requestId), context, idempotency, mutation)
    return true
  }
  if (businessPath[0] === "system") {
    await reply(response, 503, failure("system_projection_not_configured", "This System operation is not exposed by the BFF owner adapter", context.requestId), context, idempotency, mutation)
    return true
  }

  const capabilityPath = businessPath[0] === "skills"
    ? businessPath.length === 1 && method === "GET"
      ? "/bff/skills"
      : businessPath.length === 2 && businessPath[1] === "pool" && method === "GET"
        ? "/bff/skills/pool"
        : businessPath.length === 2 && businessPath[1] === "catalog" && method === "GET"
          ? "/bff/skills/catalog"
          : null
    : businessPath.length === 2 && businessPath[0] === "mcp" && businessPath[1] === "servers" && method === "GET"
      ? "/bff/mcp/servers"
      : null
  if (capabilityPath !== null) {
    const query = capabilityPath === "/bff/mcp/servers"
      ? mappedOwnerQuery(request, { provider_key: "provider_key", limit: "limit", cursor: "cursor" })
      : mappedOwnerQuery(request, { q: "q", query: "query", tags: "tags", scope_kind: "scope_kind", limit: "limit", cursor: "cursor" })
    const result = await liveOwnerRequest(request, config, context, "capability", `${capabilityPath}${query}`, method)
    if (result.status >= 400) {
      await reply(response, result.status, result.body, context, idempotency, mutation)
      return true
    }
    const projected = capabilityPath === "/bff/mcp/servers"
      ? capabilityMcpData(result.body, context.identity.namespace)
      : capabilitySkillsData(result.body, capabilityPath === "/bff/skills/catalog")
    if (projected === null) {
      await reply(response, 502, failure("upstream_response_invalid", "Capability projection did not match the v1 owner contract", context.requestId), context, idempotency, mutation)
      return true
    }
    await reply(response, result.status, ok(projected, context.requestId), context, idempotency, mutation)
    return true
  }
  if (businessPath[0] === "skills" || businessPath[0] === "mcp") {
    await reply(response, 503, failure("capability_projection_not_configured", "This Capability operation is not exposed by the BFF owner adapter", context.requestId), context, idempotency, mutation)
    return true
  }

  if (businessPath.length === 1 && businessPath[0] === "library" && method === "GET") {
    const result = await liveOwnerRequest(request, config, context, "storage", "/internal/bff/library", method)
    if (result.status >= 400) {
      await reply(response, result.status, result.body, context, idempotency, mutation)
      return true
    }
    const projected = libraryData(result.body)
    if (projected === null) {
      await reply(response, 502, failure("upstream_response_invalid", "Storage library projection did not match the v1 owner contract", context.requestId), context, idempotency, mutation)
      return true
    }
    await reply(response, result.status, ok(projected, context.requestId), context, idempotency, mutation)
    return true
  }
  if (businessPath[0] === "library" || businessPath[0] === "assets" || businessPath[0] === "artifacts") {
    await reply(response, 503, failure("storage_projection_not_configured", "This Storage operation is not exposed by the BFF owner adapter", context.requestId), context, idempotency, mutation)
    return true
  }

  if (businessPath.length === 1 && businessPath[0] === "models" && method === "GET") {
    const query = queryOf(request)
    const ownerQuery = new URLSearchParams()
    for (const [incomingName, ownerName] of [["feature_key", "featureKey"], ["limit", "limit"], ["cursor", "cursor"]] as const) {
      const value = query.get(incomingName)?.trim()
      if (value) ownerQuery.set(ownerName, value)
    }
    const path = `/bff/model-catalog${ownerQuery.size === 0 ? "" : `?${ownerQuery.toString()}`}`
    const result = await liveOwnerRequest(request, config, context, "model", path, method)
    if (result.status >= 400) {
      await reply(response, result.status, result.body, context, idempotency, mutation)
      return true
    }
    const projected = modelCatalogData(result.body)
    if (projected === null) {
      await reply(response, 502, failure("upstream_response_invalid", "Model catalog did not match the v1 owner contract", context.requestId), context, idempotency, mutation)
      return true
    }
    await reply(response, result.status, ok(projected, context.requestId), context, idempotency, mutation)
    return true
  }

  if (businessPath[0] === "billing" && businessPath[1] === "plans" && businessPath.length === 2 && method === "GET") {
    const result = await liveOwnerRequest(request, config, context, "billing", "/v1/commerce/catalog", method)
    if (result.status >= 400) {
      await reply(response, result.status, result.body, context, idempotency, mutation)
      return true
    }
    const projected = billingPlansData(result.body)
    if (projected === null) {
      await reply(response, 502, failure("upstream_response_invalid", "Billing catalog did not match the v1 owner contract", context.requestId), context, idempotency, mutation)
      return true
    }
    await reply(response, result.status, ok(projected, context.requestId), context, idempotency, mutation)
    return true
  }

  if (businessPath[0] === "billing" && businessPath[1] === "checkout" && businessPath.length === 2 && method === "POST") {
    const planId = typeof json.plan_id === "string" ? json.plan_id.trim() : ""
    if (planId === "") {
      await reply(response, 400, failure("invalid_checkout", "plan_id is required", context.requestId), context, idempotency, mutation)
      return true
    }
    const catalogResult = await liveOwnerRequest(request, config, context, "billing", "/v1/commerce/catalog", "GET")
    if (catalogResult.status >= 400) {
      await reply(response, catalogResult.status, catalogResult.body, context, idempotency, mutation)
      return true
    }
    const catalog = billingPlansData(catalogResult.body)
    const plan = catalog?.plans.find((candidate) => candidate.id === planId)
    if (plan === undefined) {
      await reply(response, 404, failure("plan_not_found", "Billing plan was not found", context.requestId, ), context, idempotency, mutation)
      return true
    }
    const checkoutBody = Buffer.from(JSON.stringify({
      offer_revision_id: plan.id,
      amount_minor: plan.amount_minor,
      currency: plan.currency,
      quote_snapshot: {
        key: plan.key,
        credit_micros: plan.credit_micros,
        name: plan.name,
        plan_id: plan.id,
      },
    }))
    const checkoutResult = await liveOwnerRequest(request, config, context, "billing", "/v1/billing/checkout", method, checkoutBody)
    if (checkoutResult.status >= 400) {
      await reply(response, checkoutResult.status, checkoutResult.body, context, idempotency, mutation)
      return true
    }
    const projected = checkoutUrlData(checkoutResult.body)
    if (projected === null) {
      await reply(response, 502, failure("upstream_response_invalid", "Billing checkout did not return a checkout URL", context.requestId), context, idempotency, mutation)
      return true
    }
    await reply(response, checkoutResult.status, ok(projected, context.requestId), context, idempotency, mutation)
    return true
  }

  return false
}

function skillPoolData(skills: Skill[]): { skills: Array<{
  name: string
  description: string
  content_hash: string
  scope: string
  enabled?: boolean
  categories?: string[]
  updated_at?: number
}> } {
  return {
    skills: skills.map((skill) => ({
      name: skill.name,
      description: skill.description,
      content_hash: skill.content_hash,
      scope: skill.scope,
      ...(skill.enabled === undefined ? {} : { enabled: skill.enabled }),
      ...(skill.categories === undefined ? {} : { categories: skill.categories }),
      ...(skill.updated_at === undefined ? {} : { updated_at: skill.updated_at }),
    })),
  }
}

function skillCatalogData(skills: Skill[]): { skills: Array<{
  name: string
  description: string
  content_hash: string
  scope: string
  installed: boolean
  enabled: boolean
  categories?: string[]
  updated_at?: number
}>; next_cursor: null } {
  return {
    skills: skills.map((skill) => ({
      name: skill.name,
      description: skill.description,
      content_hash: skill.content_hash,
      scope: skill.scope,
      installed: skill.installed ?? true,
      enabled: skill.enabled ?? true,
      ...(skill.categories === undefined ? {} : { categories: skill.categories }),
      ...(skill.updated_at === undefined ? {} : { updated_at: skill.updated_at }),
    })),
    next_cursor: null,
  }
}

async function mockMoriBusiness(
  request: IncomingMessage,
  response: ServerResponse,
  segments: string[],
  context: Context,
  mori: MoriMockBffStore,
  idempotency: Map<string, IdempotencyEntry>,
  mutation: MutationTicket | null,
  json: Record<string, unknown>,
): Promise<boolean> {
  if (segments[0] !== "mori") return false
  const method = request.method || "GET"

  if (segments.length === 2 && segments[1] === "projects" && method === "GET") {
    const pagination = moriPageInput(request)
    const projects = pagination === null ? null : mori.listProjectsPage(pagination.cursor, pagination.limit)
    if (pagination === null) await reply(response, 400, failure("invalid_pagination", "limit must be between 1 and 100", context.requestId), context, idempotency, mutation)
    else if (projects === null) await reply(response, 400, failure("invalid_cursor", "cursor is invalid", context.requestId), context, idempotency, mutation)
    else await reply(response, 200, ok({ projects: projects.items, next_cursor: projects.next_cursor }, context.requestId), context, idempotency, mutation)
    return true
  }

  if (segments.length === 2 && segments[1] === "projects" && method === "POST") {
    const input = moriProjectInput(json)
    if (input === null) await reply(response, 400, failure("invalid_project", "Project input does not match the Mori contract", context.requestId), context, idempotency, mutation)
    else await reply(response, 201, ok(mori.createProject(input.title, input.description), context.requestId), context, idempotency, mutation)
    return true
  }

  if (segments.length === 3 && segments[1] === "projects" && method === "GET") {
    const project = mori.findProject(segments[2] || "")
    if (project === undefined) await reply(response, 404, failure("project_not_found", "Mori project was not found", context.requestId), context, idempotency, mutation)
    else await reply(response, 200, ok(project, context.requestId), context, idempotency, mutation)
    return true
  }

  if (segments.length === 4 && segments[1] === "projects" && segments[3] === "song_plans" && method === "POST") {
    const projectRef = segments[2] || ""
    if (mori.findProject(projectRef) === undefined) {
      await reply(response, 404, failure("project_not_found", "Mori project was not found", context.requestId), context, idempotency, mutation)
      return true
    }
    const input = moriSongPlanInput(json)
    if (input === null) await reply(response, 400, failure("invalid_song_plan", "Song Plan input does not match the Mori contract", context.requestId), context, idempotency, mutation)
    else await reply(response, 201, ok(mori.createSongPlan(projectRef, input), context.requestId), context, idempotency, mutation)
    return true
  }

  if (segments.length === 4 && segments[1] === "projects" && segments[3] === "generations" && method === "POST") {
    const projectRef = segments[2] || ""
    if (mori.findProject(projectRef) === undefined) {
      await reply(response, 404, failure("project_not_found", "Mori project was not found", context.requestId), context, idempotency, mutation)
      return true
    }
    const input = moriGenerationInput(json)
    if (input === null) {
      await reply(response, 400, failure("invalid_generation", "Generation input does not match the Mori contract", context.requestId), context, idempotency, mutation)
      return true
    }
    const generation = mori.createGeneration(projectRef, input)
    await reply(response, 202, ok({ generation_ref: generation.generation_ref, status: generation.status }, context.requestId), context, idempotency, mutation)
    return true
  }

  if (segments.length === 3 && segments[1] === "generations" && method === "GET") {
    const generation = mori.findGeneration(segments[2] || "")
    if (generation === undefined) await reply(response, 404, failure("generation_not_found", "Mori generation was not found", context.requestId), context, idempotency, mutation)
    else await reply(response, 200, ok(generation, context.requestId), context, idempotency, mutation)
    return true
  }

  if (segments.length === 4 && segments[1] === "generations" && segments[3] === "cancel" && method === "POST") {
    const generation = mori.cancelGeneration(segments[2] || "")
    if (generation === null) await reply(response, 404, failure("generation_not_found", "Mori generation was not found", context.requestId), context, idempotency, mutation)
    else await reply(response, 202, ok({ generation_ref: generation.generation_ref, status: generation.status }, context.requestId), context, idempotency, mutation)
    return true
  }

  if (segments.length === 4 && segments[1] === "generations" && segments[3] === "events" && method === "GET") {
    const generationRef = segments[2] || ""
    const lastEventId = headerString(request.headers["last-event-id"]).trim() || null
    const result = mori.eventsSince(generationRef, lastEventId)
    if (result === null) {
      await reply(response, 404, failure("generation_not_found", "Mori generation was not found", context.requestId), context, idempotency, mutation)
      return true
    }
    if (result.invalid) {
      await reply(response, 400, failure("invalid_event_cursor", "Last-Event-ID is invalid", context.requestId), context, idempotency, mutation)
      return true
    }
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive",
    })
    const body = result.events.length === 0
      ? ": keep-alive\n\n"
      : result.events.map((event) => `id: ${event.id}\nevent: ${event.event}\ndata: ${JSON.stringify(ok(event.data, context.requestId))}\n\n`).join("")
    response.end(body)
    return true
  }

  if (segments.length === 4 && segments[1] === "projects" && segments[3] === "candidates" && method === "GET") {
    const projectRef = segments[2] || ""
    if (mori.findProject(projectRef) === undefined) {
      await reply(response, 404, failure("project_not_found", "Mori project was not found", context.requestId), context, idempotency, mutation)
      return true
    }
    const pagination = moriPageInput(request)
    const candidates = pagination === null ? null : mori.listCandidates(projectRef, pagination.cursor, pagination.limit)
    if (pagination === null) await reply(response, 400, failure("invalid_pagination", "limit must be between 1 and 100", context.requestId), context, idempotency, mutation)
    else if (candidates === null) await reply(response, 400, failure("invalid_cursor", "cursor is invalid", context.requestId), context, idempotency, mutation)
    else await reply(response, 200, ok({ candidates: candidates.items, next_cursor: candidates.next_cursor }, context.requestId), context, idempotency, mutation)
    return true
  }

  if (segments.length === 4 && segments[1] === "candidates" && segments[3] === "promote" && method === "POST") {
    const version = mori.promoteCandidate(segments[2] || "")
    if (version === null) await reply(response, 404, failure("candidate_not_found", "Mori candidate was not found", context.requestId), context, idempotency, mutation)
    else await reply(response, 201, ok({
      version_ref: version.version_ref,
      project_ref: version.project_ref,
      source_candidate_ref: version.source_candidate_ref,
      status: version.status,
    }, context.requestId), context, idempotency, mutation)
    return true
  }

  if (segments.length === 4 && segments[1] === "versions" && segments[3] === "remix" && method === "POST") {
    const version = mori.findVersion(segments[2] || "")
    const sourceInput = version === undefined ? null : mori.generationInputForVersion(version.version_ref)
    if (version === undefined || sourceInput === null) {
      await reply(response, 404, failure("version_not_found", "Mori version was not found", context.requestId), context, idempotency, mutation)
      return true
    }
    const input = Object.keys(json).length === 0 ? sourceInput : moriGenerationInput(json)
    if (input === null) await reply(response, 400, failure("invalid_generation", "Remix input does not match the Mori contract", context.requestId), context, idempotency, mutation)
    else {
      const generation = mori.createGeneration(version.project_ref, input)
      await reply(response, 202, ok({ generation_ref: generation.generation_ref, status: generation.status }, context.requestId), context, idempotency, mutation)
    }
    return true
  }

  if (segments.length === 2 && segments[1] === "library" && method === "GET") {
    const kind = queryOf(request).get("kind")?.trim() || "all"
    if (kind !== "all" && kind !== "version") {
      await reply(response, 400, failure("invalid_library_kind", "kind must be all or version", context.requestId), context, idempotency, mutation)
      return true
    }
    const pagination = moriPageInput(request)
    const library = pagination === null ? null : mori.listLibrary(kind, pagination.cursor, pagination.limit)
    if (pagination === null) await reply(response, 400, failure("invalid_pagination", "limit must be between 1 and 100", context.requestId), context, idempotency, mutation)
    else if (library === null) await reply(response, 400, failure("invalid_cursor", "cursor is invalid", context.requestId), context, idempotency, mutation)
    else await reply(response, 200, ok({ items: library.items, next_cursor: library.next_cursor }, context.requestId), context, idempotency, mutation)
    return true
  }

  if (segments.length === 4 && segments[1] === "versions" && segments[3] === "exports" && method === "POST") {
    const format = moriExportInput(json)
    if (format === null) {
      await reply(response, 400, failure("invalid_export", "Export format must be mp3 or wav", context.requestId), context, idempotency, mutation)
      return true
    }
    const exportRecord = mori.createExport(segments[2] || "", format)
    if (exportRecord === null) await reply(response, 404, failure("version_not_found", "Mori version was not found", context.requestId), context, idempotency, mutation)
    else await reply(response, 202, ok({ export_ref: exportRecord.export_ref, status: exportRecord.status }, context.requestId), context, idempotency, mutation)
    return true
  }

  if (segments.length === 3 && segments[1] === "exports" && method === "GET") {
    const exportRecord = mori.findExport(segments[2] || "")
    if (exportRecord === undefined) await reply(response, 404, failure("export_not_found", "Mori export was not found", context.requestId), context, idempotency, mutation)
    else await reply(response, 200, ok(exportRecord, context.requestId), context, idempotency, mutation)
    return true
  }

  await reply(response, 404, failure("mori_route_not_found", "Mori business route was not found", context.requestId), context, idempotency, mutation)
  return true
}

async function mockBusiness(
  request: IncomingMessage,
  response: ServerResponse,
  segments: string[],
  context: Context,
  store: MockBffStore,
  mori: MoriMockBffStore,
  idempotency: Map<string, IdempotencyEntry>,
  mutation: MutationTicket | null,
  json: Record<string, unknown>,
): Promise<void> {
  const method = request.method || "GET"
  let status = 200
  let payload: unknown

  if (segments[0] === "mori") {
    await mockMoriBusiness(request, response, segments, context, mori, idempotency, mutation, json)
    return
  }
  if (segments[0] === "sessions") {
    const sessionId = segments[1] || ""
    const scoped = sessionScope(request, context)
    if ("error" in scoped) {
      status = 400
      payload = failure("invalid_session_scope", scoped.error, context.requestId)
    } else if (segments.length === 1 && method === "GET") {
      payload = chatSessionsData(store.listSessions(scoped.scope, scoped.projectRef))
    }
    else if (segments.length === 2 && method === "GET") {
      const detail = store.readSession(sessionId, scoped.scope, scoped.projectRef)
      if (detail === undefined) {
        status = 404
        payload = failure("session_not_found", "Session was not found", context.requestId)
      } else payload = chatSessionDetailData(detail)
    } else if (segments.length === 3 && segments[2] === "messages" && method === "GET") {
      const query = queryOf(request)
      const limit = Number(query.get("limit") || "20")
      const cursor = query.get("cursor")?.trim() || undefined
      const result = Number.isInteger(limit) && limit >= 1 && limit <= 100
        ? store.listSessionMessages(sessionId, scoped.scope, scoped.projectRef, cursor, limit)
        : undefined
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        status = 400
        payload = failure("invalid_pagination", "limit must be between 1 and 100", context.requestId)
      } else if (result === undefined) {
        status = 404
        payload = failure("session_not_found", "Session was not found", context.requestId)
      } else if ("invalid_cursor" in result) {
        status = 400
        payload = failure("invalid_cursor", "cursor is invalid", context.requestId)
      } else payload = result
    } else if (segments.length === 3 && segments[2] === "messages" && method === "POST") {
      if (typeof json.content !== "string" || json.content.trim() === "") {
        status = 400
        payload = failure("invalid_message", "Message content is required", context.requestId)
      } else {
        const result = store.submitSessionMessage(sessionId, json.content.trim(), scoped.scope, scoped.projectRef)
        if (result === null) {
          status = 404
          payload = failure("session_not_found", "Session was not found", context.requestId)
        } else {
          status = 202
          payload = result
          setTimeout(() => { store.completeSessionRun(sessionId, result.run_id, json.content as string, scoped.scope, scoped.projectRef) }, 10)
        }
      }
    } else if (segments.length === 3 && segments[2] === "events" && method === "GET") {
      const detail = store.readSession(sessionId, scoped.scope, scoped.projectRef)
      if (detail === undefined) {
        status = 404
        payload = failure("session_not_found", "Session was not found", context.requestId)
      } else {
        const session = store.findSession(sessionId, scoped.scope, scoped.projectRef)
        const lastEventIdHeader = headerString(request.headers["last-event-id"]).trim()
        const cursor = lastEventIdHeader === "" ? 0 : Number(lastEventIdHeader)
        const events = session?.events.filter((event) => event.seq > (Number.isFinite(cursor) ? cursor : 0)) ?? []
        response.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-store",
          connection: "keep-alive",
        })
        if (events.length === 0) {
          response.end(": keep-alive\n\n")
          return
        }
        response.end(events.map((event) => chatSseFrame(event)).join(""))
        return
      }
    } else if (segments.length === 5 && segments[2] === "runs" && segments[4] === "control" && method === "POST") {
      const control = buildAgentControl(sessionId, json)
      const action = control?.kind === "run.cancel"
        ? "cancel"
        : control?.kind === "run.resume"
          ? "resume"
          : control?.kind === "run.steer"
            ? "steer"
            : ""
      const decisions = Array.isArray(json.decisions)
        ? json.decisions.map((decision) => typeof decision === "string" ? decision : JSON.stringify(decision))
        : undefined
      if (control === null || action === "") {
        status = 400
        payload = failure("invalid_run_control", "Control request does not match the v1 contract", context.requestId)
      } else {
        const commandId = idempotencyKey(request) || "mock-command"
        const result = store.controlSessionRun(sessionId, segments[3] || "", action, decisions, scoped.scope, scoped.projectRef)
        if (result === null) {
          status = 404
          payload = failure("run_not_found", "Run was not found", context.requestId)
        } else {
          status = 202
          payload = mockControlReceipt(segments[3] || "", commandId, json)
        }
      }
    } else if (segments.length === 3 && segments[2] === "title" && method === "PATCH") {
      if (typeof json.title !== "string" || json.title.trim() === "") {
        status = 400
        payload = failure("invalid_title", "Title is required", context.requestId)
      } else {
        const session = store.updateSessionTitle(sessionId, json.title.trim(), scoped.scope, scoped.projectRef)
        if (session === null) {
          status = 404
          payload = failure("session_not_found", "Session was not found", context.requestId)
        } else {
          payload = session
        }
      }
    } else if (segments.length === 2 && method === "DELETE") {
      const deleted = store.deleteSession(sessionId, scoped.scope, scoped.projectRef)
      if (!deleted) {
        status = 404
        payload = failure("session_not_found", "Session was not found", context.requestId)
      } else {
        payload = deleted
      }
    } else if (segments.length === 3 && segments[2] === "share" && method === "POST") {
      const share = store.createSessionShare(sessionId, scoped.scope, scoped.projectRef)
      if (share === null) {
        status = 404
        payload = failure("session_not_found", "Session was not found", context.requestId)
      } else {
        payload = share
      }
    } else if (segments.length === 3 && segments[2] === "share" && method === "DELETE") {
      const share = store.revokeSessionShare(sessionId, scoped.scope, scoped.projectRef)
      if (share === null) {
        status = 404
        payload = failure("share_not_found", "Share was not found", context.requestId)
      } else {
        payload = share
      }
    } else {
      status = 404
      payload = failure("bff_route_not_found", "Business route was not found", context.requestId)
    }
  } else if (segments[0] === "projects") {
    if (segments.length === 1 && method === "GET") payload = projectData(store.projects)
    else if (segments.length === 1 && method === "POST") {
      if (typeof json.name !== "string" || json.name.trim() === "") {
        status = 400
        payload = failure("invalid_project", "Project name is required", context.requestId)
      } else payload = { project: store.createProject({ name: json.name.trim(), description: typeof json.description === "string" ? json.description : undefined }) }
    } else if (segments.length === 2 && (method === "GET" || method === "PATCH")) {
      const project = store.findProject(segments[1] || "")
      if (project === undefined) { status = 404; payload = failure("project_not_found", "Project was not found", context.requestId) }
      else if (method === "GET") payload = { project }
      else if (typeof json.instruction !== "string") {
        status = 400
        payload = failure("invalid_project_instruction", "Project instruction must be a string", context.requestId)
      } else payload = { project: store.updateProjectInstruction(project.id, json.instruction) }
    } else if (segments.length === 3 && segments[2] === "instruction-revisions" && method === "GET") {
      if (store.findProject(segments[1] || "") === undefined) {
        status = 404
        payload = failure("project_not_found", "Project was not found", context.requestId)
      } else payload = { items: store.projectInstructions(segments[1] || "") }
    } else if (segments.length === 3 && segments[2] === "resources" && method === "POST") {
      if (store.findProject(segments[1] || "") === undefined) {
        status = 404
        payload = failure("project_not_found", "Project was not found", context.requestId)
      } else payload = { ok: true }
    } else if (segments.length === 4 && segments[2] === "skills" && method === "PATCH") {
      const project = store.findProject(segments[1] || "")
      if (project === undefined) {
        status = 404
        payload = failure("project_not_found", "Project was not found", context.requestId)
      } else if (typeof json.enabled !== "boolean") {
        status = 400
        payload = failure("invalid_project_skill", "Skill enabled must be a boolean", context.requestId)
      } else {
        store.setProjectSkillEnabled(project.id, segments[3] || "", json.enabled)
        payload = { skill: { project_id: project.id, name: segments[3] || "", enabled: json.enabled } }
      }
    } else if (segments.length === 3 && segments[2] === "scheduled-tasks" && method === "POST") {
      const project = store.findProject(segments[1] || "")
      if (project === undefined) {
        status = 404
        payload = failure("project_not_found", "Project was not found", context.requestId)
      } else {
        const task = store.createScheduledTask({
          ...(json as Partial<ScheduledTask>),
          project_id: project.id,
        })
        payload = { task }
      }
    } else if (segments.length === 3 && segments[2] === "tasks" && method === "GET") {
      payload = taskData(store.projectTasks(segments[1] || ""))
    } else { status = 404; payload = failure("bff_route_not_found", "Business route was not found", context.requestId) }
  } else if (segments[0] === "skills") {
    if (segments.length === 1 && method === "GET") payload = skillData(store.skills)
    else if (segments.length === 2 && segments[1] === "catalog" && method === "GET") payload = skillCatalogData(store.skills)
    else if (segments.length === 2 && segments[1] === "pool" && method === "GET") payload = skillPoolData(store.skills.filter((skill) => skill.enabled !== false))
    else if (segments.length === 2 && segments[1] === "quota" && method === "GET") payload = store.skillQuota(context.identity.namespace)
    else if (segments.length === 3 && segments[2] === "revisions" && method === "GET") {
      payload = { revisions: store.skillRevisions(segments[1] || "", queryOf(request).get("scope")?.trim() || undefined) }
    } else if (segments.length === 3 && (segments[2] === "enable" || segments[2] === "disable") && method === "POST") {
      const enabled = segments[2] === "enable"
      const changed = store.setSkillEnabled(segments[1] || "", enabled, queryOf(request).get("scope")?.trim() || undefined)
      if (!changed) {
        status = 404
        payload = failure("skill_not_found", "Skill was not found", context.requestId)
      } else payload = { ok: true }
    }
    else if (segments.length === 3 && segments[1] === "github" && (segments[2] === "preview" || segments[2] === "import") && method === "POST") {
      const source = githubSkillSource(json.repository)
      if (source === null) {
        status = 400
        payload = failure("invalid_github_url", "A valid GitHub URL is required", context.requestId)
      } else if (segments[2] === "preview") {
        payload = { repository: source.source_url, default_branch: "main", skill: { name: source.name, description: source.description } }
      } else {
        const skill = store.importGithubSkill(source)
        payload = { repository: source.source_url, default_branch: "main", skill: { name: skill.name, description: skill.description } }
      }
    } else { status = 404; payload = failure("bff_route_not_found", "Business route was not found", context.requestId) }
  } else if (segments[0] === "mcp" && segments[1] === "servers") {
    const name = segments[2]
    if (segments.length === 2 && method === "GET") payload = { servers: store.mcpServers }
    else if (segments.length === 2 && method === "POST") {
      const input = mcpRegisterInput(json)
      if (input === null) {
        status = 400
        payload = failure("invalid_mcp_server", "A valid MCP server registration is required", context.requestId)
      } else if (store.findMcpServer(input.name) !== undefined) {
        status = 409
        payload = failure("mcp_server_exists", "MCP server already exists", context.requestId)
      } else {
        payload = { server: store.registerMcpServer({ ...input, scope: context.identity.namespace }) }
      }
    } else if (segments.length === 4 && (segments[3] === "enable" || segments[3] === "disable") && method === "POST") {
      const changed = store.setMcpEnabled(name || "", segments[3] === "enable")
      if (!changed) {
        status = 404
        payload = failure("mcp_server_not_found", "MCP server was not found", context.requestId)
      } else payload = { ok: true }
    } else if (segments.length === 3 && method === "DELETE") {
      const deleted = store.deleteMcpServer(name || "")
      if (!deleted) {
        status = 404
        payload = failure("mcp_server_not_found", "MCP server was not found", context.requestId)
      } else payload = { ok: true }
    } else { status = 404; payload = failure("bff_route_not_found", "Business route was not found", context.requestId) }
  } else if (segments[0] === "scheduled-tasks") {
    const id = segments[1]
    if (segments.length === 1 && method === "GET") payload = scheduledData(store.scheduledTasks)
    else if (segments.length === 1 && method === "POST") payload = { task: store.createScheduledTask(json as Partial<ScheduledTask>) }
    else if (segments.length === 2 && method === "GET") {
      const task = id === undefined ? undefined : store.findScheduledTask(id)
      if (task === undefined) { status = 404; payload = failure("scheduled_task_not_found", "Scheduled task was not found", context.requestId) }
      else payload = { task }
    } else if (segments.length === 2 && method === "PATCH") {
      const task = id === undefined ? undefined : store.findScheduledTask(id)
      if (task === undefined) { status = 404; payload = failure("scheduled_task_not_found", "Scheduled task was not found", context.requestId) }
      else { Object.assign(task, json); payload = { task } }
    } else if (segments.length === 2 && method === "DELETE") {
      const index = id === undefined ? -1 : store.scheduledTasks.findIndex((task) => task.id === id)
      if (index < 0) { status = 404; payload = failure("scheduled_task_not_found", "Scheduled task was not found", context.requestId) }
      else { store.scheduledTasks.splice(index, 1); payload = { ok: true } }
    } else if (segments.length === 3 && segments[2] === "retry" && method === "POST") {
      const task = id === undefined ? undefined : store.findScheduledTask(id)
      if (task === undefined) { status = 404; payload = failure("scheduled_task_not_found", "Scheduled task was not found", context.requestId) }
      else { task.status = "active"; task.enabled = true; payload = { task } }
    } else { status = 404; payload = failure("bff_route_not_found", "Business route was not found", context.requestId) }
  } else if (segments[0] === "agents" && segments[1] === "connections" && segments[2] === "setup" && method === "GET") {
    const platform = queryOf(request).get("platform")
    if (platform === null || !PLATFORMS.has(platform as AgentConnectionSetup["platform"])) {
      status = 400
      payload = failure("invalid_agent_platform", "platform must be telegram, line, or slack", context.requestId)
    } else payload = store.setup(platform as AgentConnectionSetup["platform"])
  } else if (segments[0] === "library" && segments.length === 1 && method === "GET") {
    payload = { items: store.library } satisfies { items: LibraryItem[] }
  } else if (segments[0] === "billing" && segments[1] === "plans" && method === "GET") {
    payload = { plans: store.plans }
  } else if (segments[0] === "billing" && segments[1] === "checkout" && method === "POST") {
    const planId = typeof json.plan_id === "string" ? json.plan_id : ""
    if (!store.plans.some((plan) => plan.id === planId)) {
      status = 404
      payload = failure("plan_not_found", "Billing plan was not found", context.requestId)
    } else {
      payload = { checkout_url: `/billing/mock-checkout/${encodeURIComponent(planId)}` }
    }
  } else if (segments[0] === "billing" && segments[1] === "mock-pay" && method === "POST") {
    payload = { ok: true }
  } else if (segments[0] === "billing" && segments[1] === "summary" && method === "GET") {
    payload = store.billing satisfies BillingSummary
  } else {
    status = 404
    payload = failure("bff_route_not_found", "Business route was not found", context.requestId)
  }

  const isError = isRecord(payload) && "error" in payload
  const envelope = isError ? payload : ok(payload, context.requestId)
  reply(response, status, envelope, context, idempotency, mutation)
}

function upstreamKey(segments: string[]): string | null {
  // Chat is a BFF-owned Web contract in mock mode and an Agent business
  // adapter in live mode; it never falls back to a Session service.
  if (segments[0] === "sessions") return "agents"
  if (segments[0] === "system") return "system"
  if (segments[0] === "models") return "model"
  if (segments[0] === "skills") return "capability"
  if (segments[0] === "mcp") return "capability"
  if (segments[0] === "agents") return "agents"
  if (segments[0] === "library") return "storage"
  if (segments[0] === "billing") return "billing"
  return null
}

function bffOwnedBusinessPath(segments: string[]): boolean {
  return segments[0] === "projects" || segments[0] === "scheduled-tasks"
}

function isMoriBusinessPath(segments: string[]): boolean {
  return segments[0] === "mori"
}

function configuredUpstream(config: BffConfig, owner: string): string | null {
  const direct = config.upstreams[owner]
  return direct ?? null
}

async function handle(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  store: MockBffStore,
  mori: MoriMockBffStore,
  idempotency: Map<string, IdempotencyEntry>,
  businessStore: PostgresBffRepositories | null,
): Promise<void> {
  const id = requestId(request)
  const segments = pathOf(request)
  if (segments.length === 1 && segments[0] === "healthz" && request.method === "GET") {
    send(response, 200, { status: "ok", service: "kokoro-bff", mode: config.mode })
    return
  }
  if (segments.length === 1 && segments[0] === "readyz" && request.method === "GET") {
    // The BFF business store is required for live business facts. Agent is an
    // optional execution profile and only gates Agent/Chat routes.
    const ready = config.mode === "mock"
      || (businessStore !== null
        && await businessStore.ready().then(() => true).catch(() => false)
        && (!config.agentEnabled || configuredUpstream(config, "agents") !== null))
    send(response, ready ? 200 : 503, { status: "ok", service: "kokoro-bff", mode: config.mode })
    return
  }
  if (segments[0] === "v1" && segments[1] === "shared" && segments.length === 3 && request.method === "GET") {
    if (!authorizeServerOnly(request, config)) {
      send(response, config.sharedSecret !== null ? 403 : 401, failure("service_auth_failed", "BFF authentication failed", id))
      return
    }
    const scope = queryOf(request).get("scope")?.trim() || undefined
    const projectRef = queryOf(request).get("project_ref")?.trim() || undefined
    const session = store.findSharedSession(segments[2] || "", scope, projectRef)
    if (session === undefined) {
      send(response, 404, failure("share_not_found", "Share was not found", id))
      return
    }
    const detail = store.readSession(session.session_id, scope, projectRef)
    if (detail === undefined) {
      send(response, 404, failure("share_not_found", "Share was not found", id))
      return
    }
    send(response, 200, ok(detail, id))
    return
  }
  if (segments[0] === "internal" && segments[1] === "bff" && segments[2] === "scheduled-tasks" && segments[3] === "dispatch" && segments.length === 4) {
    await schedulerDispatch(request, response, config, businessStore, idempotency)
    return
  }
  if (segments[0] !== "v1") {
    send(response, 404, failure("route_not_found", "Use the versioned /v1 business API", id))
    return
  }

  const businessPath = segments.slice(1)
  let context = authorize(request, config, id)
  if (
    context === null
    && config.mode === "live"
    && businessPath.length === 2
    && businessPath[0] === "system"
    && businessPath[1] === "runtime-manifest"
    && request.method === "GET"
    && authorizeServerOnly(request, config)
  ) {
    const tenantId = await resolveTenantForManifest(config, id)
    if (tenantId !== null) context = { requestId: id, identity: { namespace: tenantId, userId: "runtime-manifest" } }
  }
  if (context === null) {
    send(response, config.sharedSecret !== null ? 403 : 401, failure("service_auth_failed", "BFF authentication failed", id))
    return
  }
  // Project and ScheduledTask are BFF business facts. Until the BFF
  // PostgreSQL/Redis fact store is enabled, live mode must fail explicitly;
  // it must not route these resources to System or Scheduler, and must not
  // persist a mock receipt while claiming a successful mutation.
  if (config.mode === "live" && bffOwnedBusinessPath(businessPath) && businessStore === null) {
    send(response, 503, failure("business_store_not_configured", "BFF business fact store is not configured", id))
    return
  }
  const key = upstreamKey(businessPath)
  const upstreamBase = key === null ? null : configuredUpstream(config, key)
  if (key === null && !bffOwnedBusinessPath(businessPath) && !isMoriBusinessPath(businessPath)) {
    send(response, 404, failure("bff_route_not_found", "Business route was not found", id))
    return
  }
  const method = request.method || "GET"
  let body: Buffer | undefined
  let json: Record<string, unknown> = {}
  let mutation: MutationTicket | null = null
  const mutationRequired = requiresIdempotency(method, businessPath)
  if (mutationRequired && idempotencyKey(request) === null) {
    send(response, 400, failure("idempotency_key_required", "Mutations require Idempotency-Key", id))
    return
  }
  if (isMutation(method)) {
    try {
      body = await readBody(request)
    } catch {
      send(response, 413, failure("request_body_too_large", "Request body is too large", id))
      return
    }
  }
  if (mutationRequired) {
    const route = `/${businessPath.join("/")}`
    const result = await mutationTicket(request, method, route, context, body ?? Buffer.alloc(0), idempotency, config.mode === "live" ? businessStore ?? undefined : undefined)
    if (result.replay !== null) {
      send(response, result.replay.status, result.replay.body)
      return
    }
    if (result.conflict) {
      send(response, 409, failure("idempotency_conflict", "Idempotency key already used with a different request payload", id))
      return
    }
    if (result.pending) {
      send(response, 409, failure("idempotency_in_progress", "An identical mutation is already in progress", id))
      return
    }
    mutation = result.ticket
  }
  if (isMutation(method)) {
    const parsed = requestBodyJson(request, body ?? Buffer.alloc(0))
    if (parsed === null) {
      reply(response, 400, failure("invalid_json", "Request body must be a JSON object", id), context, idempotency, mutation)
      return
    }
    json = parsed
  }
  if (config.mode === "live" && isMoriBusinessPath(businessPath)) {
    await reply(response, 503, failure("mori_projection_not_configured", "Mori music projection is not configured in live mode", context.requestId), context, idempotency, mutation)
    return
  }
  if (config.mode === "live") {
    if (businessPath[0] === "sessions") {
      await liveAgentSession(request, response, config, context, businessPath, body, json, mutation, idempotency)
      return
    }
    if (businessStore !== null && bffOwnedBusinessPath(businessPath)) {
      if (await liveBffBusiness(request, response, config, context, businessPath, json, mutation, idempotency, businessStore)) return
    }
    if (await liveOwnerBusiness(request, response, config, context, businessPath, json, mutation, idempotency)) return
    const baseUrl = upstreamBase
    if (baseUrl === null) {
      reply(response, 503, failure("upstream_not_configured", `No upstream is configured for ${key || "this route"}`, id), context, idempotency, mutation)
      return
    }
    try {
      const upstreamPath = `/${businessPath.map((segment) => encodeURIComponent(segment)).join("/")}${new URL(request.url || "/", "http://bff.local").search}`
      const upstream = await proxyUpstream(config, baseUrl, upstreamPath, method, id, new Headers(request.headers as Record<string, string>), body)
      const normalized = normalizeUpstreamResponse(upstream, id)
      reply(response, normalized.status, normalized.body, context, idempotency, mutation)
    } catch {
      reply(response, 502, failure("upstream_unreachable", "The configured upstream is unavailable", id), context, idempotency, mutation)
    }
    return
  }
  await mockBusiness(request, response, businessPath, context, store, mori, idempotency, mutation, json)
}

async function reconcilePersistedScheduledTasks(config: BffConfig, store: PostgresBffRepositories): Promise<void> {
  if (config.upstreams.scheduler === null || config.schedulerTargetUrl === null) return
  try {
    const records = await store.services.scheduledTasks.listRecords()
    const request = { headers: {} } as IncomingMessage
    let registered = 0
    let skipped = 0
    let failed = 0
    for (const record of records) {
      const { task, tenantId, ownerId } = record
      if (!task.enabled || task.status !== "active" || (task.expires_at !== undefined && Date.parse(task.expires_at) <= Date.now())) {
        skipped += 1
        continue
      }
      const context: Context = {
        requestId: `bff-startup-scheduler-reconcile-${task.id}`,
        identity: { namespace: tenantId, userId: ownerId },
      }
      const result = await Promise.race([
        reconcileSchedulerTask(request, config, context, task, ownerId, "register"),
        new Promise<LiveOwnerResult>(resolve => setTimeout(() => resolve({ status: 504, body: null }), 5000)),
      ])
      if (result.status >= 400) failed += 1
      else registered += 1
    }
    if (registered !== 0 || skipped !== 0 || failed !== 0) {
      console.log(`kokoro-bff scheduler reconciliation registered=${registered} skipped=${skipped} failed=${failed}`)
    }
  } catch {
    // Reconciliation is best-effort. Persisted business facts remain
    // authoritative and the next startup/retry can reconcile again.
    console.error("kokoro-bff scheduler reconciliation failed")
  }
}

export function createBffServer(config: BffConfig = loadConfig()) {
  const store = new MockBffStore()
  const mori = new MoriMockBffStore()
  const idempotency = new Map<string, IdempotencyEntry>()
  const businessStore = config.mode === "live" && config.postgresUrl !== null && config.redisUrl !== null
    ? new PostgresBffRepositories(config.postgresUrl, config.redisUrl)
    : null
  const server = createServer((request, response) => {
    void handle(request, response, config, store, mori, idempotency, businessStore).catch(() => {
      if (!response.headersSent) send(response, 500, failure("internal_error", "The BFF encountered an internal error", requestId(request)))
      else response.destroy()
    })
  })
  if (businessStore !== null && config.mode === "live") {
    server.once("listening", () => { void reconcilePersistedScheduledTasks(config, businessStore) })
  }
  server.once("close", () => { void businessStore?.close() })
  return server
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = loadConfig()
  const server = createBffServer(config)
  server.listen(config.port, config.host, () => {
    console.log(`kokoro-bff ${config.mode} listening on http://${config.host}:${config.port}`)
  })
}
