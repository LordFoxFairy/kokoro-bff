import { handleRunDisplayRequest } from "../http/routes/run-display.js"
import { messageRegenerationRoute, MessageRegenerationAdmissionError } from "../http/routes/message-regeneration.js"
import { handleMessageFeedbackRequest } from "../http/routes/message-feedback-native.js"
import {
  handleProjectCoreReadRequest,
  handleProjectDeleteRequest,
  handleProjectDeletionStatusRequest,
  handleProjectPinRequest,
  handleProjectRenameRequest,
  handleProjectResourceListRequest,
  handleProjectResourceDeleteRequest,
  handleProjectResourceReadRequest,
  handleProjectResourceUploadRequest,
} from "../http/routes/project-native.js"
import { handleSharedPublicRequest, handleSharedReaderRequest } from "../http/routes/shared-native.js"
import { handleHealthRequest } from "../http/routes/health-native.js"
import { handleProjectMcpRecommendationsRequest, projectMcpRecommendationsProvider } from "../http/routes/project-mcp-recommendations.js"
import { handleAppSkillBindingsRequest } from "../http/routes/app-skill-bindings-native.js"
import { handleScheduledTaskReadRequest } from "../http/routes/scheduled-task-native.js"
import { handlePersonalKnowledgeRequest } from "../http/routes/personal-knowledge-native.js"
import { handleAgentRunsInternalRequest } from "../http/routes/agent-runs-native.js"
import { handleProjectSkillSelectionRequest, projectSkillSelectionProvider } from "../http/routes/project-skill-selection.js"
import { Code, ConnectError } from "@connectrpc/connect"

import { mcpPersonalOperation, mcpPersonalRoute } from "../http/routes/mcp-personal.js"
import { customApiOperation, customApiRoute } from "../http/routes/custom-api.js"
import { handleMcpAdminRequest } from "../http/routes/mcp-admin-native.js"
import { handleMcpProjectPublicationRequest } from "../http/routes/mcp-project-publication-native.js"
import { handleConnectorListRequest } from "../http/routes/connector-list-native.js"
import { handleSkillSpecificationRequest } from "../http/routes/skill-specification-native.js"
import { handleSkillPackageInspectionRequest } from "../http/routes/skill-package-inspection-native.js"
import { handleSkillDownloadRequest } from "../http/routes/skill-download-native.js"
import { handleSkillSpecificationEnabledRequest } from "../http/routes/skill-specification-enabled.js"
import { startMcpRequestBudget, mcpRequestRemaining } from "../http/mcp-request-budget.js"
import { handleSkillUsageRequest } from "../http/routes/skill-usage.js"
import { handlePublishedSkillPackageRequest } from "../http/routes/skill-published-package-native.js"
import { startSkillRequestBudget, skillRequestRemaining } from "../http/routes/skill-drafts.js"
import { handleSkillAdminRequest } from "../http/routes/skill-admin-native.js"
import { handleAccountNativeRequest } from "../http/routes/account-native.js"
import { handleLibraryRequest, libraryRequest } from "../http/routes/library-native.js"
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"

