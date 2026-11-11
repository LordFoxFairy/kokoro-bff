import type { BffConfig } from "../../../config/runtime.js"
import { isRecord } from "../../../domain/json.js"
import { proxyUpstream } from "../../../upstream.js"
import { normalizeUpstreamResponse } from "../upstream-response.js"
import { agentControlRequestDigest, parseAgentControlReceipt } from "./control-receipt.js"
import { agentIdentityHeaders } from "./identity.js"

type SteerErrorCode = "control_apply_failed" | "control_enqueue_failed" | "control_superseded"

export type SteerDeliveryResult =
  | { status: "unknown" | "pending" | "succeeded" }
  | { status: "failed"; errorCode?: SteerErrorCode }

export type SteerDeliveryCommand = Readonly<{
  tenant_id: string
  subject_id: string
  actor_id: string
  request_id: string
  identity_assertion_ref: string
  agent_command_id: string
  run_id: string
  conversation_id: string
  message_id: string
  content: string
}>

function ownerErrorCode(code: string | undefined): SteerErrorCode | undefined {
  return code === "control_apply_failed" || code === "control_enqueue_failed" || code === "control_superseded" ? code : undefined
}

/** 8.11 wire, paired with the Agent that makes steer success a checkpoint fact. */
export async function deliverRunSteer(config: BffConfig, command: SteerDeliveryCommand, timeoutMs: number): Promise<SteerDeliveryResult> {
  const baseUrl = config.upstreams.agents ?? null
  if (!config.agentEnabled || baseUrl === null) return { status: "unknown" }
  const body = { kind: "run.steer", session_id: command.conversation_id, message_id: command.message_id, content: command.content }
  try {
    const result = await proxyUpstream(
      config, baseUrl, `/v1/runs/${encodeURIComponent(command.run_id)}/control`, "POST", command.request_id,
      new Headers({ accept: "application/json", "content-type": "application/json", "idempotency-key": command.agent_command_id }),
      Buffer.from(JSON.stringify(body)),
      agentIdentityHeaders({ namespace: command.tenant_id, userId: command.subject_id }, command.identity_assertion_ref, command.actor_id),
      "kokoro-bff", config.upstreamSecret, timeoutMs,
    )
    if (result.status !== 202) return { status: "unknown" }
    const envelope = normalizeUpstreamResponse(result, command.request_id).body
    const receipt = parseAgentControlReceipt(isRecord(envelope) ? envelope.data : undefined)
    if (receipt === null || receipt.command_id !== command.agent_command_id || receipt.request_digest !== agentControlRequestDigest(command.run_id, body)) {
      return { status: "unknown" }
    }
    if (receipt.status !== "failed") return receipt.error_code === undefined ? { status: receipt.status } : { status: "unknown" }
    const errorCode = ownerErrorCode(receipt.error_code)
    return { status: "failed", ...(errorCode === undefined ? {} : { errorCode }) }
  } catch {
    // ACK loss is ambiguous, not proof that the original Run did not consume input.
    return { status: "unknown" }
  }
}
