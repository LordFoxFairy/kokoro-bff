import type { AgentDispatchDeliveryPort, AgentDispatchDeliveryResult } from "../../../application/ports/agent-dispatch-delivery.js"
import type { BffConfig } from "../../../config/runtime.js"
import type { AgentDispatchCommand } from "../../../domain/chat/agent-dispatch.js"
import { isRecord } from "../../../domain/json.js"
import { proxyUpstream } from "../../../upstream.js"
import { normalizeUpstreamResponse } from "../upstream-response.js"
import { agentIdentityHeaders } from "./identity.js"

type AgentAttempt =
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

function acceptedReceipt(body: unknown, command: AgentDispatchCommand): boolean {
  if (!isRecord(body) || !isRecord(body.data)) return false
  return body.data.run_id === command.runId && body.data.session_id === command.conversationId
}

function classify(attempt: AgentAttempt, command: AgentDispatchCommand): AgentDispatchDeliveryResult {
  if (attempt.kind === "transport") return { outcome: "retryable", errorCode: attempt.errorCode }
  if (attempt.status >= 200 && attempt.status < 300) {
    return acceptedReceipt(attempt.body, command)
      ? { outcome: "succeeded" }
      : { outcome: "retryable", errorCode: "agent_receipt_invalid" }
  }
  const errorCode = upstreamErrorCode(attempt.body, attempt.status)
  if (attempt.status === 408 || attempt.status === 425 || attempt.status === 429 || attempt.status >= 500) {
    return { outcome: "retryable", errorCode }
  }
  return { outcome: "failed", errorCode }
}

/** Delivers one previously committed Agent command; it never owns retry state. */
export class AgentOutboxDelivery implements AgentDispatchDeliveryPort {
  public constructor(private readonly config: BffConfig) {}

  public async deliver(command: AgentDispatchCommand): Promise<AgentDispatchDeliveryResult> {
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
      const upstream = await proxyUpstream(
        this.config,
        baseUrl,
        "/v1/runs",
        "POST",
        command.requestId,
        headers,
        Buffer.from(JSON.stringify(command.payload.launch)),
        agentIdentityHeaders(
          { namespace: command.tenantId, userId: command.subjectId },
          command.identityAssertionRef,
          command.actorId,
        ),
        "kokoro-bff",
        this.config.upstreamSecret,
      )
      const normalized = normalizeUpstreamResponse(upstream, command.requestId)
      return classify({ kind: "response", status: normalized.status, body: normalized.body }, command)
    } catch (error) {
      return classify({ kind: "transport", errorCode: transportErrorCode(error) }, command)
    }
  }
}
