import type { IncomingMessage, ServerResponse } from "node:http"
import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import { authorizeUserRequest } from "../../auth/user-admission.js"
import type { ChatApplicationService } from "../../application/chat-service.js"
import { failure } from "../../contracts/index.js"
import { pathOf, queryOf, requestId } from "../request.js"
import { send } from "../response.js"
import { authorizeChatRequest } from "./chat-authorization.js"
import { liveChatBusiness } from "./chat.js"

function directChatReadPath(request: IncomingMessage): boolean {
  if (request.method !== "GET") return false
  const path = pathOf(request)
  if (path[0] !== "v1" || path[1] !== "sessions") return false
  const valid =
    path.length === 2 ||
    path.length === 3 ||
    (path.length === 4 && path[3] === "messages") ||
    (path.length === 6 && path[3] === "messages" && path[5] === "parts") ||
    (path.length === 6 && path[3] === "runs" && path[5] === "process")
  if (!valid) return false
  return (queryOf(request).get("project_ref")?.trim() ?? "") === ""
}

/** Chat-owned direct reads with feature-local admission and application-service dependencies. */
export async function handleChatBusinessReadRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  admission: SessionAdmission,
  chat: ChatApplicationService | null,
): Promise<boolean> {
  if (!directChatReadPath(request)) return false
  const id = requestId(request)
  response.setHeader("x-request-id", id)
  if (chat === null) return false
  const abort = new AbortController()
  const deadlineAt = performance.now() + Math.min(config.upstreamTimeoutMs, 10_000)
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
    const businessPath = pathOf(request).slice(1)
    const authorization = await authorizeChatRequest(request, admitted.context, businessPath, {}, { chatService: chat })
    if (authorization === null) return false
    if (!authorization.ok) {
      send(response, authorization.status, failure(authorization.code, authorization.message, id))
      return true
    }
    await liveChatBusiness(request, response, config, admitted.context, businessPath, {}, null, new Map(), { chatService: chat }, authorization)
    return true
  } catch {
    if (!response.headersSent && !response.writableEnded && !response.destroyed)
      send(response, 503, failure("chat_unavailable", "Chat read request failed", id))
    return true
  } finally {
    clearTimeout(timer)
    request.removeListener("aborted", onAborted)
    response.removeListener("close", onClosed)
  }
}
