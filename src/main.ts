import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { randomUUID } from "node:crypto"

import { loadConfig, type BffConfig } from "./config.js"
import type {
  AgentConnectionSetup,
  BillingSummary,
  ChatEvent,
  ChatMessage,
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
} from "./contracts.js"
import { failure, ok } from "./contracts.js"
import { MockStore } from "./store.js"
import { proxyUpstream, type UpstreamResponse } from "./upstream.js"
import {
  agentIdentityHeaders,
  buildAgentControl,
  buildAgentLaunch,
  buildSessionDetail,
  buildSessionSummary,
  mapAgentEvent,
  type AgentChatEvent,
  type AgentChatMessage,
} from "./adapters/agent.js"

const PLATFORMS = new Set<AgentConnectionSetup["platform"]>(["telegram", "line", "slack"])

type Context = {
  requestId: string
  identity: { namespace: string; userId: string }
}

type IdempotencyReceipt = { status: number; body: unknown }

type IdempotencyEntry = {
  fingerprint: string
  receipt: IdempotencyReceipt
}

type MutationTicket = {
  scope: string
  fingerprint: string
}

type GithubSkillSource = {
  source_url: string
  owner: string
  repository: string
  name: string
  description: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function stableStringify(value: unknown): string {
  if (value === undefined) return "null"
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`
  const entries = Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`)
  return `{${entries.join(",")}}`
}

function headerString(value: string | string[] | undefined): string {
  if (typeof value === "string") return value
  if (Array.isArray(value)) return value.join(", ")
  return ""
}

function requestContentType(request: IncomingMessage): string {
  return headerString(request.headers["content-type"]).toLowerCase()
}

function parseBoundary(contentType: string): string | null {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/iu.exec(contentType)
  return match?.[1] ?? match?.[2] ?? null
}

function parseMultipartFingerprint(contentType: string, body: Buffer): string | null {
  const boundary = parseBoundary(contentType)
  if (boundary === null) return null
  const marker = `--${boundary}`
  const sections = body.toString("latin1").split(marker)
  if (sections.length < 2) return null

  const parts: Array<{
    name: string
    filename: string | null
    content_type: string | null
    body: string
  }> = []

  for (const section of sections.slice(1)) {
    if (section.startsWith("--")) break
    const trimmed = section.replace(/^\r?\n/u, "").replace(/\r?\n$/u, "")
    if (trimmed.length === 0) continue
    const splitAt = trimmed.indexOf("\r\n\r\n")
    if (splitAt < 0) return null
    const headers = trimmed.slice(0, splitAt).split("\r\n")
    const content = trimmed.slice(splitAt + 4).replace(/\r\n$/u, "")
    const headerMap = new Map<string, string>()
    for (const line of headers) {
      const colon = line.indexOf(":")
      if (colon < 0) return null
      headerMap.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim())
    }
    const disposition = headerMap.get("content-disposition") ?? ""
    const nameMatch = /name="([^"]+)"/iu.exec(disposition)
    if (nameMatch === null) return null
    const name = nameMatch[1] ?? ""
    if (name === "") return null
    const filenameMatch = /filename="([^"]+)"/iu.exec(disposition)
    parts.push({
      name,
      filename: filenameMatch?.[1] ?? null,
      content_type: headerMap.get("content-type") ?? null,
      body: Buffer.from(content, "latin1").toString("base64"),
    })
  }

  return stableStringify(parts)
}

function fingerprintBody(request: IncomingMessage, body: Buffer): string {
  const contentType = requestContentType(request)
  if (body.byteLength === 0) return "empty"
  if (contentType.startsWith("multipart/form-data")) {
    const multipart = parseMultipartFingerprint(contentType, body)
    if (multipart !== null) return `multipart:${multipart}`
  }
  if (contentType.includes("json")) {
    try {
      const parsed: unknown = JSON.parse(body.toString("utf8"))
      return `json:${stableStringify(parsed)}`
    } catch {
      // fall through to raw body
    }
  }
  return `raw:${body.toString("base64")}`
}

function mutationScope(context: Context, method: string, path: string, key: string): string {
  return `${context.identity.namespace}:${method}:${path}:${key}`
}

function commitReceipt(
  idempotency: Map<string, IdempotencyEntry>,
  mutation: MutationTicket | null,
  status: number,
  body: unknown,
): void {
  if (mutation === null) return
  idempotency.set(mutation.scope, {
    fingerprint: mutation.fingerprint,
    receipt: {
      status,
      body: structuredClone(body),
    },
  })
}