import { loadConfig, type BffConfig } from "../config/runtime.js"
import {
  authorizeUserRequest,
  authorizeMcpAction,
  mcpActionForRequest,
  authorizeSkillAction,
  skillActionForRequest,
} from "../auth/user-admission.js"
import { handleSkillLocalImportRequest } from "../http/routes/skill-local-import-native.js"
import { failure } from "../contracts/index.js"
import { mutationTicket, type MutationTicket } from "../application/idempotency.js"
import {
  mutationFingerprint,
  idempotencyKey,
  isMutation,
  pathOf,
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
import type { ChatBusinessProvider } from "../http/routes/chat-business-provider.js"
import { authorizeScheduledTaskMutation, handleScheduledTaskMutationBusiness, scheduledTaskMutation } from "../http/routes/scheduled-task-mutation-native.js"
import { scheduledCreateInput } from "../application/scheduled/input.js"
import type { ScheduledTaskCreateInput } from "../application/scheduled/scheduled-task-repository.js"
import { authorizeChatRequest, type ChatAuthorization } from "../http/routes/chat-authorization.js"
import { handleRetiredOwnerBusiness } from "../http/routes/retired-owner-native.js"
import { billingPersonalRequest, handleBillingPersonalBusiness } from "../http/routes/billing-personal-native.js"
import { handleSystemModelCatalogBusiness, systemModelCatalogRequest } from "../http/routes/system-model-catalog-native.js"
import { livePlatformProjectionRead, platformProjectionRequest } from "../http/routes/platform-projection.js"
import { handleProjectMutationBusiness, projectMutation } from "../http/routes/project-mutation-native.js"
import { handleMoriRequest } from "../http/routes/music-native.js"
import { configuredUpstream, bffOwnedBusinessPath, upstreamKey } from "../http/routes/routing.js"
import { schedulerDispatch } from "../http/routes/scheduler.js"
import { handleSystemNativeRequest } from "../http/routes/system-native.js"
import { handleChatNativeRequest } from "../http/routes/chat-native.js"
import { handleChatBusinessReadRequest } from "../http/routes/chat-business-native.js"
import { handleChatMutationRequest } from "../http/routes/chat-mutation-native.js"
import { handleChatEventsRequest } from "../http/routes/chat-events-native.js"
import { handleChatMessageRequest } from "../http/routes/chat-message-native.js"
import { handleMessageRegenerationRequest } from "../http/routes/message-regeneration-native.js"
import { createBffComposition, type BffCompositionOptions, type BffRouteInput } from "./runtime.js"
import { handleSkillDraftRequest } from "../http/routes/skill-draft-native.js"
import { handleSkillDraftMutationRequest } from "../http/routes/skill-draft-mutations-native.js"
import { handleSkillCatalogCommandRequest, handleSkillCoverRequest, handleSkillGithubPreviewRequest, handleSkillPackageUploadReadRequest } from "../http/routes/skill-catalog-command-native.js"
import { handleSkillGithubImportRequest } from "../http/routes/skill-import-native.js"
import { handleSkillAiImportRequest } from "../http/routes/skill-ai-import-native.js"
import { handleSkillShareRequest } from "../http/routes/skill-share-native.js"
import { handleAdminIdentityRequest } from "../http/routes/admin-identity-native.js"
import { handleBillingAdminRequest } from "../http/routes/billing-admin-native.js"
import { handleSystemAdminRequest } from "../http/routes/system-admin-native.js"
import { handlePersonalSkillInstallationRequest, handleProjectSkillInstallationRequest } from "../http/routes/skill-installations.js"
import { handleMoveSessionRequest } from "../http/routes/move-session-native.js"
import { handleManagedPersonalSkillsRequest } from "../http/routes/managed-personal-skills.js"
import { handlePersonalSkillLifecycleRequest } from "../http/routes/personal-skill-lifecycle-native.js"
import { type ProjectSkillContentAccess } from "../http/routes/skill-package-inspection.js"
import { configureBffProtobufTextEncoding } from "../infrastructure/protobuf-text-encoding.js"
import { handleIamRelayRequest } from "../modules/iam-relay/iam-relay.middleware.js"
import { handleAgentConnectionSetupRequest } from "../http/routes/agent-connection-setup-native.js"

function projectContentAccessForRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  composition: ReturnType<typeof createBffComposition>,
  requestIdValue: string,
): ProjectSkillContentAccess {
  return async (projectRef, context, signal) => {
    const fresh = await authorizeUserRequest(request, config, composition.sessionAdmission, requestIdValue, signal)
    signal.throwIfAborted()
    if (!fresh.ok) {
      if (fresh.retryAfter !== undefined) response.setHeader("retry-after", fresh.retryAfter)
      send(response, fresh.status, {
        error: {
          code: fresh.code,
          message: "Current user admission is required",
          retryable: fresh.status === 429 || fresh.status >= 500,
        },
      })
      return null
    }
    if (fresh.context.identity.namespace !== context.identity.namespace || fresh.context.identity.userId !== context.identity.userId)
      throw new ConnectError("Project not found", Code.NotFound)
    const owner = composition.projectService
    if (!owner) throw new ConnectError("Project owner unavailable", Code.Unavailable)
    const project = await owner.find(
      {
        tenantId: context.identity.namespace,
        subjectId: context.identity.userId,
      },
      projectRef,
    )
    signal.throwIfAborted()
    if (!project) throw new ConnectError("Project not found", Code.NotFound)
    return project.id
  }
}

