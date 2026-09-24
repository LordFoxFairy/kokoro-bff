import type { IncomingMessage } from "node:http"

import { parseMessageCreateRequest } from "../../application/chat/message-create-input.js"
import type { BffBusinessStore } from "../../application/ports/bff-business-store.js"
import type { RequestContext } from "../../domain/request-context.js"
import { isClientCreatedConversationId } from "../../domain/chat/conversation.js"
import { queryOf } from "../request.js"

export type ChatAuthorization =
  | Readonly<{ ok: true; projectRef?: string }>
  | Readonly<{ ok: false; status: 400 | 404; code: "invalid_scope" | "invalid_message" | "project_not_found" | "session_not_found"; message: string }>

export type AuthorizedChatRequest = Extract<ChatAuthorization, { ok: true }>

function privateChatProjectRef(request: IncomingMessage): ChatAuthorization {
  const query = queryOf(request)
  const scopeValues = query.getAll("scope")
  if (scopeValues.length > 1) {
    return { ok: false, status: 400, code: "invalid_scope", message: "scope must be omitted, empty, or direct" }
  }
  const scope = scopeValues[0]?.trim()
  if (scope !== undefined && scope !== "" && scope !== "direct") {
    return { ok: false, status: 400, code: "invalid_scope", message: "scope must be omitted, empty, or direct" }
  }
  const projectValues = query.getAll("project_ref")
  if (projectValues.length > 1) {
    return { ok: false, status: 400, code: "invalid_message", message: "project_ref must be provided at most once" }
  }
  const projectRef = projectValues[0]?.trim()
  return projectRef === undefined || projectRef === "" ? { ok: true } : { ok: true, projectRef }
}

/** Authorize a private Chat resource before generic mutation receipt admission or Agent I/O. */
export async function authorizeChatRequest(
  request: IncomingMessage,
  context: RequestContext,
  businessPath: readonly string[],
  json: Readonly<Record<string, unknown>>,
  store: BffBusinessStore,
): Promise<ChatAuthorization | null> {
  if (businessPath[0] !== "sessions") return null
  const queryScope = privateChatProjectRef(request)
  if (!queryScope.ok) return queryScope

  let projectRef = queryScope.projectRef
  if (request.method === "POST" && businessPath.length === 3 && businessPath[2] === "messages") {
    const message = parseMessageCreateRequest({ ...json }, projectRef)
    if (message === null) {
      return { ok: false, status: 400, code: "invalid_message", message: "Message request does not match the v1 contract" }
    }
    projectRef = message.projectRef
  }

  const ownerScope = { tenantId: context.identity.namespace, subjectId: context.identity.userId }
  if (projectRef !== undefined && await store.services.projects.find(ownerScope, projectRef) === null) {
    return { ok: false, status: 404, code: "project_not_found", message: "Project was not found" }
  }

  if (businessPath.length >= 2) {
    const conversationId = businessPath[1]
    const firstMessageCandidate = request.method === "POST"
      && businessPath.length === 3
      && businessPath[2] === "messages"
      && conversationId !== undefined
      && isClientCreatedConversationId(conversationId)
    if (
      conversationId === undefined
      || conversationId === ""
      || (await store.services.chat.findConversation(ownerScope.tenantId, ownerScope.subjectId, conversationId, projectRef) === null
        && !firstMessageCandidate)
    ) {
      return { ok: false, status: 404, code: "session_not_found", message: "Session was not found" }
    }
  }
  return projectRef === undefined ? { ok: true } : { ok: true, projectRef }
}
