import { currentResourceProject } from "../project-resource-access.js"
import type { IncomingMessage, ServerResponse } from "node:http"
import type { RequestContext } from "../../domain/request-context.js"
import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import type { ProjectLookup } from "../../application/projects/types.js"
import type { ProjectDeletion, ProjectRenamer } from "../../application/projects/commands.js"
import type { IdempotencyRepository } from "../../application/ports/idempotency-repository.js"
import { commitReceipt, mutationTicket, type IdempotencyEntry } from "../../application/idempotency.js"
import { uploadProjectResource, projectResourceFingerprint } from "../../application/project-resource-upload.js"
import type { ProjectResourceStorage } from "../../application/project-resource.types.js"
import { ProjectResourceError } from "../../application/project-resource.error.js"
import { ProjectResourceAccessClient } from "../../infrastructure/clients/storage/project-resource-access.js"
import { authorizeUserRequest } from "../../auth/user-admission.js"
import { failure, ok } from "../../contracts/index.js"
import { isEmptyProjectDeletionRequest, isProjectDeletionId, projectDeletionHeaderValues, validProjectDeletionKey } from "../project-deletion-input.js"
import { isCanonicalRenameProjectId, parseProjectRenameName, renameProjectHeaderValues, validRenameProjectKey } from "../project-rename-input.js"
import { projectResourceListInput } from "../project-resource-list-input.js"
import { idempotencyKey, pathOf, requestId } from "../request.js"
import { readFileUploadBody } from "../file-upload-body.js"
import { reply, send } from "../response.js"
import { parseProjectResource } from "../project-resource-input.js"
import { StorageUploadClient } from "../../infrastructure/clients/storage/client.js"
import type { ProjectPinProvider } from "../../infrastructure/postgres/project-pin.js"
import type { ProjectReadStore } from "../../infrastructure/postgres/project-store.js"
import { projectPinRoute, ProjectPinAdmissionError } from "./project-pin.js"
import { projectResourceReadRoute, type ProjectResourceReadClientFactory, type ProjectResourceReadSpooler } from "./project-resource-read.js"

