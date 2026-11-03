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
  try {
    const admitted = await authorizeUserRequest(request, config, admission, id, AbortSignal.timeout(10_000), response)
    if (!admitted.ok) {
      send(response, admitted.status, failure(admitted.code, "BFF user admission failed", id), admitted.retryAfter)
      return true
    }
    await liveAdminIdentityRead(request, response, config, admitted.context, path)
  } catch {
    if (!response.headersSent && !response.destroyed && !response.writableEnded)
      send(response, 503, failure("iam_admission_unavailable", "Administrator identity read is unavailable", id))
    else if (!response.writableEnded && !response.destroyed) response.destroy()
  }
  return true
}
