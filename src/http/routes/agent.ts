import type { IncomingMessage, ServerResponse } from "node:http"

import type { BffConfig } from "../../config/runtime.js"
import { failure, ok } from "../../contracts/index.js"
import { proxyUpstream } from "../../upstream.js"
import { agentIdentityHeaders, buildAgentControl } from "../../infrastructure/clients/agent/index.js"
import { agentSessionAssertion, dataOf } from "../../application/projections.js"
import { reply } from "../response.js"
import { normalizeUpstreamResponse } from "../../infrastructure/clients/upstream-response.js"
import { headerString, incomingHeaders, idempotencyKey } from "../request.js"
import type { RequestContext } from "../../domain/request-context.js"
import type { IdempotencyEntry, MutationTicket } from "../../application/idempotency.js"
import { AgUiSseWriter } from "../../interfaces/http/agui/sse.js"
import type { AgUiProjectionService } from "../../application/agui/project-session-events.js"
import type { AgUiSessionRuntime } from "../../application/agui/session-runtime.js"

export async function callAgent(
  config: BffConfig,
  baseUrl: string,
  path: string,
  method: string,
  requestId: string,
  request: IncomingMessage,
  body: Buffer | undefined,
  identity: RequestContext,
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
  context: RequestContext,
  idempotency: Map<string, IdempotencyEntry>,
  mutation: MutationTicket | null,
): void {
  reply(response, result.status, result.body, context, idempotency, mutation)
}

function startAgUiStream(response: ServerResponse, requestId: string): void {
  if (response.headersSent) return
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store",
    connection: "keep-alive",
    "x-kokoro-request-id": requestId,
  })
}

