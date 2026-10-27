import { projectResourceReadRoute } from "../http/routes/project-resource-read.js"
import { projectResourceDeleteRoute } from "../http/routes/project-resource-delete.js"
import { mcpProjectPublicationOperation, mcpProjectPublicationRoute } from "../http/routes/mcp-project-publication.js"
import { liveAdminMetering, matchMeteringAdmin } from "../http/routes/billing-metering-admin.js"
import { liveAdminCreditGrant } from "../http/routes/billing-credit-grant-admin.js"
import { appSkillBindingsRoute } from "../http/routes/app-skill-bindings.js"
import { mcpPackageAdminOperation, mcpPackageAdminRoute } from "../http/routes/mcp-package-admin.js"
import { scheduledTaskReadRoute } from "../http/routes/scheduled-task-read.js"
import { personalKnowledgeRoute } from "../http/routes/personal-knowledge.js"
import { agentModelAdmissionRoute } from "../http/routes/model-admission.js"
import { projectExecutionBindingRoute } from "../http/routes/project-execution-binding.js"
import { projectSkillSelectionRoute } from "../http/routes/project-skill-selection.js"
import { Code, ConnectError } from "@connectrpc/connect"

import { archivedTasksRoute } from "../http/routes/archived-tasks.js"
import { sharedTasksRoute } from "../http/routes/shared-tasks.js"
import { accountProfileRoute } from "../http/routes/account-profile.js"
import { mcpPersonalOperation, mcpPersonalRoute } from "../http/routes/mcp-personal.js"
import { mcpProviderAdminOperation, mcpProviderAdminRoute } from "../http/routes/mcp-provider-admin.js"
import { customApiOperation, customApiRoute } from "../http/routes/custom-api.js"
import { connectorListFailure, connectorListRoute, isConnectorListRequest } from "../http/routes/connector-list.js"
import { skillSpecificationReadRoute } from "../http/routes/platform-projection.js"
import { skillSpecificationEnabledRoute } from "../http/routes/skill-specification-enabled.js"
import { exactSkillDownloadRoute, skillDownloadHandleRoute } from "../http/routes/skill-download.js"
import { startMcpRequestBudget, mcpRequestRemaining } from "../http/mcp-request-budget.js"
import { skillGithubImportRoute, skillGithubPreviewRoute } from "../http/routes/skill-github-import.js"
import { skillAiImportRoute } from "../http/routes/skill-ai-import.js"
import { skillShareRoute } from "../http/routes/skill-share.js"
import { skillUsageRoute } from "../http/routes/skill-usage.js"
import { skillCoverRoute } from "../http/routes/skill-cover.js"
import { publishedSkillPackageInspectionRoute } from "../http/routes/skill-download.js"
import { startSkillRequestBudget, skillRequestRemaining, skillDraftsRoute } from "../http/routes/skill-drafts.js"
import { skillAdminRoute } from "../http/routes/skill-admin.js"
import { personalizationRoute } from "../http/routes/personalization.js"
import { projectRenameRoute } from "../http/routes/project-rename.js"
import { projectDeleteRoute } from "../http/routes/project-delete.js"
import { projectDeletionStatusRoute } from "../http/routes/project-deletion-status.js"
import { projectResourceListRoute } from "../http/routes/project-resource-list.js"
import { libraryFileListRoute } from "../http/routes/library-file-list.js"
import { personalFileUploadRoute } from "../http/routes/personal-file-upload.js"
import { personalFileDownloadRoute } from "../http/routes/personal-file-download.js"
import { libraryArtifactRoute } from "../http/routes/library-artifact.js"
import { libraryArtifactDownloadRoute } from "../http/routes/library-artifact-download.js"
import { projectResourceRoute } from "../http/routes/project-resource.js"
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"

