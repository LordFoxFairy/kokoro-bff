import type { IncomingMessage, ServerResponse } from "node:http"
import type { RequestContext } from "../../domain/request-context.js"
import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import type { IdempotencyEntry, MutationTicket } from "../../application/idempotency.js"
import { failure } from "../../contracts/index.js"
import { pathOf, requestId } from "../request.js"
import { reply, send } from "../response.js"
import { authorizeUserRequest } from "../../auth/user-admission.js"

export async function handleRetiredOwnerBusiness(
  request: IncomingMessage,
  response: ServerResponse,
  context: RequestContext,
  idempotency: Map<string, IdempotencyEntry>,
  mutation: MutationTicket | null,
): Promise<boolean> {
  let path: string[]
  try {
    path = pathOf(request)
  } catch {
    return false
  }
  const owner = path[1] === "system" ? "system" : path[1] === "skills" ? "skills" : null
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
  let path: string[]
  try {
    path = pathOf(request)
  } catch {
    return false
  }
  if (path[1] !== "system" && path[1] !== "skills") return false
  const id = requestId(request)
  const admitted = await authorizeUserRequest(request, config, admission, id, AbortSignal.timeout(10_000))
  if (!admitted.ok) {
    send(response, admitted.status, failure(admitted.code, "BFF user admission failed", id), admitted.retryAfter)
    return true
  }
  return handleRetiredOwnerBusiness(request, response, admitted.context, new Map(), null)
}
