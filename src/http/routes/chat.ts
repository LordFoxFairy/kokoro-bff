import type { IncomingMessage, ServerResponse } from "node:http"

import { failure, ok } from "../../contracts/index.js"
import type { IdempotencyEntry, MutationTicket } from "../../application/idempotency.js"
import type { RequestContext } from "../../domain/request-context.js"
import { queryOf } from "../request.js"
import { reply, send } from "../response.js"
import type { AuthorizedChatRequest } from "./chat-authorization.js"
import { processReadError } from "./agui-process.js"
import { parseChatMessagePartsInput } from "../chat-message-parts-input.js"
import type { ChatSessionReads } from "../../application/chat/session-reads.js"
import type { ChatSessionMutations } from "../../infrastructure/postgres/chat-session-store.js"
import type { PrivateMessageReadContext, MessageReadLifetime } from "../../application/chat/types.js"

function pageInput(request: IncomingMessage, defaultLimit: number): { limit: number; cursor: string | null } | null {
  const query = queryOf(request)
  const rawLimit = query.get("limit")
  const limit = rawLimit === null || rawLimit === "" ? defaultLimit : Number(rawLimit)
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) return null
  const rawCursor = query.get("cursor")?.trim()
  return { limit, cursor: rawCursor === undefined || rawCursor === "" ? null : rawCursor }
}

function isInvalidCursor(error: unknown): boolean {
  return error instanceof Error && error.message === "CHAT_CURSOR_INVALID"
}

function chatError(error: unknown): { status: number; code: string; message: string } | null {
  if (!(error instanceof Error)) return null
  const parts: Record<string, { status: number; code: string; message: string }> = {
    MESSAGE_PARTS_CURSOR_INVALID: { status: 400, code: "invalid_cursor", message: "Message parts cursor is invalid" },
    MESSAGE_PARTS_SCOPE_INVALID: { status: 400, code: "invalid_scope", message: "Direct scope cannot be combined with a Project" },
    MESSAGE_PARTS_CHANGED: { status: 409, code: "message_parts_changed", message: "Message parts changed; explicitly reread the current version" },
    MESSAGE_PARTS_GONE: { status: 410, code: "message_parts_gone", message: "Retained Message ordering evidence has expired" },
    MESSAGE_PARTS_UNAVAILABLE: { status: 503, code: "message_parts_unavailable", message: "Message parts are temporarily unavailable" },
    MESSAGE_PARTS_BUDGET_EXCEEDED: { status: 503, code: "message_parts_budget_exceeded", message: "Message parts exceed the bounded response budget" },
  }
  if (parts[error.message]) return parts[error.message] ?? null
  return null
}

async function privateMessageRead<T>(
  request: IncomingMessage,
  response: ServerResponse,
  projectRef: string | undefined,
  read: (context: PrivateMessageReadContext) => Promise<T>,
  lifetime?: MessageReadLifetime,
): Promise<T> {
  const scope = queryOf(request).get("scope")?.trim() === "direct" ? "direct" : "all"
  if (scope === "direct" && projectRef !== undefined) throw new Error("MESSAGE_PARTS_SCOPE_INVALID")
  const controller = new AbortController()
  const stop = () => {
    if (!response.writableEnded) controller.abort()
  }
  request.once?.("aborted", stop)
  response.once?.("close", stop)
  if (request.aborted || response.destroyed) controller.abort()
  try {
    return await read({ signal: lifetime?.signal ?? controller.signal, deadlineAt: lifetime?.deadlineAt ?? performance.now() + 10000, scope })
  } finally {
    request.removeListener?.("aborted", stop)
    response.removeListener?.("close", stop)
  }
}

function chatFailure(error: unknown, context: RequestContext) {
  const process = processReadError(error)
  const invalidCursor = isInvalidCursor(error)
  const known = chatError(error)
  return {
    status: process?.status ?? (invalidCursor ? 400 : (known?.status ?? 503)),
    body: failure(
      process?.code ?? (invalidCursor ? "invalid_cursor" : (known?.code ?? "business_store_unavailable")),
      process?.message ?? (invalidCursor ? "cursor is invalid" : (known?.message ?? "The BFF business store is unavailable")),
      context.requestId,
    ),
  }
}

