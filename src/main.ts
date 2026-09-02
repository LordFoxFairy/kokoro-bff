import { createServer, type IncomingMessage, type ServerResponse } from "node:http"

import { loadConfig, type BffConfig } from "./config.js"
import { failure, ok } from "./contracts/index.js"
import { MockBffStore } from "./infrastructure/mock/bff-store.js"
import { PostgresBffRepositories } from "./infrastructure/postgres/repositories.js"
import { MoriMockBffStore } from "./adapters/mori.js"
import { mutationTicket, type IdempotencyEntry, type MutationTicket } from "./application/idempotency.js"
import { normalizeUpstreamResponse, reply, send } from "./http/response.js"
import { proxyUpstream } from "./upstream.js"
import { authorize, authorizeServerOnly, idempotencyKey, isMutation, pathOf, queryOf, readBody, requestBodyJson, requestId, requiresIdempotency, type Context } from "./http/request.js"
import { liveAgentSession } from "./http/routes/agent.js"
import { mockBusiness } from "./http/routes/mock.js"
import { liveBffBusiness } from "./http/routes/live-bff.js"
import { liveOwnerBusiness } from "./http/routes/owner.js"
import { liveMoriBusiness } from "./http/routes/music.js"
import { configuredUpstream, bffOwnedBusinessPath, isMoriBusinessPath, upstreamKey } from "./http/routes/routing.js"
import { reconcileSchedulerTask, schedulerDispatch } from "./http/routes/scheduler.js"
import type { LiveOwnerResult } from "./http/routes/types.js"

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
    if (config.tenantId !== null) context = { requestId: id, identity: { namespace: config.tenantId, userId: "runtime-manifest" } }
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
  if (config.mode === "live") {
    if (isMoriBusinessPath(businessPath)) {
      await liveMoriBusiness(request, response, config, context, businessPath, body, mutation, idempotency)
      return
    }
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
