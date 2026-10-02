import { projectResourceListRoute } from "../http/routes/project-resource-list.js"
import { libraryFileListRoute } from "../http/routes/library-file-list.js"
import { personalFileUploadRoute } from "../http/routes/personal-file-upload.js"
import { personalFileDownloadRoute } from "../http/routes/personal-file-download.js"
import { libraryArtifactRoute } from "../http/routes/library-artifact.js"
import { libraryArtifactDownloadRoute } from "../http/routes/library-artifact-download.js"
import { projectResourceRoute } from "../http/routes/project-resource.js"
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"

import { loadConfig, type BffConfig } from "../config/runtime.js"
import { authorizeUserRequest } from "../auth/user-admission.js"
import { failure, ok } from "../contracts/index.js"
import { mutationTicket, type MutationTicket } from "../application/idempotency.js"
import {
  mutationFingerprint,
  authorizeServerOnly,
  idempotencyKey,
  isMutation,
  pathOf,
  queryOf,
  readBody,
  requestBodyJson,
  requestId,
  requiresIdempotency,
} from "../http/request.js"
import { reply, send } from "../http/response.js"
import { normalizeUpstreamResponse } from "../infrastructure/clients/upstream-response.js"
import { proxyUpstream } from "../upstream.js"
import { liveAgentSession } from "../http/routes/agent.js"
import { liveChatBusiness } from "../http/routes/chat.js"
import { authorizeLiveBffMutation, liveBffBusiness } from "../http/routes/live-bff.js"
import { scheduledCreateInput } from "../application/scheduled/input.js"
import type { ScheduledTaskCreateInput } from "../application/ports/scheduled-task-repository.js"
import { authorizeChatRequest, type ChatAuthorization } from "../http/routes/chat-authorization.js"
import { liveOwnerBusiness } from "../http/routes/owner.js"
import { liveMoriBusiness } from "../http/routes/music.js"
import { configuredUpstream, bffOwnedBusinessPath, isMoriBusinessPath, upstreamKey } from "../http/routes/routing.js"
import { schedulerDispatch } from "../http/routes/scheduler.js"
import { runtimeManifest } from "../http/routes/runtime-manifest.js"
import { iamProtocolRelay } from "../http/routes/iam-protocol-relay.js"
import { liveTeamRead, liveTeamWrite } from "../http/routes/team.js"
import { createBffComposition, type BffCompositionOptions, type BffRouteInput } from "./runtime.js"
import { createSkillDraftRoute } from "../http/routes/create-skill-draft.js"
import { getSkillPackageUploadRoute } from "../http/routes/get-skill-package-upload.js"
import { beginSkillPackageUploadRoute } from "../http/routes/begin-skill-package-upload.js"
import { completeSkillPackageUploadRoute } from "../http/routes/complete-skill-package-upload.js"
import { validateSkillDraftRoute } from "../http/routes/validate-skill-draft.js"
import { publishSkillRoute } from "../http/routes/publish-skill.js"
import { skillInstallationRoute } from "../http/routes/skill-installations.js"

