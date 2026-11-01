import type { IncomingMessage, ServerResponse } from "node:http"
import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import type { ChatApplicationService } from "../../application/chat-service.js"
import type { AgUiProjectionService } from "../../application/agui/project-session-events.js"
import type { AgUiSessionRuntime } from "../../application/agui/session-runtime.js"
import type { AgUiProjectionConsumerRepository } from "../../application/agui/ports/agui-projection-repository.js"
import { authorizeUserRequest } from "../../auth/user-admission.js"
import { authorizeChatRequest } from "./chat-authorization.js"
import { liveAgentSession } from "./agent.js"
import { pathOf, queryOf, requestId } from "../request.js"
import { failure } from "../../contracts/index.js"
import { send } from "../response.js"

function directChatEventsPath(request: IncomingMessage): boolean {
  try {
    const path = pathOf(request)
    if (request.method !== "GET" || path[0] !== "v1" || path[1] !== "sessions" || path.length !== 4 || path[3] !== "events") return false
    const projectRef = queryOf(request).get("project_ref")?.trim()
    return projectRef === undefined || projectRef === ""
  } catch {
    return false
  }
}

export function isChatEventsNativeRequest(request: IncomingMessage): boolean {
  return directChatEventsPath(request)
}

/** Chat-owned direct AG-UI events stream with feature-local projection and consumer providers. */
export async function handleChatEventsRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  admission: SessionAdmission,
  chat: ChatApplicationService,
  projection: AgUiProjectionService,
  consumers: AgUiProjectionConsumerRepository,
  runtime: AgUiSessionRuntime,
  sourceProjectionActive: boolean,
): Promise<boolean> {
  if (!directChatEventsPath(request)) return false
  const id = requestId(request)
  try {
    const admitted = await authorizeUserRequest(request, config, admission, id, AbortSignal.timeout(10_000))
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
    const conversation = await chat.findConversation(
      admitted.context.identity.namespace,
      admitted.context.identity.userId,
      businessPath[1] ?? "",
      authorization.projectRef,
    )
    if (conversation === null) {
      send(response, 404, failure("session_not_found", "Session was not found", id))
      return true
    }
    await consumers.registerConsumer(admitted.context.identity.namespace, businessPath[1] ?? "", conversation.owner_id)
    await liveAgentSession(
      request,
      response,
      config,
      admitted.context,
      businessPath,
      {},
      null,
      new Map(),
      projection,
      runtime,
      sourceProjectionActive,
      authorization,
      chat,
    )
  } catch {
    if (!response.headersSent && !response.writableEnded && !response.destroyed)
      send(response, 503, failure("agui_ledger_unavailable", "The durable AG-UI ledger is unavailable", id))
  }
  return true
}
