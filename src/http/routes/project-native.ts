import type { IncomingMessage, ServerResponse } from "node:http"
import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import type { DeleteProjectResult, RenameProjectResult } from "../../application/ports/project-repository.js"
import { ProjectResourceError } from "../../application/project-resource.error.js"
import { authorizeUserRequest } from "../../auth/user-admission.js"
import { failure, ok } from "../../contracts/index.js"
import { isEmptyProjectDeletionRequest, isProjectDeletionId, projectDeletionHeaderValues, validProjectDeletionKey } from "../project-deletion-input.js"
import { isCanonicalRenameProjectId, parseProjectRenameName, renameProjectHeaderValues, validRenameProjectKey } from "../project-rename-input.js"
import { projectResourceListInput } from "../project-resource-list-input.js"
import { pathOf, requestId } from "../request.js"
import { send } from "../response.js"
import { StorageUploadClient } from "../../infrastructure/clients/storage/client.js"
import { projectPinRoute, ProjectPinAdmissionError, type ProjectPinProvider } from "./project-pin.js"

export type ProjectCoreReadProvider = Readonly<{
  list(scope: Readonly<{ tenantId: string; subjectId: string }>): Promise<readonly unknown[]>
  find(scope: Readonly<{ tenantId: string; subjectId: string }>, idOrSlug: string): Promise<unknown | null>
  revisions(scope: Readonly<{ tenantId: string; subjectId: string }>, idOrSlug: string): Promise<readonly unknown[] | null>
  deletion(scope: Readonly<{ tenantId: string; subjectId: string }>, projectId: string, signal: AbortSignal): Promise<unknown | null>
  rename(scope: Readonly<{ tenantId: string; subjectId: string }>, projectId: string, name: string, key: string, signal: AbortSignal): Promise<RenameProjectResult>
  delete(
    scope: Readonly<{ tenantId: string; subjectId: string }>,
    projectId: string,
    key: string,
    requestId: string,
    signal: AbortSignal,
  ): Promise<DeleteProjectResult>
}>

function projectPinPath(request: IncomingMessage): string {
  return (request.url ?? "").split("?", 1)[0] ?? ""
}

export function isProjectPinRequest(request: IncomingMessage): boolean {
  const path = projectPinPath(request)
  return path === "/v1/self/project-pins" || /^\/v1\/projects\/[^/]+\/pin$/u.test(path)
}

export function isProjectCoreReadRequest(request: IncomingMessage): boolean {
  const path = (request.url ?? "").split("?", 1)[0] ?? ""
  return request.method === "GET" && (path === "/v1/projects" || /^\/v1\/projects\/[^/]+$/u.test(path) || /^\/v1\/projects\/[^/]+\/instruction-revisions$/u.test(path))
}

export function isProjectDeletionStatusRequest(request: IncomingMessage): boolean {
  const path = (request.url ?? "").split("?", 1)[0] ?? ""
  return request.method === "GET" && /^\/v1\/projects\/[^/]+\/deletion$/u.test(path)
}

export function isProjectRenameRequest(request: IncomingMessage): boolean {
  const path = (request.url ?? "").split("?", 1)[0] ?? ""
  return request.method === "PATCH" && /^\/v1\/projects\/[^/]+\/name$/u.test(path)
}

export function isProjectResourceListRequest(request: IncomingMessage): boolean {
  const path = (request.url ?? "").split("?", 1)[0] ?? ""
  return request.method === "GET" && /^\/v1\/projects\/[^/]+\/resources$/u.test(path)
}

