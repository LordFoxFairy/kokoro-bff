import type {
  AgentCancellationDeliveryPort,
  AgentCancellationDeliveryResult,
} from "../../../application/ports/agent-cancellation-delivery.js"
import type { BffConfig } from "../../../config/runtime.js"
import type { AgentCancellationCommand } from "../../../domain/chat/agent-cancellation.js"
import { isRecord } from "../../../domain/json.js"
import { proxyUpstream } from "../../../upstream.js"
import { normalizeUpstreamResponse } from "../upstream-response.js"
import {
  agentControlRequestDigest,
  parseAgentControlReceipt,
} from "./control-receipt.js"
import { agentIdentityHeaders } from "./identity.js"

export { agentControlRequestDigest } from "./control-receipt.js"

export type AgentCancellationAttempt =
  | { kind: "response"; status: number; body: unknown }
  | { kind: "transport"; errorCode: string }

function upstreamErrorCode(body: unknown, status: number): string {
  if (isRecord(body) && isRecord(body.error) && typeof body.error.code === "string" && body.error.code.trim() !== "") {
    return body.error.code
  }
  return `agent_http_${status}`
}

function transportErrorCode(error: unknown): string {
  if (isRecord(error) && typeof error.code === "string" && error.code.trim() !== "") return error.code
  return "agent_transport_error"
}

export function classifyAgentCancellationAttempt(
  attempt: AgentCancellationAttempt,
  command: AgentCancellationCommand,
): AgentCancellationDeliveryResult {
  if (attempt.kind === "transport") {
    return attempt.errorCode === "upstream_response_too_large"
      ? { outcome: "failed", errorCode: attempt.errorCode }
      : { outcome: "retryable", errorCode: attempt.errorCode }
  }
  if (attempt.status >= 200 && attempt.status < 300) {
    const data = isRecord(attempt.body) ? attempt.body.data : undefined
    const receipt = parseAgentControlReceipt(data)
    const digest = agentControlRequestDigest(command.runId, command.payload)
    if (receipt === null || receipt.command_id !== command.commandId || receipt.request_digest !== digest) {
      return { outcome: "failed", errorCode: "agent_control_receipt_invalid" }
    }
    return receipt.status === "failed"
      ? { outcome: "failed", errorCode: receipt.error_code ?? "agent_control_failed" }
      : { outcome: "succeeded" }
  }
  const errorCode = upstreamErrorCode(attempt.body, attempt.status)
  if (
    attempt.status === 404
    || attempt.status === 408
    || attempt.status === 425
    || attempt.status === 429
    || attempt.status >= 500
  ) return { outcome: "retryable", errorCode }
  return { outcome: "failed", errorCode }
}

export class AgentCancellationDelivery implements AgentCancellationDeliveryPort {
  public constructor(private readonly config: BffConfig) {}

  public async deliver(
    command: AgentCancellationCommand,
    timeoutBudgetMs: number,
  ): Promise<AgentCancellationDeliveryResult> {
    if (!Number.isSafeInteger(timeoutBudgetMs) || timeoutBudgetMs < 1) {
      throw new Error("AGENT_CANCELLATION_TIMEOUT_BUDGET_INVALID")
    }
    const baseUrl = this.config.upstreams.agents ?? null
    if (!this.config.agentEnabled || baseUrl === null) {
      return { outcome: "retryable", errorCode: "agent_not_configured" }
    }
    const headers = new Headers({
      accept: "application/json",
      "content-type": "application/json",
      "idempotency-key": command.commandId,
    })
    try {
      const upstream = await proxyUpstream(
        this.config,
        baseUrl,
        `/v1/runs/${encodeURIComponent(command.runId)}/control`,
        "POST",
        command.requestId,
        headers,
        Buffer.from(JSON.stringify(command.payload)),
        agentIdentityHeaders(
          { namespace: command.tenantId, userId: command.subjectId },
          command.identityAssertionRef,
          command.actorId,
        ),
        "kokoro-bff",
        this.config.upstreamSecret,
        timeoutBudgetMs,
      )
      const normalized = normalizeUpstreamResponse(upstream, command.requestId)
      return classifyAgentCancellationAttempt({
        kind: "response",
        status: upstream.status,
        body: normalized.body,
      }, command)
    } catch (error) {
      return classifyAgentCancellationAttempt({ kind: "transport", errorCode: transportErrorCode(error) }, command)
    }
  }
}
