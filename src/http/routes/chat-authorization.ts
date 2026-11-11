import type { IncomingMessage } from "node:http"

import { parseMessageCreateRequest } from "../../application/chat/message-create-input.js"
import type { ConversationCollectionFilter } from "../../application/chat/types.js"
import type { RequestContext } from "../../domain/request-context.js"
import { queryOf } from "../request.js"
import type { ChatConversationLookup } from "../../infrastructure/postgres/chat-conversation-lookup.js"
import type { ProjectLookup } from "../../application/projects/types.js"

export type ChatAuthorization =
  | Readonly<{ ok: true; projectRef?: string; collectionFilter?: ConversationCollectionFilter }>
  | Readonly<{ ok: false; status: 400 | 404; code: "invalid_scope" | "invalid_message" | "project_not_found" | "session_not_found"; message: string }>

export type AuthorizedChatRequest = Extract<ChatAuthorization, { ok: true }>

type PrivateChatQuery = Readonly<{ ok: true; scope: "all" | "direct"; projectRef?: string }> | Extract<ChatAuthorization, { ok: false }>

function privateChatQuery(request: IncomingMessage): PrivateChatQuery {
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
  const scopeKind = scope === "direct" ? "direct" : "all"
  return projectRef === undefined || projectRef === "" ? { ok: true, scope: scopeKind } : { ok: true, scope: scopeKind, projectRef }
}

/** Validate the command syntax only: locked ChatTurn admission owns current scope and canonical replay. */
export function validateChatMessageRequest(request: IncomingMessage, json: Record<string, unknown>): ChatAuthorization {
  const queryScope = privateChatQuery(request)
  if (!queryScope.ok) return queryScope
  const message = parseMessageCreateRequest(json, queryScope.projectRef)
  if (message === null) return { ok: false, status: 400, code: "invalid_message", message: "Message request does not match the v1 contract" }
  // An early Project lookup here would wrongly reject a canonical replay after a successful Move.
  return message.projectRef === undefined ? { ok: true } : { ok: true, projectRef: message.projectRef }
}

/** Authorize a private Chat resource before generic mutation receipt admission or Agent I/O. */
export async function authorizeChatRequest(
  request: IncomingMessage,
  context: RequestContext,
  businessPath: readonly string[],
  findConversation: ChatConversationLookup,
  projects: ProjectLookup,
  signal?: AbortSignal,
): Promise<ChatAuthorization | null> {
  signal?.throwIfAborted()
  if (businessPath[0] !== "sessions") return null
  const queryScope = privateChatQuery(request)
  if (!queryScope.ok) return queryScope

  const projectRef = queryScope.projectRef
  const isConversationCollection = request.method === "GET" && businessPath.length === 1
  if (isConversationCollection && queryScope.scope === "direct" && projectRef !== undefined) {
    return { ok: false, status: 400, code: "invalid_scope", message: "scope=direct cannot be combined with project_ref" }
  }
  const ownerScope = { tenantId: context.identity.namespace, subjectId: context.identity.userId }
  if (projectRef !== undefined) {
    signal?.throwIfAborted()
    const project = await projects.find(ownerScope, projectRef)
    signal?.throwIfAborted()
    if (project === null) return { ok: false, status: 404, code: "project_not_found", message: "Project was not found" }
  }

  if (isConversationCollection) {
    const collectionFilter: ConversationCollectionFilter = projectRef === undefined ? { kind: queryScope.scope } : { kind: "project", projectRef }
    return projectRef === undefined ? { ok: true, collectionFilter } : { ok: true, projectRef, collectionFilter }
  }

  if (businessPath.length >= 2) {
    const conversationId = businessPath[1]
    let currentConversation = null
    if (conversationId !== undefined && conversationId !== "") {
      signal?.throwIfAborted()
      currentConversation = await findConversation(ownerScope.tenantId, ownerScope.subjectId, conversationId, projectRef)
      signal?.throwIfAborted()
    }
    if (conversationId === undefined || conversationId === "" || currentConversation === null) {
      return { ok: false, status: 404, code: "session_not_found", message: "Session was not found" }
    }
  }
  return projectRef === undefined ? { ok: true } : { ok: true, projectRef }
}
