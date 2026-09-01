import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { randomUUID } from "node:crypto"

import { loadConfig, type BffConfig } from "./config.js"
import type {
  AgentConnectionSetup,
  BffEnvelope,
  BillingSummary,
  LibraryItem,
  Project,
  ScheduledTask,
  Skill,
  Task,
} from "./contracts.js"
import { failure, ok } from "./contracts.js"
import { MockStore } from "./store.js"
import { proxyUpstream } from "./upstream.js"

const PLATFORMS = new Set<AgentConnectionSetup["platform"]>(["telegram", "line", "slack"])
const store = new MockStore()
const idempotency = new Map<string, { status: number; body: unknown }>()

type Context = {
  requestId: string
  identity: { namespace: string; userId: string }
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

function authorize(request: IncomingMessage, config: BffConfig, id: string): Context | null {
  const service = request.headers["x-kokoro-service"]
  if (service !== "web-bff") return null
  if (config.sharedSecret !== null && request.headers["x-kokoro-internal-secret"] !== config.sharedSecret) {
    return null
  }
  const namespace = request.headers["x-kokoro-namespace"]
  const userId = request.headers["x-kokoro-user-id"]
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

function jsonBody(body: Buffer): Record<string, unknown> | null {
  if (body.byteLength === 0) return {}
  try {
    const parsed: unknown = JSON.parse(body.toString("utf8"))
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

function mutationKey(request: IncomingMessage, path: string, context: Context): string | null {
  const key = request.headers["idempotency-key"]
  if (typeof key !== "string" || key.trim() === "") return null
  return `${context.identity.namespace}:${request.method}:${path}:${key.trim()}`
}

function result(response: ServerResponse, status: number, body: unknown, context: Context): void {
  send(response, status, body)
}

function projectData(projects: Project[]): { projects: Project[] } { return { projects } }
function taskData(tasks: Task[]): { tasks: Task[] } { return { tasks } }
function skillData(skills: Skill[]): { skills: Skill[] } { return { skills } }
function scheduledData(tasks: ScheduledTask[]): { tasks: ScheduledTask[] } { return { tasks } }

async function mockBusiness(
  request: IncomingMessage,
  response: ServerResponse,
  segments: string[],
  context: Context,
): Promise<void> {
  const method = request.method || "GET"
  const route = `/${segments.join("/")}`
  let body: Buffer | undefined
  if (isMutation(method)) {
    const key = mutationKey(request, route, context)
    if (key === null) {
      result(response, 400, failure("idempotency_key_required", "Mutations require Idempotency-Key", context.requestId), context)
      return
    }
    const prior = idempotency.get(key)
    if (prior !== undefined) {
      result(response, prior.status, prior.body, context)
      return
    }
    try { body = await readBody(request) } catch {
      result(response, 413, failure("request_body_too_large", "Request body is too large", context.requestId), context)
      return
    }
  }

  const input = body === undefined ? {} : jsonBody(body)
  if (body !== undefined && input === null) {
    result(response, 400, failure("invalid_json", "Request body must be a JSON object", context.requestId), context)
    return
  }
  const json = input || {}
  let status = 200
  let payload: unknown

  if (segments[0] === "projects") {
    if (segments.length === 1 && method === "GET") payload = projectData(store.projects)
    else if (segments.length === 1 && method === "POST") {
      if (typeof json.name !== "string" || json.name.trim() === "") {
        status = 400
        payload = failure("invalid_project", "Project name is required", context.requestId)
      } else payload = { project: store.createProject({ name: json.name.trim(), description: typeof json.description === "string" ? json.description : undefined }) }
    } else if (segments.length === 2 && method === "GET") {
      const project = store.projects.find((item) => item.id === segments[1] || item.slug === segments[1])
      if (project === undefined) { status = 404; payload = failure("project_not_found", "Project was not found", context.requestId) }
      else payload = { project }
    } else if (segments.length === 3 && segments[2] === "tasks" && method === "GET") {
      payload = taskData(store.projectTasks(segments[1] || ""))
    } else { status = 404; payload = failure("bff_route_not_found", "Business route was not found", context.requestId) }
  } else if (segments[0] === "skills") {
    if (segments.length === 1 && method === "GET") payload = skillData(store.skills)
    else if (segments.length === 2 && segments[1] === "catalog" && method === "GET") payload = { skills: store.skills, next_cursor: null }
    else if (segments.length === 2 && segments[1] === "pool" && method === "GET") payload = skillData(store.skills.filter((skill) => skill.enabled !== false))
    else { status = 404; payload = failure("bff_route_not_found", "Business route was not found", context.requestId) }
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
  } else if (segments[0] === "billing" && segments[1] === "summary" && method === "GET") {
    payload = store.billing satisfies BillingSummary
  } else {
    status = 404
    payload = failure("bff_route_not_found", "Business route was not found", context.requestId)
  }

  const isError = typeof payload === "object" && payload !== null && "error" in payload
  const envelope = isError ? payload : ok(payload, context.requestId)
  if (isMutation(method)) {
    const key = mutationKey(request, route, context)
    if (key !== null) idempotency.set(key, { status, body: envelope })
  }
  result(response, status, envelope, context)
}

function upstreamKey(segments: string[]): string | null {
  if (segments[0] === "projects") return "projects"
  if (segments[0] === "skills" || segments[0] === "mcp" || segments[0] === "connectors" || segments[0] === "preferences" || segments[0] === "cloud-computers" || segments[0] === "integrations") return "hub"
  if (segments[0] === "scheduled-tasks") return "scheduled"
  if (segments[0] === "agents") return "agents"
  if (segments[0] === "library") return "library"
  if (segments[0] === "billing") return "billing"
  return null
}

async function handle(request: IncomingMessage, response: ServerResponse, config: BffConfig): Promise<void> {
  const id = requestId(request)
  const segments = pathOf(request)
  if (segments.length === 1 && segments[0] === "healthz" && request.method === "GET") {
    send(response, 200, { status: "ok", service: "kokoro-bff", mode: config.mode })
    return
  }
  if (segments.length === 1 && segments[0] === "readyz" && request.method === "GET") {
    send(response, config.mode === "live" && Object.values(config.upstreams).every((value) => value === null) ? 503 : 200, { status: config.mode === "live" ? "configured" : "ready", mode: config.mode })
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
  if (config.mode === "live") {
    const baseUrl = upstreamBase
    if (baseUrl === null) {
      send(response, 503, failure("upstream_not_configured", `No upstream is configured for ${key || "this route"}`, id))
      return
    }
    let body: Buffer | undefined
    if (isMutation(request.method || "GET")) {
      try { body = await readBody(request) } catch {
        send(response, 413, failure("request_body_too_large", "Request body is too large", id))
        return
      }
    }
    try {
      const upstreamPath = `/${businessPath.map((segment) => encodeURIComponent(segment)).join("/")}${new URL(request.url || "/", "http://bff.local").search}`
      const upstream = await proxyUpstream(config, baseUrl, upstreamPath, request.method || "GET", id, new Headers(request.headers as Record<string, string>), body)
      const raw = await upstream.arrayBuffer()
      let parsed: unknown
      try { parsed = JSON.parse(Buffer.from(raw).toString("utf8")) } catch { parsed = null }
      if (parsed !== null && typeof parsed === "object" && "data" in parsed) send(response, upstream.status, parsed)
      else send(response, upstream.status, ok(parsed, id))
    } catch {
      send(response, 502, failure("upstream_unreachable", "The configured upstream is unavailable", id))
    }
    return
  }
  await mockBusiness(request, response, businessPath, context)
}

export function createBffServer(config: BffConfig = loadConfig()) {
  return createServer((request, response) => {
    void handle(request, response, config).catch(() => {
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
