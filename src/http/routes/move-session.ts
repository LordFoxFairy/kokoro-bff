import type { IncomingMessage, ServerResponse } from "node:http"

import type { BffBusinessStore } from "../../application/ports/bff-business-store.js"
import type { RequestContext } from "../../domain/request-context.js"
import { isCanonicalMoveSessionId, parseMoveSessionInput, singleMoveSessionKey } from "../move-session-input.js"
import { readBody } from "../request.js"
import { send } from "../response.js"

const failure = (code: string, message: string, retryable = false) => ({ error: { code, message, retryable } })

export async function moveSessionRoute(
  request: IncomingMessage,
  response: ServerResponse,
  context: RequestContext,
  conversationId: string,
  store: BffBusinessStore | null,
): Promise<void> {
  response.setHeader("x-request-id", context.requestId)
  if (request.method !== "POST" || request.url !== `/v1/sessions/${conversationId}/move` || !isCanonicalMoveSessionId(conversationId)) {
    send(response, 400, failure("invalid_move_request", "Move request is invalid"))
    return
  }
  const rawKeys = request.rawHeaders.filter((name, index) => index % 2 === 0 && name.toLowerCase() === "idempotency-key")
  const key = singleMoveSessionKey(request.rawHeaders)
  if (key === null) {
    send(response, 400, failure(rawKeys.length === 0 ? "idempotency_key_required" : "invalid_move_request", "One valid Idempotency-Key is required"))
    return
  }
  const contentTypes = request.rawHeaders.filter((name, index) => index % 2 === 0 && name.toLowerCase() === "content-type")
  if (contentTypes.length !== 1 || request.headers["content-type"]?.toLowerCase().split(";", 1)[0]?.trim() !== "application/json") {
    send(response, 400, failure("invalid_move_request", "Move requires one application/json Content-Type"))
    return
  }
  let input
  try {
    input = parseMoveSessionInput(await readBody(request, 65_536))
  } catch {
    send(response, 400, failure("invalid_move_request", "Move body is invalid"))
    return
  }
  if (input === null) {
    send(response, 400, failure("invalid_move_request", "Move body is invalid"))
    return
  }
  if (store === null) {
    send(response, 503, failure("business_store_unavailable", "Conversation store is unavailable", true))
    return
  }
  const routeAbort = new AbortController()
  const abortRoute = (): void => routeAbort.abort()
  const onResponseClosed = (): void => {
    if (!response.writableEnded) routeAbort.abort()
  }
  request.once("aborted", abortRoute)
  response.once("close", onResponseClosed)
  if (request.aborted || response.destroyed) routeAbort.abort()
  try {
    const result = await store.services.chat.moveConversation(context, conversationId, input.targetProjectId, key, routeAbort.signal)
    if (response.destroyed) return
    if (result.kind === "moved") send(response, 200, result.receipt)
    else if (result.kind === "not_found") send(response, 404, failure("session_not_found", "Conversation or Project was not found"))
    else send(response, 409, failure("idempotency_conflict", "Move key was used for different input"))
  } catch {
    if (!response.destroyed) send(response, 503, failure("business_store_unavailable", "Conversation result is unavailable", true))
  } finally {
    request.removeListener("aborted", abortRoute)
    response.removeListener("close", onResponseClosed)
  }
}