import { loadConfig, type BffConfig } from "../config/runtime.js"
import {
  authorizeUserRequest,
  authorizeMcpAction,
  mcpActionForRequest,
  authorizeSkillAction,
  skillActionForRequest,
  withSkillActionAdmission,
} from "../auth/user-admission.js"
import { localSkillImportRoute } from "../http/routes/local-skill-import.js"
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
import { accountSessionsRoute } from "../http/routes/account-sessions.js"
import { liveTeamRead, liveTeamWrite } from "../http/routes/team.js"
import { liveModelConfigurationAdmin } from "../http/routes/model-configuration-admin.js"
import { liveModelRoutingAdmin } from "../http/routes/model-routing-admin.js"
import { liveAdminIdentityRead } from "../http/routes/admin-identity.js"
import { createBffComposition, type BffCompositionOptions, type BffRouteInput } from "./runtime.js"
import { createSkillDraftRoute } from "../http/routes/create-skill-draft.js"
import { getSkillPackageUploadRoute } from "../http/routes/get-skill-package-upload.js"
import { beginSkillPackageUploadRoute } from "../http/routes/begin-skill-package-upload.js"
import { completeSkillPackageUploadRoute } from "../http/routes/complete-skill-package-upload.js"
import { validateSkillDraftRoute } from "../http/routes/validate-skill-draft.js"
import { publishSkillRoute } from "../http/routes/publish-skill.js"
import { skillInstallationRoute } from "../http/routes/skill-installations.js"
import { moveSessionRoute } from "../http/routes/move-session.js"
import { managedPersonalSkillsRoute } from "../http/routes/managed-personal-skills.js"
import { createPersonalSkillVersionRoute } from "../http/routes/create-personal-skill-version.js"
import { deletePersonalSkillSeriesRoute } from "../http/routes/delete-personal-skill-series.js"
import { withdrawPersonalSkillRoute } from "../http/routes/withdraw-personal-skill.js"
import { skillPackageInspectionRoute } from "../http/routes/skill-package-inspection.js"
import { configureBffProtobufTextEncoding } from "../infrastructure/protobuf-text-encoding.js"

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
  response.setHeader("x-request-id", id)
  if (request.method === "PATCH" && (request.url === "/v1/account/profile" || request.url?.startsWith("/v1/account/profile?"))) {
    await accountProfileRoute(request, response, config, composition.sessionAdmission, id)
    return
  }
  if (
    (request.method === "GET" && (request.url === "/v1/account/archived-tasks" || request.url?.startsWith("/v1/account/archived-tasks?"))) ||
    ((request.method === "GET" || request.method === "POST") && /^\/v1\/sessions\/[^/]+\/(?:archive|restore)(?:\?|$)/u.test(request.url ?? ""))
  ) {
    await archivedTasksRoute(request, response, config, composition.sessionAdmission, composition.businessStore?.services.chat, id)
    return
  }
  if (request.method === "GET" && (request.url === "/v1/account/shared-tasks" || request.url?.startsWith("/v1/account/shared-tasks?"))) {
    await sharedTasksRoute(request, response, config, composition.sessionAdmission, composition.businessStore?.services.chat, id)
    return
  }
  if ((request.url ?? "").split("?", 1)[0] === "/internal/v1/model-admissions" || (request.url ?? "").startsWith("/internal/v1/model-admissions/")) {
    await agentModelAdmissionRoute(request, response, config, composition.businessStore?.submittedAgentRuns ?? null)
    return
  }
  if ((request.url ?? "").split("?", 1)[0] === "/internal/v1/project-execution-bindings/verify") {
    await projectExecutionBindingRoute(
      request,
      response,
      config.projectExecutionCredentialFile ?? null,
      composition.businessStore?.projectExecutionBindings ?? null,
    )
    return
  }
  const rawPathname = new URL(request.url || "/", "http://bff.local").pathname
  const isRawSkillPackageInspection =
    request.method === "GET" && (/^\/v1\/self\/skills\/[^/]+\/package$/u.test(rawPathname) || /^\/v1\/skill-installations\/[^/]+\/package$/u.test(rawPathname))
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
  if (segments.length === 1 && segments[0] === "healthz" && request.method === "GET") {
    send(response, 200, {
      status: "ok",
      service: "kokoro-bff",
      mode: config.mode,
    })
    return
  }
  if (segments.length === 1 && segments[0] === "readyz" && request.method === "GET") {
    const ready =
      (await composition
        .readiness()
        .then(() => true)
        .catch(() => false)) &&
      (!config.agentEnabled || configuredUpstream(config, "agents") !== null)
    send(response, ready ? 200 : 503, {
      status: "ok",
      service: "kokoro-bff",
      mode: config.mode,
    })
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
  if (await appSkillBindingsRoute(request, response, config, composition, id, rawPathname)) return
  if (await skillSpecificationReadRoute(request, response, config, composition, id, rawPathname)) return
  if (await skillSpecificationEnabledRoute(request, response, config, composition, id, rawPathname)) return
  if (await skillDownloadHandleRoute(request, response, config, composition, id, segments)) return
  if (await exactSkillDownloadRoute(request, response, config, composition, id, segments)) return
  if (
    await localSkillImportRoute(
      request,
      response,
      config,
      composition.sessionAdmission,
      composition.skillAuthorization,
      composition.localSkillImportClient,
      id,
      segments,
    )
  )
    return
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

  if (!browserPrivateMcp && segments.length === 3 && segments[1] === "system" && segments[2] === "runtime-manifest" && request.method === "GET") {
    await runtimeManifest(request, response, config, id)
    return
  }

  const businessPath = browserPrivateMcp ? segments.slice(2) : segments.slice(1)
  const adminOperationDeadline =
    !browserPrivateMcp &&
    ((request.method === "GET" &&
      businessPath.length === 4 &&
      businessPath[0] === "admin" &&
      businessPath[1] === "model-providers" &&
      businessPath[3] === "upstream-models") ||
      (request.method === "POST" && businessPath.join("/") === "admin/billing/credit-grants") ||
      matchMeteringAdmin(request.method ?? "", businessPath) !== null)
      ? Date.now() + Math.min(config.upstreamTimeoutMs, 10_000)
      : undefined
  if (!browserPrivateMcp && businessPath[0] === "self" && businessPath[1] === "mcp") {
    send(response, 404, failure("route_not_found", "Route was not found", id))
    return
  }
  const isConnectorList = !browserPrivateMcp && isConnectorListRequest(businessPath, request.method ?? "GET")
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
  const projectPublicationOperation = browserPrivateMcp ? mcpProjectPublicationOperation(businessPath, request.method ?? "GET") : null
  const isMcpProjectPublication = projectPublicationOperation !== null
  const mcpAction = isMcpProjectPublication
    ? projectPublicationOperation === "list"
      ? "read"
      : "manage"
    : mcpActionForRequest(request.method ?? "GET", businessPath, browserPrivateMcp)
  const isMcpPersonalOperation = browserPrivateMcp && mcpPersonalOperation(businessPath, request.method ?? "GET") !== null
  const isCustomApiOperation = browserPrivateMcp && customApiOperation(businessPath, request.method ?? "GET") !== null
  const defersMcpPersonalReadAction = isMcpPersonalOperation && request.method === "GET"
  const isMcpPackageAdminOperation = !browserPrivateMcp && mcpPackageAdminOperation(businessPath, request.method ?? "GET") !== null
  const isMcpProviderAdminOperation = !browserPrivateMcp && mcpProviderAdminOperation(businessPath, request.method ?? "GET") !== null
  if (browserPrivateMcp && !isMcpPersonalOperation && !isCustomApiOperation && !isMcpProjectPublication) {
    send(response, 404, failure("route_not_found", "Route was not found", id))
    return
  }
  const hasMcpBudget = mcpAction !== null || isMcpPersonalOperation || isMcpProviderAdminOperation || isMcpPackageAdminOperation || isCustomApiOperation
  if (hasMcpBudget) {
    startMcpRequestBudget(request, isMcpPackageAdminOperation ? 20_000 : 10_000)
    response.setHeader("cache-control", "no-store")
    response.setHeader("x-request-id", id)
  }
  const isSkillPackageInspection =
    isRawSkillPackageInspection &&
    ((businessPath.length === 4 && businessPath[0] === "self" && businessPath[1] === "skills" && businessPath[3] === "package") ||
      (businessPath.length === 3 && businessPath[0] === "skill-installations" && businessPath[2] === "package"))
  if (isSkillPackageInspection) {
    await skillPackageInspectionRoute(request, response, config, composition.sessionAdmission, id, businessPath)
    return
  }
  const isManagedPersonalSkillRead =
    request.method === "GET" &&
    ((businessPath.length === 2 && businessPath[0] === "self" && businessPath[1] === "skills") ||
      (businessPath.length === 3 && businessPath[0] === "self" && businessPath[1] === "skills") ||
      (businessPath.length === 4 && businessPath[0] === "self" && businessPath[1] === "skills" && businessPath[3] === "versions"))
  if (isManagedPersonalSkillRead) {
    await managedPersonalSkillsRoute(request, response, config, composition.sessionAdmission, id, businessPath)
    return
  }
  if (request.method === "DELETE" && businessPath.length === 3 && businessPath[0] === "self" && businessPath[1] === "skills") {
    await deletePersonalSkillSeriesRoute(
      request,
      response,
      config,
      withSkillActionAdmission(composition.sessionAdmission, composition.skillAuthorization, "delete_series", config.tenantId),
      id,
      businessPath[2] ?? "",
      composition.skillDraftClient,
    )
    return
  }
  const isCreatePersonalSkillVersion =
    request.method === "POST" && businessPath.length === 4 && businessPath[0] === "self" && businessPath[1] === "skills" && businessPath[3] === "versions"
  if (isCreatePersonalSkillVersion) {
    await createPersonalSkillVersionRoute(
      request,
      response,
      config,
      withSkillActionAdmission(composition.sessionAdmission, composition.skillAuthorization, "create_version", config.tenantId),
      id,
      businessPath[2] ?? "",
      composition.skillDraftClient,
    )
    return
  }
  const isWithdrawPersonalSkill =
    request.method === "POST" && businessPath.length === 4 && businessPath[0] === "self" && businessPath[1] === "skills" && businessPath[3] === "withdraw"
  if (isWithdrawPersonalSkill) {
    await withdrawPersonalSkillRoute(
      request,
      response,
      config,
      withSkillActionAdmission(composition.sessionAdmission, composition.skillAuthorization, "withdraw", config.tenantId),
      id,
      businessPath[2] ?? "",
      composition.skillDraftClient,
    )
    return
  }

  const isPersonalKnowledgePath =
    businessPath[0] === "preferences" &&
    ((businessPath.length === 2 && ["knowledge", "knowledge-usage"].includes(businessPath[1]!)) ||
      (businessPath.length === 3 && businessPath[1] === "knowledge"))
  const isPersonalizationPath = businessPath.length === 2 && businessPath[0] === "preferences" && businessPath[1] === "personalization"
  const isProjectRenamePath =
    composition.routeHandler === undefined &&
    request.method === "PATCH" &&
    businessPath.length === 3 &&
    businessPath[0] === "projects" &&
    businessPath[2] === "name"
  const isProjectDeletePath =
    composition.routeHandler === undefined && request.method === "DELETE" && businessPath.length === 2 && businessPath[0] === "projects"
  const isProjectDeletionStatusPath =
    composition.routeHandler === undefined &&
    request.method === "GET" &&
    businessPath.length === 3 &&
    businessPath[0] === "projects" &&
    businessPath[2] === "deletion"
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
    adminOperationDeadline === undefined
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
      if (isConnectorList) {
        connectorListFailure(
          response,
          admission.status,
          id,
          admission.status === 401 ? "Unauthenticated" : admission.status === 403 ? "PermissionDenied" : "Unavailable",
          "Connector list access is unavailable",
        )
        return
      }
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
        isProjectRenamePath ||
        isProjectDeletePath ||
        isProjectDeletionStatusPath ||
        isPersonalizationPath ||
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
  if (isConnectorList) {
    await connectorListRoute(request, response, config, composition, admission.context)
    return
  }
  if (isMcpPackageAdminOperation) {
    await mcpPackageAdminRoute(request, response, config, composition, id, businessPath)
    return
  }
  if (isMcpProviderAdminOperation) {
    await mcpProviderAdminRoute(request, response, config, composition, id, businessPath)
    return
  }
  if (isCustomApiOperation) {
    await customApiRoute(request, response, composition, admission.context, id, businessPath)
    return
  }
  if (hasMcpBudget && !isMcpPersonalOperation && !isMcpProjectPublication && (request.method !== "GET" || businessPath[0] === "self")) {
    if (!response.destroyed && !response.writableEnded)
      send(response, 503, failure("platform_operation_not_available", "This Platform operation is not exposed by the BFF owner adapter", id))
    return
  }
  const context = admission.context
  if (composition.routeHandler === undefined && request.method === "GET" && businessPath[0] === "scheduled-tasks" && businessPath.length <= 2) {
    await scheduledTaskReadRoute(
      request,
      response,
      context,
      composition.scheduledTaskReader,
      businessPath[1],
      (signal) => authorizeUserRequest(request, config, composition.sessionAdmission, id, signal),
      config.upstreamTimeoutMs,
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
    if (!composition.businessStore) throw new ConnectError("Project owner unavailable", Code.Unavailable)
    const project = await composition.businessStore.services.projects.find(
      { tenantId: context.identity.namespace, subjectId: context.identity.userId },
      projectRef,
    )
    signal.throwIfAborted()
    if (!project) throw new ConnectError("Project not found", Code.NotFound)
    return project.id
  }
  if (isMcpProjectPublication) {
    await mcpProjectPublicationRoute(
      request,
      response,
      { tenant: context.identity.namespace, subject: context.identity.userId, requestId: context.requestId },
      businessPath,
      composition.mcpProjectPublicationClient,
      async (projectIds, action, signal) => {
        const fresh = await authorizeUserRequest(request, config, composition.sessionAdmission, id, signal)
        if (!fresh.ok) throw new ConnectError("Project publication admission failed", fresh.status >= 500 ? Code.Unavailable : Code.PermissionDenied)
        if (fresh.context.identity.namespace !== context.identity.namespace || fresh.context.identity.userId !== context.identity.userId)
          throw new ConnectError("Project not found", Code.NotFound)
        const checked = await authorizeMcpAction(composition.mcpAuthorization, fresh, action, signal)
        if (!checked.ok) throw new ConnectError("MCP action denied", checked.status >= 500 ? Code.Unavailable : Code.PermissionDenied)
        if (!composition.businessStore) throw new ConnectError("Project owner unavailable", Code.Unavailable)
        for (const projectId of projectIds) {
          signal.throwIfAborted()
          const project = await composition.businessStore.services.projects.find(
            { tenantId: fresh.context.identity.namespace, subjectId: fresh.context.identity.userId },
            projectId,
          )
          signal.throwIfAborted()
          if (!project || project.id !== projectId) throw new ConnectError("Project not found", Code.NotFound)
        }
      },
    )
    return
  }
  if (isMcpPersonalOperation) {
    await mcpPersonalRoute(request, response, config, composition, admission, businessPath)
    return
  }
  const readmitSkill = async (signal: AbortSignal): Promise<void> => {
    const current = await authorizeUserRequest(request, config, composition.sessionAdmission, id, signal)
    if (!current.ok && current.status >= 500) throw new Error("skill_dependency_unavailable")
    if (!current.ok || current.context.identity.namespace !== context.identity.namespace || current.context.identity.userId !== context.identity.userId)
      throw new Error("skill_not_found")
    signal.throwIfAborted()
  }
  if (businessPath.join("/") === "skills/github/import" && request.method === "POST") {
    await skillGithubImportRoute(request, response, context, config, composition.businessStore, composition.skillProductClient, readmitSkill)
    return
  }
  if (businessPath.join("/") === "skills/github/preview" && request.method === "POST") {
    await skillGithubPreviewRoute(request, response, context, readmitSkill)
    return
  }
  if (businessPath.join("/") === "skills/ai-import" && request.method === "POST") {
    await skillAiImportRoute(request, response, context, config, composition.businessStore, composition.skillProductClient, readmitSkill)
    return
  }
  if (
    businessPath[0] === "skill-shares" &&
    ((businessPath.length === 1 && request.method === "POST") ||
      (businessPath.length === 2 && ["GET", "DELETE"].includes(request.method ?? "")) ||
      (businessPath.length === 3 && businessPath[2] === "skill" && request.method === "GET"))
  ) {
    await skillShareRoute(
      request,
      response,
      { ...context, humanBearer: admission.bearerToken },
      businessPath,
      composition.businessStore?.services.skillShares,
      composition.skillProductClient,
      config.iamRelay?.webOrigin,
      composition.skillSpecificationSource,
    )
    return
  }
  if (businessPath.length === 2 && businessPath[0] === "skills" && businessPath[1] === "usage" && request.method === "POST") {
    await skillUsageRoute(request, response, context, composition.businessStore?.services.skillUsage)
    return
  }
  if (businessPath.length === 3 && businessPath[0] === "skills" && businessPath[2] === "package" && request.method === "GET") {
    await publishedSkillPackageInspectionRoute(request, response, context, businessPath[1]!, composition.skillProductClient)
    return
  }
  if (
    businessPath[0] === "skills" &&
    ((businessPath.length === 3 && businessPath[2] === "cover" && request.method === "GET") ||
      (businessPath.length === 3 && businessPath[2] === "cover-upload" && ["GET", "POST"].includes(request.method ?? "")) ||
      (businessPath.length === 4 && businessPath[2] === "cover-upload" && businessPath[3] === "complete" && request.method === "POST"))
  ) {
    await skillCoverRoute(
      request,
      response,
      context,
      businessPath[1]!,
      businessPath[2] === "cover" ? "cover" : request.method === "GET" ? "get" : businessPath.length === 4 ? "complete" : "begin",
      composition.skillProductClient,
      config.storage?.objectOrigin ?? null,
      readmitSkill,
    )
    return
  }

  const meteringKind = matchMeteringAdmin(request.method ?? "", businessPath)
  if (meteringKind !== null) {
    await liveAdminMetering(
      request,
      response,
      config,
      context,
      admission.bearerToken,
      composition.sessionAdmission,
      meteringKind,
      adminOperationDeadline ?? Date.now(),
    )
    return
  }

  if (request.method === "POST" && businessPath.join("/") === "admin/billing/credit-grants") {
    await liveAdminCreditGrant(request, response, config, context, admission.bearerToken, composition.sessionAdmission, adminOperationDeadline ?? Date.now())
    return
  }

  if (businessPath[0] === "admin" && businessPath[1] === "identity") {
    await liveAdminIdentityRead(request, response, config, context, admission.bearerToken, businessPath)
    return
  }

  if (
    businessPath[0] === "admin" &&
    businessPath[1] === "skills" &&
    ((request.method === "GET" && [2, 3].includes(businessPath.length)) || (request.method === "POST" && [2, 4].includes(businessPath.length)))
  ) {
    await skillAdminRoute(request, response, context, businessPath, composition.skillAdminClient, config.iamBaseUrl)
    return
  }
  if (
    businessPath[0] === "skills" &&
    businessPath.length === 3 &&
    ((businessPath[2] === "draft" && request.method === "PATCH") || (["discard", "audience"].includes(businessPath[2]!) && request.method === "POST"))
  ) {
    await skillDraftsRoute(
      request,
      response,
      context,
      businessPath[1]!,
      businessPath[2] === "draft" ? "update" : (businessPath[2] as "discard" | "audience"),
      composition.skillProductClient,
    )
    return
  }

  if (isProjectSkillSelectionPath) {
    await projectSkillSelectionRoute(request, response, context, composition.businessStore, composition.installationClient, (signal) =>
      currentProjectAccess(businessPath[1] ?? "", signal),
    )
    return
  }

  if (isPersonalKnowledgePath) {
    await personalKnowledgeRoute(request, response, context, composition.businessStore)
    return
  }

  if (isPersonalizationPath) {
    await personalizationRoute(request, response, context, composition.businessStore)
    return
  }

  if (composition.routeHandler === undefined && businessPath[0] === "projects" && businessPath[2] === "resources" && businessPath[1] !== undefined && businessPath[3] !== undefined) {
    if (request.method === "GET" && (businessPath.length === 4 || businessPath.length === 5 && businessPath[4] === "download")) {
      await projectResourceReadRoute(request, response, config, context, businessPath[1], businessPath[3], businessPath.length === 5, composition.businessStore)
      return
    }
    if (request.method === "DELETE" && businessPath.length === 4) {
      await projectResourceDeleteRoute(request, response, config, context, businessPath[1], businessPath[3], composition.businessStore)
      return
    }
  }
  if (isProjectRenamePath) {
    await projectRenameRoute(request, response, context, businessPath[1] ?? "", composition.businessStore)
    return
  }

  if (isProjectDeletePath) {
    await projectDeleteRoute(request, response, context, businessPath[1] ?? "", composition.businessStore)
    return
  }

  if (isProjectDeletionStatusPath) {
    await projectDeletionStatusRoute(request, response, context, businessPath[1] ?? "", composition.businessStore)
    return
  }

  if (isMoveSessionPath) {
    await moveSessionRoute(request, response, context, businessPath[1] ?? "", composition.businessStore)
    return
  }

  if (isSkillInstallationPath) {
    const routeAbort = new AbortController()
    const abortRoute = (): void => routeAbort.abort()
    request.once("aborted", abortRoute)
    response.once("close", abortRoute)
    await skillInstallationRoute(
      request,
      response,
      context,
      isProjectInstallationPath ? businessPath.slice(2) : businessPath,
      composition.installationClient,
      routeAbort.signal,
      config.iamBaseUrl,
      isProjectInstallationPath ? (signal) => currentProjectAccess(businessPath[1] ?? "", signal) : undefined,
    ).finally(() => {
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
    send(
      response,
      200,
      ok(
        {
          user_id: context.identity.userId,
          tenant_id: context.identity.namespace,
          platform_admin: context.platformAdmin,
        },
        id,
      ),
    )
    return
  }

  if (
    businessPath[0] === "account" &&
    businessPath[1] === "sessions" &&
    ((request.method === "GET" && businessPath.length === 2) || (request.method === "DELETE" && businessPath.length === 3))
  ) {
    await accountSessionsRoute(request, response, config, context, admission.bearerToken, businessPath)
    return
  }

  if (businessPath[0] === "team") {
    if (request.method === "GET") await liveTeamRead(request, response, config, context, admission.bearerToken, businessPath)
    else await liveTeamWrite(request, response, config, context, admission.bearerToken, businessPath)
    return
  }

  if (composition.routeHandler === undefined && businessPath[0] === "admin") {
    if (await liveModelConfigurationAdmin(request, response, config, context, businessPath, adminOperationDeadline)) return
    await liveModelRoutingAdmin(request, response, config, context, businessPath)
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
    !bffOwnedBusinessPath(businessPath) &&
    !isMoriBusinessPath(businessPath)
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
  configureBffProtobufTextEncoding()
  const composition = createBffComposition(config, options)
  const server = createServer({ maxHeaderSize: 32768 }, (request, response) => {
    void handle(request, response, config, composition).catch(() => {
      if (!response.headersSent) {
        if (request.method === "PATCH" && (request.url === "/v1/account/profile" || request.url?.startsWith("/v1/account/profile?"))) {
          response.setHeader("x-request-id", requestId(request))
          send(response, 500, { error: { code: "internal_error", message: "The BFF encountered an internal error", retryable: false } })
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
          send(response, 503, { error: { code: "shared_tasks_unavailable", message: "shared_tasks_unavailable", retryable: true } })
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
