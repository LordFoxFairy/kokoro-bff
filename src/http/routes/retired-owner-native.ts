import type { IncomingMessage, ServerResponse } from "node:http"
import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import { failure } from "../../contracts/index.js"
import { pathOf, requestId } from "../request.js"
import { send } from "../response.js"
import { authorizeUserRequest } from "../../auth/user-admission.js"

type RetiredOwner = "system" | "skills"

function retiredOwnerForRequest(request: IncomingMessage): RetiredOwner | null {
  let path: string[]
  try {
    path = pathOf(request)
  } catch {
    return null
  }
  const owner = path[1] === "system" ? "system" : path[1] === "skills" ? "skills" : null
  if (owner !== "skills" || path[0] !== "v1") return owner

  // R357 removed these REST reads. Neither runtime should admit or forward them.
  const method = request.method ?? "GET"
  const removedSkillRead =
    method === "GET" &&
    (path.length === 2 || (path.length === 3 && !["quota", "drafts", "github"].includes(path[2] ?? "")) || (path.length === 4 && path[3] === "download"))
  return removedSkillRead ? null : owner
}

export async function handleRetiredOwnerRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  admission: SessionAdmission,
): Promise<boolean> {
  const owner = retiredOwnerForRequest(request)
  if (owner === null) return false
  const id = requestId(request)
  const admitted = await authorizeUserRequest(request, config, admission, id, AbortSignal.timeout(10_000), response)
  if (!admitted.ok) {
    send(response, admitted.status, failure(admitted.code, "BFF user admission failed", id), admitted.retryAfter)
    return true
  }
  response.setHeader("x-request-id", admitted.context.requestId)
  send(
    response,
    503,
    owner === "system"
      ? failure("system_projection_not_configured", "This System operation is not exposed by the BFF owner adapter", admitted.context.requestId)
      : failure("platform_operation_not_available", "This Platform operation is not exposed by the BFF owner adapter", admitted.context.requestId),
  )
  return true
}
