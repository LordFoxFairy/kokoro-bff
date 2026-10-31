import type { IncomingMessage, ServerResponse } from "node:http"
import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import { authorizeUserRequest } from "../../auth/user-admission.js"
import { failure } from "../../contracts/index.js"
import { pathOf, requestId } from "../request.js"
import { send } from "../response.js"
import { projectPinRoute, ProjectPinAdmissionError, type ProjectPinProvider } from "./project-pin.js"

function projectPinPath(request: IncomingMessage): string {
  return (request.url ?? "").split("?", 1)[0] ?? ""
}

export function isProjectPinRequest(request: IncomingMessage): boolean {
  const path = projectPinPath(request)
  return path === "/v1/self/project-pins" || /^\/v1\/projects\/[^/]+\/pin$/u.test(path)
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
