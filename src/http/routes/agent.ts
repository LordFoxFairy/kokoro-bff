import type { IncomingMessage, ServerResponse } from "node:http"

import type { BffConfig } from "../../config.js"
import { failure, ok } from "../../contracts/index.js"
import { proxyUpstream } from "../../upstream.js"
import { agentIdentityHeaders, buildAgentControl, buildAgentLaunch, buildSessionDetail, mapAgentEvent, type AgentChatEvent, type AgentChatMessage } from "../../adapters/agent.js"
import { agentMessageListData, agentSessionAssertion, agentSessionListData, dataOf, messageCursor } from "../../application/projections.js"
import type { ChatEvent } from "../../contracts/index.js"
import { normalizeUpstreamResponse, reply } from "../response.js"
import { headerString, incomingHeaders, idempotencyKey, queryOf, type Context } from "../request.js"
import type { IdempotencyEntry, MutationTicket } from "../../application/idempotency.js"
import { chatSseFrame, waitForSsePoll } from "./helpers.js"

export async function callAgent(
  config: BffConfig,
  baseUrl: string,
  path: string,
  method: string,
  requestId: string,
  request: IncomingMessage,
  body: Buffer | undefined,
  identity: Context,
  assertionRef: string,
): Promise<{ status: number; body: unknown }> {
  const upstream = await proxyUpstream(
    config,
    baseUrl,
    path,
    method,
    requestId,
    incomingHeaders(request),
    body,
    agentIdentityHeaders(identity.identity, assertionRef),
  )
  return normalizeUpstreamResponse(upstream, requestId)
}

function sendAgentFailure(
  response: ServerResponse,
  result: { status: number; body: unknown },
  context: Context,
  idempotency: Map<string, IdempotencyEntry>,
  mutation: MutationTicket | null,
): void {
  reply(response, result.status, result.body, context, idempotency, mutation)
}