export type ProjectResourceUploadProvider = ProjectLookup &
  Readonly<{
    receipts: IdempotencyRepository
    idempotency: Map<string, IdempotencyEntry>
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
  return (
    request.method === "GET" &&
    (path === "/v1/projects" || /^\/v1\/projects\/[^/]+$/u.test(path) || /^\/v1\/projects\/[^/]+\/instruction-revisions$/u.test(path))
  )
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

export function isProjectResourceDeleteRequest(request: IncomingMessage): boolean {
  const path = (request.url ?? "").split("?", 1)[0] ?? ""
  return request.method === "DELETE" && /^\/v1\/projects\/[^/]+\/resources\/[^/]+$/u.test(path)
}

export function isProjectResourceReadRequest(request: IncomingMessage): boolean {
  const path = (request.url ?? "").split("?", 1)[0] ?? ""
  return request.method === "GET" && /^\/v1\/projects\/[^/]+\/resources\/[^/]+(?:\/download)?$/u.test(path)
}

export function isProjectResourceUploadRequest(request: IncomingMessage): boolean {
  const path = (request.url ?? "").split("?", 1)[0] ?? ""
  return request.method === "POST" && /^\/v1\/projects\/[^/]+\/resources$/u.test(path)
}

/** Projects-owned resource upload; the legacy dispatcher no longer owns this path. */
export async function handleProjectResourceUploadRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  admission: SessionAdmission,
  projects: ProjectResourceUploadProvider,
  clientFactory: (
    storage: NonNullable<BffConfig["storage"]>,
    context: { tenantId: string; subjectId: string; projectId: string; key: string; requestId: string },
  ) => ProjectResourceStorage = (storage, context) => new StorageUploadClient(storage, context),
): Promise<boolean> {
  if (!isProjectResourceUploadRequest(request)) return false
  const id = requestId(request)
  response.setHeader("x-request-id", id)
  const cancellation = new AbortController()
  const cancel = (): void => {
    if (!response.writableEnded) cancellation.abort()
  }
  request.once("aborted", cancel)
  response.once("close", cancel)
  const signal = AbortSignal.any([cancellation.signal, AbortSignal.timeout(45_000)])
  let mutation: import("../../application/idempotency.js").MutationTicket | null = null
  let admittedContext: RequestContext | null = null
  try {
    const admitted = await authorizeUserRequest(request, config, admission, id, signal, response)
    if (!admitted.ok) {
      send(response, admitted.status, failure(admitted.code, "BFF user admission failed", id), admitted.retryAfter)
      return true
    }
    admittedContext = admitted.context
    const path = (request.url ?? "").split("?", 1)[0] ?? ""
    const match = /^\/v1\/projects\/([^/]+)\/resources$/u.exec(path)
    if (match?.[1] === undefined || request.url !== path) throw new ProjectResourceError("invalid_project_resource", 400)
    let projectRef: string
    try {
      projectRef = decodeURIComponent(match[1])
    } catch {
      throw new ProjectResourceError("invalid_project_resource", 400)
    }
    const scope = { tenantId: admitted.context.identity.namespace, subjectId: admitted.context.identity.userId }
    const project = { id: await currentResourceProject(projects, scope, projectRef, signal) }
    const authorize = async (): Promise<void> => {
      if ((await currentResourceProject(projects, scope, project.id, signal)) !== project.id) throw new ProjectResourceError("project_not_found", 404)
    }
    const keys = projectDeletionHeaderValues(request.rawHeaders, "idempotency-key")
    const key = idempotencyKey(request)
    if (keys.length !== 1 || key === null || keys[0] !== key || key.length > 191 || !/^[\x21-\x7e]+$/u.test(key))
      throw new ProjectResourceError("invalid_idempotency_key", 400)
    const body = await readFileUploadBody(request, response, id)
    if (body === null) return true
    const input = await parseProjectResource(request.headers["content-type"] ?? "", body)
    const context = { tenantId: admitted.context.identity.namespace, subjectId: admitted.context.identity.userId, projectId: project.id, key, requestId: id }
    const ticket = await mutationTicket(
      key,
      "POST",
      `/projects/${project.id}/resources`,
      admitted.context,
      projectResourceFingerprint(input),
      projects.idempotency,
      projects.receipts,
    )
    if (ticket.replay !== null) {
      await authorize()
      send(response, ticket.replay.status, ticket.replay.body)
      return true
    }
    if (ticket.conflict || ticket.pending) throw new ProjectResourceError(ticket.conflict ? "idempotency_conflict" : "idempotency_in_progress", 409)
    mutation = ticket.ticket
    if (config.storage === undefined) throw new ProjectResourceError("storage_projection_not_configured", 503, true)
    const resource = await uploadProjectResource(context, input, projects.receipts, clientFactory(config.storage, context), signal, authorize)
    await authorize()
    await reply(response, 200, ok({ resources: [resource] }, id), admitted.context, projects.idempotency, mutation)
  } catch (error) {
    const known = error instanceof ProjectResourceError ? error : new ProjectResourceError("resource_upload_unavailable", 503, true)
    if (admittedContext !== null && mutation !== null && (known.status === 403 || known.status === 404)) {
      // Permission retirement is not a terminal receipt for a possibly dispatched owner command.
      await commitReceipt(projects.idempotency, mutation, 503, null)
      send(response, known.status, failure(known.code, "Project resource access is no longer available", id))
    } else if (admittedContext === null) send(response, known.status, failure(known.code, "Project resource upload did not complete", id))
    else
      await reply(response, known.status, failure(known.code, "Project resource upload did not complete", id), admittedContext, projects.idempotency, mutation)
  } finally {
    request.off("aborted", cancel)
    response.off("close", cancel)
  }
  return true
}

