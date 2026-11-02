import type { AgentDispatchDeliveryPort, AgentDispatchDeliveryResult } from "../../../application/ports/agent-dispatch-delivery.js"
import type { BffConfig } from "../../../config/runtime.js"
import { parseAgentDispatchPayload, type AgentDispatchCommand } from "../../../domain/chat/agent-dispatch.js"
import { AGENT_LAUNCH_MAX_BODY_BYTES, zLaunchRequest } from "../../../generated/agent-http/zod.gen.js"
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
    return { outcome: "unknown", errorCode: attempt.errorCode }
  }
  if (attempt.status >= 200 && attempt.status < 300) {
    const receipt = parseLaunchReceipt(attempt.status, attempt.body)
    return receipt !== null && receipt.data.run_id === command.runId && receipt.data.session_id === command.conversationId
      ? { outcome: "admitted" }
      : { outcome: "unknown", errorCode: "agent_receipt_invalid" }
  }
  // Unknown owner error payloads never become trusted BFF error codes.
  const errorCode = parseAgentErrorCode(attempt.body) ?? `agent_http_${attempt.status}`
  if (attempt.status === 408 || attempt.status === 425 || attempt.status === 429 || attempt.status >= 500) {
    return { outcome: "unknown", errorCode }
  }
  return { outcome: "not_admitted", errorCode }
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
      return { outcome: "not_admitted", errorCode: "agent_not_configured" }
    }
    const headers = new Headers({
      accept: "application/json",
      "content-type": "application/json",
      "idempotency-key": command.idempotencyKey,
    })
    let payload
    try {
      payload = parseAgentDispatchPayload(command.payload)
    } catch {
      return { outcome: "not_admitted", errorCode: "agent_launch_invalid" }
    }
    if (payload.launch.project_ref !== command.executionProjectRef) return { outcome: "not_admitted", errorCode: "agent_launch_invalid" }
    let launchBody: Buffer
    try {
      launchBody = serializeAgentLaunch(payload.launch)
      const owner = payload.launch.personal_context?.owner
      if (owner !== undefined && (owner.tenant_ref !== command.tenantId || owner.user_ref !== command.actorId))
        return { outcome: "not_admitted", errorCode: "agent_launch_invalid" }
    } catch {
      return { outcome: "not_admitted", errorCode: "agent_launch_invalid" }
    }
    try {
      const upstream = await proxyUpstream(
        this.config,
        baseUrl,
        "/v1/runs",
        "POST",
        command.requestId,
        headers,
        launchBody,
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

/** Exact canonical HTTP body shared by transactional preflight and durable delivery. */
export function serializeAgentLaunch(value: unknown): Buffer {
  const parsed = zLaunchRequest.strict().safeParse(value)
  if (!parsed.success) throw new Error("AGENT_DISPATCH_PAYLOAD_INVALID")
  const { requested_model_label, trace, personal_context, ...required } = parsed.data
  const launch = {
    ...required,
    ...(requested_model_label === undefined ? {} : { requested_model_label }),
    ...(trace === undefined ? {} : { trace }),
    ...(personal_context == null ? {} : { personal_context }),
  }
  const bytes = Buffer.from(JSON.stringify(launch))
  if (bytes.byteLength > AGENT_LAUNCH_MAX_BODY_BYTES) throw new Error("PERSONAL_CONTEXT_TOO_LARGE")
  return bytes
}
