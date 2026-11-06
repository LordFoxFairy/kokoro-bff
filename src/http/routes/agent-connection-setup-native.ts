import type { IncomingMessage, ServerResponse } from "node:http"
import { z } from "zod"

import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import { authorizeUserRequest } from "../../auth/user-admission.js"
import { failure } from "../../contracts/index.js"
import { callAgent } from "./agent.js"
import { pathOf, queryOf, requestId } from "../request.js"
import { send } from "../response.js"

const platformSchema = z.enum(["telegram", "line", "slack"])
const setupDataSchema = z
  .object({
    platform: platformSchema,
    status: z.enum(["disconnected", "pending", "connected", "expired"]),
    qr_value: z.string().min(1).max(4096),
    continue_url: z.string().url().max(2048),
    expires_at: z.iso.datetime({ offset: true }),
  })
  .strict()
const setupEnvelopeSchema = z
  .object({
    data: setupDataSchema,
    meta: z.object({ request_id: z.string().min(1).max(128) }).strict(),
  })
  .strict()

export function agentConnectionSetupRequest(request: IncomingMessage): boolean {
  try {
    const path = pathOf(request)
    return request.method === "GET" && path.length === 4 && path[0] === "v1" && path[1] === "agents" && path[2] === "connections" && path[3] === "setup"
  } catch {
    return false
  }
}

function platformOf(request: IncomingMessage): string | null {
  const query = queryOf(request)
  const entries = [...query.entries()]
  if (entries.length !== 1 || entries[0]?.[0] !== "platform") return null
  const value = entries[0][1].trim()
  const parsed = platformSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

/** Explicit Agent setup adapter; the generic upstream fallback must not own this contract path. */
export async function handleAgentConnectionSetupRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  admission: SessionAdmission,
): Promise<boolean> {
  if (!agentConnectionSetupRequest(request)) return false
  const id = requestId(request)
  response.setHeader("x-request-id", id)

  const url = new URL(request.url ?? "/", "http://bff.local")
  const contentLength = request.headers["content-length"]
  if (url.hash || request.headers["transfer-encoding"] !== undefined || (contentLength !== undefined && contentLength !== "0")) {
    send(response, 400, failure("invalid_agent_request", "Agent setup request must not contain a body", id))
    return true
  }

  const platform = platformOf(request)
  if (platform === null) {
    send(response, 400, failure("invalid_agent_platform", "platform must be telegram, line, or slack", id))
    return true
  }
  const selectedPlatform = platform

  const admitted = await authorizeUserRequest(request, config, admission, id, AbortSignal.timeout(Math.min(config.upstreamTimeoutMs, 10_000)), response)
  if (!admitted.ok) {
    send(response, admitted.status, failure(admitted.code, "BFF user admission failed", id), admitted.retryAfter)
    return true
  }

  const agentBase = config.upstreams.agents ?? null
  if (!config.agentEnabled || agentBase === null) {
    send(response, 503, failure("agent_not_configured", "Agent setup is not configured", id))
    return true
  }

  const result = await callAgent(
    config,
    agentBase,
    `/v1/agents/connections/setup?platform=${encodeURIComponent(selectedPlatform)}`,
    "GET",
    id,
    request,
    undefined,
    admitted.context,
    `bff:agent-connection-setup:${id}`,
  )
  if (result.status >= 400) {
    send(response, result.status, result.body)
    return true
  }
  if (!setupEnvelopeSchema.safeParse(result.body).success) {
    send(response, 502, failure("upstream_response_invalid", "Agent setup response did not match the v1 contract", id))
    return true
  }
  send(response, result.status, result.body)
  return true
}
