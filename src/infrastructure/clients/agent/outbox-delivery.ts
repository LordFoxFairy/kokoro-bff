import type { CreateRunData } from "../../../generated/agent-http/types.gen.js"
import type { AgentDispatchDeliveryPort, AgentDispatchDeliveryResult } from "../../../application/ports/agent-dispatch-delivery.js"
import type { BffConfig } from "../../../config/runtime.js"
import type { AgentDispatchCommand } from "../../../domain/chat/agent-dispatch.js"
import { isRecord } from "../../../domain/json.js"
import { proxyUpstream } from "../../../upstream.js"
import { parseAgentErrorCode, parseAgentHttpJson, parseLaunchReceipt } from "./http-wire.js"
import { agentIdentityHeaders } from "./identity.js"

export type AgentDispatchAttempt = { kind: "response"; status: number; body: unknown } | { kind: "transport"; errorCode: string }

function transportErrorCode(error: unknown): string {
  if (isRecord(error) && typeof error.code === "string" && error.code.trim() !== "") return error.code
  return "agent_transport_error"
}

export function classifyAgentDispatchAttempt(attempt: AgentDispatchAttempt, command: AgentDispatchCommand): AgentDispatchDeliveryResult {
  if (attempt.kind === "transport") {
    return attempt.errorCode === "upstream_response_too_large"
      ? { outcome: "failed", errorCode: attempt.errorCode }
      : { outcome: "retryable", errorCode: attempt.errorCode }
  }
  if (attempt.status >= 200 && attempt.status < 300) {
    const receipt = parseLaunchReceipt(attempt.status, attempt.body)
    return receipt !== null && receipt.data.run_id === command.runId && receipt.data.session_id === command.conversationId
      ? { outcome: "succeeded" }
      : { outcome: "failed", errorCode: "agent_receipt_invalid" }
  }
  // Unknown owner error payloads never become trusted BFF error codes.
  const errorCode = parseAgentErrorCode(attempt.body) ?? `agent_http_${attempt.status}`
  if (attempt.status === 408 || attempt.status === 425 || attempt.status === 429 || attempt.status >= 500) {
    return { outcome: "retryable", errorCode }
  }
  return { outcome: "failed", errorCode }
}

/** Delivers one previously committed Agent command; it never owns retry state. */
export class AgentOutboxDelivery implements AgentDispatchDeliveryPort {
  public constructor(private readonly config: BffConfig) {}

  public async deliver(command: AgentDispatchCommand, timeoutBudgetMs: number): Promise<AgentDispatchDeliveryResult> {
    if (!Number.isSafeInteger(timeoutBudgetMs) || timeoutBudgetMs < 1) {
      throw new Error("AGENT_DISPATCH_TIMEOUT_BUDGET_INVALID")
    }
    const baseUrl = this.config.upstreams.agents ?? null
    if (!this.config.agentEnabled || baseUrl === null) {
      return { outcome: "retryable", errorCode: "agent_not_configured" }
    }
    const headers = new Headers({
      accept: "application/json",
      "content-type": "application/json",
      "idempotency-key": command.idempotencyKey,
    })
    try {
      const launch: CreateRunData["body"] = command.payload.launch
      const upstream = await proxyUpstream(
        this.config,
        baseUrl,
        "/v1/runs",
        "POST",
        command.requestId,
        headers,
        Buffer.from(JSON.stringify(launch)),
        agentIdentityHeaders({ namespace: command.tenantId, userId: command.subjectId }, command.identityAssertionRef, command.actorId),
        "kokoro-bff",
        this.config.upstreamSecret,
        timeoutBudgetMs,
      )
      return classifyAgentDispatchAttempt({ kind: "response", status: upstream.status, body: parseAgentHttpJson(upstream.body) }, command)
    } catch (error) {
      return classifyAgentDispatchAttempt({ kind: "transport", errorCode: transportErrorCode(error) }, command)
    }
  }
}