export async function handleBffRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  composition: ReturnType<typeof createBffComposition>,
): Promise<void> {
  const id = requestId(request)
  response.setHeader("x-request-id", id)
  const rawPathname = new URL(request.url || "/", "http://bff.local").pathname
  const isRawSkillPackageInspection =
    request.method === "GET" &&
    /^\/v1\/projects\/[^/]+\/skill-installations\/[^/]+\/package$/u.test(rawPathname)
  let segments: string[]
  try {
    segments = pathOf(request)
  } catch (error) {
    if (!isRawSkillPackageInspection) throw error
    send(response, 400, {
      error: {
        code: "invalid_skill_package_request",
        message: "Skill package request is invalid",
        retryable: false,
      },
    })
    return
  }
  if (segments[0] === "internal" && segments[1] === "bff" && segments[2] === "scheduled-tasks" && segments[3] === "dispatch" && segments.length === 4) {
    const schedulerProvider = composition.schedulerDispatchReceipts !== null && composition.scheduledTaskService !== null
      ? {
          schedulerDispatchReceipts: composition.schedulerDispatchReceipts,
          scheduledTasks: composition.scheduledTaskService,
          ...(composition.scheduledAgentDispatch === null ? {} : { scheduledAgentDispatch: composition.scheduledAgentDispatch }),
        }
      : null
    await schedulerDispatch(request, response, config, schedulerProvider, composition.idempotency)
    return
  }
  const removedSkillRead =
    request.method === "GET" &&
    segments[0] === "v1" &&
    segments[1] === "skills" &&
    (segments.length === 2 ||
      (segments.length === 3 && !["quota", "drafts", "github"].includes(segments[2] ?? "")) ||
      (segments.length === 4 && segments[3] === "download"))
  if (removedSkillRead) {
    send(response, 404, failure("route_not_found", "Route was not found", id))
    return
  }
  const browserPrivateMcp = segments[0] === "browser" && segments[1] === "v1"
  if (!browserPrivateMcp && segments[0] !== "v1") {
    send(response, 404, failure("route_not_found", "Use the versioned /v1 business API", id))
    return
  }

  const businessPath = browserPrivateMcp ? segments.slice(2) : segments.slice(1)
  const adminOperationDeadline =
    !browserPrivateMcp &&
    request.method === "GET" &&
    businessPath.length === 4 &&
    businessPath[0] === "admin" &&
    businessPath[1] === "model-providers" &&
    businessPath[3] === "upstream-models"
      ? Date.now() + Math.min(config.upstreamTimeoutMs, 10_000)
      : undefined
  if (!browserPrivateMcp && businessPath[0] === "self" && businessPath[1] === "mcp") {
    send(response, 404, failure("route_not_found", "Route was not found", id))
    return
  }
  const isMessageRegenerationPath =
    !browserPrivateMcp && businessPath.length === 5 && businessPath[0] === "sessions" && businessPath[2] === "messages" && businessPath[4] === "regenerate"
  const messageRegenerationDeadline = isMessageRegenerationPath ? performance.now() + 10000 : null
  const preferenceDeadline = messageRegenerationDeadline
  const isProjectMcpRecommendationsPath =
    !browserPrivateMcp && businessPath.length === 3 && businessPath[0] === "projects" && businessPath[2] === "mcp-recommendations"
  const isProjectSkillSelectionPath =
    composition.routeHandler === undefined && businessPath.length === 3 && businessPath[0] === "projects" && businessPath[2] === "skill-selection"
  const isProjectInstallationPath = businessPath[0] === "projects" && businessPath[2] === "skill-installations"
  const hasSkillsBudget =
    isProjectInstallationPath ||
    isProjectSkillSelectionPath ||
    ["skills", "skill-installations", "skill-shares"].includes(businessPath[0] ?? "") ||
    (businessPath[0] === "admin" && businessPath[1] === "skills") ||
    (businessPath[0] === "self" && businessPath[1] === "skills")
  if (hasSkillsBudget) startSkillRequestBudget(request)
  const mcpAction = mcpActionForRequest(request.method ?? "GET", businessPath, browserPrivateMcp)
  const isMcpPersonalOperation = browserPrivateMcp && mcpPersonalOperation(businessPath, request.method ?? "GET") !== null
  const isCustomApiOperation = browserPrivateMcp && customApiOperation(businessPath, request.method ?? "GET") !== null
  const defersMcpPersonalReadAction = isMcpPersonalOperation && request.method === "GET"
  if (browserPrivateMcp && !isMcpPersonalOperation && !isCustomApiOperation) {
    send(response, 404, failure("route_not_found", "Route was not found", id))
    return
  }
  const hasMcpBudget =
    isProjectMcpRecommendationsPath ||
    mcpAction !== null ||
    isMcpPersonalOperation ||
    isCustomApiOperation
  if (hasMcpBudget) {
    startMcpRequestBudget(request, 10_000)
    response.setHeader("cache-control", "no-store")
    response.setHeader("x-request-id", id)
  }
  const isPersonalKnowledgePath =
    businessPath[0] === "preferences" &&
    ((businessPath.length === 2 && ["knowledge", "knowledge-usage"].includes(businessPath[1]!)) ||
      (businessPath.length === 3 && businessPath[1] === "knowledge"))
  const isMoveSessionPath =
    composition.routeHandler === undefined &&
    request.method === "POST" &&
    businessPath.length === 3 &&
    businessPath[0] === "sessions" &&
    businessPath[2] === "move"
  if (isMoveSessionPath) response.setHeader("x-request-id", id)
  const isSkillPackagePath = segments.length === 4 && segments[1] === "skills" && segments[3] === "package-upload"
  const isSkillPackageCompletePath = segments.length === 5 && segments[1] === "skills" && segments[3] === "package-upload" && segments[4] === "complete"
  const isSkillValidatePath = segments.length === 4 && segments[1] === "skills" && segments[3] === "validate"
  const isSkillPublishPath = segments.length === 4 && segments[1] === "skills" && segments[3] === "publish"
  const isSkillInstallationPath = businessPath[0] === "skill-installations" || isProjectInstallationPath
  const isPlatformProjectionRead =
    request.method === "GET" && businessPath.length === 2 && businessPath[0] === "mcp" && ["servers", "connections"].includes(businessPath[1]!)
  if (request.method === "GET" && businessPath.length === 3 && businessPath[0] === "projects" && businessPath[2] === "resources")
    response.setHeader("x-request-id", id)
  if (request.method === "POST" && businessPath.length === 2 && businessPath[0] === "library" && businessPath[1] === "files")
    response.setHeader("x-request-id", id)
  const admissionAbort = new AbortController()
  const admissionTimer = setTimeout(
    () => admissionAbort.abort(new Error("skill_admission_deadline")),
    preferenceDeadline !== null
      ? Math.max(0, preferenceDeadline - performance.now())
      : adminOperationDeadline === undefined
        ? hasMcpBudget
          ? mcpRequestRemaining(request)
          : hasSkillsBudget
            ? skillRequestRemaining(request)
            : 10_000
        : Math.max(0, adminOperationDeadline - Date.now()),
  )
  const onRequestAborted = (): void => {
    admissionAbort.abort()
  }
  const onResponseClosed = (): void => {
    if (!response.writableEnded) admissionAbort.abort()
  }
  request.once("aborted", onRequestAborted)
  response.once("close", onResponseClosed)
  const admissionWork = Promise.resolve()
    .then(() => authorizeUserRequest(request, config, composition.sessionAdmission, id, admissionAbort.signal))
    .then(async (result) => {
      if (result.ok && mcpAction !== null && !defersMcpPersonalReadAction) {
        admissionAbort.signal.throwIfAborted()
        if (mcpRequestRemaining(request) <= 0) throw new Error("mcp_admission_deadline")
        const checked = await authorizeMcpAction(composition.mcpAuthorization, result, mcpAction, admissionAbort.signal)
        if (mcpRequestRemaining(request) <= 0) throw new Error("mcp_admission_deadline")
        if (!checked.ok)
          return {
            ...checked,
            retryAfter: checked.status === 429 ? checked.retryAfter : undefined,
          }
      }
      const action = skillActionForRequest(request.method ?? "GET", businessPath)
      if (!result.ok || action === null) return result
      const checked = await authorizeSkillAction(composition.skillAuthorization, result, action, admissionAbort.signal)
      return checked.ok ? result : { ...checked, retryAfter: undefined }
    })
  const admission = await new Promise<Awaited<typeof admissionWork>>((resolve) => {
    const abort = () => resolve({ ok: false, status: 503, code: "iam_admission_unavailable" })
    admissionAbort.signal.addEventListener("abort", abort, { once: true })
    void admissionWork
      .then(resolve, () =>
        resolve({
          ok: false,
          status: 503,
          code: "iam_admission_unavailable",
        }),
      )
      .finally(() => admissionAbort.signal.removeEventListener("abort", abort))
    if (admissionAbort.signal.aborted) abort()
  }).finally(() => {
    clearTimeout(admissionTimer)
    request.removeListener("aborted", onRequestAborted)
    response.removeListener("close", onResponseClosed)
  })
  if (!admission.ok) {
    if (!response.destroyed) {
      response.setHeader("x-request-id", id)
      if (
        hasMcpBudget ||
        hasSkillsBudget ||
        request.url === "/v1/skills/drafts" ||
        isSkillPackagePath ||
        isSkillPackageCompletePath ||
        isSkillValidatePath ||
        isSkillPublishPath ||
        isSkillInstallationPath ||
        isPlatformProjectionRead ||
        isMcpPersonalOperation ||
        isMoveSessionPath ||
        isPersonalKnowledgePath
      ) {
        response.setHeader("cache-control", "no-store")
        send(
          response,
          admission.status,
          {
            error: {
              code: admission.code,
              message: "BFF user admission failed",
              retryable: admission.status === 429 || admission.status === 503,
            },
          },
          admission.retryAfter,
        )
      } else send(response, admission.status, failure(admission.code, "BFF user admission failed", id), admission.retryAfter)
    }
    return
  }
  if (hasMcpBudget && (admissionAbort.signal.aborted || mcpRequestRemaining(request) <= 0)) {
    if (!response.destroyed && !response.writableEnded)
      send(response, 503, {
        error: {
          code: "iam_admission_unavailable",
          message: "BFF user admission failed",
          retryable: true,
        },
      })
    return
  }
  if (isCustomApiOperation) {
    await customApiRoute(request, response, composition.customApiClient, admission.context, id, businessPath)
    return
  }
  if (
    hasMcpBudget &&
    !isMcpPersonalOperation &&
    !isProjectMcpRecommendationsPath &&
    (request.method !== "GET" || businessPath[0] === "self")
  ) {
    if (!response.destroyed && !response.writableEnded)
      send(response, 503, failure("platform_operation_not_available", "This Platform operation is not exposed by the BFF owner adapter", id))
    return
  }
  const context = admission.context
  if (isMessageRegenerationPath && messageRegenerationDeadline !== null) {
    await messageRegenerationRoute(
      request,
      response,
      context,
      businessPath,
      composition.chatTurnService === null ? null : { chatTurnService: composition.chatTurnService },
      messageRegenerationDeadline,
      async (signal) => {
      const fresh = await authorizeUserRequest(request, config, composition.sessionAdmission, id, signal)
      if (!fresh.ok) throw new MessageRegenerationAdmissionError(fresh.status, fresh.code, fresh.retryAfter)
      if (fresh.context.identity.namespace !== context.identity.namespace || fresh.context.identity.userId !== context.identity.userId)
        throw new MessageRegenerationAdmissionError(404, "message_not_found")
      },
    )
    return
  }
  const currentProjectAccess = async (projectRef: string, signal: AbortSignal): Promise<string> => {
    const fresh = await authorizeUserRequest(request, config, composition.sessionAdmission, id, signal)
    if (!fresh.ok) throw new ConnectError("Project admission failed", fresh.status >= 500 ? Code.Unavailable : Code.PermissionDenied)
    if (fresh.context.identity.namespace !== context.identity.namespace || fresh.context.identity.userId !== context.identity.userId)
      throw new ConnectError("Project not found", Code.NotFound)
    const action = skillActionForRequest(request.method ?? "GET", businessPath)
    if (action !== null) {
      const checked = await authorizeSkillAction(composition.skillAuthorization, fresh, action, signal)
      if (!checked.ok) throw new ConnectError("Project Skill action denied", checked.status >= 500 ? Code.Unavailable : Code.PermissionDenied)
    }
    signal.throwIfAborted()
    if (!composition.projectService) throw new ConnectError("Project owner unavailable", Code.Unavailable)
    const project = await composition.projectService.find(
      {
        tenantId: context.identity.namespace,
        subjectId: context.identity.userId,
      },
      projectRef,
    )
    signal.throwIfAborted()
    if (!project) throw new ConnectError("Project not found", Code.NotFound)
    return project.id
  }
  if (isMcpPersonalOperation) {
    await mcpPersonalRoute(request, response, config, composition, admission, businessPath)
    return
  }
  if (businessPath.length === 3 && businessPath[0] === "skills" && ["enable", "disable"].includes(businessPath[2] ?? "")) {
    send(response, 404, failure("bff_route_not_found", "Business route was not found", id))
    return
  }

  if (composition.routeHandler === undefined && businessPath[0] === "projects" && businessPath.length === 4 && businessPath[2] === "skills") {
    send(response, 404, failure("bff_route_not_found", "Business route was not found", id))
    return
  }

  // Retired Skills mutations must not claim a BFF receipt or touch owner SQL.
  // The named v4 candidate routes above have already returned.
  if (composition.routeHandler === undefined && businessPath[0] === "skills" && request.method !== "GET") {
    send(response, 503, failure("platform_operation_not_available", "This Platform operation is not exposed by the BFF owner adapter", id))
    return
  }

  if (composition.routeHandler === undefined && bffOwnedBusinessPath(businessPath) && composition.businessStore === null) {
    send(response, 503, failure("business_store_not_configured", "BFF business fact store is not configured", id))
    return
  }

  const key = upstreamKey(businessPath)
  const upstreamBase = key === null ? null : configuredUpstream(config, key)
  if (
    composition.routeHandler === undefined &&
    key === null &&
    !isPlatformProjectionRead &&
    !bffOwnedBusinessPath(businessPath)
  ) {
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
  const chatService = composition.chatService
  const projectService = composition.projectService
  const chatProvider: ChatBusinessProvider = {
    ...(chatService === undefined || chatService === null ? {} : { chatService }),
    ...(composition.chatTurnService === null ? {} : { chatTurnService: composition.chatTurnService }),
    ...(projectService === undefined || projectService === null ? {} : { projectService }),
    ...(composition.agUiConsumers === null ? {} : { agUiConsumers: composition.agUiConsumers }),
  }
  if (composition.routeHandler === undefined && composition.businessStore !== null) {
    try {
      chatAuthorization = await authorizeChatRequest(request, context, businessPath, json, chatProvider)
      if (chatAuthorization !== null && !chatAuthorization.ok) {
        send(response, chatAuthorization.status, failure(chatAuthorization.code, chatAuthorization.message, id))
        return
      }
      const resourceAuthorization = composition.projectService !== null && composition.scheduledTaskService !== null
        ? await authorizeScheduledTaskMutation(method, context, businessPath, scheduledCreate, { projects: composition.projectService, scheduledTasks: composition.scheduledTaskService })
        : null
      if (resourceAuthorization !== null && !resourceAuthorization.ok) {
        send(response, resourceAuthorization.status, failure(resourceAuthorization.code, resourceAuthorization.message, id))
        return
      }
    } catch {
      send(response, 503, failure("business_store_unavailable", "The BFF business store is unavailable", id))
      return
    }
  }
  if (composition.routeHandler === undefined && libraryRequest(request)) {
    await handleLibraryRequest(request, response, config, context, {
      ...(composition.artifactLibrary === null ? {} : { artifactLibrary: composition.artifactLibrary }),
      receipts: composition.businessStore,
      idempotency: composition.idempotency,
    }, body ?? Buffer.alloc(0))
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
    const input: BffRouteInput = {
      request,
      response,
      businessPath,
      context,
      body,
      json,
      mutation,
      idempotency: composition.idempotency,
    }
    const handled = await composition.routeHandler(input)
    if (handled === false || (handled !== true && !response.writableEnded)) {
      await reply(response, 404, failure("bff_route_not_found", "Business route was not found", id), context, composition.idempotency, mutation)
    }
    return
  }

  if (composition.businessStore !== null && projectMutation(request) !== null) {
    const projectOwner = composition.projectService
    if (projectOwner !== null && await handleProjectMutationBusiness(request, response, context, projectOwner, json, mutation, composition.idempotency)) return
  }

  if (composition.businessStore !== null && scheduledTaskMutation(request) !== null) {
    const scheduledOwner = composition.scheduledTaskService
    const projectOwner = composition.projectService
    if (scheduledOwner !== null && projectOwner !== null && await handleScheduledTaskMutationBusiness(request, response, context, scheduledOwner, projectOwner, json, mutation, composition.idempotency)) return
  }

  if (billingPersonalRequest(request) && await handleBillingPersonalBusiness(request, response, config, context, businessPath, json, mutation, composition.idempotency)) return
  if (systemModelCatalogRequest(request) && await handleSystemModelCatalogBusiness(request, response, config, context, composition.idempotency, mutation)) return
  if (platformProjectionRequest(request) && await livePlatformProjectionRead(request, response, config, context, businessPath)) return
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
        chatProvider,
        chatAuthorization,
        composition.installationClient,
        currentProjectAccess,
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
      composition.agUiProjection,
      composition.agUiRuntime,
      composition.agUiProjector !== undefined,
      chatAuthorization,
      composition.chatService,
    )
    return
  }
  if (await handleRetiredOwnerBusiness(request, response, context, composition.idempotency, mutation)) return
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
  configureBffProtobufTextEncoding()
  const composition = createBffComposition(config, options)
  const projectResourceProjectReader = composition.projectService
  const projectResourceUpload = composition.businessStore === null || typeof projectResourceProjectReader?.find !== "function"
    ? null
    : {
        find: projectResourceProjectReader.find.bind(projectResourceProjectReader),
        receipts: composition.businessStore,
        idempotency: composition.idempotency,
      }
  const server = createServer({ maxHeaderSize: 32768 }, (request, response) => {
    const handler = handleHealthRequest(request, response, config, composition.readiness)
      .then((handled) => handled ? true : handleIamRelayRequest(request, response, config))
      .then((handled) => handled ? true : composition.routeHandler === undefined ? handleSharedPublicRequest(request, response, config, composition.publicShareService) : false)
      .then((handled) => handled ? true : handleSharedReaderRequest(request, response, config, composition.sharedSessionReader))
      .then((handled) => handled ? true : handleAdminIdentityRequest(request, response, config, composition.sessionAdmission))
      .then((handled) => handled ? true : handleBillingAdminRequest(request, response, config, composition.sessionAdmission))
      .then((handled) => handled ? true : composition.routeHandler !== undefined ? false : handleSystemAdminRequest(request, response, config, composition.sessionAdmission))
      .then((handled) => handled ? true : handleMcpProjectPublicationRequest(request, response, config, {
        sessionAdmission: composition.sessionAdmission,
        mcpAuthorization: composition.mcpAuthorization,
        project: composition.projectService,
        client: composition.mcpProjectPublicationClient,
      }))
      .then((handled) => handled ? true : handleMcpAdminRequest(request, response, config, composition.sessionAdmission, composition.mcpAuthorization, composition.mcpProviderAdminClient, composition.mcpPackageAdminClient))
      .then((handled) => handled ? true : handleSkillPackageInspectionRequest(request, response, config, composition.sessionAdmission, { client: null, installations: composition.installationClient }, composition.projectService))
      .then((handled) => handled ? true : handleSkillDownloadRequest(
        request,
        response,
        config,
        composition.sessionAdmission,
        composition.skillDownloadHandles,
        composition.skillSpecificationSource,
        composition.exactSkillDownloadSource,
        projectContentAccessForRequest(request, response, config, composition, requestId(request)),
      ))
      .then((handled) => handled ? true : handleSkillSpecificationRequest(request, response, config, {
        skillListAdmission: composition.skillListAdmission,
        skillSpecificationSource: composition.skillSpecificationSource,
        sessionAdmission: composition.sessionAdmission,
        skillDownloadHandles: composition.skillDownloadHandles,
      }))
      .then((handled) => handled ? true : handleAppSkillBindingsRequest(request, response, config, composition.sessionAdmission, composition.openAppManagementAdmission, composition.appSkillBindingClient))
      .then((handled) => handled ? true : handleConnectorListRequest(request, response, config, composition.sessionAdmission, composition.mcpPersonalClient, composition.mcpAuthorization))
      .then((handled) => handled ? true : handleMoveSessionRequest(request, response, config, composition.sessionAdmission, composition.chatService))
      .then((handled) => handled ? true : handleAccountNativeRequest(request, response, config, composition.sessionAdmission, composition.personalizationProvider))
      .then((handled) => handled ? true : composition.routeHandler !== undefined ? false : handleMoriRequest(request, response, config, composition.sessionAdmission, { entries: composition.idempotency, ...(composition.businessStore === null ? {} : { persistent: composition.businessStore }) }))
      .then((handled) =>
        handled
          ? true
          : handleAgentRunsInternalRequest(
              request,
              response,
              config,
              composition.submittedAgentRuns,
              composition.projectExecutionBindings,
            ),
      )
      .then((handled) =>
        handled
          ? true
          : handleRunDisplayRequest(
              request,
              response,
              config,
              composition.sessionAdmission,
              composition.submittedAgentRuns && composition.chatService
                ? { submittedAgentRuns: composition.submittedAgentRuns, chat: composition.chatService }
                : null,
            ),
      )
      .then((handled) => (handled ? true : handleChatNativeRequest(request, response, config, composition.sessionAdmission, composition.chatService)))
      .then((handled) => (handled ? true : handleChatBusinessReadRequest(request, response, config, composition.sessionAdmission, composition.chatService, composition.projectService)))
      .then((handled) => (handled ? true : handleMessageFeedbackRequest(request, response, config, composition.sessionAdmission, composition.chatService)))
      .then((handled) =>
        handled
          ? true
          : composition.routeHandler !== undefined || composition.chatTurnService === null
            ? false
            : handleMessageRegenerationRequest(request, response, config, composition.sessionAdmission, composition.chatTurnService),
      )
      .then((handled) =>
        handled
          ? true
          : composition.routeHandler !== undefined || composition.businessStore === null || composition.chatService === null || composition.projectService === null
            ? false
            : handleChatMutationRequest(
                request,
                response,
                config,
                composition.sessionAdmission,
                composition.chatService,
                composition.projectService,
                composition.idempotency,
                composition.businessStore,
              ),
      )
      .then((handled) =>
        handled
          ? true
          : composition.routeHandler !== undefined || composition.chatService === null || composition.projectService === null || composition.agUiProjection === null || composition.agUiConsumers === null
            ? false
            : handleChatEventsRequest(
                request,
                response,
                config,
                composition.sessionAdmission,
                composition.chatService,
                composition.projectService,
                composition.agUiProjection,
                composition.agUiConsumers,
                composition.agUiRuntime,
                composition.agUiProjector !== undefined,
              ),
      )
      .then((handled) =>
        handled
          ? true
          : composition.routeHandler !== undefined || composition.businessStore === null || composition.chatService === null || composition.chatTurnService === null || composition.projectService === null
            ? false
            : handleChatMessageRequest(
                request,
                response,
                config,
                composition.sessionAdmission,
                composition.chatService,
                composition.chatTurnService,
                composition.projectService,
                composition.installationClient,
                composition.idempotency,
                composition.businessStore,
              ),
      )
      .then((handled) => (handled ? true : composition.routeHandler !== undefined ? false : handleProjectRenameRequest(request, response, config, composition.sessionAdmission, composition.projectService)))
      .then((handled) => (handled ? true : composition.routeHandler !== undefined ? false : handleProjectDeleteRequest(request, response, config, composition.sessionAdmission, composition.projectService)))
      .then((handled) => (handled ? true : composition.routeHandler !== undefined ? false : handleProjectDeletionStatusRequest(request, response, config, composition.sessionAdmission, composition.projectService)))
      .then((handled) => (handled ? true : composition.routeHandler !== undefined ? false : handleProjectResourceDeleteRequest(request, response, config, composition.sessionAdmission, composition.projectService)))
      .then((handled) => (handled ? true : composition.routeHandler !== undefined ? false : handleProjectResourceUploadRequest(request, response, config, composition.sessionAdmission, projectResourceUpload)))
      .then((handled) => (handled ? true : composition.routeHandler !== undefined ? false : handleProjectResourceReadRequest(request, response, config, composition.sessionAdmission, composition.projectService)))
      .then((handled) => (handled ? true : composition.routeHandler !== undefined ? false : handleProjectResourceListRequest(request, response, config, composition.sessionAdmission, composition.projectService)))
      .then((handled) => (handled ? true : composition.routeHandler !== undefined ? false : handleProjectCoreReadRequest(request, response, config, composition.sessionAdmission, composition.projectService)))
      .then((handled) => (handled ? true : handleProjectPinRequest(request, response, config, composition.sessionAdmission, composition.projectService)))
      .then((handled) =>
        handled
          ? true
          : composition.routeHandler !== undefined
            ? false
            : handleProjectSkillSelectionRequest(
                request,
                response,
                config,
                composition.sessionAdmission,
                composition.projectSkillSelectionProvider ?? projectSkillSelectionProvider(composition.projectService, composition.businessStore),
                composition.installationClient,
              ),
      )
      .then((handled) =>
        handled
          ? true
          : composition.routeHandler !== undefined
            ? false
            : handleSkillDraftRequest(
                request,
                response,
                config,
                composition.sessionAdmission,
                composition.skillAuthorization,
                composition.skillDraftClient,
              ),
      )
      .then((handled) =>
        handled
          ? true
          : composition.routeHandler !== undefined
            ? false
            : handleSkillPackageUploadReadRequest(request, response, config, composition.sessionAdmission, composition.skillDraftClient),
      )
      .then((handled) =>
        handled
          ? true
          : composition.routeHandler !== undefined
            ? false
            : handleSkillCoverRequest(
                request,
                response,
                config,
                composition.sessionAdmission,
                composition.skillAuthorization,
                composition.skillProductClient,
              ),
      )
      .then((handled) =>
        handled
          ? true
          : composition.routeHandler !== undefined
            ? false
            : handlePublishedSkillPackageRequest(request, response, config, composition.sessionAdmission, composition.skillProductClient),
      )
      .then((handled) =>
        handled
          ? true
          : handleSkillAdminRequest(request, response, config, composition.sessionAdmission, composition.skillAuthorization, composition.skillAdminClient),
      )
      .then((handled) =>
        handled
          ? true
          : handleSkillGithubImportRequest(request, response, config, composition.sessionAdmission, composition.businessStore, composition.skillProductClient),
      )
      .then((handled) =>
        handled
          ? true
          : handleSkillAiImportRequest(
              request,
              response,
              config,
              composition.sessionAdmission,
              composition.businessStore,
              composition.skillAiAssociation,
              composition.skillProductClient,
            ),
      )
      .then((handled) =>
        handled
          ? true
          : handleSkillShareRequest(
              request,
              response,
              config,
              composition.sessionAdmission,
              composition.skillShareRepository ?? undefined,
              composition.skillProductClient,
              composition.skillSpecificationSource,
            ),
      )
      .then((handled) =>
        handled
          ? true
          : handleSkillGithubPreviewRequest(request, response, config, composition.sessionAdmission),
      )
      .then((handled) =>
        handled
          ? true
          : composition.routeHandler !== undefined
            ? false
            : handleSkillLocalImportRequest(request, response, config, composition.sessionAdmission, composition.skillAuthorization, composition.localSkillImportClient),
      )
      .then((handled) =>
        handled
          ? true
          : composition.routeHandler !== undefined
            ? false
            : handlePersonalKnowledgeRequest(request, response, config, composition.sessionAdmission, composition.personalKnowledgeRepository),
      )
      .then((handled) =>
        handled
          ? true
          : composition.routeHandler !== undefined
            ? false
            : handleSkillDraftMutationRequest(
                request,
                response,
                config,
                composition.sessionAdmission,
                composition.skillAuthorization,
                composition.skillProductClient,
              ),
      )
      .then((handled) =>
        handled
          ? true
          : composition.routeHandler !== undefined
            ? false
            : handleSkillCatalogCommandRequest(
                request,
                response,
                config,
                composition.sessionAdmission,
                composition.skillAuthorization,
                composition.skillDraftClient,
              ),
      )
      .then((handled) =>
        handled
          ? true
          : composition.routeHandler !== undefined
            ? false
            : handleSkillUsageRequest(request, response, config, composition.sessionAdmission, composition.skillUsageReader ?? undefined),
      )
      .then((handled) =>
        handled
          ? true
          : composition.routeHandler !== undefined
            ? false
            : handlePersonalSkillLifecycleRequest(
                request,
                response,
                config,
                composition.sessionAdmission,
                composition.skillAuthorization,
                composition.skillDraftClient,
              ),
      )
      .then((handled) =>
        handled
          ? true
          : composition.routeHandler !== undefined
            ? false
            : handleManagedPersonalSkillsRequest(request, response, config, composition.sessionAdmission),
      )
      .then((handled) =>
        handled
          ? true
          : composition.routeHandler !== undefined
            ? false
            : handleSkillSpecificationEnabledRequest(
                request,
                response,
                config,
                composition.sessionAdmission,
                composition.installationClient,
              ),
      )
      .then((handled) =>
        handled
          ? true
          : composition.routeHandler !== undefined
            ? false
            : handlePersonalSkillInstallationRequest(
                request,
                response,
                config,
                composition.sessionAdmission,
                composition.skillAuthorization,
                composition.installationClient,
              ),
      )
      .then((handled) =>
        handled
          ? true
          : composition.routeHandler !== undefined
            ? false
            : handleProjectSkillInstallationRequest(
                request,
                response,
                config,
                composition.sessionAdmission,
                composition.skillAuthorization,
                composition.projectService,
                composition.installationClient,
              ),
      )
      .then((handled) =>
        handled
          ? true
          : composition.routeHandler !== undefined
            ? false
            : handleProjectMcpRecommendationsRequest(
                request,
                response,
                config,
                composition.sessionAdmission,
                composition.mcpAuthorization,
                composition.projectMcpRecommendationsProvider ?? projectMcpRecommendationsProvider(composition.projectService, {
                  mcpPersonalClient: composition.mcpPersonalClient,
                  customApiClient: composition.customApiClient,
                }),
              ),
      )
      .then((handled) =>
        handled
          ? true
          : composition.routeHandler !== undefined
            ? false
            : handleScheduledTaskReadRequest(request, response, config, composition.sessionAdmission, composition.scheduledTaskReader),
      )
      .then((handled) => (handled ? true : handleSystemNativeRequest(request, response, config)))
      .then((handled) =>
        handled
          ? true
          : composition.routeHandler !== undefined
            ? false
            : handleAgentConnectionSetupRequest(request, response, config, composition.sessionAdmission),
      )
      .then((handled) => {
        if (handled) return
        return handleBffRequest(request, response, config, composition)
      })
    void handler.catch(() => {
      if (!response.headersSent) {
        if (
          (request.method === "GET" || request.method === "PATCH") &&
          (request.url === "/v1/account/profile" || request.url?.startsWith("/v1/account/profile?"))
        ) {
          response.setHeader("x-request-id", requestId(request))
          send(response, 500, {
            error: {
              code: "internal_error",
              message: "The BFF encountered an internal error",
              retryable: false,
            },
          })
        } else if (
          (request.method === "GET" && (request.url === "/v1/account/archived-tasks" || request.url?.startsWith("/v1/account/archived-tasks?"))) ||
          ((request.method === "GET" || request.method === "POST") && /^\/v1\/sessions\/[^/]+\/(?:archive|restore)(?:\?|$)/u.test(request.url ?? ""))
        ) {
          response.setHeader("cache-control", "no-store")
          send(response, 503, {
            error: {
              code: request.url?.startsWith("/v1/account/") ? "archived_tasks_unavailable" : "archive_state_unavailable",
              message: "Archive unavailable",
              retryable: true,
            },
          })
        } else if (request.method === "GET" && (request.url === "/v1/account/shared-tasks" || request.url?.startsWith("/v1/account/shared-tasks?"))) {
          response.setHeader("x-request-id", requestId(request))
          send(response, 503, {
            error: {
              code: "shared_tasks_unavailable",
              message: "shared_tasks_unavailable",
              retryable: true,
            },
          })
        } else send(response, 500, failure("internal_error", "The BFF encountered an internal error", requestId(request)))
      } else response.destroy()
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
    composition.scheduledAgentTerminalConsumer !== undefined ||
    composition.projectScopeReleaseDispatcher !== undefined
  ) {
    server.once("listening", () => {
      composition.agUiProjector?.start()
      composition.scheduledTaskDispatcher?.start()
      composition.agentDispatchDispatcher?.start()
      composition.scheduledAgentDispatcher?.start()
      composition.scheduledAgentTerminalConsumer?.start()
      composition.agentCancellationDispatcher?.start()
      composition.projectScopeReleaseDispatcher?.start()
    })
  }
  server.once("close", () => {
    void composition.close()
  })
  return server as BffServer
}
