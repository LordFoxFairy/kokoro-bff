import type { IncomingMessage, ServerResponse } from "node:http"
import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import type { ChatTurnApplicationService } from "../../application/chat-turn-service.js"
import { authorizeUserRequest } from "../../auth/user-admission.js"
import { failure } from "../../contracts/index.js"
import { messageRegenerationRoute, MessageRegenerationAdmissionError } from "./message-regeneration.js"
import { pathOf, requestId } from "../request.js"
import { send } from "../response.js"

export function isMessageRegenerationNativeRequest(request: IncomingMessage): boolean {
  return /^\/v1\/sessions\/[^/]+\/messages\/[^/]+\/regenerate$/u.test((request.url ?? "").split("?", 1)[0] ?? "")
}

export async function handleMessageRegenerationRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  admission: SessionAdmission,
  chatTurns: Pick<ChatTurnApplicationService, "regenerate">,
): Promise<boolean> {
  if (!isMessageRegenerationNativeRequest(request)) return false
  const id = requestId(request)
  const deadlineAt = performance.now() + Math.min(config.upstreamTimeoutMs, 10_000)
  const admitted = await authorizeUserRequest(request, config, admission, id, AbortSignal.timeout(Math.max(1, Math.floor(deadlineAt - performance.now()))))
  if (!admitted.ok) {
    send(response, admitted.status, failure(admitted.code, "BFF user admission failed", id), admitted.retryAfter)
    return true
  }
  try {
    await messageRegenerationRoute(
      request,
      response,
      admitted.context,
      pathOf(request).slice(1),
      { chatTurnService: chatTurns },
      deadlineAt,
      async (signal) => {
        const fresh = await authorizeUserRequest(request, config, admission, id, signal)
        if (!fresh.ok) throw new MessageRegenerationAdmissionError(fresh.status, fresh.code, fresh.retryAfter)
        if (fresh.context.identity.namespace !== admitted.context.identity.namespace || fresh.context.identity.userId !== admitted.context.identity.userId)
          throw new MessageRegenerationAdmissionError(404, "message_not_found")
      },
    )
  } catch {
    if (!response.headersSent && !response.writableEnded && !response.destroyed)
      send(response, 503, failure("message_regeneration_unavailable", "Message regeneration request failed", id))
  }
  return true
}