/** Projects-owned resource metadata/download read; the legacy dispatcher no longer owns this path. */
export async function handleProjectResourceReadRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  admission: SessionAdmission,
  projects: ProjectLookup,
  clientFactory?: ProjectResourceReadClientFactory,
  spooler?: ProjectResourceReadSpooler,
): Promise<boolean> {
  if (!isProjectResourceReadRequest(request)) return false
  const id = requestId(request)
  response.setHeader("x-request-id", id)
  const signal = AbortSignal.timeout(10_000)
  try {
    const admitted = await authorizeUserRequest(request, config, admission, id, signal, response)
    if (!admitted.ok) {
      send(response, admitted.status, failure(admitted.code, "BFF user admission failed", id), admitted.retryAfter)
      return true
    }
    const path = (request.url ?? "").split("?", 1)[0] ?? ""
    const match = /^\/v1\/projects\/([^/]+)\/resources\/([^/]+)(\/download)?$/u.exec(path)
    if (match?.[1] === undefined || match[2] === undefined) {
      send(response, 400, failure("invalid_project_resource", "Project resource request is invalid", id))
      return true
    }
    let projectRef: string
    let assetId: string
    try {
      projectRef = decodeURIComponent(match[1])
      assetId = decodeURIComponent(match[2])
    } catch {
      send(response, 400, failure("invalid_project_resource", "Project resource request is invalid", id))
      return true
    }
    await projectResourceReadRoute(
      request,
      response,
      config,
      { requestId: id, identity: admitted.context.identity },
      projectRef,
      assetId,
      match[3] === "/download",
      projects,
      clientFactory,
      spooler,
    )
    return true
  } catch {
    if (!response.headersSent && !response.writableEnded && !response.destroyed)
      send(response, 503, failure("storage_unavailable", "Project resource could not be read", id))
    return true
  }
}

/** Projects-owned resource delete command; the legacy dispatcher no longer owns this path. */
export async function handleProjectResourceDeleteRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  admission: SessionAdmission,
  projects: ProjectLookup,
  clientFactory: (
    storage: NonNullable<BffConfig["storage"]>,
    context: { tenantId: string; subjectId: string; projectId: string; requestId: string },
  ) => Pick<ProjectResourceAccessClient, "delete"> = (storage, context) => new ProjectResourceAccessClient(storage, context),
): Promise<boolean> {
  if (!isProjectResourceDeleteRequest(request)) return false
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
    const admitted = await authorizeUserRequest(request, config, admission, id, signal, response)
    if (!admitted.ok) {
      send(response, admitted.status, failure(admitted.code, "BFF user admission failed", id), admitted.retryAfter)
      return true
    }
    const url = new URL(request.url ?? "/", "http://bff.local")
    const match = /^\/v1\/projects\/([^/]+)\/resources\/([^/]+)$/u.exec(url.pathname)
    if (match?.[1] === undefined || match[2] === undefined) throw new ProjectResourceError("invalid_project_resource", 400)
    let projectRef: string
    let assetId: string
    try {
      projectRef = decodeURIComponent(match[1])
      assetId = decodeURIComponent(match[2])
    } catch {
      throw new ProjectResourceError("invalid_project_resource", 400)
    }
    if (
      request.url !== `/v1/projects/${encodeURIComponent(projectRef)}/resources/${encodeURIComponent(assetId)}` ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(projectRef) ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(assetId) ||
      !isEmptyProjectDeletionRequest(request, true) ||
      request.headers["content-type"] !== undefined
    )
      throw new ProjectResourceError("invalid_project_resource", 400)
    const keys = projectDeletionHeaderValues(request.rawHeaders, "idempotency-key")
    const key = keys[0]
    if (keys.length !== 1 || key === undefined || !/^[\x21-\x7e]{1,191}$/u.test(key)) throw new ProjectResourceError("invalid_project_resource", 400)
    const scope = { tenantId: admitted.context.identity.namespace, subjectId: admitted.context.identity.userId }
    const project = { id: await currentResourceProject(projects, scope, projectRef, signal) }
    if (config.storage === undefined) throw new ProjectResourceError("storage_projection_not_configured", 503, true)
    const result = await clientFactory(config.storage, { ...scope, projectId: project.id, requestId: id }).delete(assetId, key, signal)
    signal.throwIfAborted()
    if ((await currentResourceProject(projects, scope, project.id, signal)) !== project.id) throw new ProjectResourceError("project_not_found", 404)
    if (!response.destroyed) send(response, 200, ok(result, id))
  } catch (error) {
    if (response.destroyed || response.writableEnded) return true
    const known = error instanceof ProjectResourceError ? error : new ProjectResourceError("project_resource_delete_unknown", 503, true)
    send(response, known.status, failure(known.code, "Project resource deletion did not complete", id))
  } finally {
    request.removeListener("aborted", onAborted)
    response.removeListener("close", onClosed)
  }
  return true
}

