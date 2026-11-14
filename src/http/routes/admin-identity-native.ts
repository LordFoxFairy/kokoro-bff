import type { IncomingMessage, ServerResponse } from "node:http"
import { authorizeUserRequest } from "../../auth/user-admission.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import type { BffConfig } from "../../config/runtime.js"
import { liveAdminIdentityRead } from "./admin-identity.js"
import { requestId } from "../request.js"
import { send } from "../response.js"
import { failure } from "../../contracts/index.js"

function identityPath(request: IncomingMessage): string[] | null {
  const parts = new URL(request.url ?? "/", "http://bff.local").pathname.split("/").filter(Boolean)
  return parts[0] === "v1" && parts[1] === "admin" && parts[2] === "identity" ? parts.slice(1) : null
}

/** Administrator IAM identity reads are admitted and owned by AccountModule. */
export async function handleAdminIdentityRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  admission: SessionAdmission,
): Promise<boolean> {
  const path = identityPath(request)
  if (path === null) return false
  const id = requestId(request)
  const controller = new AbortController()
  const deadlineAt = performance.now() + 10_000
  const abort = (): void => controller.abort()
  const close = (): void => {
    if (!response.writableEnded) abort()
  }
  request.once("aborted", abort)
  response.once("close", close)
  const timer = setTimeout(abort, 10_000)
  timer.unref()
  try {
    if (request.aborted || response.destroyed || response.writableEnded) return true
    const admitted = await authorizeUserRequest(request, config, admission, id, controller.signal, response)
    controller.signal.throwIfAborted()
    if (!admitted.ok) {
      send(response, admitted.status, failure(admitted.code, "BFF user admission failed", id), admitted.retryAfter)
      return true
    }
    await liveAdminIdentityRead(request, response, config, admitted.context, path, controller.signal, deadlineAt)
  } catch {
    if (!response.headersSent && !response.destroyed && !response.writableEnded)
      send(response, 503, failure("iam_admission_unavailable", "Administrator identity read is unavailable", id))
    else if (!response.writableEnded && !response.destroyed) response.destroy()
  } finally {
    clearTimeout(timer)
    request.removeListener("aborted", abort)
    response.removeListener("close", close)
  }
  return true
}
