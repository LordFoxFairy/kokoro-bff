import { skillRequestRemaining } from "./skill-drafts.js"
import { IamPublisherProfileClient } from "../../infrastructure/clients/iam-publisher-profile.js"
import type { IncomingMessage, ServerResponse } from "node:http"
import { Code, ConnectError } from "@connectrpc/connect"
import type { BffConfig } from "../../config/runtime.js"
import { authorizeSkillAction, authorizeUserRequest, skillActionForRequest } from "../../auth/user-admission.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import type { RequestContext } from "../../domain/request-context.js"
import type { SkillAuthorizationClient } from "../../auth/skill-authorization.client.js"
import type { SkillInstallationConnectClient } from "../../infrastructure/clients/platform/skill-installation-connect.js"
import {
  installSkillDigest,
  removeSkillDigest,
  setSkillEnabledDigest,
  updateSkillDigest,
} from "../../infrastructure/clients/platform/skill-installation-projector.js"
import {
  projectInstallation,
  projectInstallationAck,
  projectInstallationList,
  projectInstallationUpdateAck,
} from "../../infrastructure/clients/platform/skill-installation-response.js"
import {
  exactIdempotencyKey,
  exactInstallationId,
  installationCommandId,
  parseEnabledInput,
  parseInstallInput,
  parseUpdateInput,
  parseInstallationList,
} from "../skill-installation-input.js"
import { readSkillBody as readBody } from "./skill-drafts.js"
import { send } from "../response.js"
import { requestId } from "../request.js"
const failure = (code: string, message: string, retryable = false) => ({
  error: { code, message, retryable },
})
function idempotencyKey(request: IncomingMessage): string {
  const count = request.rawHeaders.filter((value, index) => index % 2 === 0 && value.toLowerCase() === "idempotency-key").length
  if (count !== 1) throw new Error("skill_installation_idempotency_key_required")
  return exactIdempotencyKey(request.headers["idempotency-key"])
}
function mapped(error: unknown) {
  if (!(error instanceof ConnectError))
    return error instanceof Error && error.message === "skill_installation_response_invalid"
      ? {
          status: 502,
          body: failure("skill_installation_response_invalid", "Skill installation owner returned an invalid response"),
        }
      : {
          status: 503,
          body: failure("skill_installation_dependency_unavailable", "Skill installation owner is unavailable", true),
        }
  if (error.code === Code.InvalidArgument) return { status: 400, body: failure("invalid_skill_installation_request", "Skill installation request is invalid") }
  if (error.code === Code.NotFound)
    return {
      status: 404,
      body: failure("skill_installation_not_found", "Skill installation was not found"),
    }
  if (error.code === Code.PermissionDenied)
    return {
      status: 403,
      body: failure("skill_installation_forbidden", "Skill installation operation is forbidden"),
    }
  if (error.code === Code.AlreadyExists)
    return {
      status: 409,
      body: failure("skill_installation_idempotency_conflict", "Skill installation command conflicts"),
    }
  if (error.code === Code.Aborted)
    return {
      status: 409,
      body: failure("skill_installation_command_in_progress", "Skill installation command is in progress", true),
    }
  if (error.code === Code.FailedPrecondition)
    return {
      status: 412,
      body: failure("skill_installation_precondition_failed", "Skill installation precondition failed"),
    }
  if (error.code === Code.ResourceExhausted)
    return {
      status: 429,
      body: failure("skill_installation_rate_limited", "Skill installation was rate limited", true),
      retryAfter: error.metadata.get("retry-after"),
    }
  if (error.code === Code.DeadlineExceeded)
    return {
      status: 504,
      body: failure("skill_installation_dependency_timeout", "Skill installation owner timed out", true),
    }
  if ([Code.Unavailable, Code.Canceled, Code.Unauthenticated].includes(error.code))
    return {
      status: 503,
      body: failure("skill_installation_dependency_unavailable", "Skill installation owner is unavailable", true),
    }
  return {
    status: 502,
    body: failure("skill_installation_response_invalid", "Skill installation owner returned an invalid response"),
  }
}

export function isProjectSkillInstallationRequest(request: IncomingMessage): boolean {
  const url = request.url ?? ""
  return (
    /^\/v1\/projects\/[^/]+\/skill-installations(?:\/[^?]*)?(?:\?|$)/u.test(url) &&
    !/^\/v1\/projects\/[^/]+\/skill-installations\/[^/]+\/package(?:\?|$)/u.test(url)
  )
}

export function isPersonalSkillInstallationRequest(request: IncomingMessage): boolean {
  const url = request.url ?? ""
  return /^\/v1\/skill-installations(?:\/[^?]*)?(?:\?|$)/u.test(url)
}

export async function handlePersonalSkillInstallationRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  admission: SessionAdmission,
  skillAuthorization: Pick<SkillAuthorizationClient, "check">,
  client: SkillInstallationConnectClient | null,
): Promise<boolean> {
  if (!isPersonalSkillInstallationRequest(request)) return false
  const id = requestId(request)
  const signal = AbortSignal.timeout(10_000)
  response.setHeader("x-request-id", id)
  response.setHeader("cache-control", "no-store")
  try {
    const admitted = await authorizeUserRequest(request, config, admission, id, signal, response)
    if (!admitted.ok) {
      send(
        response,
        admitted.status,
        {
          error: {
            code: admitted.code,
            message: "BFF user admission failed",
            retryable: admitted.status === 429 || admitted.status === 503,
          },
        },
        admitted.retryAfter,
      )
      return true
    }
    const parts = new URL(request.url ?? "/", "http://bff.local").pathname.split("/").filter(Boolean)
    if (parts.length < 2 || parts[0] !== "v1" || parts[1] !== "skill-installations") throw new ConnectError("Skill path invalid", Code.InvalidArgument)
    const skillPath = parts.slice(1).map((value) => decodeURIComponent(value))
    const action = skillActionForRequest(request.method ?? "GET", skillPath)
    if (action !== null) {
      const checked = await authorizeSkillAction(skillAuthorization, admitted, action, signal)
      if (!checked.ok) {
        send(response, checked.status, failure(checked.code, "Skill action admission failed", checked.status === 429 || checked.status >= 500))
        return true
      }
    }
    await skillInstallationRoute(
      request,
      response,
      admitted.context,
      skillPath,
      client,
      signal,
      config.iamBaseUrl,
      undefined,
      config.iamUserContextServiceCredentialFile,
    )
  } catch (error) {
    if (response.writableEnded || response.destroyed) return true
    const status =
      error instanceof ConnectError && error.code === Code.InvalidArgument
        ? 400
        : error instanceof ConnectError && error.code === Code.PermissionDenied
          ? 403
          : 503
    send(
      response,
      status,
      failure(
        status === 400 ? "invalid_skill_installation_request" : status === 403 ? "permission_denied" : "skill_installation_dependency_unavailable",
        "Skill installation request failed",
        status === 503,
      ),
    )
  }
  return true
}

export async function handleProjectSkillInstallationRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  admission: SessionAdmission,
  skillAuthorization: Pick<SkillAuthorizationClient, "check">,
  projects: Readonly<{
    find(scope: Readonly<{ tenantId: string; subjectId: string }>, idOrSlug: string): Promise<unknown | null>
  }> | null,
  client: SkillInstallationConnectClient | null,
): Promise<boolean> {
  if (!isProjectSkillInstallationRequest(request)) return false
  const id = requestId(request)
  const signal = AbortSignal.timeout(10_000)
  response.setHeader("x-request-id", id)
  response.setHeader("cache-control", "no-store")
  try {
    const admitted = await authorizeUserRequest(request, config, admission, id, signal, response)
    if (!admitted.ok) {
      send(
        response,
        admitted.status,
        {
          error: {
            code: admitted.code,
            message: "BFF user admission failed",
            retryable: admitted.status === 429 || admitted.status === 503,
          },
        },
        admitted.retryAfter,
      )
      return true
    }
    const parts = new URL(request.url ?? "/", "http://bff.local").pathname.split("/").filter(Boolean)
    if (parts.length < 4 || parts[0] !== "v1" || parts[1] !== "projects" || parts[3] !== "skill-installations")
      throw new ConnectError("Project not found", Code.NotFound)
    let projectRef: string
    try {
      projectRef = decodeURIComponent(parts[2] ?? "")
    } catch {
      throw new ConnectError("Project path invalid", Code.InvalidArgument)
    }
    const skillPath = parts.slice(3).map((value) => decodeURIComponent(value))
    const businessPath = ["projects", projectRef, ...skillPath]
    const currentProject = async (currentSignal: AbortSignal): Promise<string> => {
      const fresh = await authorizeUserRequest(request, config, admission, id, currentSignal, response)
      if (!fresh.ok) throw new ConnectError("Project admission failed", fresh.status >= 500 ? Code.Unavailable : Code.PermissionDenied)
      if (fresh.context.identity.namespace !== admitted.context.identity.namespace || fresh.context.identity.userId !== admitted.context.identity.userId)
        throw new ConnectError("Project not found", Code.NotFound)
      const action = skillActionForRequest(request.method ?? "GET", businessPath)
      if (action !== null) {
        const checked = await authorizeSkillAction(skillAuthorization, fresh, action, currentSignal)
        if (!checked.ok) throw new ConnectError("Skill action denied", checked.status >= 500 ? Code.Unavailable : Code.PermissionDenied)
      }
      if (!projects) throw new ConnectError("Project owner unavailable", Code.Unavailable)
      const project = await projects.find({ tenantId: admitted.context.identity.namespace, subjectId: admitted.context.identity.userId }, projectRef)
      currentSignal.throwIfAborted()
      if (!project || typeof project !== "object" || !("id" in project) || typeof project.id !== "string")
        throw new ConnectError("Project not found", Code.NotFound)
      return project.id
    }
    await skillInstallationRoute(
      request,
      response,
      admitted.context,
      skillPath,
      client,
      undefined,
      config.iamBaseUrl,
      currentProject,
      config.iamUserContextServiceCredentialFile,
    )
  } catch (error) {
    if (response.writableEnded || response.destroyed) return true
    const status =
      error instanceof ConnectError && error.code === Code.NotFound
        ? 404
        : error instanceof ConnectError && error.code === Code.InvalidArgument
          ? 400
          : error instanceof ConnectError && error.code === Code.PermissionDenied
            ? 403
            : 503
    send(
      response,
      status,
      failure(
        status === 404
          ? "project_not_found"
          : status === 400
            ? "invalid_skill_installation_request"
            : status === 403
              ? "permission_denied"
              : "skill_installation_dependency_unavailable",
        "Skill installation request failed",
        status === 503,
      ),
    )
  }
  return true
}
export async function skillInstallationRoute(
  request: IncomingMessage,
  response: ServerResponse,
  context: RequestContext,
  path: string[],
  client: SkillInstallationConnectClient | null,
  signal?: AbortSignal,
  iamBaseUrl?: string | null,
  projectAccess?: (signal: AbortSignal) => Promise<string>,
  credentialFile?: string | null,
): Promise<boolean> {
  if (path[0] !== "skill-installations") return false
  response.setHeader("x-request-id", context.requestId)
  response.setHeader("cache-control", "no-store")
  if (client === null) {
    send(response, 503, failure("skill_installation_dependency_unavailable", "Skill installation owner is unavailable", true))
    return true
  }
  const cancellation = new AbortController(),
    timer = setTimeout(
      () => cancellation.abort(new ConnectError("Skill installation deadline exceeded", Code.DeadlineExceeded)),
      skillRequestRemaining(request),
    )
  const cancel = () => {
    if (!response.writableEnded) cancellation.abort()
  }
  request.once("aborted", cancel)
  response.once("close", cancel)
  signal = signal ? AbortSignal.any([signal, cancellation.signal]) : cancellation.signal
  let projectRef: string | undefined
  const currentProject = async () => {
    if (!projectAccess) return undefined
    const activeSignal = signal!
    activeSignal.throwIfAborted()
    let aborted: () => void = () => undefined
    const canceled = new Promise<never>((_resolve, reject) => {
      aborted = () => reject(activeSignal.reason)
      activeSignal.addEventListener("abort", aborted, { once: true })
      if (activeSignal.aborted) aborted()
    })
    try {
      return await Promise.race([projectAccess(activeSignal), canceled])
    } finally {
      activeSignal.removeEventListener("abort", aborted)
    }
  }
  const enrich = async <T>(value: T) => {
    const result = await new IamPublisherProfileClient(iamBaseUrl ?? "", 5000, credentialFile ?? null).enrich(
      context.identity.namespace,
      context.identity.userId,
      context.requestId,
      value,
      signal!,
    )
    if (projectAccess && (await currentProject()) !== projectRef) throw new ConnectError("Project not found", Code.NotFound)
    return result
  }
  try {
    projectRef = await currentProject()
    const common = {
      requestId: context.requestId,
      tenant: context.identity.namespace,
      subject: context.identity.userId,
      ...(projectRef === undefined ? {} : { projectRef }),
    }
    if (path.length === 1 && request.method === "POST") {
      if (new URL(request.url ?? "", "http://bff.local").search) throw new Error("invalid_skill_installation_request")
      const input = parseInstallInput(await readBody(request, 65_536)),
        key = idempotencyKey(request)
      const commandId = installationCommandId("install", common.tenant, common.subject, input.sourceRef, key, projectRef)
      const result = await client.install(
        {
          ...common,
          ...input,
          commandId,
          digest: installSkillDigest(common.tenant, common.subject, input.sourceRef, projectRef),
        },
        signal,
      )
      const ack = projectInstallationAck(result)
      if (ack.installation.source_ref !== input.sourceRef || !ack.installation.installed || !["installed", "reinstalled", "unchanged"].includes(ack.change))
        throw new Error("skill_installation_response_invalid")
      send(response, 200, { data: await enrich(ack) })
      return true
    }
    if (path.length === 1 && request.method === "GET") {
      if (request.headers["idempotency-key"] !== undefined || (await readBody(request, 1)).length) throw new Error("invalid_skill_installation_request")
      const input = parseInstallationList(request.url ?? "")
      const result = await client.list({ ...common, ...input }, signal)
      send(response, 200, await enrich(projectInstallationList(result)))
      return true
    }
    const id = exactInstallationId(path[1] ?? "")
    if (path.length === 2 && request.method === "GET") {
      if (new URL(request.url ?? "", "http://bff.local").search || request.headers["idempotency-key"] !== undefined || (await readBody(request, 1)).length)
        throw new Error("invalid_skill_installation_request")
      const result = await client.get({ ...common, installationId: id }, signal)
      const view = projectInstallation(result.installation)
      if (view.installation_id !== id) throw new Error("skill_installation_response_invalid")
      send(response, 200, { data: await enrich(view) })
      return true
    }
    if (path.length === 2 && request.method === "DELETE") {
      if (new URL(request.url ?? "", "http://bff.local").search) throw new Error("invalid_skill_installation_request")
      const key = idempotencyKey(request)
      if ((await readBody(request, 1)).length) throw new Error("invalid_skill_installation_request")
      const commandId = installationCommandId("remove", common.tenant, common.subject, id, key, projectRef)
      const result = await client.remove(
        {
          ...common,
          installationId: id,
          commandId,
          digest: removeSkillDigest(common.tenant, common.subject, id, projectRef),
        },
        signal,
      )
      const ack = projectInstallationAck(result)
      if (ack.installation.installation_id !== id || ack.installation.installed || ack.installation.enabled || !["removed", "unchanged"].includes(ack.change))
        throw new Error("skill_installation_response_invalid")
      send(response, 200, { data: await enrich(ack) })
      return true
    }
    if (path.length === 3 && path[2] === "update" && request.method === "POST") {
      if (new URL(request.url ?? "", "http://bff.local").search || request.headers["content-type"]?.split(";", 1)[0] !== "application/json")
        throw new Error("invalid_skill_installation_request")
      const key = idempotencyKey(request),
        input = parseUpdateInput(await readBody(request, 65_536, signal))
      const result = await client.update(
        {
          ...common,
          ...input,
          installationId: id,
          commandId: installationCommandId("update", common.tenant, common.subject, id, key, projectRef),
          digest: updateSkillDigest(common.tenant, common.subject, id, input.expectedSourceRef, input.sourceRef, projectRef),
        },
        signal,
      )
      const ack = projectInstallationUpdateAck(result, id, input.sourceRef)
      send(response, 200, { data: await enrich(ack) })
      return true
    }
    if (path.length === 3 && path[2] === "enabled" && request.method === "PUT") {
      if (new URL(request.url ?? "", "http://bff.local").search) throw new Error("invalid_skill_installation_request")
      const key = idempotencyKey(request),
        input = parseEnabledInput(await readBody(request, 65_536))
      const commandId = installationCommandId("set-enabled", common.tenant, common.subject, id, key, projectRef)
      const result = await client.setEnabled(
        {
          ...common,
          installationId: id,
          ...input,
          commandId,
          digest: setSkillEnabledDigest(common.tenant, common.subject, id, input.enabled, projectRef),
        },
        signal,
      )
      const ack = projectInstallationAck(result)
      if (
        ack.installation.installation_id !== id ||
        !ack.installation.installed ||
        ack.installation.enabled !== input.enabled ||
        ![input.enabled ? "enabled" : "disabled", "unchanged"].includes(ack.change)
      )
        throw new Error("skill_installation_response_invalid")
      send(response, 200, { data: await enrich(ack) })
      return true
    }
    send(response, 404, failure("bff_route_not_found", "Business route was not found"))
    return true
  } catch (error) {
    if (response.destroyed || response.writableEnded || request.aborted) return true
    if (
      error instanceof Error &&
      ["invalid_skill_installation_request", "skill_installation_idempotency_key_required", "request_body_too_large", "request body too large"].includes(
        error.message,
      )
    ) {
      const oversized = error.message === "request_body_too_large" || error.message === "request body too large"
      send(response, oversized ? 413 : 400, failure(oversized ? "request_body_too_large" : error.message, "Skill installation request is invalid"))
      return true
    }
    const value = mapped(error)
    if (value.status === 504 && !request.complete) {
      response.shouldKeepAlive = false
      response.setHeader("connection", "close")
    }
    send(response, value.status, value.body, value.retryAfter ?? undefined)
    return true
  } finally {
    clearTimeout(timer)
    request.off("aborted", cancel)
    response.off("close", cancel)
  }
}
