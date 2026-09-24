import { randomUUID } from "node:crypto"

import type { ReplaySessionEventsData } from "../../../generated/agent-http/types.gen.js"
import type { BffConfig } from "../../../config/runtime.js"
import { AgUiConsumerLeaseLostError, AgUiSourceContinuityError, AgUiSourceContractError, AgUiSourceReadError } from "../../../application/agui/errors.js"
import type { AgUiConsumerLease } from "../../../application/agui/ports/agui-projection-repository.js"
import type { AgUiSourcePage, AgUiSourceReader, AgUiSourceScope } from "../../../application/agui/ports/agui-source-reader.js"
import type { AgentProjectionSource } from "../../../application/agui/project-session-events.js"
import { parseAgentHttpJson, parseReplayPage } from "./http-wire.js"
import { proxyUpstream, UpstreamRequestError, type UpstreamResponse } from "../../../upstream.js"
import { agentIdentityHeaders } from "./identity.js"
import { classifyAgentEventPage, mapAgentEvent } from "./projection.js"
import type { AgentChatEvent } from "./types.js"

export type AgentAgUiSourceReaderOptions = {
  maxAttempts?: number
  retryBaseDelayMs?: number
  retryMaxDelayMs?: number
  retryJitterPercent?: number
  leaseSettlementReserveMs?: number
  now?: () => Date
  monotonicNow?: () => number
  random?: () => number
  sleep?: (milliseconds: number) => Promise<void>
}

function nonNegativeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative safe integer`)
}

function percentage(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 100) throw new Error(`${label} must be an integer between 0 and 100`)
}

function positiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive safe integer`)
}

function sourceOf(event: AgentChatEvent): AgentProjectionSource {
  try {
    return {
      sourceEventId: event.chat_event_id,
      sourceSequence: event.seq,
      sourceOccurredAt: new Date(event.created_at).toISOString(),
      sourcePayload: event,
      event: mapAgentEvent(event),
    }
  } catch {
    throw new AgUiSourceContractError()
  }
}

function assertionFor(scope: AgUiSourceScope): string {
  return `bff:agui-projector:${scope.tenantId}:${scope.sessionId}`
}

function retryAfterMs(headers: Headers, now: Date): number | undefined {
  const raw = headers.get("retry-after")?.trim()
  if (raw === undefined || raw === "") return undefined
  if (/^[0-9]+$/u.test(raw)) {
    const milliseconds = Number(raw) * 1000
    return Number.isSafeInteger(milliseconds) ? milliseconds : undefined
  }
  const deadline = Date.parse(raw)
  const nowMs = now.getTime()
  if (!Number.isFinite(deadline) || !Number.isFinite(nowMs)) return undefined
  const milliseconds = Math.ceil(deadline - nowMs)
  return Number.isSafeInteger(milliseconds) && milliseconds >= 0 ? milliseconds : undefined
}

function statusFailure(status: number, headers: Headers, now: Date): AgUiSourceReadError {
  const retryAfter = retryAfterMs(headers, now)
  if (status === 401) return new AgUiSourceReadError("agent_source_unauthorized", false)
  if (status === 403) return new AgUiSourceReadError("agent_source_forbidden", false)
  if (status === 410) return new AgUiSourceReadError("agent_source_history_expired", false)
  if (status === 429) return new AgUiSourceReadError("agent_source_rate_limited", true, retryAfter)
  if (status === 408 || status === 425 || status === 404 || status === 409 || status === 423 || status >= 500) {
    return new AgUiSourceReadError("agent_source_unavailable", true, retryAfter)
  }
  return new AgUiSourceReadError("agent_source_request_invalid", false)
}

function transportFailure(error: unknown): AgUiSourceReadError {
  if (error instanceof UpstreamRequestError) {
    if (error.code === "upstream_timeout") return new AgUiSourceReadError("agent_source_timeout", true)
    if (error.code === "upstream_connection_error") return new AgUiSourceReadError("agent_source_connection_error", true)
    if (error.code === "upstream_response_too_large") return new AgUiSourceReadError("agent_source_response_too_large", false)
  }
  return new AgUiSourceReadError("agent_source_unavailable", true)
}

export class AgentAgUiSourceReader implements AgUiSourceReader {
  private readonly maxAttempts: number
  private readonly retryBaseDelayMs: number
  private readonly retryMaxDelayMs: number
  private readonly retryJitterRatio: number
  private readonly leaseSettlementReserveMs: number
  private readonly now: () => Date
  private readonly monotonicNow: () => number
  private readonly random: () => number
  private readonly sleep: (milliseconds: number) => Promise<void>

