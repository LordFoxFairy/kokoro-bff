import type { IncomingMessage, ServerResponse } from "node:http"
import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import { failure } from "../../contracts/index.js"
import { pathOf, requestId } from "../request.js"
import { send } from "../response.js"
import { authorizeUserRequest } from "../../auth/user-admission.js"

type RetiredOwner = "system" | "skills"

function isRetiredOwnerRequest(request: IncomingMessage, owner: RetiredOwner): boolean {
  let path: string[]
  try {
    path = pathOf(request)
  } catch {
    return false
  }
  if (path[1] !== owner) return false
  if (owner !== "skills" || path[0] !== "v1") return true

  // R357 removed these REST reads. Neither runtime should admit or forward them.
  const method = request.method ?? "GET"
  const removedSkillRead =
    method === "GET" &&
    (path.length === 2 || (path.length === 3 && !["quota", "drafts", "github"].includes(path[2] ?? "")) || (path.length === 4 && path[3] === "download"))
  return !removedSkillRead
}

export async function handleRetiredOwnerRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  admission: SessionAdmission,
  owner: RetiredOwner,
): Promise<boolean> {
  if (!isRetiredOwnerRequest(request, owner)) return false
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