async function handle(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  composition: ReturnType<typeof createBffComposition>,
): Promise<void> {
  if ((request.url ?? "").startsWith("/iam")) {
    await iamProtocolRelay(request, response, config)
    return
  }
  const id = requestId(request)
  const segments = pathOf(request)
  if (segments.length === 1 && segments[0] === "healthz" && request.method === "GET") {
    send(response, 200, { status: "ok", service: "kokoro-bff", mode: config.mode })
    return
  }
  if (segments.length === 1 && segments[0] === "readyz" && request.method === "GET") {
    const ready =
      (await composition
        .readiness()
        .then(() => true)
        .catch(() => false)) &&
      (!config.agentEnabled || configuredUpstream(config, "agents") !== null)
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
      if (messages === null) {
        send(response, 404, failure("share_not_found", "Share was not found", id))
        return
      }
      send(
        response,
        200,
        ok(
          {
            session: {
              session_id: shared.conversation.conversationId,
              title: shared.conversation.title,
              owner_id: shared.conversation.ownerId,
              created_at: shared.conversation.createdAt.toISOString(),
              updated_at: shared.conversation.updatedAt.toISOString(),
            },
            ...(messages.messages.length === 0 ? {} : { messages: messages.messages }),
            files: [],
            deliveries: [],
            deliveries_has_more: false,
            event_watermark: null,
          },
          id,
        ),
      )
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
    // A service-only Share snapshot does not grant private Artifact visibility.
    send(response, 200, ok({ ...(detail as object), deliveries: [], deliveries_has_more: false }, id))
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
  const isSkillPackagePath = segments.length === 4 && segments[1] === "skills" && segments[3] === "package-upload"
  const isSkillPackageCompletePath = segments.length === 5 && segments[1] === "skills" && segments[3] === "package-upload" && segments[4] === "complete"
  const isSkillValidatePath = segments.length === 4 && segments[1] === "skills" && segments[3] === "validate"
  const isSkillPublishPath = segments.length === 4 && segments[1] === "skills" && segments[3] === "publish"
  const isSkillInstallationPath = businessPath[0] === "skill-installations"
  const isPlatformProjectionRead =
    request.method === "GET" &&
    ((businessPath[0] === "skills" &&
      (businessPath.length === 1 ||
        (businessPath.length === 2 && businessPath[1] !== "quota" && businessPath[1] !== "drafts" && businessPath[1] !== "github"))) ||
      (businessPath.length === 2 && businessPath[0] === "mcp" && businessPath[1] === "servers"))
  if (request.method === "GET" && businessPath.length === 3 && businessPath[0] === "projects" && businessPath[2] === "resources")
    response.setHeader("x-request-id", id)
  if (request.method === "POST" && businessPath.length === 2 && businessPath[0] === "library" && businessPath[1] === "files")
    response.setHeader("x-request-id", id)
  const admissionAbort = new AbortController()
  const onRequestAborted = (): void => {
    admissionAbort.abort()
  }
  const onResponseClosed = (): void => {
    if (!response.writableEnded) admissionAbort.abort()
  }
  request.once("aborted", onRequestAborted)
  response.once("close", onResponseClosed)
  const admission = await authorizeUserRequest(request, config, composition.sessionAdmission, id, admissionAbort.signal).finally(() => {
    request.removeListener("aborted", onRequestAborted)
    response.removeListener("close", onResponseClosed)
  })
  if (!admission.ok) {
    if (!response.destroyed) {
      response.setHeader("x-request-id", id)
      if (
        request.url === "/v1/skills/drafts" ||
        isSkillPackagePath ||
        isSkillPackageCompletePath ||
        isSkillValidatePath ||
        isSkillPublishPath ||
        isSkillInstallationPath ||
        isPlatformProjectionRead
      ) {
        response.setHeader("cache-control", "no-store")
        send(
          response,
          admission.status,
          { error: { code: admission.code, message: "BFF user admission failed", retryable: admission.status === 429 || admission.status === 503 } },
          admission.retryAfter,
        )
      } else send(response, admission.status, failure(admission.code, "BFF user admission failed", id), admission.retryAfter)
    }
    return
  }
  const context = admission.context

  if (isSkillInstallationPath) {
    const routeAbort = new AbortController()
    const abortRoute = (): void => routeAbort.abort()
    request.once("aborted", abortRoute)
    response.once("close", abortRoute)
    await skillInstallationRoute(request, response, context, businessPath, composition.personalInstallationClient, routeAbort.signal).finally(() => {
      request.removeListener("aborted", abortRoute)
      response.removeListener("close", abortRoute)
    })
    return
  }

  if (businessPath.length === 3 && businessPath[0] === "skills" && ["enable", "disable"].includes(businessPath[2] ?? "")) {
    send(response, 404, failure("bff_route_not_found", "Business route was not found", id))
    return
  }

  if (isSkillPublishPath) {
    const routeAbort = new AbortController()
    const abortRoute = (): void => routeAbort.abort()
    request.once("aborted", abortRoute)
    response.once("close", abortRoute)
    await publishSkillRoute(request, response, context, segments[2] ?? "", composition.skillDraftClient, routeAbort.signal).finally(() => {
      request.removeListener("aborted", abortRoute)
      response.removeListener("close", abortRoute)
    })
    return
  }

  if (isSkillValidatePath) {
    const routeAbort = new AbortController()
    const abortRoute = (): void => routeAbort.abort()
    request.once("aborted", abortRoute)
    response.once("close", abortRoute)
    await validateSkillDraftRoute(request, response, context, segments[2] ?? "", composition.skillDraftClient, routeAbort.signal).finally(() => {
      request.removeListener("aborted", abortRoute)
      response.removeListener("close", abortRoute)
    })
    return
  }

  if (isSkillPackageCompletePath) {
    const routeAbort = new AbortController()
    const abortRoute = (): void => routeAbort.abort()
    request.once("aborted", abortRoute)
    response.once("close", abortRoute)
    await completeSkillPackageUploadRoute(request, response, context, segments[2] ?? "", composition.skillDraftClient, routeAbort.signal).finally(() => {
      request.removeListener("aborted", abortRoute)
      response.removeListener("close", abortRoute)
    })
    return
  }

  if (isSkillPackagePath) {
    const routeAbort = new AbortController()
    const abortRoute = (): void => routeAbort.abort()
    request.once("aborted", abortRoute)
    response.once("close", abortRoute)
    const operation =
      request.method === "POST"
        ? beginSkillPackageUploadRoute(
            request,
            response,
            context,
            segments[2] ?? "",
            composition.skillDraftClient,
            config.storageObjectOrigin ?? config.storage?.objectOrigin ?? null,
            routeAbort.signal,
          )
        : getSkillPackageUploadRoute(request, response, context, segments[2] ?? "", composition.skillDraftClient, routeAbort.signal)
    await operation.finally(() => {
      request.removeListener("aborted", abortRoute)
      response.removeListener("close", abortRoute)
    })
    return
  }

  if (new URL(request.url || "/", "http://bff.local").pathname === "/v1/skills/drafts") {
    if (request.method !== "POST" || request.url !== "/v1/skills/drafts") {
      response.setHeader("x-request-id", id)
      send(response, 404, failure("bff_route_not_found", "Business route was not found", id))
      return
    }
    const routeAbort = new AbortController()
    const abortRoute = (): void => routeAbort.abort()
    request.once("aborted", abortRoute)
    response.once("close", abortRoute)
    await createSkillDraftRoute(request, response, context, composition.skillDraftClient, routeAbort.signal).finally(() => {
      request.removeListener("aborted", abortRoute)
      response.removeListener("close", abortRoute)
    })
    return
  }

  if (businessPath.length === 1 && businessPath[0] === "me") {
    response.setHeader("x-request-id", id)
    if (request.method !== "GET" || (request.url !== "/v1/me" && !(request.url ?? "").startsWith("/v1/me?"))) {
      send(response, 404, failure("bff_route_not_found", "Business route was not found", id))
      return
    }
    if (request.url !== "/v1/me") {
      send(response, 400, failure("current_user_query_invalid", "Current user request must not contain query parameters", id))
      return
    }
    if ((request.headers["content-length"] !== undefined && request.headers["content-length"] !== "0") || request.headers["transfer-encoding"] !== undefined) {
      send(response, 400, failure("current_user_body_rejected", "Current user request must not contain a body", id))
      return
    }
    send(response, 200, ok({ user_id: context.identity.userId, tenant_id: context.identity.namespace }, id))
    return
  }

  if (businessPath[0] === "team") {
    if (request.method === "GET") await liveTeamRead(request, response, config, context, admission.bearerToken, businessPath)
    else await liveTeamWrite(request, response, config, context, admission.bearerToken, businessPath)
    return
  }

  // Retired Skills/MCP mutations must not claim a BFF receipt or touch owner SQL.
  // The named v4 candidate routes above have already returned.
  if (composition.routeHandler === undefined && (businessPath[0] === "skills" || businessPath[0] === "mcp") && request.method !== "GET") {
    send(response, 503, failure("platform_operation_not_available", "This Platform operation is not exposed by the BFF owner adapter", id))
    return
  }

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
  let scheduledCreate: ScheduledTaskCreateInput | null = null
  if (composition.routeHandler === undefined && method === "POST" && businessPath.length === 1 && businessPath[0] === "scheduled-tasks") {
    if ((request.url ?? "").includes("?")) {
      send(response, 400, failure("invalid_scheduled_task", "Scheduled task creation does not accept query parameters", id))
      return
    }
    scheduledCreate = scheduledCreateInput(json)
    if (scheduledCreate === null) {
      send(response, 400, failure("invalid_scheduled_task", "Scheduled task fields are invalid", id))
      return
    }
  }
  let chatAuthorization: ChatAuthorization | null = null
  if (composition.routeHandler === undefined && composition.businessStore !== null) {
    try {
      chatAuthorization = await authorizeChatRequest(request, context, businessPath, json, composition.businessStore)
      if (chatAuthorization !== null && !chatAuthorization.ok) {
        send(response, chatAuthorization.status, failure(chatAuthorization.code, chatAuthorization.message, id))
        return
      }
      const resourceAuthorization = await authorizeLiveBffMutation(method, context, businessPath, scheduledCreate, composition.businessStore)
      if (resourceAuthorization !== null && !resourceAuthorization.ok) {
        send(response, resourceAuthorization.status, failure(resourceAuthorization.code, resourceAuthorization.message, id))
        return
      }
    } catch {
      send(response, 503, failure("business_store_unavailable", "The BFF business store is unavailable", id))
      return
    }
  }
  if (
    composition.routeHandler === undefined &&
    method === "GET" &&
    businessPath.length === 3 &&
    businessPath[0] === "projects" &&
    businessPath[1] !== undefined &&
    businessPath[2] === "resources"
  ) {
    await projectResourceListRoute(request, response, config, context, businessPath[1], composition.businessStore)
    return
  }
  if (composition.routeHandler === undefined && method === "GET" && businessPath.length === 1 && businessPath[0] === "library") {
    await libraryFileListRoute(request, response, config, context, undefined, composition.businessStore?.artifactLibrary)
    return
  }
  if (
    composition.routeHandler === undefined &&
    method === "GET" &&
    businessPath.length === 4 &&
    businessPath[0] === "library" &&
    businessPath[1] === "artifacts"
  ) {
    await libraryArtifactRoute(request, response, config, context, composition.businessStore?.artifactLibrary, businessPath[2] ?? "", businessPath[3] ?? "")
    return
  }
  if (
    composition.routeHandler === undefined &&
    method === "GET" &&
    businessPath.length === 5 &&
    businessPath[0] === "library" &&
    businessPath[1] === "artifacts" &&
    businessPath[4] === "content"
  ) {
    await libraryArtifactDownloadRoute(
      request,
      response,
      config,
      context,
      composition.businessStore?.artifactLibrary,
      businessPath[2] ?? "",
      businessPath[3] ?? "",
    )
    return
  }
  if (
    composition.routeHandler === undefined &&
    method === "GET" &&
    businessPath.length === 4 &&
    businessPath[0] === "library" &&
    businessPath[1] === "files" &&
    businessPath[3] === "content"
  ) {
    await personalFileDownloadRoute(request, response, config, context, businessPath[2] ?? "")
    return
  }
  if (
    composition.routeHandler === undefined &&
    method === "POST" &&
    businessPath.length === 3 &&
    businessPath[0] === "projects" &&
    businessPath[1] !== undefined &&
    businessPath[2] === "resources"
  ) {
    await projectResourceRoute(request, response, config, context, businessPath[1], body ?? Buffer.alloc(0), composition.businessStore, composition.idempotency)
    return
  }
  if (
    composition.routeHandler === undefined &&
    method === "POST" &&
    businessPath.length === 2 &&
    businessPath[0] === "library" &&
    businessPath[1] === "files"
  ) {
    await personalFileUploadRoute(request, response, config, context, body ?? Buffer.alloc(0), composition.businessStore, composition.idempotency)
    return
  }
  const durableChatAdmission =
    composition.routeHandler === undefined &&
    composition.businessStore !== null &&
    method === "POST" &&
    businessPath.length === 3 &&
    businessPath[0] === "sessions" &&
    businessPath[2] === "messages"
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
    if (
      composition.businessStore !== null &&
      chatAuthorization !== null &&
      chatAuthorization.ok &&
      (await liveChatBusiness(
        request,
        response,
        config,
        context,
        businessPath,
        json,
        mutation,
        composition.idempotency,
        composition.businessStore,
        chatAuthorization,
      ))
    )
      return
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
      chatAuthorization,
      composition.businessStore?.services.chat ?? null,
    )
    return
  }
  if (composition.businessStore !== null && bffOwnedBusinessPath(businessPath)) {
    if (await liveBffBusiness(request, response, context, businessPath, json, mutation, composition.idempotency, composition.businessStore, scheduledCreate))
      return
  }
  if (await liveOwnerBusiness(request, response, config, context, businessPath, json, mutation, composition.idempotency)) return
  if (upstreamBase === null) {
    await reply(
      response,
      503,
      failure("upstream_not_configured", `No upstream is configured for ${key || "this route"}`, id),
      context,
      composition.idempotency,
      mutation,
    )
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
        forcedCloseTimer = setTimeout(() => {
          server.closeAllConnections()
        }, gracePeriodMs)
        forcedCloseTimer.unref()
      }
      void Promise.all([stopWorkers, closeServer]).then(
        async () => {
          await composition.close()
          finish()
        },
        (error: unknown) => {
          finish(error instanceof Error ? error : new Error(String(error)))
        },
      )
    })
    return shutdownPromise
  }
  Object.assign(server, { shutdown })
  if (
    composition.agUiProjector !== undefined ||
    composition.scheduledTaskDispatcher !== undefined ||
    composition.agentDispatchDispatcher !== undefined ||
    composition.agentCancellationDispatcher !== undefined ||
    composition.scheduledAgentDispatcher !== undefined ||
    composition.scheduledAgentTerminalConsumer !== undefined
  ) {
    server.once("listening", () => {
      composition.agUiProjector?.start()
      composition.scheduledTaskDispatcher?.start()
      composition.agentDispatchDispatcher?.start()
      composition.scheduledAgentDispatcher?.start()
      composition.scheduledAgentTerminalConsumer?.start()
      composition.agentCancellationDispatcher?.start()
    })
  }
  server.once("close", () => {
    void composition.close()
  })
  return server as BffServer
}
