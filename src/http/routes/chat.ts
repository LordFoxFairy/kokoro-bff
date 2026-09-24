import type { IncomingMessage, ServerResponse } from "node:http"

import type { BffConfig } from "../../config/runtime.js"
import { failure, ok } from "../../contracts/index.js"
import type { BffBusinessStore } from "../../application/ports/bff-business-store.js"
import type { IdempotencyEntry, MutationTicket } from "../../application/idempotency.js"
import type { RequestContext } from "../../domain/request-context.js"
import { idempotencyKey, queryOf } from "../request.js"
import { reply } from "../response.js"
import { parseMessageCreateRequest } from "../../application/chat/message-create-input.js"
import type { AuthorizedChatRequest } from "./chat-authorization.js"

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
  if (error.message === "CHAT_TURN_IDEMPOTENCY_CONFLICT") {
    return { status: 409, code: "idempotency_conflict", message: "Idempotency key was already used with different Chat input" }
  }
  if (
    error.message === "CHAT_TURN_INPUT_INVALID"
    || error.message === "AGENT_DISPATCH_PAYLOAD_INVALID"
    || error.message === "AGENT_DISPATCH_LINEAGE_MISMATCH"
  ) {
    return { status: 400, code: "invalid_message", message: "Chat message input is invalid" }
  }
  return null
}

async function sendChatError(
  response: ServerResponse,
  error: unknown,
  context: RequestContext,
  idempotency: Map<string, IdempotencyEntry>,
  mutation: MutationTicket | null,
): Promise<void> {
  const invalidCursor = isInvalidCursor(error)
  const known = chatError(error)
  await reply(
    response,
    invalidCursor ? 400 : known?.status ?? 503,
    failure(
      invalidCursor ? "invalid_cursor" : known?.code ?? "business_store_unavailable",
      invalidCursor ? "cursor is invalid" : known?.message ?? "The BFF business store is unavailable",
      context.requestId,
    ),
    context,
    idempotency,
    mutation,
  )
}