/** Projects-owned resource collection read; the legacy dispatcher no longer owns this path. */
export async function handleProjectResourceListRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  admission: SessionAdmission,
  projects: ProjectCoreReadProvider | null,
  clientFactory: (storage: NonNullable<BffConfig["storage"]>, context: { tenantId: string; subjectId: string; projectId: string; requestId: string }) => Pick<StorageUploadClient, "listAssets"> = (storage, context) =>
    new StorageUploadClient(storage, context),
): Promise<boolean> {
  if (!isProjectResourceListRequest(request)) return false
  const id = requestId(request)
  response.setHeader("x-request-id", id)
  const abort = new AbortController()
  const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(10_000)])
  const onAborted = (): void => abort.abort()
  const onClosed = (): void => {
    if (!response.writableEnded) abort.abort()
  }
  request.once("aborted", onAborted)
  response.once("close", onClosed)
  try {
    const admitted = await authorizeUserRequest(request, config, admission, id, signal)
    if (!admitted.ok) {
      send(response, admitted.status, failure(admitted.code, "BFF user admission failed", id), admitted.retryAfter)
      return true
    }
    if (projects === null) throw new ProjectResourceError("business_store_unavailable", 503, true)
    const url = new URL(request.url ?? "/", "http://bff.local")
    const match = /^\/v1\/projects\/([^/]+)\/resources$/u.exec(url.pathname)
    if (match?.[1] === undefined) throw new ProjectResourceError("invalid_project_resource_page", 400)
    let projectRef: string
    try {
      projectRef = decodeURIComponent(match[1])
    } catch {
      throw new ProjectResourceError("invalid_project_resource_page", 400)
    }
    if (request.headers["transfer-encoding"] !== undefined || (request.headers["content-length"] !== undefined && request.headers["content-length"] !== "0"))
      throw new ProjectResourceError("invalid_project_resource_page", 400)
    const project = await projects.find(
      { tenantId: admitted.context.identity.namespace, subjectId: admitted.context.identity.userId },
      projectRef,
    )
    if (project === null) throw new ProjectResourceError("project_not_found", 404)
    if (typeof project !== "object" || project === null || !("id" in project) || typeof project.id !== "string")
      throw new ProjectResourceError("project_resources_unavailable", 503, true)
    if (config.storage === undefined) throw new ProjectResourceError("storage_projection_not_configured", 503, true)
    const input = projectResourceListInput(url.searchParams)
    const page = await clientFactory(config.storage, {
      tenantId: admitted.context.identity.namespace,
      subjectId: admitted.context.identity.userId,
      projectId: project.id,
      requestId: id,
    }).listAssets(input, signal)
    signal.throwIfAborted()
    if (!response.destroyed) send(response, 200, ok(page, id))
  } catch (error) {
    if (response.destroyed || response.writableEnded) return true
    const known = error instanceof ProjectResourceError ? error : new ProjectResourceError("project_resources_unavailable", 503, true)
    send(response, known.status, failure(known.code, "Project resources could not be read", id))
  } finally {
    request.removeListener("aborted", onAborted)
    response.removeListener("close", onClosed)
  }
  return true
}

async function readProjectRenameBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string)
    size += buffer.byteLength
    if (size > 65_536) throw new Error("PROJECT_RENAME_BODY_TOO_LARGE")
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}

