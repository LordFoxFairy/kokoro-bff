import type { IncomingMessage, ServerResponse } from "node:http"

import type { BffConfig } from "../../config/runtime.js"
import { failure, ok } from "../../contracts/index.js"
import type { BffBusinessStore } from "../../application/ports/bff-business-store.js"
import type { IdempotencyEntry, MutationTicket } from "../../application/idempotency.js"
import type { RequestContext } from "../../domain/request-context.js"
import { idempotencyKey, queryOf } from "../request.js"
import { reply } from "../response.js"
import { buildAgentLaunch } from "../../infrastructure/clients/agent/launch.js"
import { callAgent } from "./agent.js"

function projectRef(request: IncomingMessage): string | undefined {
  const value = queryOf(request).get("project_ref")?.trim()
  return value === undefined || value === "" ? undefined : value
}

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

async function sendChatError(
  response: ServerResponse,
  error: unknown,
  context: RequestContext,
  idempotency: Map<string, IdempotencyEntry>,
  mutation: MutationTicket | null,
): Promise<void> {
  const invalidCursor = isInvalidCursor(error)
  await reply(
    response,
    invalidCursor ? 400 : 503,
    failure(invalidCursor ? "invalid_cursor" : "business_store_unavailable", invalidCursor ? "cursor is invalid" : "The BFF business store is unavailable", context.requestId),
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
): Promise<boolean> {
  if (businessPath[0] !== "sessions") return false
  const method = request.method || "GET"
  const tenantId = context.identity.namespace
  const conversationId = businessPath[1] || ""
  const chat = store.services.chat

  try {
    if (businessPath.length === 1 && method === "GET") {
      const page = pageInput(request, 20)
      if (page === null) {
        await reply(response, 400, failure("invalid_pagination", "limit must be between 1 and 100", context.requestId), context, idempotency, mutation)
        return true
      }
      await reply(response, 200, ok(await chat.listConversations(tenantId, projectRef(request), page.limit, page.cursor), context.requestId), context, idempotency, mutation)
      return true
    }

    if (businessPath.length === 2 && method === "GET") {
      const session = await chat.findConversation(tenantId, conversationId, projectRef(request))
      if (session === null) {
        await reply(response, 404, failure("session_not_found", "Session was not found", context.requestId), context, idempotency, mutation)
        return true
      }
      const messages = await chat.listMessages(tenantId, conversationId, 100, null, projectRef(request))
      const watermark = await store.agUi.status(tenantId, conversationId).then((status) => status.currentCursor).catch(() => null)
      await reply(response, 200, ok({
        session,
        ...(messages === null || messages.messages.length === 0 ? {} : { messages: messages.messages }),
        pending_pauses: [],
        files: [],
        deliveries: [],
        event_watermark: watermark,
      }, context.requestId), context, idempotency, mutation)
      return true
    }

    if (businessPath.length === 3 && businessPath[2] === "messages" && method === "GET") {
      const page = pageInput(request, 20)
      if (page === null) {
        await reply(response, 400, failure("invalid_pagination", "limit must be between 1 and 100", context.requestId), context, idempotency, mutation)
        return true
      }
      const result = await chat.listMessages(tenantId, conversationId, page.limit, page.cursor, projectRef(request))
      if (result === null) {
        await reply(response, 404, failure("session_not_found", "Session was not found", context.requestId), context, idempotency, mutation)
      } else {
        await reply(response, 200, ok(result, context.requestId), context, idempotency, mutation)
      }
      return true
    }

    if (businessPath.length === 3 && businessPath[2] === "messages" && method === "POST") {
      if (typeof json.content !== "string" || json.content.trim() === "") {
        await reply(response, 400, failure("invalid_message", "Message content is required", context.requestId), context, idempotency, mutation)
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
      const messageProjectRef = typeof json.project_ref === "string" ? json.project_ref.trim() : projectRef(request)
      const launch = buildAgentLaunch({
        identity: context.identity,
        requestId: context.requestId,
        sessionId: conversationId,
        idempotencyKey: key,
        content: json.content.trim(),
        ...(typeof json.model === "string" ? { model: json.model } : {}),
        ...(typeof json.agent === "string" ? { agent: json.agent } : {}),
        ...(typeof json.thinking === "boolean" ? { thinking: json.thinking } : {}),
        ...(Array.isArray(json.pinned_skills) ? { pinnedSkills: json.pinned_skills.filter((value): value is string => typeof value === "string") } : {}),
        ...(Array.isArray(json.mcp_servers) ? { mcpServers: json.mcp_servers.filter((value): value is string => typeof value === "string") } : {}),
        ...(typeof json.project_ref === "string" ? { projectRef: json.project_ref } : {}),
      })
      const appended = await chat.appendUserMessage({
        tenantId,
        conversationId,
        ...(messageProjectRef === undefined ? {} : { projectRef: messageProjectRef }),
        messageId: launch.receipt.user_message_id,
        runId: launch.receipt.run_id,
        content: json.content.trim(),
      })
      if (appended === null) {
        await reply(response, 404, failure("session_not_found", "Session was not found", context.requestId), context, idempotency, mutation)
        return true
      }
      let result: { status: number; body: unknown }
      try {
        result = await callAgent(config, agentBase, "/v1/runs", "POST", context.requestId, request, Buffer.from(JSON.stringify(launch.body)), context, String((launch.body.execution_identity as Record<string, unknown>).identity_assertion_ref))
      } catch {
        await reply(response, 502, failure("upstream_unreachable", "The configured Agent upstream is unavailable", context.requestId), context, idempotency, mutation)
        return true
      }
      if (result.status >= 400) {
        await reply(response, result.status, result.body, context, idempotency, mutation)
        return true
      }
      const body = result.body
      const data = body !== null && typeof body === "object" && "data" in body && typeof body.data === "object" && body.data !== null ? body.data as Record<string, unknown> : null
      if (data === null || data.run_id !== launch.receipt.run_id) {
        await reply(response, 502, failure("upstream_response_invalid", "Agent launch receipt did not match the requested run", context.requestId), context, idempotency, mutation)
        return true
      }
      await reply(response, 202, ok({ run_id: launch.receipt.run_id, user_message_id: appended.userMessage.messageId, assistant_message_id: appended.assistantMessageId }, context.requestId), context, idempotency, mutation)
      return true
    }

    if (businessPath.length === 3 && businessPath[2] === "title" && method === "PATCH") {
      if (typeof json.title !== "string" || json.title.trim() === "") {
        await reply(response, 400, failure("invalid_title", "Title is required", context.requestId), context, idempotency, mutation)
        return true
      }
      const conversation = await chat.renameConversation(tenantId, conversationId, json.title.trim(), projectRef(request))
      await reply(response, conversation === null ? 404 : 200, conversation === null ? failure("session_not_found", "Session was not found", context.requestId) : ok({ ok: true }, context.requestId), context, idempotency, mutation)
      return true
    }

    if (businessPath.length === 2 && method === "DELETE") {
      const deleted = await chat.deleteConversation(tenantId, conversationId, projectRef(request))
      await reply(response, deleted ? 200 : 404, deleted ? ok({ status: "deleted" }, context.requestId) : failure("session_not_found", "Session was not found", context.requestId), context, idempotency, mutation)
      return true
    }

    if (businessPath.length === 3 && businessPath[2] === "share" && method === "POST") {
      const share = await chat.createShare(tenantId, conversationId, projectRef(request))
      await reply(response, share === null ? 404 : 200, share === null ? failure("session_not_found", "Session was not found", context.requestId) : ok({ share_id: share.shareId }, context.requestId), context, idempotency, mutation)
      return true
    }

    if (businessPath.length === 3 && businessPath[2] === "share" && method === "DELETE") {
      const share = await chat.revokeShare(tenantId, conversationId, projectRef(request))
      await reply(response, share === null ? 404 : 200, share === null ? failure("share_not_found", "Share was not found", context.requestId) : ok({ share_id: share.shareId }, context.requestId), context, idempotency, mutation)
      return true
    }
  } catch (error) {
    await sendChatError(response, error, context, idempotency, mutation)
    return true
  }
  return false
}
