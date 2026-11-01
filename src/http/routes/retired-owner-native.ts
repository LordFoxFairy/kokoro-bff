import type { IncomingMessage, ServerResponse } from "node:http"
import type { RequestContext } from "../../domain/request-context.js"
import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import type { IdempotencyEntry, MutationTicket } from "../../application/idempotency.js"
import { failure } from "../../contracts/index.js"
import { pathOf, requestId } from "../request.js"
import { reply, send } from "../response.js"
import { authorizeUserRequest } from "../../auth/user-admission.js"

type RetiredOwner = "system" | "skills"

function retiredOwnerForRequest(request: IncomingMessage, preserveRawSkillNotFound: boolean): RetiredOwner | null {
  let path: string[]
  try {
    path = pathOf(request)
  } catch {
    return null
  }
  const owner = path[1] === "system" ? "system" : path[1] === "skills" ? "skills" : null
  if (owner !== "skills" || !preserveRawSkillNotFound || path[0] !== "v1") return owner

  // The raw compatibility entrypoint historically emits route_not_found for these
  // retired Skill shapes. Keep that explicit 404 boundary while moving the rest of
  // the owner guard out of handleBffRequest.
  const method = request.method ?? "GET"
  const removedSkillRead =
    method === "GET" &&
    (path.length === 2 ||
      (path.length === 3 && !["quota", "drafts", "github"].includes(path[2] ?? "")) ||
      (path.length === 4 && path[3] === "download"))
  const removedSkillToggle = path.length === 4 && ["enable", "disable"].includes(path[3] ?? "")
  return removedSkillRead || removedSkillToggle ? null : owner
}

export async function handleRetiredOwnerBusiness(
  request: IncomingMessage,
  response: ServerResponse,
  context: RequestContext,
  idempotency: Map<string, IdempotencyEntry>,
  mutation: MutationTicket | null,
): Promise<boolean> {
  const owner = retiredOwnerForRequest(request, false)
  if (owner === null) return false
  await reply(
    response,
    503,
    owner === "system"
      ? failure("system_projection_not_configured", "This System operation is not exposed by the BFF owner adapter", context.requestId)
      : failure("platform_operation_not_available", "This Platform operation is not exposed by the BFF owner adapter", context.requestId),
    context,
    idempotency,
    mutation,
  )
  return true
}

export async function handleRetiredOwnerRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  admission: SessionAdmission,
): Promise<boolean> {
  return handleRetiredOwnerRequestInternal(request, response, config, admission, false)
}

/**
 * Raw createBffServer compatibility adapter. The raw entrypoint has two explicit
 * legacy 404 Skill shapes that must stay ahead of this retired-owner guard.
 */
export async function handleRetiredOwnerRawRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  admission: SessionAdmission,
): Promise<boolean> {
  return handleRetiredOwnerRequestInternal(request, response, config, admission, true)
}

async function handleRetiredOwnerRequestInternal(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  admission: SessionAdmission,
  preserveRawSkillNotFound: boolean,
): Promise<boolean> {
  if (retiredOwnerForRequest(request, preserveRawSkillNotFound) === null) return false
  const id = requestId(request)
  const admitted = await authorizeUserRequest(request, config, admission, id, AbortSignal.timeout(10_000))
  if (!admitted.ok) {
    send(response, admitted.status, failure(admitted.code, "BFF user admission failed", id), admitted.retryAfter)
    return true
  }
  return handleRetiredOwnerBusiness(request, response, admitted.context, new Map(), null)
}
