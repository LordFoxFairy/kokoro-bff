import type { IncomingMessage, ServerResponse } from "node:http"
import { Code, ConnectError } from "@connectrpc/connect"
import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import type { ChatTurnApplicationService } from "../../application/chat-turn-service.js"
import type { ProjectLookup } from "../../application/projects/project-repository.js"
import type { SkillInstallationConnectClient } from "../../infrastructure/clients/platform/skill-installation-connect.js"
import { authorizeUserRequest } from "../../auth/user-admission.js"
import { failure } from "../../contracts/index.js"
import { validateChatMessageRequest } from "./chat-authorization.js"
import { chatMessageRoute } from "./chat-message.js"
import { pathOf, readBody, requestBodyJson, requestId } from "../request.js"
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
  chatTurns: ChatTurnApplicationService,
  projects: ProjectLookup,
  installations: SkillInstallationConnectClient | null,
): Promise<boolean> {
  if (!chatMessagePath(request)) return false
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
    let body: Buffer
    try {
      body = await readBody(request)
    } catch (error) {
      if (error instanceof Error && error.message === "request body too large") {
        send(response, 413, failure("request_body_too_large", "Request body is too large", id))
        return true
      }
      throw error
    }
    const json = requestBodyJson(request, body)
    if (json === null) {
      send(response, 400, failure("invalid_json", "Request body must be a JSON object", id))
      return true
    }
    const businessPath = pathOf(request).slice(1)
    const authorization = validateChatMessageRequest(request, json)
    if (!authorization.ok) {
      send(response, authorization.status, failure(authorization.code, authorization.message, id))
      return true
    }
    const currentProjectAccess = async (projectRef: string, signal: AbortSignal): Promise<string> => {
      const fresh = await authorizeUserRequest(request, config, admission, id, signal, response)
      if (!fresh.ok) throw new ConnectError("Project admission failed", fresh.status >= 500 ? Code.Unavailable : Code.PermissionDenied)
      if (fresh.context.identity.namespace !== admitted.context.identity.namespace || fresh.context.identity.userId !== admitted.context.identity.userId)
        throw new ConnectError("Project not found", Code.NotFound)
      const project = await projects.find({ tenantId: admitted.context.identity.namespace, subjectId: admitted.context.identity.userId }, projectRef)
      signal.throwIfAborted()
      if (!project) throw new ConnectError("Project not found", Code.NotFound)
      return project.id
    }
    await chatMessageRoute(
      request,
      response,
      config,
      admitted.context,
      businessPath[1] ?? "",
      json,
      authorization.projectRef,
      chatTurns,
      installations,
      currentProjectAccess,
    )
    return true
  } catch {
    if (!response.headersSent && !response.writableEnded && !response.destroyed)
      send(response, 503, failure("chat_unavailable", "Chat message request failed", id))
    return true
  } finally {
    request.removeListener("aborted", onAborted)
    response.removeListener("close", onAborted)
  }
}
