import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"

import { loadConfig, type BffConfig } from "../config/runtime.js"
import { authorizeUserRequest } from "../auth/user-admission.js"
import { failure, ok } from "../contracts/index.js"
import { mutationTicket, type MutationTicket } from "../application/idempotency.js"
import { mutationFingerprint, authorizeServerOnly, idempotencyKey, isMutation, pathOf, queryOf, readBody, requestBodyJson, requestId, requiresIdempotency } from "../http/request.js"
import { reply, send } from "../http/response.js"
import { normalizeUpstreamResponse } from "../infrastructure/clients/upstream-response.js"
import { proxyUpstream } from "../upstream.js"
import { liveAgentSession } from "../http/routes/agent.js"
import { liveChatBusiness } from "../http/routes/chat.js"
import { liveBffBusiness } from "../http/routes/live-bff.js"
import { liveOwnerBusiness } from "../http/routes/owner.js"
import { liveMoriBusiness } from "../http/routes/music.js"
import { configuredUpstream, bffOwnedBusinessPath, isMoriBusinessPath, upstreamKey } from "../http/routes/routing.js"
import { schedulerDispatch } from "../http/routes/scheduler.js"
import { runtimeManifest } from "../http/routes/runtime-manifest.js"
import { createBffComposition, type BffCompositionOptions, type BffRouteInput } from "./runtime.js"

