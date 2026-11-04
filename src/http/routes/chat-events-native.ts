import type { IncomingMessage, ServerResponse } from "node:http"
import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import type { ChatApplicationService } from "../../application/chat-service.js"
import type { ProjectService } from "../../application/project-service.js"
import type { AgUiProjectionService } from "../../application/agui/project-session-events.js"
import type { AgUiSessionRuntime } from "../../application/agui/session-runtime.js"
import type { AgUiProjectionConsumerRepository } from "../../application/agui/ports/agui-projection-repository.js"
import { authenticateBrowserRequest, writeSessionCookies } from "../../auth/user-admission.js"
import { authorizeChatRequest } from "./chat-authorization.js"
import { liveAgentSessionEvents } from "./agent.js"
import { runAgUiHttpTransport } from "../../interfaces/http/agui/sse.js"
import { pathOf, requestId } from "../request.js"
import { failure } from "../../contracts/index.js"
import { send } from "../response.js"

function chatEventsPath(request: IncomingMessage): boolean {
  try {
    const path = pathOf(request)
    if (request.method !== "GET" || path[0] !== "v1" || path[1] !== "sessions" || path.length !== 4 || path[3] !== "events") return false
    return true
  } catch {
    return false
  }
}

export function isChatEventsNativeRequest(request: IncomingMessage): boolean {
  return chatEventsPath(request)
}

/** Chat-owned direct AG-UI events stream with feature-local projection and consumer providers. */
export async function handleChatEventsRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  admission: SessionAdmission,
  chat: ChatApplicationService,
  projects: ProjectService,
  projection: AgUiProjectionService,
  consumers: AgUiProjectionConsumerRepository,
  runtime: AgUiSessionRuntime,
  sourceProjectionActive: boolean,
): Promise<boolean> {
  if (!chatEventsPath(request)) return false
  const id = requestId(request)
  await runAgUiHttpTransport(request, response, runtime, async (signal) => {
    try {
      signal.throwIfAborted()
      const admitted = await authenticateBrowserRequest(request, config, admission, id, AbortSignal.any([signal, AbortSignal.timeout(10_000)]))
      signal.throwIfAborted()
      writeSessionCookies(response, admitted.setCookies)
      if (!admitted.ok) {
        send(response, admitted.status, failure(admitted.code, "BFF user admission failed", id), admitted.retryAfter)
        return
      }
      const context = { requestId: id, identity: admitted.identity, platformAdmin: admitted.platformAdmin }
      const businessPath = pathOf(request).slice(1)
      signal.throwIfAborted()
      const authorization = await authorizeChatRequest(request, context, businessPath, chat, projects, signal)
      signal.throwIfAborted()
      if (authorization === null) return
      if (!authorization.ok) {
        send(response, authorization.status, failure(authorization.code, authorization.message, id))
        return
      }
      signal.throwIfAborted()
      const conversation = await chat.findConversation(context.identity.namespace, context.identity.userId, businessPath[1] ?? "", authorization.projectRef)
      signal.throwIfAborted()
      if (conversation === null) {
        send(response, 404, failure("session_not_found", "Session was not found", id))
        return
      }
      signal.throwIfAborted()
      await consumers.registerConsumer(context.identity.namespace, businessPath[1] ?? "", conversation.owner_id)
      signal.throwIfAborted()
      await liveAgentSessionEvents(request, response, config, context, businessPath[1] ?? "", projection, sourceProjectionActive, runtime, signal)
      signal.throwIfAborted()
    } catch {
      if (!signal.aborted && !response.headersSent && !response.writableEnded && !response.destroyed)
        send(response, 503, failure("agui_ledger_unavailable", "The durable AG-UI ledger is unavailable", id))
    }
  })
  return true
}
