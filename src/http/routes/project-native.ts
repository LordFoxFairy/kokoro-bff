import type { IncomingMessage, ServerResponse } from "node:http"
import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import { authorizeUserRequest } from "../../auth/user-admission.js"
import { failure, ok } from "../../contracts/index.js"
import { pathOf, requestId } from "../request.js"
import { send } from "../response.js"
import { projectPinRoute, ProjectPinAdmissionError, type ProjectPinProvider } from "./project-pin.js"

export type ProjectCoreReadProvider = Readonly<{
  list(scope: Readonly<{ tenantId: string; subjectId: string }>): Promise<readonly unknown[]>
  find(scope: Readonly<{ tenantId: string; subjectId: string }>, idOrSlug: string): Promise<unknown | null>
  revisions(scope: Readonly<{ tenantId: string; subjectId: string }>, idOrSlug: string): Promise<readonly unknown[] | null>
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
