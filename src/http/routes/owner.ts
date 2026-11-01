import type { IncomingMessage, ServerResponse } from "node:http"

import type { BffConfig } from "../../config/runtime.js"
import { failure } from "../../contracts/index.js"
import { proxyUpstream } from "../../upstream.js"
import { ownerIdentityHeaders } from "../../infrastructure/clients/owner/identity.js"
import { reply } from "../response.js"
import { normalizeSystemUpstreamResponse, normalizeUpstreamResponse } from "../../infrastructure/clients/upstream-response.js"
import { incomingHeaders } from "../request.js"
import type { RequestContext } from "../../domain/request-context.js"
import type { IdempotencyEntry, MutationTicket } from "../../application/idempotency.js"
import type { LiveOwnerResult } from "./types.js"
import { livePlatformProjectionRead } from "./platform-projection.js"
export async function liveOwnerRequest(
  request: IncomingMessage,
  config: BffConfig,
  context: RequestContext,
  owner: string,
  path: string,
  method: string,
  body?: Buffer,
  strictSystemEnvelope = false,
): Promise<LiveOwnerResult> {
  const baseUrl = config.upstreams[owner] ?? null
  if (baseUrl === null) {
    return { status: 503, body: failure("upstream_not_configured", `No upstream is configured for ${owner}`, context.requestId) }
  }
  try {
    const upstream = await proxyUpstream(
      config,
      baseUrl,
      path,
      method,
      context.requestId,
      incomingHeaders(request),
      body,
      ownerIdentityHeaders(context),
      "web-bff",
    )
    return strictSystemEnvelope ? normalizeSystemUpstreamResponse(upstream, context.requestId) : normalizeUpstreamResponse(upstream, context.requestId)
  } catch {
    return { status: 502, body: failure("upstream_unreachable", `The configured ${owner} upstream is unavailable`, context.requestId) }
  }
}

export async function liveOwnerBusiness(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  context: RequestContext,
  businessPath: string[],
  mutation: MutationTicket | null,
  idempotency: Map<string, IdempotencyEntry>,
): Promise<boolean> {
  if (await livePlatformProjectionRead(request, response, config, context, businessPath)) return true

  if (businessPath[0] === "system") {
    await reply(
      response,
      503,
      failure("system_projection_not_configured", "This System operation is not exposed by the BFF owner adapter", context.requestId),
      context,
      idempotency,
      mutation,
    )
    return true
  }

  if (businessPath[0] === "skills") {
    await reply(
      response,
      503,
      failure("platform_operation_not_available", "This Platform operation is not exposed by the BFF owner adapter", context.requestId),
      context,
      idempotency,
      mutation,
    )
    return true
  }

  return false
}
