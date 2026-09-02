import type { IncomingMessage, ServerResponse } from "node:http"

import { failure } from "../../contracts/index.js"
import type { BffConfig } from "../../config.js"
import { projectMoriEventStream, projectMoriResponse, musicOwnerRoute } from "../../adapters/music.js"
import { ownerIdentityHeaders } from "../../application/projections.js"
import { proxyUpstream } from "../../upstream.js"
import { incomingHeaders, type Context } from "../request.js"
import { normalizeUpstreamResponse, reply } from "../response.js"
import type { IdempotencyEntry, MutationTicket } from "../../application/idempotency.js"
import { liveOwnerRequest } from "./owner.js"

export async function liveMoriBusiness(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  context: Context,
  businessPath: string[],
  body: Buffer | undefined,
  mutation: MutationTicket | null,
  idempotency: Map<string, IdempotencyEntry>,
): Promise<void> {
  const method = request.method || "GET"
  const route = musicOwnerRoute(businessPath, method, request.url)
  if (route === null) {
    await reply(response, 404, failure("mori_route_not_found", "Mori business route was not found", context.requestId), context, idempotency, mutation)
    return
  }
  const musicBase = config.upstreams.music ?? null
  if (musicBase === null) {
    await reply(response, 503, failure("music_owner_not_configured", "Mori Music owner is not configured", context.requestId), context, idempotency, mutation)
    return
  }

  if (!route.stream) {
    const result = await liveOwnerRequest(request, config, context, "music", route.path, method, body)
    if (result.status >= 400) {
      await reply(response, result.status, result.body, context, idempotency, mutation)
      return
    }
    const projected = projectMoriResponse(route.kind, result.body, context.requestId)
    if (projected === null) {
      await reply(response, 502, failure("upstream_response_invalid", "Music owner response did not match the Mori contract", context.requestId), context, idempotency, mutation)
      return
    }
    await reply(response, result.status, projected, context, idempotency, mutation)
    return
  }

  try {
    const upstream = await proxyUpstream(
      config,
      musicBase,
      route.path,
      method,
      context.requestId,
      incomingHeaders(request),
      body,
      ownerIdentityHeaders(context),
      "web-bff",
    )
    if (upstream.status >= 400) {
      const normalized = normalizeUpstreamResponse(upstream, context.requestId)
      await reply(response, normalized.status, normalized.body, context, idempotency, mutation)
      return
    }
    if (!(upstream.headers.get("content-type") || "").toLowerCase().startsWith("text/event-stream")) {
      await reply(response, 502, failure("upstream_response_invalid", "Music owner events did not use text/event-stream", context.requestId), context, idempotency, mutation)
      return
    }
    const generationRef = businessPath[2] || ""
    const projected = projectMoriEventStream(generationRef, upstream.body, context.requestId)
    if (projected === null) {
      await reply(response, 502, failure("upstream_response_invalid", "Music owner events did not match the Mori contract", context.requestId), context, idempotency, mutation)
      return
    }
    response.writeHead(upstream.status, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive",
    })
    response.end(projected)
  } catch {
    await reply(response, 502, failure("upstream_unreachable", "The configured Music owner is unavailable", context.requestId), context, idempotency, mutation)
  }
}