/** Projects-owned rename command; the legacy dispatcher no longer owns this path. */
export async function handleProjectRenameRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  admission: SessionAdmission,
  projects: ProjectCoreReadProvider | null,
): Promise<boolean> {
  if (!isProjectRenameRequest(request)) return false
  const id = requestId(request)
  const fail = (status: number, code: string, message: string, retryable = false, retryAfter?: string): void =>
    send(response, status, { error: { code, message, retryable } }, retryAfter)
  response.setHeader("x-request-id", id)
  response.setHeader("cache-control", "no-store")
  const path = (request.url ?? "").split("?", 1)[0] ?? ""
  const projectId = path.slice("/v1/projects/".length, -"/name".length)
  if (request.url !== `/v1/projects/${projectId}/name` || !isCanonicalRenameProjectId(projectId)) {
    fail(400, "invalid_project_rename", "Project rename request is invalid")
    return true
  }
  const keys = renameProjectHeaderValues(request.rawHeaders, "idempotency-key")
  const key = keys[0]
  if (keys.length !== 1 || key === undefined || !validRenameProjectKey(key)) {
    fail(400, keys.length === 0 ? "idempotency_key_required" : "invalid_project_rename", "One valid Idempotency-Key is required")
    return true
  }
  const contentTypes = renameProjectHeaderValues(request.rawHeaders, "content-type")
  if (contentTypes.length !== 1 || contentTypes[0]?.toLowerCase().split(";", 1)[0]?.trim() !== "application/json") {
    fail(400, "invalid_project_rename", "Project rename requires one application/json Content-Type")
    return true
  }
  let name: string | null
  try {
    name = parseProjectRenameName(await readProjectRenameBody(request))
  } catch {
    response.setHeader("connection", "close")
    request.resume()
    fail(400, "invalid_project_rename", "Project rename body is invalid")
    return true
  }
  if (name === null) {
    fail(400, "invalid_project_rename", "Project rename name is invalid")
    return true
  }
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), Math.min(config.upstreamTimeoutMs, 10_000))
  const onAborted = (): void => abort.abort()
  const onClosed = (): void => {
    if (!response.writableEnded) abort.abort()
  }
  request.once("aborted", onAborted)
  response.once("close", onClosed)
  if (request.aborted || response.destroyed) abort.abort()
  try {
    const admitted = await authorizeUserRequest(request, config, admission, id, abort.signal)
    if (!admitted.ok) {
      fail(admitted.status, admitted.code, "BFF user admission failed", admitted.status === 429 || admitted.status === 503, admitted.retryAfter)
      return true
    }
    if (projects === null) {
      fail(503, "business_store_unavailable", "Project store is unavailable", true)
      return true
    }
    const result = await projects.rename(
      { tenantId: admitted.context.identity.namespace, subjectId: admitted.context.identity.userId },
      projectId,
      name,
      key,
      abort.signal,
    )
    if (response.destroyed || response.writableEnded) return true
    if (result.kind === "renamed") send(response, 200, result.receipt)
    else if (result.kind === "not_found") fail(404, "project_not_found", "Project was not found")
    else fail(409, "idempotency_conflict", "Project rename key was used for different input")
  } catch {
    if (!response.destroyed && !response.writableEnded) fail(503, "business_store_unavailable", "Project rename result is unavailable", true)
  } finally {
    clearTimeout(timer)
    request.removeListener("aborted", onAborted)
    response.removeListener("close", onClosed)
  }
  return true
}

export function isProjectDeleteRequest(request: IncomingMessage): boolean {
  const path = (request.url ?? "").split("?", 1)[0] ?? ""
  return request.method === "DELETE" && /^\/v1\/projects\/[^/]+$/u.test(path)
}

/** Projects-owned delete command; the legacy dispatcher no longer owns this path. */
export async function handleProjectDeleteRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  admission: SessionAdmission,
  projects: ProjectCoreReadProvider | null,
): Promise<boolean> {
  if (!isProjectDeleteRequest(request)) return false
  const id = requestId(request)
  const fail = (status: number, code: string, message: string, retryable = false, retryAfter?: string): void =>
    send(response, status, { error: { code, message, retryable } }, retryAfter)
  response.setHeader("x-request-id", id)
  response.setHeader("cache-control", "no-store")
  const path = (request.url ?? "").split("?", 1)[0] ?? ""
  const projectId = path.slice("/v1/projects/".length)
  const keys = projectDeletionHeaderValues(request.rawHeaders, "idempotency-key")
  const key = keys[0]
  if (request.url !== `/v1/projects/${projectId}` || !isProjectDeletionId(projectId) || !isEmptyProjectDeletionRequest(request, true)) {
    fail(400, "invalid_project_deletion_request", "Project deletion request is invalid")
    return true
  }
  if (keys.length !== 1 || key === undefined || !validProjectDeletionKey(key)) {
    fail(400, keys.length === 0 ? "idempotency_key_required" : "invalid_idempotency_key", "One valid Idempotency-Key is required")
    return true
  }
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), Math.min(config.upstreamTimeoutMs, 10_000))
  const onAborted = (): void => abort.abort()
  const onClosed = (): void => {
    if (!response.writableEnded) abort.abort()
  }
  request.once("aborted", onAborted)
  response.once("close", onClosed)
  if (request.aborted || response.destroyed) abort.abort()
  try {
    const admitted = await authorizeUserRequest(request, config, admission, id, abort.signal)
    if (!admitted.ok) {
      fail(admitted.status, admitted.code, "BFF user admission failed", admitted.status === 429 || admitted.status === 503, admitted.retryAfter)
      return true
    }
    if (projects === null) {
      fail(503, "business_store_unavailable", "Project deletion is unavailable", true)
      return true
    }
    const result = await projects.delete(
      { tenantId: admitted.context.identity.namespace, subjectId: admitted.context.identity.userId },
      projectId,
      key,
      id,
      abort.signal,
    )
    if (response.destroyed || response.writableEnded) return true
    if (result.kind === "accepted") {
      response.setHeader("location", result.location)
      send(response, 202, { data: result.resource })
    } else if (result.kind === "not_found") fail(404, "project_not_found", "Project was not found")
    else if (result.kind === "in_progress") fail(409, "idempotency_in_progress", "Project deletion is in progress", true)
    else fail(409, "idempotency_conflict", "Idempotency key was used for different input")
  } catch {
    if (!response.destroyed && !response.writableEnded) fail(503, "business_store_unavailable", "Project deletion is unavailable", true)
  } finally {
    clearTimeout(timer)
    request.removeListener("aborted", onAborted)
    response.removeListener("close", onClosed)
  }
  return true
}

