import type { CreateRunData } from "../../../generated/agent-http/types.gen.js"
import type { ScheduledAgentDispatchDeliveryPort, ScheduledAgentDeliveryResult } from "../../../application/ports/scheduled-agent-dispatch-delivery.js"
import type { ScheduledAgentDispatchCommand } from "../../../domain/scheduled-task/agent-dispatch.js"
import type { BffConfig } from "../../../config/runtime.js"
import { isRecord } from "../../../domain/json.js"
import { proxyUpstream } from "../../../upstream.js"
import { parseAgentErrorCode, parseAgentHttpJson, parseLaunchReceipt } from "./http-wire.js"
import { agentIdentityHeaders } from "./identity.js"

export function classifyScheduledDeliveryStatus(status: number): "unknown" | "not_admitted" {
  return status >= 400 && status < 500 && status !== 408 && status !== 425 && status !== 429 ? "not_admitted" : "unknown"
}

function transportCode(error: unknown): string {
  return isRecord(error) && typeof error.code === "string" ? error.code : "agent_transport_error"
}
export class ScheduledAgentDispatchDelivery implements ScheduledAgentDispatchDeliveryPort {
  public constructor(private readonly config: BffConfig) {}
  public async deliver(command: ScheduledAgentDispatchCommand, timeoutMs: number): Promise<ScheduledAgentDeliveryResult> {
    const base = this.config.upstreams.agents ?? null
    if (!this.config.agentEnabled || base === null) return { outcome: "not_admitted", errorCode: "agent_not_configured" }
    try {
      const body: CreateRunData["body"] = command.payload as CreateRunData["body"]
      const upstream = await proxyUpstream(
        this.config,
        base,
        "/v1/runs",
        "POST",
        command.requestId,
        new Headers({ accept: "application/json", "content-type": "application/json", "idempotency-key": command.idempotencyKey }),
        Buffer.from(JSON.stringify(body)),
        agentIdentityHeaders({ namespace: command.tenantId, userId: command.subjectId }, command.identityAssertionRef),
        "kokoro-bff",
        this.config.upstreamSecret,
        timeoutMs,
      )
      const parsed = parseAgentHttpJson(upstream.body)
      if (upstream.status >= 200 && upstream.status < 300) {
        const receipt = parseLaunchReceipt(upstream.status, parsed)
        return receipt !== null && receipt.data.run_id === command.runId && receipt.data.session_id === body.session_id
          ? { outcome: "admitted" }
          : { outcome: "unknown", errorCode: "agent_receipt_invalid" }
      }
      const code = parseAgentErrorCode(parsed) ?? `agent_http_${upstream.status}`
      const outcome = classifyScheduledDeliveryStatus(upstream.status)
      return { outcome, errorCode: code }
    } catch (error) {
      return { outcome: "unknown", errorCode: transportCode(error) }
    }
  }
}