export async function liveAgentSession(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  context: Context,
  businessPath: string[],
  body: Buffer | undefined,
  json: Record<string, unknown>,
  mutation: MutationTicket | null,
  idempotency: Map<string, IdempotencyEntry>,
): Promise<boolean> {
  const baseUrl = config.upstreams.agents ?? null
  if (!config.agentEnabled || baseUrl === null) {
    reply(response, 503, failure("agent_not_configured", "Agent execution is disabled or not configured", context.requestId), context, idempotency, mutation)
    return true
  }
  const method = request.method || "GET"
  const sessionId = businessPath[1] || ""
  const assertion = agentSessionAssertion(context, sessionId)

  if (businessPath.length === 1 && method === "GET") {
    try {
      const incomingQuery = queryOf(request)
      const ownerQuery = new URLSearchParams()
      for (const key of ["project_ref", "limit", "cursor"]) {
        const value = incomingQuery.get(key)
        if (value !== null && value !== "") ownerQuery.set(key, value)
      }
      const ownerPath = `/v1/sessions${ownerQuery.size > 0 ? `?${ownerQuery.toString()}` : ""}`
      const result = await callAgent(config, baseUrl, ownerPath, "GET", context.requestId, request, undefined, context, agentSessionAssertion(context, "session-list"))
      if (result.status >= 400) {
        sendAgentFailure(response, result, context, idempotency, mutation)
        return true
      }
      const projected = agentSessionListData(result.body)
      if (projected === null) {
        reply(response, 502, failure("upstream_response_invalid", "Agent session list response is invalid", context.requestId), context, idempotency, mutation)
        return true
      }
      reply(response, 200, ok(projected, context.requestId), context, idempotency, mutation)
    } catch {
      reply(response, 502, failure("upstream_unreachable", "The configured Agent upstream is unavailable", context.requestId), context, idempotency, mutation)
    }
    return true
  }

  if (businessPath.length === 3 && businessPath[2] === "messages" && method === "GET") {
    const incomingQuery = queryOf(request)
    const rawLimit = incomingQuery.get("limit")
    const limit = rawLimit === null || rawLimit === "" ? 20 : Number(rawLimit)
    const cursor = messageCursor(incomingQuery.get("cursor")?.trim() || undefined)
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || cursor === null) {
      reply(response, 400, failure("invalid_pagination", "limit must be between 1 and 100 and cursor must be valid", context.requestId), context, idempotency, mutation)
      return true
    }
    try {
      const ownerPath = `/v1/sessions/${encodeURIComponent(sessionId)}/messages?after_seq=${cursor}&limit=${limit}`
      const result = await callAgent(config, baseUrl, ownerPath, "GET", context.requestId, request, undefined, context, assertion)
      if (result.status >= 400) {
        sendAgentFailure(response, result, context, idempotency, mutation)
        return true
      }
      const projected = agentMessageListData(result.body, limit)
      if (projected === null) {
        reply(response, 502, failure("upstream_response_invalid", "Agent message history response is invalid", context.requestId), context, idempotency, mutation)
        return true
      }
      reply(response, 200, ok(projected, context.requestId), context, idempotency, mutation)
    } catch {
      reply(response, 502, failure("upstream_unreachable", "The configured Agent upstream is unavailable", context.requestId), context, idempotency, mutation)
    }
    return true
  }

  if (businessPath.length === 3 && businessPath[2] === "messages" && method === "POST") {
    if (typeof json.content !== "string" || json.content.trim() === "") {
      reply(response, 400, failure("invalid_message", "Message content is required", context.requestId), context, idempotency, mutation)
      return true
    }
    const key = idempotencyKey(request)
    if (key === null) {
      reply(response, 400, failure("idempotency_key_required", "Mutations require Idempotency-Key", context.requestId), context, idempotency, mutation)
      return true
    }
    const launch = buildAgentLaunch({
      identity: context.identity,
      requestId: context.requestId,
      sessionId,
      idempotencyKey: key,
      content: json.content.trim(),
      ...(typeof json.model === "string" ? { model: json.model } : {}),
      ...(typeof json.agent === "string" ? { agent: json.agent } : {}),
      ...(typeof json.thinking === "boolean" ? { thinking: json.thinking } : {}),
      ...(Array.isArray(json.pinned_skills) ? { pinnedSkills: json.pinned_skills.filter((value): value is string => typeof value === "string") } : {}),
      ...(Array.isArray(json.mcp_servers) ? { mcpServers: json.mcp_servers.filter((value): value is string => typeof value === "string") } : {}),
      ...(typeof json.project_ref === "string" ? { projectRef: json.project_ref } : {}),
    })
    const launchBody = Buffer.from(JSON.stringify(launch.body))
    try {
      const result = await callAgent(config, baseUrl, "/v1/runs", "POST", context.requestId, request, launchBody, context, String((launch.body.execution_identity as Record<string, unknown>).identity_assertion_ref))
      if (result.status >= 400) {
        sendAgentFailure(response, result, context, idempotency, mutation)
        return true
      }
      const data = dataOf(result.body)
      if (data === null || data.run_id !== launch.receipt.run_id) {
        sendAgentFailure(response, { status: 502, body: failure("upstream_response_invalid", "Agent launch receipt did not match the requested run", context.requestId) }, context, idempotency, mutation)
        return true
      }
      reply(response, 202, ok(launch.receipt, context.requestId), context, idempotency, mutation)
    } catch {
      reply(response, 502, failure("upstream_unreachable", "The configured Agent upstream is unavailable", context.requestId), context, idempotency, mutation)
    }
    return true
  }

  if (businessPath.length === 5 && businessPath[2] === "runs" && businessPath[4] === "control" && method === "POST") {
    const control = buildAgentControl(sessionId, json)
    if (control === null) {
      reply(response, 400, failure("invalid_run_control", "Control request does not match the v1 contract", context.requestId), context, idempotency, mutation)
      return true
    }
    const runId = businessPath[3] || ""
    const commandId = idempotencyKey(request)
    if (commandId === null) {
      reply(response, 400, failure("idempotency_key_required", "Control requests require Idempotency-Key", context.requestId), context, idempotency, mutation)
      return true
    }
    try {
      const result = await callAgent(config, baseUrl, `/v1/runs/${encodeURIComponent(runId)}/control`, "POST", context.requestId, request, Buffer.from(JSON.stringify(control)), context, assertion)
      if (result.status >= 400) {
        sendAgentFailure(response, result, context, idempotency, mutation)
        return true
      }
      const receipt = dataOf(result.body)
      if (receipt === null || receipt.command_id !== commandId || receipt.run_id !== runId) {
        sendAgentFailure(response, { status: 502, body: failure("upstream_response_invalid", "Agent control receipt did not match the requested command", context.requestId) }, context, idempotency, mutation)
        return true
      }
      reply(response, 202, ok(receipt, context.requestId), context, idempotency, mutation)
    } catch {
      reply(response, 502, failure("upstream_unreachable", "The configured Agent upstream is unavailable", context.requestId), context, idempotency, mutation)
    }
    return true
  }

  if (businessPath.length === 3 && businessPath[2] === "events" && method === "GET") {
    const lastEventId = headerString(request.headers["last-event-id"]).trim()
    const cursor = lastEventId === "" ? 0 : Number(lastEventId)
    let afterSeq = Number.isInteger(cursor) && cursor >= 0 ? cursor : 0
    let streamStarted = false
    try {
      for (;;) {
        const result = await callAgent(config, baseUrl, `/v1/sessions/${encodeURIComponent(sessionId)}/events?after_seq=${afterSeq}&limit=1000`, "GET", context.requestId, request, undefined, context, assertion)
        if (result.status >= 400) {
          if (!streamStarted) sendAgentFailure(response, result, context, idempotency, mutation)
          else response.end(": upstream-error\n\n")
          return true
        }
        const data = dataOf(result.body)
        const rawEvents = Array.isArray(data?.events) ? data.events as AgentChatEvent[] : null
        if (data === null || rawEvents === null) {
          if (!streamStarted) sendAgentFailure(response, { status: 502, body: failure("upstream_response_invalid", "Agent event replay did not match the v1 contract", context.requestId) }, context, idempotency, mutation)
          else response.end(": upstream-response-invalid\n\n")
          return true
        }
        if (!streamStarted) {
          response.writeHead(200, {
            "content-type": "text/event-stream; charset=utf-8",
            "cache-control": "no-store",
            connection: "keep-alive",
            "x-kokoro-request-id": context.requestId,
          })
          streamStarted = true
        }
        const events = rawEvents.map(mapAgentEvent).filter((event): event is ChatEvent => event !== null)
        if (events.length > 0) {
          response.write(events.map(chatSseFrame).join(""))
          afterSeq = Math.max(afterSeq, ...events.map((event) => event.seq))
        } else {
          response.write(": keep-alive\n\n")
        }
        if (events.some((event) => event.kind === "run.completed" || event.kind === "run.failed")) break
        if (!await waitForSsePoll(request, response, 1000)) break
      }
      if (!response.writableEnded) response.end()
    } catch {
      if (!streamStarted) reply(response, 502, failure("upstream_response_invalid", "Agent event projection failed", context.requestId), context, idempotency, mutation)
      else if (!response.writableEnded) response.end(": upstream-error\n\n")
    }
    return true
  }

  if (businessPath.length === 2 && method === "GET") {
    try {
      const [messagesResult, eventsResult] = await Promise.all([
        callAgent(config, baseUrl, `/v1/sessions/${encodeURIComponent(sessionId)}/messages?after_seq=0&limit=1000`, "GET", context.requestId, request, undefined, context, assertion),
        callAgent(config, baseUrl, `/v1/sessions/${encodeURIComponent(sessionId)}/events?after_seq=0&limit=1000`, "GET", context.requestId, request, undefined, context, assertion),
      ])
      if (messagesResult.status >= 400) {
        sendAgentFailure(response, messagesResult, context, idempotency, mutation)
        return true
      }
      if (eventsResult.status >= 400) {
        sendAgentFailure(response, eventsResult, context, idempotency, mutation)
        return true
      }
      const messagesData = dataOf(messagesResult.body)
      const eventsData = dataOf(eventsResult.body)
      const messages = Array.isArray(messagesData?.messages) ? messagesData.messages as AgentChatMessage[] : null
      const events = Array.isArray(eventsData?.events) ? eventsData.events as AgentChatEvent[] : null
      const watermark = typeof eventsData?.watermark === "number" ? eventsData.watermark : null
      if (messagesData === null || eventsData === null || messages === null || events === null || watermark === null) {
        sendAgentFailure(response, { status: 502, body: failure("upstream_response_invalid", "Agent session projection did not match the v1 contract", context.requestId) }, context, idempotency, mutation)
        return true
      }
      reply(response, 200, ok(buildSessionDetail(context.identity, sessionId, messages, events, watermark), context.requestId), context, idempotency, mutation)
    } catch {
      reply(response, 502, failure("upstream_response_invalid", "Agent session projection failed", context.requestId), context, idempotency, mutation)
    }
    return true
  }

  reply(response, 503, failure("chat_projection_not_configured", "This Chat operation is not exposed by the Agent v1 adapter", context.requestId), context, idempotency, mutation)
  return true
}
