import type { IncomingMessage, ServerResponse } from "node:http"
import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import type { ChatSessionMutations } from "../../infrastructure/postgres/chat-session-store.js"
import type { ChatConversationLookup } from "../../infrastructure/postgres/chat-conversation-lookup.js"
import type { ProjectLookup } from "../../application/projects/project-repository.js"
import type { IdempotencyEntry } from "../../application/idempotency.js"
import { mutationTicket } from "../../application/idempotency.js"
import type { IdempotencyRepository } from "../../application/ports/idempotency-repository.js"
import { failure } from "../../contracts/index.js"
import { authorizeUserRequest } from "../../auth/user-admission.js"
import { authorizeChatRequest } from "./chat-authorization.js"
import { writeChatBusiness } from "./chat.js"
import { idempotencyKey, mutationFingerprint, pathOf, readBody, requestBodyJson, requestId, requiresIdempotency } from "../request.js"
import { send } from "../response.js"

function chatMutationPath(request: IncomingMessage): boolean {
  const path = pathOf(request)
  if (path[0] !== "v1" || path[1] !== "sessions" || path.length !== 4) return false
  return (
    (path[3] === "title" && request.method === "PATCH") ||
    (path[3] === "share" && ["POST", "DELETE"].includes(request.method ?? "")) ||
    (path[3] === undefined && request.method === "DELETE")
  )
}

export function isChatMutationRequest(request: IncomingMessage): boolean {
  try {
    const path = pathOf(request)
    if (path[0] !== "v1" || path[1] !== "sessions") return false
    if (path.length === 3 && request.method === "DELETE") return true
    return chatMutationPath(request)
  } catch {
    return false
  }
}

function mutationRoute(request: IncomingMessage): string {
  return `/${pathOf(request).slice(1).join("/")}`
}

/** Direct Chat title/delete/share mutations owned by ChatModule; project-scoped variants remain transitional. */
export async function handleChatMutationRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  admission: SessionAdmission,
  mutations: ChatSessionMutations,
  findConversation: ChatConversationLookup,
  projects: ProjectLookup,
  idempotency: Map<string, IdempotencyEntry>,
  persistent: IdempotencyRepository | null,
): Promise<boolean> {
  if (!isChatMutationRequest(request)) return false
  const id = requestId(request)
  response.setHeader("x-request-id", id)
  const abort = new AbortController()
  const onAborted = (): void => abort.abort()
  request.once("aborted", onAborted)
  response.once("close", onAborted)
  try {
    const admitted = await authorizeUserRequest(request, config, admission, id, abort.signal, response)
    if (!admitted.ok) {
      send(response, admitted.status, failure(admitted.code, "BFF user admission failed", id), admitted.retryAfter)
      return true
    }
    const body = request.method === "DELETE" ? Buffer.alloc(0) : await readBody(request)
    const json = requestBodyJson(request, body)
    if (json === null) {
      send(response, 400, failure("invalid_json", "Request body must be a JSON object", id))
      return true
    }
    const businessPath = pathOf(request).slice(1)
    const authorization = await authorizeChatRequest(request, admitted.context, businessPath, findConversation, projects)
    if (authorization === null) return false
    if (!authorization.ok) {
      send(response, authorization.status, failure(authorization.code, authorization.message, id))
      return true
    }
    const key = idempotencyKey(request)
    if (requiresIdempotency(request.method ?? "GET", businessPath) && key === null) {
      send(response, 400, failure("idempotency_key_required", "Mutations require Idempotency-Key", id))
      return true
    }
    const ticket = await mutationTicket(
      key,
      request.method ?? "GET",
      mutationRoute(request),
      admitted.context,
      mutationFingerprint(request, businessPath, json, body),
      idempotency,
      persistent ?? undefined,
    )
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
    const handled = await writeChatBusiness(request, response, admitted.context, businessPath, json, ticket.ticket, idempotency, mutations, authorization)
    return handled
  } catch {
    if (!response.headersSent && !response.writableEnded && !response.destroyed)
      send(response, 503, failure("chat_unavailable", "Chat mutation request failed", id))
    return true
  } finally {
    request.removeListener("aborted", onAborted)
    response.removeListener("close", onAborted)
  }
}
