import type { IncomingMessage, ServerResponse } from "node:http"
import { Code, ConnectError } from "@connectrpc/connect"
import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import type { ChatApplicationService } from "../../application/chat-service.js"
import type { ChatTurnApplicationService } from "../../application/chat-turn-service.js"
import type { ProjectService } from "../../application/project-service.js"
import type { SkillInstallationConnectClient } from "../../infrastructure/clients/platform/skill-installation-connect.js"
import type { IdempotencyEntry } from "../../application/idempotency.js"
import type { IdempotencyRepository } from "../../application/ports/idempotency-repository.js"
import { authorizeUserRequest } from "../../auth/user-admission.js"
import { failure } from "../../contracts/index.js"
import { mutationTicket } from "../../application/idempotency.js"
import { authorizeChatRequest } from "./chat-authorization.js"
import { liveChatBusiness } from "./chat.js"
import type { ChatBusinessProvider } from "./chat-business-provider.js"
import { idempotencyKey, mutationFingerprint, pathOf, readBody, requestBodyJson, requestId } from "../request.js"
import { send } from "../response.js"

function chatMessagePath(request: IncomingMessage): boolean {
  try {
    const path = pathOf(request)
    return request.method === "POST" && path[0] === "v1" && path[1] === "sessions" && path.length === 4 && path[3] === "messages"
  } catch {
    return false
  }
}

export function isChatMessageNativeRequest(request: IncomingMessage): boolean {
  return chatMessagePath(request)
}

/** Chat message submission with the canonical Agent outbox and Project/Skill owner rechecks. */
export async function handleChatMessageRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  admission: SessionAdmission,
  chat: ChatApplicationService,
  chatTurns: ChatTurnApplicationService,
  projects: ProjectService,
  installations: SkillInstallationConnectClient | null,
  idempotency: Map<string, IdempotencyEntry>,
  persistent: IdempotencyRepository | null,
): Promise<boolean> {
  if (!chatMessagePath(request)) return false
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
    const provider: ChatBusinessProvider = { chatService: chat, chatTurnService: chatTurns, projectService: projects }
    const authorization = await authorizeChatRequest(request, admitted.context, businessPath, json, provider)
    if (authorization === null) return false
    if (!authorization.ok) {
      send(response, authorization.status, failure(authorization.code, authorization.message, id))
      return true
    }
    const key = idempotencyKey(request)
    if (key === null) {
      send(response, 400, failure("idempotency_key_required", "Mutations require Idempotency-Key", id))
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
    const currentProjectAccess = async (projectRef: string, signal: AbortSignal): Promise<string> => {
      const fresh = await authorizeUserRequest(request, config, admission, id, signal)
      if (!fresh.ok) throw new ConnectError("Project admission failed", fresh.status >= 500 ? Code.Unavailable : Code.PermissionDenied)
      if (fresh.context.identity.namespace !== admitted.context.identity.namespace || fresh.context.identity.userId !== admitted.context.identity.userId)
        throw new ConnectError("Project not found", Code.NotFound)
      const project = await projects.find({ tenantId: admitted.context.identity.namespace, subjectId: admitted.context.identity.userId }, projectRef)
      signal.throwIfAborted()
      if (!project) throw new ConnectError("Project not found", Code.NotFound)
      return project.id
    }
    const handled = await liveChatBusiness(request, response, config, admitted.context, businessPath, json, ticket.ticket, idempotency, provider, authorization, installations, currentProjectAccess)
    return handled
  } catch {
    if (!response.headersSent && !response.writableEnded && !response.destroyed) send(response, 503, failure("chat_unavailable", "Chat message request failed", id))
    return true
  } finally {
    request.removeListener("aborted", onAborted)
    response.removeListener("close", onAborted)
  }
}