/** Projects-owned deletion status read; the legacy dispatcher no longer owns this path. */
export async function handleProjectDeletionStatusRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  admission: SessionAdmission,
  projects: ProjectCoreReadProvider | null,
): Promise<boolean> {
  if (!isProjectDeletionStatusRequest(request)) return false
  const id = requestId(request)
  const fail = (status: number, code: string, message: string, retryable = false, retryAfter?: string): void =>
    send(response, status, { error: { code, message, retryable } }, retryAfter)
  response.setHeader("x-request-id", id)
  response.setHeader("cache-control", "no-store")
  const path = (request.url ?? "").split("?", 1)[0] ?? ""
  const projectId = path.slice("/v1/projects/".length, -"/deletion".length)
  if (
    request.url !== `/v1/projects/${projectId}/deletion` ||
    !isProjectDeletionId(projectId) ||
    !isEmptyProjectDeletionRequest(request, false) ||
    projectDeletionHeaderValues(request.rawHeaders, "idempotency-key").length !== 0
  ) {
    fail(400, "invalid_project_deletion_request", "Project deletion status request is invalid")
    return true
  }
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), Math.min(config.upstreamTimeoutMs, 10_000))
  const onAborted = (): void => abort.abort()
  const onClosed = (): void => {
    if (!response.writableEnded) abort.abort()
  }
  request.once("aborted", onAborted)
  response.once("close", onClosed)
  if (request.aborted || response.destroyed) abort.abort()
  try {
    const admitted = await authorizeUserRequest(request, config, admission, id, abort.signal)
    if (!admitted.ok) {
      fail(admitted.status, admitted.code, "BFF user admission failed", admitted.status === 429 || admitted.status === 503, admitted.retryAfter)
      return true
    }
    if (projects === null) {
      fail(503, "business_store_unavailable", "Project deletion status is unavailable", true)
      return true
    }
    const resource = await projects.deletion(
      {
        tenantId: admitted.context.identity.namespace,
        subjectId: admitted.context.identity.userId,
      },
      projectId,
      abort.signal,
    )
    if (response.destroyed || response.writableEnded) return true
    if (resource === null) fail(404, "project_not_found", "Project was not found")
    else send(response, 200, { data: resource })
  } catch {
    if (!response.destroyed && !response.writableEnded)
      fail(503, "business_store_unavailable", "Project deletion status is unavailable", true)
  } finally {
    clearTimeout(timer)
    request.removeListener("aborted", onAborted)
    response.removeListener("close", onClosed)
  }
  return true
}

