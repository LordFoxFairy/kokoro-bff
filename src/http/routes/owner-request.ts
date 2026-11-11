import type { IncomingMessage } from "node:http"

import type { BffConfig } from "../../config/runtime.js"
import { failure } from "../../contracts/index.js"
import { proxyUpstream } from "../../upstream.js"
import { ownerIdentityHeaders } from "../../infrastructure/clients/owner/identity.js"
import { normalizeSystemUpstreamResponse, normalizeUpstreamResponse } from "../../infrastructure/clients/upstream-response.js"
import { incomingHeaders } from "../request.js"
import type { RequestContext } from "../../domain/request-context.js"
import type { LiveOwnerResult } from "./types.js"

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
