import type { IncomingMessage, ServerResponse } from "node:http"
import type { RequestContext } from "../../domain/request-context.js"
import type { IdempotencyEntry, MutationTicket } from "../../application/idempotency.js"
import { failure } from "../../contracts/index.js"
import { pathOf } from "../request.js"
import { reply } from "../response.js"

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
