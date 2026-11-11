import { setTimeout as sleep } from "node:timers/promises"
import { isRecord } from "../../domain/json.js"
import type { AgUiRunControlReader } from "../../infrastructure/postgres/agui-run-state-read.js"
import { resumeControlFailure } from "../../application/chat-run-control.js"
import type { IncomingMessage, ServerResponse } from "node:http"

import type { BffConfig } from "../../config/runtime.js"
import { failure, ok } from "../../contracts/index.js"
import { proxyUpstream } from "../../upstream.js"
import { agentControlRequestDigest, agentIdentityHeaders, buildAgentControl, parseAgentControlReceipt } from "../../infrastructure/clients/agent/index.js"
import { agentSessionAssertion, dataOf } from "../../application/projections.js"
import { reply, send } from "../response.js"
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
  timeoutBudgetMs?: number,
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
    "kokoro-bff",
    config.upstreamSecret,
    timeoutBudgetMs,
  )
  return normalizeUpstreamResponse(upstream, requestId)
}

function sendAgentFailure(
  response: ServerResponse,
  result: { status: number; body: unknown },
  context: RequestContext,
  idempotency: Map<string, IdempotencyEntry>,
  mutation: MutationTicket | null,
): Promise<void> {
  return reply(response, result.status, result.body, context, idempotency, mutation)
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

export async function liveAgentSessionEvents(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  context: RequestContext,
  sessionId: string,
  projection: AgUiProjectionService | null,
  sourceProjectionActive: boolean,
  runtime: AgUiSessionRuntime,
  signal: AbortSignal,
): Promise<void> {
  const fail = (status: number, code: string, message: string): void => {
    signal.throwIfAborted()
    if (response.destroyed || response.writableEnded) return
    response.setHeader("x-request-id", context.requestId)
    send(response, status, failure(code, message, context.requestId))
  }
  signal.throwIfAborted()
  if (projection === null) {
    fail(503, "business_store_not_configured", "BFF AG-UI projection store is not configured")
    return
  }

  const tenantId = context.identity.namespace
  const connection = runtime.connections.acquire(tenantId, sessionId)
  if (connection === null) {
    fail(429, "agui_connection_limit_exceeded", "AG-UI stream connection capacity was exceeded")
    return
  }

  const cursorHeader = request.headers["last-event-id"]
  let cursor = cursorHeader === undefined ? null : headerString(cursorHeader).trim()
  let streamStarted = false
  const writer = new AgUiSseWriter(
    request,
    response,
    {
      maxFrames: config.agUi.streamMaxFrames,
      maxBytes: config.agUi.streamMaxBytes,
      maxDurationMs: config.agUi.streamMaxDurationMs,
    },
    Date.now,
    signal,
  )

  const drainLedger = async (): Promise<{
    state: "head" | "terminal" | "invalid_cursor" | "expired_cursor" | "stopped"
    wroteFrames: boolean
  }> => {
    let wroteFrames = false
    for (;;) {
      signal.throwIfAborted()
      const page = await runtime.replays.replay(tenantId, sessionId, cursor, config.agUi.replayPageFrames, config.agUi.replayPageBytes, () =>
        projection.replay(tenantId, sessionId, cursor, config.agUi.replayPageFrames, config.agUi.replayPageBytes),
      )
      signal.throwIfAborted()
      if (page.kind === "invalid_cursor") return { state: "invalid_cursor", wroteFrames }
      if (page.kind === "expired_cursor") return { state: "expired_cursor", wroteFrames }
      if (page.frames.length > 0) {
        startAgUiStream(response, context.requestId)
        streamStarted = true
        const write = await writer.writeFrames(page.frames)
        signal.throwIfAborted()
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
    signal.throwIfAborted()
    const initial = await drainLedger()
    signal.throwIfAborted()
    if (initial.state === "invalid_cursor") {
      fail(400, "invalid_event_cursor", "Last-Event-ID is invalid for this session")
      return
    }
    if (initial.state === "expired_cursor") {
      fail(410, "event_cursor_expired", "Last-Event-ID is outside the retained replay window")
      return
    }
    if (initial.state === "stopped") return
    if (initial.state === "terminal") {
      startAgUiStream(response, context.requestId)
      response.end()
      return
    }
    signal.throwIfAborted()
    const initialStatus = await projection.status(tenantId, sessionId)
    signal.throwIfAborted()
    if (initialStatus.consumerState === "blocked") {
      const code = initialStatus.consumerLastErrorCode ?? "projection_blocked"
      if (!streamStarted) {
        fail(502, "agui_projection_blocked", `AG-UI projection is blocked (${code})`)
      } else {
        if (!response.writableEnded && !response.destroyed) response.end()
      }
      return
    }
    if (!sourceProjectionActive) {
      if (!streamStarted) {
        fail(503, "agui_projector_not_configured", "The durable AG-UI projector is not configured")
      } else {
        if (!response.writableEnded && !response.destroyed) response.end()
      }
      return
    }

    startAgUiStream(response, context.requestId)
    streamStarted = true
    if ((await writer.writeComment("keep-alive")) !== "written") return
    signal.throwIfAborted()
    for (;;) {
      signal.throwIfAborted()
      await runtime.ledgerWaits.wait(tenantId, sessionId, signal)
      signal.throwIfAborted()
      const drained = await drainLedger()
      signal.throwIfAborted()
      if (drained.state === "stopped") return
      if (drained.state === "invalid_cursor" || drained.state === "expired_cursor") {
        if (!response.writableEnded && !response.destroyed) response.end()
        return
      }
      if (drained.wroteFrames) runtime.ledgerWaits.observedChange(tenantId, sessionId)
      signal.throwIfAborted()
      const status = await projection.status(tenantId, sessionId)
      signal.throwIfAborted()
      if (status.consumerState === "blocked") {
        break
      }
      if (drained.state === "terminal") {
        response.end()
        return
      }
      if (!drained.wroteFrames && (await writer.writeComment("keep-alive")) !== "written") break
      signal.throwIfAborted()
      if (request.aborted || response.destroyed || response.writableEnded) break
    }
    if (!response.writableEnded) response.end()
  } catch {
    if (signal.aborted) return
    if (!streamStarted) fail(503, "agui_ledger_unavailable", "The durable AG-UI ledger is unavailable")
    else if (!response.writableEnded && !response.destroyed) {
      response.end()
    }
  } finally {
    connection.release()
    if (runtime.connections.sessionCount(tenantId, sessionId) === 0) runtime.ledgerWaits.clear(tenantId, sessionId)
  }
}

export async function runAgentControl(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  context: RequestContext,
  sessionId: string,
  runId: string,
  json: Record<string, unknown>,
  mutation: MutationTicket | null,
  idempotency: Map<string, IdempotencyEntry>,
  projectRef: string | undefined,
  readControl: AgUiRunControlReader,
): Promise<void> {
  const baseUrl = config.upstreams.agents ?? null
  const assertion = agentSessionAssertion(context, sessionId)

  if (!config.agentEnabled || baseUrl === null) {
    reply(response, 503, failure("agent_not_configured", "Agent execution is disabled or not configured", context.requestId), context, idempotency, mutation)
    return
  }

  const control = buildAgentControl(sessionId, json)
  if (control === null || control.kind === "run.steer") {
    reply(response, 400, failure("invalid_run_control", "Control request does not match the v1 contract", context.requestId), context, idempotency, mutation)
    return
  }
  const commandId = idempotencyKey(request)
  if (commandId === null) {
    reply(response, 400, failure("idempotency_key_required", "Control requests require Idempotency-Key", context.requestId), context, idempotency, mutation)
    return
  }
  if (control.kind === "run.resume") {
    try {
      const snapshot = await readControl(context.identity.namespace, context.identity.userId, sessionId, projectRef)
      if (snapshot === null) {
        reply(response, 404, failure("session_not_found", "Session was not found", context.requestId), context, idempotency, mutation)
        return
      }
      const rejected = resumeControlFailure(snapshot.executionHead, runId, commandId, control)
      if (rejected !== null) {
        reply(
          response,
          rejected.status,
          failure(rejected.code, "Control does not match the current complete pause", context.requestId),
          context,
          idempotency,
          mutation,
        )
        return
      }
    } catch {
      reply(
        response,
        503,
        failure("chat_projection_unavailable", "The durable chat projection is unavailable", context.requestId),
        context,
        idempotency,
        mutation,
      )
      return
    }
  }
  // A durable BFF queued head can precede Agent run creation. Only its
  // explicit pre-admission run_not_found may use this bounded startup bridge.
  // Every delivery keeps the original command and only an actual Agent ACK
  // is accepted; no local cancellation terminal or receipt is invented.
  const cancelWindow = new AbortController()
  const deadlineAt = performance.now() + config.upstreamTimeoutMs
  const cancel = () => {
    if (!response.writableEnded) cancelWindow.abort(new Error("control_caller_cancelled"))
  }
  const timer = control.kind === "run.cancel" ? setTimeout(() => cancelWindow.abort(new Error("control_deadline")), config.upstreamTimeoutMs) : undefined
  if (control.kind === "run.cancel") {
    request.once("aborted", cancel)
    response.once("close", cancel)
    if (request.aborted || response.destroyed) cancel()
  }
  const currentHead = async (requireQueued: boolean): Promise<boolean> => {
    if (cancelWindow.signal.aborted) return false
    const readWindow = new AbortController()
    try {
      const state = await Promise.race([
        readControl(context.identity.namespace, context.identity.userId, sessionId, projectRef),
        sleep(Math.max(1, Math.ceil(deadlineAt - performance.now())), undefined, { signal: AbortSignal.any([cancelWindow.signal, readWindow.signal]) }).then(
          () => {
            throw new Error("control_deadline")
          },
        ),
      ])
      cancelWindow.signal.throwIfAborted()
      return state?.executionHead?.runId === runId && (!requireQueued || state.executionHead.state === "queued")
    } finally {
      readWindow.abort()
    }
  }
  try {
    const body = Buffer.from(JSON.stringify(control))
    let result = await callAgent(config, baseUrl, `/v1/runs/${encodeURIComponent(runId)}/control`, "POST", context.requestId, request, body, context, assertion)
    let startupQualified = false
    for (let attempt = 1; control.kind === "run.cancel" && attempt < 8; attempt++) {
      if (result.status !== 404 || !isRecord(result.body) || !isRecord(result.body.error) || result.body.error.code !== "run_not_found") break
      cancelWindow.signal.throwIfAborted()
      if (!(await currentHead(!startupQualified))) break
      startupQualified = true
      const delay = Math.min(50 * 2 ** (attempt - 1), 500)
      if (deadlineAt - performance.now() <= delay) break
      await sleep(delay, undefined, { signal: cancelWindow.signal })
      if (!(await currentHead(false))) break
      const remaining = Math.floor(deadlineAt - performance.now())
      if (remaining < 1) break
      result = await callAgent(
        config,
        baseUrl,
        `/v1/runs/${encodeURIComponent(runId)}/control`,
        "POST",
        context.requestId,
        request,
        body,
        context,
        assertion,
        remaining,
      )
    }
    if (control.kind === "run.cancel") cancelWindow.signal.throwIfAborted()
    if (result.status >= 400) {
      await sendAgentFailure(response, result, context, idempotency, mutation)
      return
    }
    const receipt = parseAgentControlReceipt(dataOf(result.body))
    const requestDigest = agentControlRequestDigest(runId, control)
    if (result.status !== 202 || receipt === null || receipt.command_id !== commandId || receipt.request_digest !== requestDigest) {
      await sendAgentFailure(
        response,
        { status: 502, body: failure("upstream_response_invalid", "Agent control receipt did not match the requested command", context.requestId) },
        context,
        idempotency,
        mutation,
      )
      return
    }
    reply(response, 202, ok({ run_id: runId, ...receipt }, context.requestId), context, idempotency, mutation)
  } catch {
    if (!request.aborted && !response.destroyed && !response.writableEnded)
      reply(response, 502, failure("upstream_unreachable", "The configured Agent upstream is unavailable", context.requestId), context, idempotency, mutation)
  } finally {
    clearTimeout(timer)
    request.removeListener("aborted", cancel)
    response.removeListener("close", cancel)
  }
}