/** Projects-owned resource collection read; the legacy dispatcher no longer owns this path. */
export async function handleProjectResourceListRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  admission: SessionAdmission,
  projects: ProjectLookup,
  clientFactory: (
    storage: NonNullable<BffConfig["storage"]>,
    context: { tenantId: string; subjectId: string; projectId: string; requestId: string },
  ) => Pick<StorageUploadClient, "listAssets"> = (storage, context) => new StorageUploadClient(storage, context),
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
    const admitted = await authorizeUserRequest(request, config, admission, id, signal, response)
    if (!admitted.ok) {
      send(response, admitted.status, failure(admitted.code, "BFF user admission failed", id), admitted.retryAfter)
      return true
    }
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
    const scope = { tenantId: admitted.context.identity.namespace, subjectId: admitted.context.identity.userId }
    const project = { id: await currentResourceProject(projects, scope, projectRef, signal) }
    if (config.storage === undefined) throw new ProjectResourceError("storage_projection_not_configured", 503, true)
    const input = projectResourceListInput(url.searchParams)
    const page = await clientFactory(config.storage, {
      tenantId: admitted.context.identity.namespace,
      subjectId: admitted.context.identity.userId,
      projectId: project.id,
      requestId: id,
    }).listAssets(input, signal)
    signal.throwIfAborted()
    if ((await currentResourceProject(projects, scope, project.id, signal)) !== project.id) throw new ProjectResourceError("project_not_found", 404)
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
  rename: ProjectRenamer,
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
    const admitted = await authorizeUserRequest(request, config, admission, id, abort.signal, response)
    if (!admitted.ok) {
      fail(admitted.status, admitted.code, "BFF user admission failed", admitted.status === 429 || admitted.status === 503, admitted.retryAfter)
      return true
    }
    const result = await rename(
      { tenantId: admitted.context.identity.namespace, subjectId: admitted.context.identity.userId },
      projectId,
      name,
      key,
      abort.signal,
    )
    if (response.destroyed || response.writableEnded) return true
    if (result.kind === "renamed") send(response, 200, result.receipt)
    else if (result.kind === "forbidden") fail(403, "project_edit_forbidden", "Project cannot be edited")
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
  return request.method === "DELETE" && /^\/v1\/projects\/[^/]+\/?$/u.test(path)
}

