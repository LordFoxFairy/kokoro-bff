import type { IncomingMessage, ServerResponse } from "node:http"

import { systemManifestData } from "../../application/projections.js"
import type { BffConfig } from "../../config/runtime.js"
import { failure, ok } from "../../contracts/index.js"
import { normalizeSystemUpstreamResponse } from "../../infrastructure/clients/upstream-response.js"
import { proxyUpstream } from "../../upstream.js"
import { authorizeServerOnly, incomingHeaders, queryOf } from "../request.js"
import { send } from "../response.js"

export async function runtimeManifest(request: IncomingMessage, response: ServerResponse, config: BffConfig, requestId: string): Promise<void> {
  if (!authorizeServerOnly(request, config)) {
    send(response, 403, failure("service_auth_failed", "BFF service authentication failed", requestId))
    return
  }
  const query = queryOf(request)
  const productId = query.get("product_id")?.trim() ?? ""
  const locale = query.get("locale")?.trim() || "en-US"
  const surfaceId = query.get("surface_id")?.trim() || "user-web"
  if (productId === "" || locale === "" || surfaceId === "") {
    send(response, 400, failure("invalid_runtime_manifest_request", "product_id, locale, and surface_id are required", requestId))
    return
  }
  const baseUrl = config.upstreams.system ?? null
  if (baseUrl === null || config.tenantId === null) {
    send(response, 503, failure("upstream_not_configured", "System runtime manifest is not configured", requestId))
    return
  }
  const ownerQuery = new URLSearchParams({ product_id: productId, locale, surface_id: surfaceId })
  try {
    const upstream = await proxyUpstream(
      config,
      baseUrl,
      `/v1/system/runtime-manifest?${ownerQuery.toString()}`,
      "GET",
      requestId,
      incomingHeaders(request),
      undefined,
      { "x-kokoro-tenant-id": config.tenantId },
      "web-bff",
    )
    const normalized = normalizeSystemUpstreamResponse(upstream, requestId)
    if (normalized.status >= 400) {
      send(response, normalized.status, normalized.body)
      return
    }
    const projected = systemManifestData(normalized.body)
    if (projected === null || projected.tenant_id !== config.tenantId || projected.product_id !== productId || projected.locale !== locale) {
      send(response, 502, failure("upstream_response_invalid", "System runtime manifest did not match the v1 owner contract", requestId))
      return
    }
    send(response, normalized.status, ok(projected, requestId))
  } catch {
    send(response, 502, failure("upstream_unreachable", "The configured system upstream is unavailable", requestId))
  }
}