async function handle(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  composition: ReturnType<typeof createBffComposition>,
): Promise<void> {
  const id = requestId(request)
  const segments = pathOf(request)
  if (segments.length === 1 && segments[0] === "healthz" && request.method === "GET") {
    send(response, 200, { status: "ok", service: "kokoro-bff", mode: config.mode })
    return
  }
  if (segments.length === 1 && segments[0] === "readyz" && request.method === "GET") {
    const ready = await composition.readiness().then(() => true).catch(() => false)
      && (!config.agentEnabled || configuredUpstream(config, "agents") !== null)
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
    if (composition.businessStore?.services.publicShares !== undefined) {
      const shared = await composition.businessStore.services.publicShares.findActiveShare(segments[2] || "", scope, projectRef)
      if (shared === null) {
        send(response, 404, failure("share_not_found", "Share was not found", id))
        return
      }
      const messages = await composition.businessStore.services.publicShares.listMessages(
        shared.share.shareId,
        shared.conversation.tenantId,
        shared.conversation.conversationId,
        100,
      )
      send(response, 200, ok({
        session: {
          session_id: shared.conversation.conversationId,
          title: shared.conversation.title,
          owner_id: shared.conversation.ownerId,
          created_at: shared.conversation.createdAt.toISOString(),
          updated_at: shared.conversation.updatedAt.toISOString(),
        },
        ...(messages === null || messages.messages.length === 0 ? {} : { messages: messages.messages }),
        pending_pauses: [],
        files: [],
        deliveries: [],
        event_watermark: null,
      }, id))
      return
    }
    if (composition.sharedSessionReader === undefined) {
      send(response, 503, failure("share_projection_not_configured", "Share projection is not configured", id))
      return
    }
    const session = composition.sharedSessionReader.findSharedSession(segments[2] || "", scope, projectRef)
    if (session === undefined) {
      send(response, 404, failure("share_not_found", "Share was not found", id))
      return
    }
    const detail = composition.sharedSessionReader.readSession(session.session_id, scope, projectRef)
    if (detail === undefined) {
      send(response, 404, failure("share_not_found", "Share was not found", id))
      return
    }
    send(response, 200, ok(detail, id))
    return
  }

  if (segments[0] === "internal" && segments[1] === "bff" && segments[2] === "scheduled-tasks" && segments[3] === "dispatch" && segments.length === 4) {
    await schedulerDispatch(request, response, config, composition.businessStore, composition.idempotency)
    return
  }
  if (segments[0] !== "v1") {
    send(response, 404, failure("route_not_found", "Use the versioned /v1 business API", id))
    return
  }

  if (segments.length === 3 && segments[1] === "system" && segments[2] === "runtime-manifest" && request.method === "GET") {
    await runtimeManifest(request, response, config, id)
    return
  }

  const businessPath = segments.slice(1)
  const admissionAbort = new AbortController()
  const onRequestAborted = (): void => { admissionAbort.abort() }
  const onResponseClosed = (): void => { if (!response.writableEnded) admissionAbort.abort() }
  request.once("aborted", onRequestAborted)
  response.once("close", onResponseClosed)
  const admission = await authorizeUserRequest(request, config, composition.sessionAdmission, id, admissionAbort.signal)
    .finally(() => {
      request.removeListener("aborted", onRequestAborted)
      response.removeListener("close", onResponseClosed)
    })
  if (!admission.ok) {
    if (!response.destroyed) {
      response.setHeader("x-request-id", id)
      send(response, admission.status, failure(admission.code, "BFF user admission failed", id), admission.retryAfter)
    }
    return
  }
  const context = admission.context

  if (composition.routeHandler === undefined && bffOwnedBusinessPath(businessPath) && composition.businessStore === null) {
    send(response, 503, failure("business_store_not_configured", "BFF business fact store is not configured", id))
    return
  }

  const key = upstreamKey(businessPath)
  const upstreamBase = key === null ? null : configuredUpstream(config, key)
  if (composition.routeHandler === undefined && key === null && !bffOwnedBusinessPath(businessPath) && !isMoriBusinessPath(businessPath)) {
    send(response, 404, failure("bff_route_not_found", "Business route was not found", id))
    return
  }
  const method = request.method || "GET"
  let body: Buffer | undefined
  let json: Record<string, unknown> = {}
  let mutation: MutationTicket | null = null
  const mutationRequired = requiresIdempotency(method, businessPath)
  const keyValue = idempotencyKey(request)
  if (mutationRequired && keyValue === null) {
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
  if (isMutation(method)) {
    const parsed = requestBodyJson(request, body ?? Buffer.alloc(0))
    if (parsed === null) {
      send(response, 400, failure("invalid_json", "Request body must be a JSON object", id))
      return
    }
    json = parsed
  }
  const durableChatAdmission = composition.routeHandler === undefined
    && composition.businessStore !== null
    && method === "POST"
    && businessPath.length === 3
    && businessPath[0] === "sessions"
    && businessPath[2] === "messages"
  if (mutationRequired && !durableChatAdmission) {
    const route = `/${businessPath.join("/")}`
    const result = await mutationTicket(
      keyValue,
      method,
      route,
      context,
      mutationFingerprint(request, businessPath, json, body ?? Buffer.alloc(0)),
      composition.idempotency,
      composition.businessStore ?? undefined,
    )
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
  if (composition.routeHandler !== undefined) {
    const input: BffRouteInput = { request, response, businessPath, context, body, json, mutation, idempotency: composition.idempotency }
    const handled = await composition.routeHandler(input)
    if (handled === false || (handled !== true && !response.writableEnded)) {
      await reply(response, 404, failure("bff_route_not_found", "Business route was not found", id), context, composition.idempotency, mutation)
    }
    return
  }

  if (isMoriBusinessPath(businessPath)) {
    await liveMoriBusiness(request, response, config, context, businessPath, body, mutation, composition.idempotency)
    return
  }
  if (businessPath[0] === "sessions") {
    if (composition.businessStore !== null && await liveChatBusiness(request, response, config, context, businessPath, json, mutation, composition.idempotency, composition.businessStore)) return
    await liveAgentSession(
      request,
      response,
      config,
      context,
      businessPath,
      json,
      mutation,
      composition.idempotency,
      composition.businessStore?.agUi ?? null,
      composition.agUiRuntime,
      composition.agUiProjector !== undefined,
    )
    return
  }
  if (composition.businessStore !== null && bffOwnedBusinessPath(businessPath)) {
    if (await liveBffBusiness(request, response, context, businessPath, json, mutation, composition.idempotency, composition.businessStore)) return
  }
  if (await liveOwnerBusiness(request, response, config, context, businessPath, json, mutation, composition.idempotency)) return
  if (upstreamBase === null) {
    await reply(response, 503, failure("upstream_not_configured", `No upstream is configured for ${key || "this route"}`, id), context, composition.idempotency, mutation)
    return
  }
  try {
    const upstreamPath = `/${businessPath.map((segment) => encodeURIComponent(segment)).join("/")}${new URL(request.url || "/", "http://bff.local").search}`
    const upstream = await proxyUpstream(config, upstreamBase, upstreamPath, method, id, new Headers(request.headers as Record<string, string>), body)
    const normalized = normalizeUpstreamResponse(upstream, id)
    await reply(response, normalized.status, normalized.body, context, composition.idempotency, mutation)
  } catch {
    await reply(response, 502, failure("upstream_unreachable", "The configured upstream is unavailable", id), context, composition.idempotency, mutation)
  }
}

export type BffServerOptions = BffCompositionOptions

export type BffServer = Server & {
  /** Stop admission, drain active requests and workers, then close owned resources. */
  shutdown: (gracePeriodMs?: number) => Promise<void>
}

export function createBffServer(config: BffConfig = loadConfig(), options: BffServerOptions = {}): BffServer {
  const composition = createBffComposition(config, options)
  const server = createServer((request, response) => {
    void handle(request, response, config, composition).catch(() => {
      if (!response.headersSent) send(response, 500, failure("internal_error", "The BFF encountered an internal error", requestId(request)))
      else response.destroy()
    })
  })
  let shutdownPromise: Promise<void> | null = null
  const shutdown = (gracePeriodMs = 30_000): Promise<void> => {
    if (shutdownPromise !== null) return shutdownPromise
    shutdownPromise = new Promise<void>((resolve, reject) => {
      let forcedCloseTimer: NodeJS.Timeout | undefined
      const finish = (error?: Error): void => {
        if (forcedCloseTimer !== undefined) clearTimeout(forcedCloseTimer)
        if (error !== undefined) reject(error)
        else resolve()
      }
      const stopWorkers = composition.stopWorkers()
      const closeServer = new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => {
          if (error !== undefined && (error as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING") {
            rejectClose(error)
            return
          }
          resolveClose()
        })
      })
      if (Number.isFinite(gracePeriodMs) && gracePeriodMs > 0) {
        forcedCloseTimer = setTimeout(() => { server.closeAllConnections() }, gracePeriodMs)
        forcedCloseTimer.unref()
      }
      void Promise.all([stopWorkers, closeServer]).then(
        async () => {
          await composition.close()
          finish()
        },
        (error: unknown) => { finish(error instanceof Error ? error : new Error(String(error))) },
      )
    })
    return shutdownPromise
  }
  Object.assign(server, { shutdown })
  if (
    composition.agUiProjector !== undefined
    || composition.scheduledTaskDispatcher !== undefined
    || composition.agentDispatchDispatcher !== undefined
    || composition.agentCancellationDispatcher !== undefined
  ) {
    server.once("listening", () => {
      composition.agUiProjector?.start()
      composition.scheduledTaskDispatcher?.start()
      composition.agentDispatchDispatcher?.start()
      composition.agentCancellationDispatcher?.start()
    })
  }
  server.once("close", () => { void composition.close() })
  return server as BffServer
}