/** Projects-owned delete command; the legacy dispatcher no longer owns this path. */
export async function handleProjectDeleteRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  admission: SessionAdmission,
  deletion: ProjectDeletion,
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
    const admitted = await authorizeUserRequest(request, config, admission, id, abort.signal, response)
    if (!admitted.ok) {
      fail(admitted.status, admitted.code, "BFF user admission failed", admitted.status === 429 || admitted.status === 503, admitted.retryAfter)
      return true
    }
    const result = await deletion.delete(
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
  deletion: ProjectDeletion,
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
    const admitted = await authorizeUserRequest(request, config, admission, id, abort.signal, response)
    if (!admitted.ok) {
      fail(admitted.status, admitted.code, "BFF user admission failed", admitted.status === 429 || admitted.status === 503, admitted.retryAfter)
      return true
    }
    const resource = await deletion.deletion(
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
    if (!response.destroyed && !response.writableEnded) fail(503, "business_store_unavailable", "Project deletion status is unavailable", true)
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
  reads: ProjectReadStore,
  lookup: ProjectLookup,
): Promise<boolean> {
  if (!isProjectCoreReadRequest(request)) return false
  const id = requestId(request)
  response.setHeader("x-request-id", id)
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), Math.min(config.upstreamTimeoutMs, 10_000))
  const onAborted = (): void => abort.abort()
  const onClosed = (): void => {
    if (!response.writableEnded) abort.abort()
  }
  request.once("aborted", onAborted)
  response.once("close", onClosed)
  try {
    const admitted = await authorizeUserRequest(request, config, admission, id, abort.signal, response)
    if (!admitted.ok) {
      send(response, admitted.status, failure(admitted.code, "BFF user admission failed", id), admitted.retryAfter)
      return true
    }
    const scope = { tenantId: admitted.context.identity.namespace, subjectId: admitted.context.identity.userId }
    const path = (request.url ?? "").split("?", 1)[0] ?? ""
    const projectId = path === "/v1/projects" ? null : path.slice("/v1/projects/".length)
    if (projectId !== null && projectId.endsWith("/instruction-revisions")) {
      const revisions = await reads.revisions(scope, projectId.slice(0, -"/instruction-revisions".length))
      if (abort.signal.aborted || response.destroyed || response.writableEnded) return true
      send(
        response,
        revisions === null ? 404 : 200,
        revisions === null ? failure("project_not_found", "Project was not found", id) : ok({ items: revisions }, id),
      )
      return true
    }
    if (projectId !== null) {
      const project = await lookup.find(scope, projectId)
      if (abort.signal.aborted || response.destroyed || response.writableEnded) return true
      send(response, project === null ? 404 : 200, project === null ? failure("project_not_found", "Project was not found", id) : ok({ project }, id))
      return true
    }
    const projectsRead = await reads.list(scope)
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

/** GET reuses this request's complete admission; PUT retains its fresh pre/post-write admission. */
export async function handleProjectPinRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  admission: SessionAdmission,
  projectPins: ProjectPinProvider,
): Promise<boolean> {
  if (!isProjectPinRequest(request)) return false
  const id = requestId(request)
  const deadlineAt = performance.now() + Math.min(config.upstreamTimeoutMs, 10_000)
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), Math.max(0, deadlineAt - performance.now()))
  const onAborted = (): void => abort.abort()
  const onClosed = (): void => {
    if (!response.writableEnded) abort.abort()
  }
  request.once("aborted", onAborted)
  response.once("close", onClosed)
  const checkLifetime = (): void => {
    if (request.aborted || response.destroyed || response.writableEnded || performance.now() >= deadlineAt) abort.abort()
    abort.signal.throwIfAborted()
  }
  try {
    checkLifetime()
    response.setHeader("x-request-id", id)
    const admitted = await authorizeUserRequest(request, config, admission, id, abort.signal, response)
    checkLifetime()
    if (!admitted.ok) {
      send(response, admitted.status, failure(admitted.code, "BFF user admission failed", id), admitted.retryAfter)
      return true
    }
    const readPins = request.method === "GET" && projectPinPath(request) === "/v1/self/project-pins"
    const expiresAt = readPins && typeof admitted.expiresAt === "string" ? Date.parse(admitted.expiresAt) : undefined
    if (readPins && (expiresAt === undefined || !Number.isFinite(expiresAt))) throw new ProjectPinAdmissionError(503, "iam_admission_unavailable")
    if (expiresAt !== undefined && Date.now() >= expiresAt) throw new ProjectPinAdmissionError(401, "session_invalid")
    await projectPinRoute(
      request,
      response,
      admitted.context,
      pathOf(request).slice(1),
      projectPins,
      deadlineAt,
      async (signal) => {
        if (readPins) {
          if (Date.now() >= expiresAt!) throw new ProjectPinAdmissionError(401, "session_invalid")
          checkLifetime()
          signal.throwIfAborted()
          return
        }
        const fresh = await authorizeUserRequest(request, config, admission, id, signal, response)
        if (!fresh.ok) throw new ProjectPinAdmissionError(fresh.status, fresh.code, fresh.retryAfter)
        if (fresh.context.identity.namespace !== admitted.context.identity.namespace || fresh.context.identity.userId !== admitted.context.identity.userId)
          throw new ProjectPinAdmissionError(404, "project_not_found")
      },
      expiresAt,
    )
    return true
  } catch (error) {
    if (!response.headersSent && !response.writableEnded && !response.destroyed)
      send(
        response,
        error instanceof ProjectPinAdmissionError ? error.status : 503,
        failure(error instanceof ProjectPinAdmissionError ? error.code : "project_pin_unavailable", "Project pin request failed", id),
      )
    return true
  } finally {
    clearTimeout(timer)
    request.removeListener("aborted", onAborted)
    response.removeListener("close", onClosed)
  }
}