function reply(
  response: ServerResponse,
  status: number,
  body: unknown,
  context: Context,
  idempotency: Map<string, IdempotencyEntry>,
  mutation: MutationTicket | null,
): void {
  commitReceipt(idempotency, mutation, status, body)
  send(response, status, body)
}

function idempotencyKey(request: IncomingMessage): string | null {
  const key = headerString(request.headers["idempotency-key"]).trim()
  return key === "" ? null : key
}

function send(response: ServerResponse, status: number, body: unknown): void {
  const payload = Buffer.from(JSON.stringify(body))
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": payload.byteLength,
  })
  response.end(payload)
}

function requestId(request: IncomingMessage): string {
  const value = request.headers["x-kokoro-request-id"]
  return typeof value === "string" && value.trim() ? value.trim() : randomUUID()
}

function pathOf(request: IncomingMessage): string[] {
  const pathname = new URL(request.url || "/", "http://bff.local").pathname
  return pathname.split("/").filter(Boolean).map((segment) => decodeURIComponent(segment))
}

function queryOf(request: IncomingMessage): URLSearchParams {
  return new URL(request.url || "/", "http://bff.local").searchParams
}

function isMutation(method: string): boolean {
  return method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE"
}

function requiresIdempotency(method: string, segments: string[]): boolean {
  if (!isMutation(method)) return false
  if (method === "POST" && segments[0] === "skills" && segments[1] === "github" && segments[2] === "preview") return false
  return true
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

function requestBodyJson(request: IncomingMessage, body: Buffer): Record<string, unknown> | null {
  if (body.byteLength === 0) return {}
  if (requestContentType(request).startsWith("multipart/form-data")) return {}
  try {
    const parsed: unknown = JSON.parse(body.toString("utf8"))
    return isRecord(parsed) && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function mutationTicket(
  request: IncomingMessage,
  method: string,
  path: string,
  context: Context,
  body: Buffer,
  idempotency: Map<string, IdempotencyEntry>,
): { ticket: MutationTicket | null; replay: IdempotencyReceipt | null; conflict: boolean } {
  const key = idempotencyKey(request)
  if (key === null) return { ticket: null, replay: null, conflict: false }
  const scope = mutationScope(context, method, path, key)
  const fingerprint = fingerprintBody(request, body)
  const prior = idempotency.get(scope)
  if (prior !== undefined) {
    if (prior.fingerprint !== fingerprint) return { ticket: null, replay: null, conflict: true }
    return { ticket: null, replay: prior.receipt, conflict: false }
  }
  return { ticket: { scope, fingerprint }, replay: null, conflict: false }
}

function normalizeUpstreamResponse(
  upstream: UpstreamResponse,
  requestId: string,
): { status: number; body: unknown } {
  const text = upstream.body.toString("utf8")
  if (text.trim() === "") {
    return {
      status: upstream.status >= 400 ? upstream.status : 502,
      body: failure(
        upstream.status >= 400 ? "upstream_http_error" : "upstream_response_invalid",
        upstream.status >= 400
          ? `Upstream returned HTTP ${upstream.status} with an empty body`
          : "The configured upstream returned an empty response",
        requestId,
      ),
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return {
      status: upstream.status >= 400 ? upstream.status : 502,
      body: failure(
        upstream.status >= 400 ? "upstream_http_error" : "upstream_response_invalid",
        upstream.status >= 400
          ? `Upstream returned HTTP ${upstream.status}`
          : "The configured upstream did not return JSON",
        requestId,
      ),
    }
  }

  if (isRecord(parsed) && isRecord(parsed.error) && typeof parsed.error.code === "string" && typeof parsed.error.message === "string") {
    const responseRequestId = isRecord(parsed.meta) && typeof parsed.meta.request_id === "string" && parsed.meta.request_id.trim() !== ""
      ? parsed.meta.request_id.trim()
      : requestId
    return {
      status: upstream.status >= 400 ? upstream.status : 502,
      body: failure(parsed.error.code, parsed.error.message, responseRequestId),
    }
  }

  if (upstream.status >= 400) {
    const responseRequestId = headerString(upstream.headers.get("x-kokoro-request-id") ?? "").trim() || requestId
    return {
      status: upstream.status,
      body: failure("upstream_http_error", `Upstream returned HTTP ${upstream.status}`, responseRequestId),
    }
  }

  if (isRecord(parsed) && "data" in parsed) {
    const responseRequestId = isRecord(parsed.meta) && typeof parsed.meta.request_id === "string" && parsed.meta.request_id.trim() !== ""
      ? parsed.meta.request_id.trim()
      : requestId
    return {
      status: upstream.status,
      body: {
        ...parsed,
        meta: { request_id: responseRequestId },
      },
    }
  }

  return { status: upstream.status, body: ok(parsed, requestId) }
}

function authorizeServerOnly(request: IncomingMessage, config: BffConfig): boolean {
  const service = request.headers["x-kokoro-service"]
  if (service !== "web-bff") return false
  return config.sharedSecret !== null && request.headers["x-kokoro-internal-secret"] === config.sharedSecret
}

function authorize(request: IncomingMessage, config: BffConfig, id: string): Context | null {
  const service = request.headers["x-kokoro-service"]
  if (service !== "web-bff") return null
  if (config.sharedSecret !== null && request.headers["x-kokoro-internal-secret"] !== config.sharedSecret) {
    return null
  }
  const namespace = request.headers["x-kokoro-namespace"]
  const userId = request.headers["x-kokoro-principal-id"]
  if (typeof namespace !== "string" || namespace.trim() === "" || typeof userId !== "string" || userId.trim() === "") {
    return null
  }
  return { requestId: id, identity: { namespace: namespace.trim(), userId: userId.trim() } }
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.byteLength
    if (size > 1024 * 1024) throw new Error("request body too large")
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}

function projectData(projects: Project[]): { projects: Project[] } { return { projects } }
function taskData(tasks: Task[]): { tasks: Task[] } { return { tasks } }
function skillData(skills: Skill[]): { skills: Skill[] } { return { skills } }
function scheduledData(tasks: ScheduledTask[]): { tasks: ScheduledTask[] } { return { tasks } }
function chatSessionsData(sessions: ChatSessionSummary[], nextCursor?: string): { sessions: ChatSessionSummary[]; next_cursor?: string } {
  return nextCursor === undefined ? { sessions } : { sessions, next_cursor: nextCursor }
}
function chatSessionDetailData(detail: ChatSessionDetail): ChatSessionDetail {
  return detail
}
function chatShareData(shareId: string): { share_id: string } { return { share_id: shareId } }
function chatSseFrame(event: ChatEvent): string {
  return `id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`
}

type LiveSessionIndex = Map<string, Map<string, string | undefined>>

function incomingHeaders(request: IncomingMessage): Headers {
  const headers = new Headers()
  for (const [name, value] of Object.entries(request.headers)) {
    if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value)
  }
  return headers
}

function dataOf(body: unknown): Record<string, unknown> | null {
  if (!isRecord(body) || !isRecord(body.data)) return null
  return body.data
}

function agentSessionAssertion(context: Context, sessionId: string): string {
  return `bff:session:${context.identity.namespace}:${sessionId}`
}

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
  liveSessions: LiveSessionIndex,
): Promise<boolean> {
  const baseUrl = config.upstreams.agents ?? null
  if (baseUrl === null) {
    reply(response, 503, failure("upstream_not_configured", "No upstream is configured for agents", context.requestId), context, idempotency, mutation)
    return true
  }
  const method = request.method || "GET"
  const sessionId = businessPath[1] || ""
  const assertion = agentSessionAssertion(context, sessionId)
  const sessionIndex = liveSessions.get(context.identity.namespace) ?? new Map<string, string | undefined>()

  if (businessPath.length === 1 && method === "GET") {
    const projectRef = queryOf(request).get("project_ref")?.trim() || undefined
    const items = [...sessionIndex.entries()]
      .filter(([, indexedProject]) => projectRef === undefined || indexedProject === projectRef)
      .map(async ([id, indexedProject]) => {
        const detailResult = await callAgent(config, baseUrl, `/v1/sessions/${encodeURIComponent(id)}/messages?after_seq=0&limit=1000`, "GET", context.requestId, request, undefined, context, agentSessionAssertion(context, id))
        if (detailResult.status >= 400) throw new Error("agent session list projection failed")
        const messagesData = dataOf(detailResult.body)
        const messages = Array.isArray(messagesData?.messages) ? messagesData.messages as AgentChatMessage[] : []
        const detail = buildSessionDetail(context.identity, id, messages, [], 0)
        return { item: buildSessionSummary(context.identity, id, detail), projectRef: indexedProject }
      })
    try {
      const listed = await Promise.all(items)
      reply(response, 200, ok({ sessions: listed.map(({ item }) => item) }, context.requestId), context, idempotency, mutation)
    } catch {
      reply(response, 502, failure("upstream_response_invalid", "Agent session list projection failed", context.requestId), context, idempotency, mutation)
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
      sessionIndex.set(sessionId, typeof json.project_ref === "string" ? json.project_ref : undefined)
      liveSessions.set(context.identity.namespace, sessionIndex)
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
    try {
      const result = await callAgent(config, baseUrl, `/v1/runs/${encodeURIComponent(runId)}/control`, "POST", context.requestId, request, Buffer.from(JSON.stringify(control)), context, assertion)
      if (result.status >= 400) {
        sendAgentFailure(response, result, context, idempotency, mutation)
        return true
      }
      reply(response, 200, ok({ ok: true }, context.requestId), context, idempotency, mutation)
    } catch {
      reply(response, 502, failure("upstream_unreachable", "The configured Agent upstream is unavailable", context.requestId), context, idempotency, mutation)
    }
    return true
  }

  if (businessPath.length === 3 && businessPath[2] === "events" && method === "GET") {
    const lastEventId = headerString(request.headers["last-event-id"]).trim()
    const cursor = lastEventId === "" ? 0 : Number(lastEventId)
    const afterSeq = Number.isInteger(cursor) && cursor >= 0 ? cursor : 0
    try {
      const result = await callAgent(config, baseUrl, `/v1/sessions/${encodeURIComponent(sessionId)}/events?after_seq=${afterSeq}&limit=1000`, "GET", context.requestId, request, undefined, context, assertion)
      if (result.status >= 400) {
        sendAgentFailure(response, result, context, idempotency, mutation)
        return true
      }
      const data = dataOf(result.body)
      const rawEvents = Array.isArray(data?.events) ? data.events as AgentChatEvent[] : null
      if (data === null || rawEvents === null) {
        sendAgentFailure(response, { status: 502, body: failure("upstream_response_invalid", "Agent event replay did not match the v1 contract", context.requestId) }, context, idempotency, mutation)
        return true
      }
      const events = rawEvents.map(mapAgentEvent).filter((event): event is ChatEvent => event !== null)
      response.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
        connection: "keep-alive",
        "x-kokoro-request-id": context.requestId,
      })
      response.end(events.length === 0 ? ": keep-alive\n\n" : events.map(chatSseFrame).join(""))
    } catch {
      reply(response, 502, failure("upstream_response_invalid", "Agent event projection failed", context.requestId), context, idempotency, mutation)
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

async function mockBusiness(
  request: IncomingMessage,
  response: ServerResponse,
  segments: string[],
  context: Context,
  store: MockStore,
  idempotency: Map<string, IdempotencyEntry>,
  mutation: MutationTicket | null,
  json: Record<string, unknown>,
): Promise<void> {
  const method = request.method || "GET"
  let status = 200
  let payload: unknown

  if (segments[0] === "sessions") {
    const sessionId = segments[1] || ""
    const scope = queryOf(request).get("scope")?.trim() || undefined
    const projectRef = queryOf(request).get("project_ref")?.trim() || undefined
    if (segments.length === 1 && method === "GET") payload = chatSessionsData(store.listSessions(scope, projectRef))
    else if (segments.length === 2 && method === "GET") {
      const detail = store.readSession(sessionId, scope, projectRef)
      if (detail === undefined) {
        status = 404
        payload = failure("session_not_found", "Session was not found", context.requestId)
      } else payload = chatSessionDetailData(detail)
    } else if (segments.length === 3 && segments[2] === "messages" && method === "POST") {
      if (typeof json.content !== "string" || json.content.trim() === "") {
        status = 400
        payload = failure("invalid_message", "Message content is required", context.requestId)
      } else {
        const result = store.submitSessionMessage(sessionId, json.content.trim(), scope, projectRef)
        if (result === null) {
          status = 404
          payload = failure("session_not_found", "Session was not found", context.requestId)
        } else {
          payload = result
        }
      }
    } else if (segments.length === 3 && segments[2] === "events" && method === "GET") {
      const detail = store.readSession(sessionId, scope, projectRef)
      if (detail === undefined) {
        status = 404
        payload = failure("session_not_found", "Session was not found", context.requestId)
      } else {
        const session = store.findSession(sessionId, scope, projectRef)
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
      const action = typeof json.action === "string"
        ? json.action
        : json.kind === "run.cancel"
          ? "cancel"
          : json.kind === "run.resume"
            ? "resume"
            : ""
      const decisions = Array.isArray(json.decisions)
        ? json.decisions.map((decision) => typeof decision === "string" ? decision : JSON.stringify(decision))
        : undefined
      if (action !== "cancel" && action !== "resume") {
        status = 400
        payload = failure("invalid_run_control", "Control action must be cancel or resume", context.requestId)
      } else {
        const result = store.controlSessionRun(sessionId, segments[3] || "", action, decisions, scope, projectRef)
        if (result === null) {
          status = 404
          payload = failure("run_not_found", "Run was not found", context.requestId)
        } else {
          payload = result
        }
      }
    } else if (segments.length === 3 && segments[2] === "title" && method === "PATCH") {
      if (typeof json.title !== "string" || json.title.trim() === "") {
        status = 400
        payload = failure("invalid_title", "Title is required", context.requestId)
      } else {
        const session = store.updateSessionTitle(sessionId, json.title.trim(), scope, projectRef)
        if (session === null) {
          status = 404
          payload = failure("session_not_found", "Session was not found", context.requestId)
        } else {
          payload = session
        }
      }
    } else if (segments.length === 2 && method === "DELETE") {
      const deleted = store.deleteSession(sessionId, scope, projectRef)
      if (!deleted) {
        status = 404
        payload = failure("session_not_found", "Session was not found", context.requestId)
      } else {
        payload = deleted
      }
    } else if (segments.length === 3 && segments[2] === "share" && method === "POST") {
      const share = store.createSessionShare(sessionId, scope, projectRef)
      if (share === null) {
        status = 404
        payload = failure("session_not_found", "Session was not found", context.requestId)
      } else {
        payload = share
      }
    } else if (segments.length === 3 && segments[2] === "share" && method === "DELETE") {
      const share = store.revokeSessionShare(sessionId, scope, projectRef)
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
  if (segments[0] === "projects") return "projects"
  if (segments[0] === "skills") return "skills"
  if (segments[0] === "mcp" || segments[0] === "connectors" || segments[0] === "preferences" || segments[0] === "cloud-computers" || segments[0] === "integrations") return "hub"
  if (segments[0] === "scheduled-tasks") return "scheduled"
  if (segments[0] === "agents") return "agents"
  if (segments[0] === "library") return "library"
  if (segments[0] === "billing") return "billing"
  return null
}

async function handle(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  store: MockStore,
  idempotency: Map<string, IdempotencyEntry>,
  liveSessions: LiveSessionIndex,
): Promise<void> {
  const id = requestId(request)
  const segments = pathOf(request)
  if (segments.length === 1 && segments[0] === "healthz" && request.method === "GET") {
    send(response, 200, { status: "ok", service: "kokoro-bff", mode: config.mode })
    return
  }
  if (segments.length === 1 && segments[0] === "readyz" && request.method === "GET") {
    const ready = config.mode === "mock" || Object.values(config.upstreams).every((value) => value !== null)
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
  if (segments[0] !== "v1") {
    send(response, 404, failure("route_not_found", "Use the versioned /v1 business API", id))
    return
  }

  const context = authorize(request, config, id)
  if (context === null) {
    send(response, config.sharedSecret !== null ? 403 : 401, failure("service_auth_failed", "BFF authentication failed", id))
    return
  }
  const businessPath = segments.slice(1)
  const key = upstreamKey(businessPath)
  const upstreamBase = key === null ? null : (config.upstreams[key] ?? null)
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
    const result = mutationTicket(request, method, route, context, body ?? Buffer.alloc(0), idempotency)
    if (result.replay !== null) {
      send(response, result.replay.status, result.replay.body)
      return
    }
    if (result.conflict) {
      send(response, 409, failure("idempotency_conflict", "Idempotency key already used with a different request payload", id))
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
  if (config.mode === "live") {
    if (businessPath[0] === "sessions") {
      await liveAgentSession(request, response, config, context, businessPath, body, json, mutation, idempotency, liveSessions)
      return
    }
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
  await mockBusiness(request, response, businessPath, context, store, idempotency, mutation, json)
}

export function createBffServer(config: BffConfig = loadConfig()) {
  const store = new MockStore()
  const idempotency = new Map<string, IdempotencyEntry>()
  const liveSessions: LiveSessionIndex = new Map()
  return createServer((request, response) => {
    void handle(request, response, config, store, idempotency, liveSessions).catch(() => {
      if (!response.headersSent) send(response, 500, failure("internal_error", "The BFF encountered an internal error", requestId(request)))
      else response.destroy()
    })
  })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = loadConfig()
  const server = createBffServer(config)
  server.listen(config.port, config.host, () => {
    console.log(`kokoro-bff ${config.mode} listening on http://${config.host}:${config.port}`)
  })
}