/** Projects-owned collection read; the legacy dispatcher no longer owns this path. */
export async function handleProjectCoreReadRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  admission: SessionAdmission,
  projects: ProjectCoreReadProvider | null,
): Promise<boolean> {
  if (!isProjectCoreReadRequest(request)) return false
  const id = requestId(request)
  response.setHeader("x-request-id", id)
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), Math.min(config.upstreamTimeoutMs, 10_000))
  const onAborted = (): void => abort.abort()
  const onClosed = (): void => { if (!response.writableEnded) abort.abort() }
  request.once("aborted", onAborted)
  response.once("close", onClosed)
  try {
    const admitted = await authorizeUserRequest(request, config, admission, id, abort.signal)
    if (!admitted.ok) {
      send(response, admitted.status, failure(admitted.code, "BFF user admission failed", id), admitted.retryAfter)
      return true
    }
    if (projects === null) {
      send(response, 503, failure("business_store_not_configured", "Project owner is unavailable", id))
      return true
    }
    const scope = { tenantId: admitted.context.identity.namespace, subjectId: admitted.context.identity.userId }
    const path = (request.url ?? "").split("?", 1)[0] ?? ""
    const projectId = path === "/v1/projects" ? null : path.slice("/v1/projects/".length)
    if (projectId !== null && projectId.endsWith("/instruction-revisions")) {
      const revisions = await projects.revisions(scope, projectId.slice(0, -"/instruction-revisions".length))
      if (abort.signal.aborted || response.destroyed || response.writableEnded) return true
      send(response, revisions === null ? 404 : 200, revisions === null ? failure("project_not_found", "Project was not found", id) : ok({ items: revisions }, id))
      return true
    }
    if (projectId !== null) {
      const project = await projects.find(scope, projectId)
      if (abort.signal.aborted || response.destroyed || response.writableEnded) return true
      send(response, project === null ? 404 : 200, project === null ? failure("project_not_found", "Project was not found", id) : ok({ project }, id))
      return true
    }
    const projectsRead = await projects.list(scope)
    if (abort.signal.aborted || response.destroyed || response.writableEnded) return true
    send(response, 200, ok({ projects: projectsRead }, id))
  } catch {
    if (!response.destroyed && !response.writableEnded) send(response, 503, failure("business_store_unavailable", "The BFF business store is unavailable", id))
  } finally {
    clearTimeout(timer)
    request.removeListener("aborted", onAborted)
    response.removeListener("close", onClosed)
  }
  return true
}

/** Projects-owned pin adapter; the route keeps its own body, CAS and final-admission checks. */
export async function handleProjectPinRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  admission: SessionAdmission,
  projectPins: ProjectPinProvider | null,
): Promise<boolean> {
  if (!isProjectPinRequest(request)) return false
  const id = requestId(request)
  const deadlineAt = performance.now() + Math.min(config.upstreamTimeoutMs, 10_000)
  response.setHeader("x-request-id", id)
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), Math.max(0, deadlineAt - performance.now()))
  const onAborted = (): void => abort.abort()
  const onClosed = (): void => {
    if (!response.writableEnded) abort.abort()
  }
  request.once("aborted", onAborted)
  response.once("close", onClosed)
  try {
    const admitted = await authorizeUserRequest(request, config, admission, id, abort.signal)
    if (!admitted.ok) {
      send(response, admitted.status, failure(admitted.code, "BFF user admission failed", id), admitted.retryAfter)
      return true
    }
    await projectPinRoute(request, response, admitted.context, pathOf(request).slice(1), projectPins, deadlineAt, async (signal) => {
      const fresh = await authorizeUserRequest(request, config, admission, id, signal)
      if (!fresh.ok) throw new ProjectPinAdmissionError(fresh.status, fresh.code, fresh.retryAfter)
      if (fresh.context.identity.namespace !== admitted.context.identity.namespace || fresh.context.identity.userId !== admitted.context.identity.userId)
        throw new ProjectPinAdmissionError(404, "project_not_found")
    })
    return true
  } catch {
    if (!response.headersSent && !response.writableEnded && !response.destroyed)
      send(response, 503, failure("project_pin_unavailable", "Project pin request failed", id))
    return true
  } finally {
    clearTimeout(timer)
    request.removeListener("aborted", onAborted)
    response.removeListener("close", onClosed)
  }
}