export async function liveChatBusiness(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  context: RequestContext,
  businessPath: string[],
  json: Record<string, unknown>,
  mutation: MutationTicket | null,
  idempotency: Map<string, IdempotencyEntry>,
  store: BffBusinessStore,
  authorization: AuthorizedChatRequest,
): Promise<boolean> {
  if (businessPath[0] !== "sessions") return false
  const method = request.method || "GET"
  const tenantId = context.identity.namespace
  const subjectId = context.identity.userId
  const conversationId = businessPath[1] || ""
  const projectRef = authorization.projectRef
  const chat = store.services.chat

  try {
    if (businessPath.length === 3 && businessPath[2] === "events" && method === "GET") {
      const conversation = await chat.findConversation(tenantId, subjectId, conversationId, projectRef)
      if (conversation === null) {
        await reply(response, 404, failure("session_not_found", "Session was not found", context.requestId), context, idempotency, mutation)
        return true
      }
      if (store.agUiConsumers === undefined) {
        await reply(response, 503, failure("agui_projector_not_configured", "The durable AG-UI projector is not configured", context.requestId), context, idempotency, mutation)
        return true
      }
      await store.agUiConsumers.registerConsumer(tenantId, conversationId, conversation.owner_id)
      return false
    }

    if (businessPath.length === 1 && method === "GET") {
      const page = pageInput(request, 20)
      if (page === null) {
        await reply(response, 400, failure("invalid_pagination", "limit must be between 1 and 100", context.requestId), context, idempotency, mutation)
        return true
      }
      await reply(response, 200, ok(await chat.listConversations(tenantId, subjectId, projectRef, page.limit, page.cursor), context.requestId), context, idempotency, mutation)
      return true
    }

    if (businessPath.length === 2 && method === "GET") {
      const snapshot = await chat.snapshot(tenantId, subjectId, conversationId, projectRef)
      if (snapshot === null) {
        await reply(response, 404, failure("session_not_found", "Session was not found", context.requestId), context, idempotency, mutation)
        return true
      }
      await reply(response, 200, ok(snapshot, context.requestId), context, idempotency, mutation)
      return true
    }

    if (businessPath.length === 3 && businessPath[2] === "messages" && method === "GET") {
      const page = pageInput(request, 20)
      if (page === null) {
        await reply(response, 400, failure("invalid_pagination", "limit must be between 1 and 100", context.requestId), context, idempotency, mutation)
        return true
      }
      const result = await chat.listMessages(tenantId, subjectId, conversationId, page.limit, page.cursor, projectRef)
      if (result === null) {
        await reply(response, 404, failure("session_not_found", "Session was not found", context.requestId), context, idempotency, mutation)
      } else {
        await reply(response, 200, ok(result, context.requestId), context, idempotency, mutation)
      }
      return true
    }

    if (businessPath.length === 3 && businessPath[2] === "messages" && method === "POST") {
      const input = parseMessageCreateRequest(json, projectRef)
      if (input === null) {
        await reply(response, 400, failure("invalid_message", "Message request does not match the v1 contract", context.requestId), context, idempotency, mutation)
        return true
      }
      const key = idempotencyKey(request)
      if (key === null) {
        await reply(response, 400, failure("idempotency_key_required", "Mutations require Idempotency-Key", context.requestId), context, idempotency, mutation)
        return true
      }
      const agentBase = config.upstreams.agents ?? null
      if (!config.agentEnabled || agentBase === null) {
        await reply(response, 503, failure("agent_not_configured", "Agent execution is disabled or not configured", context.requestId), context, idempotency, mutation)
        return true
      }
      const receipt = await store.services.chatTurns.submit({
        tenantId,
        conversationId,
        ...input,
        subjectId,
        actorId: subjectId,
        requestId: context.requestId,
        idempotencyKey: key,
      })
      if (receipt === null) {
        await reply(response, 404, failure("session_not_found", "Session was not found", context.requestId), context, idempotency, mutation)
        return true
      }
      await reply(response, 202, ok(receipt, context.requestId), context, idempotency, mutation)
      return true
    }

    if (businessPath.length === 3 && businessPath[2] === "title" && method === "PATCH") {
      if (typeof json.title !== "string" || json.title.trim() === "") {
        await reply(response, 400, failure("invalid_title", "Title is required", context.requestId), context, idempotency, mutation)
        return true
      }
      const conversation = await chat.renameConversation(tenantId, subjectId, conversationId, json.title.trim(), projectRef)
      await reply(response, conversation === null ? 404 : 200, conversation === null ? failure("session_not_found", "Session was not found", context.requestId) : ok({ ok: true }, context.requestId), context, idempotency, mutation)
      return true
    }

    if (businessPath.length === 2 && method === "DELETE") {
      const deleted = await chat.deleteConversation(
        tenantId,
        subjectId,
        conversationId,
        context.requestId,
        projectRef,
      )
      await reply(response, deleted ? 200 : 404, deleted ? ok({ status: "deleted" }, context.requestId) : failure("session_not_found", "Session was not found", context.requestId), context, idempotency, mutation)
      return true
    }

    if (businessPath.length === 3 && businessPath[2] === "share" && method === "POST") {
      const share = await chat.createShare(tenantId, subjectId, conversationId, projectRef)
      await reply(response, share === null ? 404 : 200, share === null ? failure("session_not_found", "Session was not found", context.requestId) : ok({ share_id: share.shareId }, context.requestId), context, idempotency, mutation)
      return true
    }

    if (businessPath.length === 3 && businessPath[2] === "share" && method === "DELETE") {
      const share = await chat.revokeShare(tenantId, subjectId, conversationId, projectRef)
      await reply(response, share === null ? 404 : 200, share === null ? failure("share_not_found", "Share was not found", context.requestId) : ok({ share_id: share.shareId }, context.requestId), context, idempotency, mutation)
      return true
    }
  } catch (error) {
    await sendChatError(response, error, context, idempotency, mutation)
    return true
  }
  return false
}