async function durableAgentEventStream(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  context: RequestContext,
  sessionId: string,
  projection: AgUiProjectionService | null,
  sourceProjectionActive: boolean,
  idempotency: Map<string, IdempotencyEntry>,
  mutation: MutationTicket | null,
  runtime: AgUiSessionRuntime,
): Promise<void> {
  if (projection === null) {
    reply(response, 503, failure("business_store_not_configured", "BFF AG-UI projection store is not configured", context.requestId), context, idempotency, mutation)
    return
  }

  const tenantId = context.identity.namespace
  const connection = runtime.connections.acquire(tenantId, sessionId)
  if (connection === null) {
    reply(response, 429, failure("agui_connection_limit_exceeded", "AG-UI stream connection capacity was exceeded", context.requestId), context, idempotency, mutation)
    return
  }

  const cursorHeader = request.headers["last-event-id"]
  let cursor = cursorHeader === undefined ? null : headerString(cursorHeader).trim()
  let streamStarted = false
  const writer = new AgUiSseWriter(request, response, {
    maxFrames: config.agUi.streamMaxFrames,
    maxBytes: config.agUi.streamMaxBytes,
    maxDurationMs: config.agUi.streamMaxDurationMs,
  })

  const drainLedger = async (): Promise<{
    state: "head" | "terminal" | "invalid_cursor" | "expired_cursor" | "stopped"
    wroteFrames: boolean
  }> => {
    let wroteFrames = false
    for (;;) {
      const page = await runtime.replays.replay(
        tenantId,
        sessionId,
        cursor,
        config.agUi.replayPageFrames,
        config.agUi.replayPageBytes,
        () => projection.replay(
          tenantId,
          sessionId,
          cursor,
          config.agUi.replayPageFrames,
          config.agUi.replayPageBytes,
        ),
      )
      if (page.kind === "invalid_cursor") return { state: "invalid_cursor", wroteFrames }
      if (page.kind === "expired_cursor") return { state: "expired_cursor", wroteFrames }
      if (page.frames.length > 0) {
        startAgUiStream(response, context.requestId)
        streamStarted = true
        const write = await writer.writeFrames(page.frames)
        cursor = write.lastCursor ?? cursor
        wroteFrames = wroteFrames || write.writtenFrames > 0
        if (write.status !== "written") {
          if (!response.writableEnded && !response.destroyed) response.end()
          return { state: "stopped", wroteFrames }
        }
      }
      if (!page.atHead) continue
      return { state: page.terminalRunId === null ? "head" : "terminal", wroteFrames }
    }
  }

  try {
    const initial = await drainLedger()
    if (initial.state === "invalid_cursor") {
      reply(response, 400, failure("invalid_event_cursor", "Last-Event-ID is invalid for this session", context.requestId), context, idempotency, mutation)
      return
    }
    if (initial.state === "expired_cursor") {
      reply(response, 410, failure("event_cursor_expired", "Last-Event-ID is outside the retained replay window", context.requestId), context, idempotency, mutation)
      return
    }
    if (initial.state === "stopped") return
    if (initial.state === "terminal" && !sourceProjectionActive) {
      startAgUiStream(response, context.requestId)
      response.end()
      return
    }
    const initialStatus = await projection.status(tenantId, sessionId)
    const initialPollCompletion = initialStatus.consumerLastPolledAt
    if (initialStatus.consumerState === "blocked") {
      const code = initialStatus.consumerLastErrorCode ?? "projection_blocked"
      if (!streamStarted) {
        reply(response, 502, failure("agui_projection_blocked", `AG-UI projection is blocked (${code})`, context.requestId), context, idempotency, mutation)
      } else {
        if (!response.writableEnded && !response.destroyed) response.end()
      }
      return
    }
    if (!sourceProjectionActive) {
      if (!streamStarted) {
        reply(response, 503, failure("agui_projector_not_configured", "The durable AG-UI projector is not configured", context.requestId), context, idempotency, mutation)
      } else {
        if (!response.writableEnded && !response.destroyed) response.end()
      }
      return
    }

    startAgUiStream(response, context.requestId)
    streamStarted = true
    if (await writer.writeComment("keep-alive") !== "written") return
    for (;;) {
      await runtime.ledgerWaits.wait(tenantId, sessionId)
      const drained = await drainLedger()
      if (drained.state === "stopped") return
      if (drained.state === "invalid_cursor" || drained.state === "expired_cursor") {
        if (!response.writableEnded && !response.destroyed) response.end()
        return
      }
      if (drained.wroteFrames) runtime.ledgerWaits.observedChange(tenantId, sessionId)
      const status = await projection.status(tenantId, sessionId)
      if (status.consumerState === "blocked") {
        break
      }
      const sourceWasObserved = drained.wroteFrames || status.consumerLastPolledAt !== initialPollCompletion
      if (drained.state === "terminal" && sourceWasObserved) {
        response.end()
        return
      }
      if (!drained.wroteFrames && await writer.writeComment("keep-alive") !== "written") break
      if (request.aborted || response.destroyed || response.writableEnded) break
    }
    if (!response.writableEnded) response.end()
  } catch {
    if (!streamStarted) reply(response, 503, failure("agui_ledger_unavailable", "The durable AG-UI ledger is unavailable", context.requestId), context, idempotency, mutation)
    else if (!response.writableEnded && !response.destroyed) {
      response.end()
    }
  } finally {
    connection.release()
    if (runtime.connections.sessionCount(tenantId, sessionId) === 0) runtime.ledgerWaits.clear(tenantId, sessionId)
  }
}

export async function liveAgentSession(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  context: RequestContext,
  businessPath: string[],
  json: Record<string, unknown>,
  mutation: MutationTicket | null,
  idempotency: Map<string, IdempotencyEntry>,
  agUiProjection: AgUiProjectionService | null,
  agUiRuntime: AgUiSessionRuntime,
  sourceProjectionActive: boolean,
): Promise<boolean> {
  const baseUrl = config.upstreams.agents ?? null
  const method = request.method || "GET"
  const sessionId = businessPath[1] || ""
  const assertion = agentSessionAssertion(context, sessionId)

  if (businessPath.length === 3 && businessPath[2] === "events" && method === "GET") {
    await durableAgentEventStream(request, response, config, context, sessionId, agUiProjection, sourceProjectionActive, idempotency, mutation, agUiRuntime)
    return true
  }

  if (!config.agentEnabled || baseUrl === null) {
    reply(response, 503, failure("agent_not_configured", "Agent execution is disabled or not configured", context.requestId), context, idempotency, mutation)
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

  if (businessPath.length === 2 && method === "GET" && agUiProjection === null) {
    reply(response, 503, failure("business_store_not_configured", "BFF chat fact storage is not configured", context.requestId), context, idempotency, mutation)
    return true
  }

  reply(response, 503, failure("chat_projection_not_configured", "This Chat operation is not exposed by the Agent v1 adapter", context.requestId), context, idempotency, mutation)
  return true
}