  public constructor(
    private readonly config: BffConfig,
    private readonly baseUrl: string,
    options: AgentAgUiSourceReaderOptions = {},
  ) {
    this.maxAttempts = options.maxAttempts ?? 3
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? 50
    this.retryMaxDelayMs = options.retryMaxDelayMs ?? 500
    this.retryJitterRatio = (options.retryJitterPercent ?? 20) / 100
    this.leaseSettlementReserveMs = options.leaseSettlementReserveMs ?? 500
    this.now = options.now ?? (() => new Date())
    this.monotonicNow = options.monotonicNow ?? (() => performance.now())
    this.random = options.random ?? Math.random
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))
    positiveInteger(this.maxAttempts, "AG-UI Agent source attempt budget")
    positiveInteger(this.retryBaseDelayMs, "AG-UI Agent source retry base delay")
    positiveInteger(this.retryMaxDelayMs, "AG-UI Agent source retry maximum delay")
    if (this.retryBaseDelayMs > this.retryMaxDelayMs) throw new Error("AG-UI Agent source retry base delay must not exceed its maximum")
    percentage(options.retryJitterPercent ?? 20, "AG-UI Agent source retry jitter")
    positiveInteger(this.leaseSettlementReserveMs, "AG-UI Agent source lease settlement reserve")
    if (baseUrl.trim() === "") throw new Error("AG-UI Agent source base URL is required")
  }

  public async read(scope: AgUiSourceScope, afterSequence: number, limit: number, lease?: AgUiConsumerLease): Promise<AgUiSourcePage> {
    nonNegativeInteger(afterSequence, "AG-UI Agent source cursor")
    positiveInteger(limit, "AG-UI Agent source page size")
    if (lease !== undefined) positiveInteger(lease.leaseRemainingMs, "AG-UI Agent source lease remaining budget")
    const leaseDeadline = lease === undefined ? undefined : this.monotonicTimestamp() + lease.leaseRemainingMs
    for (let attempt = 0; attempt < this.maxAttempts; attempt += 1) {
      const requestTimeoutMs = this.remainingLeaseBudget(leaseDeadline)
      const requestId = `agui-projector-${randomUUID()}`
      const ownerRequest: Pick<ReplaySessionEventsData, "path" | "query"> = {
        path: { session_id: scope.sessionId },
        query: { after_seq: afterSequence, limit },
      }
      let upstream: UpstreamResponse
      try {
        upstream = await proxyUpstream(
          this.config,
          this.baseUrl,
          `/v1/sessions/${encodeURIComponent(ownerRequest.path.session_id)}/events?after_seq=${ownerRequest.query?.after_seq}&limit=${ownerRequest.query?.limit}`,
          "GET",
          requestId,
          new Headers({ accept: "application/json" }),
          undefined,
          agentIdentityHeaders({ namespace: scope.tenantId, userId: scope.subjectId }, assertionFor(scope)),
          "kokoro-bff-agui-projector",
          this.config.upstreamSecret,
          requestTimeoutMs,
        )
      } catch (error) {
        if (
          error instanceof UpstreamRequestError &&
          error.code === "upstream_timeout" &&
          lease !== undefined &&
          requestTimeoutMs !== undefined &&
          requestTimeoutMs < this.config.upstreamTimeoutMs
        ) {
          throw new AgUiConsumerLeaseLostError()
        }
        const failure = transportFailure(error)
        if (!failure.retryable || attempt + 1 >= this.maxAttempts) throw failure
        await this.waitForRetry(attempt, leaseDeadline)
        continue
      }
      this.remainingLeaseBudget(leaseDeadline)
      if (upstream.status >= 400) {
        const failure = statusFailure(upstream.status, upstream.headers, this.now())
        if (!failure.retryable || attempt + 1 >= this.maxAttempts) throw failure
        if ((failure.retryAfterMs ?? 0) > this.retryMaxDelayMs) throw failure
        await this.waitForRetry(attempt, leaseDeadline, failure.retryAfterMs)
        continue
      }
      const envelope = parseReplayPage(upstream.status, parseAgentHttpJson(upstream.body))
      if (envelope === null) throw new AgUiSourceContractError()
      const parsed = classifyAgentEventPage(envelope.data, scope.sessionId, afterSequence, limit)
      if (parsed.kind === "gap") {
        if (attempt + 1 < this.maxAttempts) {
          await this.waitForRetry(attempt, leaseDeadline)
          continue
        }
        throw new AgUiSourceContinuityError()
      }
      if (parsed.kind === "invalid") throw new AgUiSourceContractError()
      return {
        events: parsed.page.events.map(sourceOf),
        nextSequence: parsed.page.nextSequence,
        watermark: parsed.page.watermark,
        exhausted: parsed.page.exhausted,
      }
    }
    throw new AgUiSourceContinuityError()
  }

  private monotonicTimestamp(): number {
    const value = this.monotonicNow()
    if (!Number.isFinite(value) || value < 0) throw new Error("AG-UI Agent source monotonic clock returned an invalid value")
    return value
  }

  private remainingLeaseBudget(leaseDeadline: number | undefined): number | undefined {
    if (leaseDeadline === undefined) return undefined
    const remaining = Math.floor(leaseDeadline - this.monotonicTimestamp() - this.leaseSettlementReserveMs)
    if (remaining < 1) throw new AgUiConsumerLeaseLostError()
    return Math.min(this.config.upstreamTimeoutMs, remaining)
  }

  private async waitForRetry(attempt: number, leaseDeadline: number | undefined, retryAfterMs = 0): Promise<void> {
    const random = this.random()
    if (!Number.isFinite(random) || random < 0 || random > 1) throw new Error("AG-UI Agent source random provider returned an invalid value")
    const exponential = Math.min(this.retryMaxDelayMs, this.retryBaseDelayMs * 2 ** Math.min(attempt, 30))
    const jittered = Math.max(1, Math.min(this.retryMaxDelayMs, Math.floor(exponential * (1 - this.retryJitterRatio + 2 * this.retryJitterRatio * random))))
    const delay = Math.max(jittered, retryAfterMs)
    const remaining = this.remainingLeaseBudget(leaseDeadline)
    if (remaining !== undefined && delay >= remaining) throw new AgUiConsumerLeaseLostError()
    await this.sleep(delay)
  }
}