export async function readChatBusiness(
  request: IncomingMessage,
  response: ServerResponse,
  context: RequestContext,
  businessPath: string[],
  reads: ChatSessionReads,
  authorization: AuthorizedChatRequest,
  lifetime?: MessageReadLifetime,
): Promise<boolean> {
  if (businessPath[0] !== "sessions") return false
  response.setHeader("x-request-id", context.requestId)
  const method = request.method || "GET"
  const tenantId = context.identity.namespace
  const subjectId = context.identity.userId
  const conversationId = businessPath[1] || ""
  const projectRef = authorization.projectRef

  try {
    if (businessPath.length === 3 && businessPath[2] === "share" && method === "GET") {
      const metadata = await privateMessageRead(
        request,
        response,
        projectRef,
        (readLifetime) => reads.readShareMetadata({ ...readLifetime, tenantId, subjectId, conversationId, projectRef }),
        lifetime,
      )
      if (request.aborted || response.destroyed || response.writableEnded) return true
      lifetime?.signal.throwIfAborted()
      send(
        response,
        metadata === null ? 404 : 200,
        metadata === null ? failure("session_not_found", "Session was not found", context.requestId) : ok(metadata, context.requestId),
      )
      return true
    }
    if (businessPath.length === 5 && businessPath[2] === "messages" && businessPath[4] === "parts" && method === "GET") {
      const input = parseChatMessagePartsInput(request)
      if (!input.ok) {
        send(response, 400, failure(input.code, "Message parts query is invalid", context.requestId))
        return true
      }
      const page = await privateMessageRead(request, response, projectRef, (lifetime) =>
        reads.readMessageParts({
          ...lifetime,
          tenantId,
          subjectId,
          conversationId,
          messageId: businessPath[3] ?? "",
          projectRef,
          scope: input.scope,
          cursor: input.cursor,
          limit: input.limit,
        }),
      )
      if (page === null) send(response, 404, failure("message_not_found", "Owned Message was not found", context.requestId))
      else {
        const body = ok(page, context.requestId)
        if (Buffer.byteLength(JSON.stringify(body)) > 1048576) throw new Error("MESSAGE_PARTS_BUDGET_EXCEEDED")
        send(response, 200, body)
      }
      return true
    }
    if (businessPath.length === 1 && method === "GET") {
      const page = pageInput(request, 20)
      if (page === null) {
        send(response, 400, failure("invalid_pagination", "limit must be between 1 and 100", context.requestId))
        return true
      }
      if (authorization.collectionFilter === undefined) throw new Error("CHAT_COLLECTION_FILTER_MISSING")
      send(response, 200, ok(await reads.listConversations(tenantId, subjectId, authorization.collectionFilter, page.limit, page.cursor), context.requestId))
      return true
    }

    if (businessPath.length === 2 && method === "GET") {
      const snapshot = await privateMessageRead(request, response, projectRef, (lifetime) =>
        reads.snapshot(tenantId, subjectId, conversationId, projectRef, lifetime),
      )
      if (snapshot === null) {
        send(response, 404, failure("session_not_found", "Session was not found", context.requestId))
        return true
      }
      send(response, 200, ok(snapshot, context.requestId))
      return true
    }

    if (businessPath.length === 3 && businessPath[2] === "messages" && method === "GET") {
      const page = pageInput(request, 20)
      if (page === null) {
        send(response, 400, failure("invalid_pagination", "limit must be between 1 and 100", context.requestId))
        return true
      }
      const result = await privateMessageRead(request, response, projectRef, (lifetime) =>
        reads.listMessages(tenantId, subjectId, conversationId, page.limit, page.cursor, projectRef, lifetime),
      )
      if (result === null) {
        send(response, 404, failure("session_not_found", "Session was not found", context.requestId))
      } else {
        send(response, 200, ok(result, context.requestId))
      }
      return true
    }
  } catch (error) {
    if (request.aborted || response.destroyed || response.writableEnded) return true
    const { status, body } = chatFailure(error, context)
    send(response, status, body)
    return true
  }
  return false
}

export async function writeChatBusiness(
  request: IncomingMessage,
  response: ServerResponse,
  context: RequestContext,
  businessPath: string[],
  json: Record<string, unknown>,
  mutation: MutationTicket | null,
  idempotency: Map<string, IdempotencyEntry>,
  mutations: ChatSessionMutations,
  authorization: AuthorizedChatRequest,
): Promise<boolean> {
  if (businessPath[0] !== "sessions") return false
  const method = request.method || "GET"
  const tenantId = context.identity.namespace
  const subjectId = context.identity.userId
  const conversationId = businessPath[1] || ""
  const projectRef = authorization.projectRef

  try {
    if (businessPath.length === 3 && businessPath[2] === "title" && method === "PATCH") {
      if (typeof json.title !== "string" || json.title.trim() === "") {
        await reply(response, 400, failure("invalid_title", "Title is required", context.requestId), context, idempotency, mutation)
        return true
      }
      const conversation = await mutations.renameConversation(tenantId, subjectId, conversationId, json.title.trim(), projectRef)
      await reply(
        response,
        conversation === null ? 404 : 200,
        conversation === null ? failure("session_not_found", "Session was not found", context.requestId) : ok({ ok: true }, context.requestId),
        context,
        idempotency,
        mutation,
      )
      return true
    }

    if (businessPath.length === 2 && method === "DELETE") {
      const deleted = await mutations.deleteConversation(tenantId, subjectId, conversationId, context.requestId, projectRef)
      await reply(
        response,
        deleted ? 200 : 404,
        deleted ? ok({ status: "deleted" }, context.requestId) : failure("session_not_found", "Session was not found", context.requestId),
        context,
        idempotency,
        mutation,
      )
      return true
    }

    if (businessPath.length === 3 && businessPath[2] === "share" && method === "POST") {
      const share = await mutations.createShare(tenantId, subjectId, conversationId, projectRef)
      await reply(
        response,
        share === null ? 404 : 200,
        share === null ? failure("session_not_found", "Session was not found", context.requestId) : ok({ share_id: share.shareId }, context.requestId),
        context,
        idempotency,
        mutation,
      )
      return true
    }

    if (businessPath.length === 3 && businessPath[2] === "share" && method === "DELETE") {
      const share = await mutations.revokeShare(tenantId, subjectId, conversationId, projectRef)
      await reply(
        response,
        share === null ? 404 : 200,
        share === null ? failure("share_not_found", "Share was not found", context.requestId) : ok({ share_id: share.shareId }, context.requestId),
        context,
        idempotency,
        mutation,
      )
      return true
    }
  } catch (error) {
    const { status, body } = chatFailure(error, context)
    await reply(response, status, body, context, idempotency, mutation)
    return true
  }
  return false
}
