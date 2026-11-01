import type { IncomingMessage, ServerResponse } from "node:http"
import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import type { ChatApplicationService } from "../../application/chat-service.js"
import type { ProjectService } from "../../application/project-service.js"
import type { AgUiSessionRuntime } from "../../application/agui/session-runtime.js"
import type { IdempotencyEntry } from "../../application/idempotency.js"
import type { IdempotencyRepository } from "../../application/ports/idempotency-repository.js"
import { authorizeUserRequest } from "../../auth/user-admission.js"
import { failure } from "../../contracts/index.js"
import { mutationTicket } from "../../application/idempotency.js"
import { authorizeChatRequest } from "./chat-authorization.js"
import { liveAgentSession } from "./agent.js"
import type { ChatBusinessProvider } from "./chat-business-provider.js"
import { idempotencyKey, mutationFingerprint, pathOf, readBody, requestBodyJson, requestId } from "../request.js"
import { send } from "../response.js"

function agentControlPath(request: IncomingMessage): boolean {
  try {
    const path = pathOf(request)
    return request.method === "POST" && path[0] === "v1" && path[1] === "sessions" && path[3] === "runs" && path.length === 6 && path[5] === "control"
  } catch {
    return false
  }
}

export function isAgentControlNativeRequest(request: IncomingMessage): boolean {
  return agentControlPath(request)
}

/** AgentRuns-owned Chat run control with Chat/Project owner rechecks and durable idempotency. */
export async function handleAgentControlRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  admission: SessionAdmission,
  chat: ChatApplicationService,
  projects: ProjectService,
  runtime: AgUiSessionRuntime,
  idempotency: Map<string, IdempotencyEntry>,
  persistent: IdempotencyRepository | null,
): Promise<boolean> {
  if (!agentControlPath(request)) return false
  const id = requestId(request)
  const abort = new AbortController()
  const onAborted = (): void => abort.abort()
  request.once("aborted", onAborted)
  response.once("close", onAborted)
  try {
    const admitted = await authorizeUserRequest(request, config, admission, id, abort.signal)
    if (!admitted.ok) {
      send(response, admitted.status, failure(admitted.code, "BFF user admission failed", id), admitted.retryAfter)
      return true
    }
    const body = await readBody(request)
    const json = requestBodyJson(request, body)
    if (json === null) {
      send(response, 400, failure("invalid_json", "Request body must be a JSON object", id))
      return true
    }
    const businessPath = pathOf(request).slice(1)
    const provider: ChatBusinessProvider = { chatService: chat, projectService: projects }
    const authorization = await authorizeChatRequest(request, admitted.context, businessPath, json, provider)
    if (authorization === null) return false
    if (!authorization.ok) {
      send(response, authorization.status, failure(authorization.code, authorization.message, id))
      return true
    }
    const key = idempotencyKey(request)
    if (key === null) {
      send(response, 400, failure("idempotency_key_required", "Control requests require Idempotency-Key", id))
      return true
    }
    const ticket = await mutationTicket(key, "POST", `/${businessPath.join("/")}`, admitted.context, mutationFingerprint(request, businessPath, json, body), idempotency, persistent ?? undefined)
    if (ticket.replay !== null) {
      send(response, ticket.replay.status, ticket.replay.body)
      return true
    }
    if (ticket.conflict) {
      send(response, 409, failure("idempotency_conflict", "Idempotency key already used with a different request payload", id))
      return true
    }
    if (ticket.pending) {
      send(response, 409, failure("idempotency_in_progress", "An identical mutation is already in progress", id))
      return true
    }
    await liveAgentSession(request, response, config, admitted.context, businessPath, json, ticket.ticket, idempotency, null, runtime, false, authorization, chat)
    return true
  } catch {
    if (!response.headersSent && !response.writableEnded && !response.destroyed) send(response, 503, failure("agent_control_unavailable", "Agent control request failed", id))
    return true
  } finally {
    request.removeListener("aborted", onAborted)
    response.removeListener("close", onAborted)
  }
}
