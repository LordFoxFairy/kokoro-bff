import type { IncomingMessage, ServerResponse } from "node:http"
import { authorizeUserRequest } from "../../auth/user-admission.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import type { BffConfig } from "../../config/runtime.js"
import type { ChatMove } from "../../application/chat/move-conversation.js"
import { moveSessionRoute } from "./move-session.js"
import { requestId } from "../request.js"
import { send } from "../response.js"
import { failure } from "../../contracts/index.js"

function isMovePath(request: IncomingMessage): boolean {
  const parts = new URL(request.url ?? "/", "http://bff.local").pathname.split("/").filter(Boolean)
  return request.method === "POST" && parts[0] === "v1" && parts[1] === "sessions" && parts.length === 4 && parts[3] === "move"
}

/** Conversation move is owned by ChatModule and uses its narrow move provider. */
export async function handleMoveSessionRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  admission: SessionAdmission,
  move: ChatMove,
): Promise<boolean> {
  if (!isMovePath(request)) return false
  const id = requestId(request)
  response.setHeader("x-request-id", id)
  try {
    const admitted = await authorizeUserRequest(request, config, admission, id, AbortSignal.timeout(10_000), response)
    if (!admitted.ok) {
      send(response, admitted.status, failure(admitted.code, "BFF user admission failed", id), admitted.retryAfter)
      return true
    }
    const conversationId = new URL(request.url ?? "/", "http://bff.local").pathname.split("/").filter(Boolean)[2] ?? ""
    await moveSessionRoute(request, response, admitted.context, conversationId, move)
  } catch {
    if (!response.headersSent && !response.destroyed && !response.writableEnded)
      send(response, 503, failure("chat_move_unavailable", "Conversation move is unavailable", id))
    else if (!response.writableEnded && !response.destroyed) response.destroy()
  }
  return true
}
