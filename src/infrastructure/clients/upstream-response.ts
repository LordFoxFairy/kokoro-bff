import { failure, ok } from "../../contracts/index.js"
import { isRecord } from "../../domain/json.js"
import type { UpstreamResponse } from "../../upstream.js"

/** Normalize an owner transport response before an application or HTTP adapter consumes it. */
export function normalizeUpstreamResponse(upstream: UpstreamResponse, requestId: string): { status: number; body: unknown } {
  const text = upstream.body.toString("utf8")
  if (text.trim() === "") {
    return {
      status: upstream.status >= 400 ? upstream.status : 502,
      body: failure(
        upstream.status >= 400 ? "upstream_http_error" : "upstream_response_invalid",
        upstream.status >= 400 ? `Upstream returned HTTP ${upstream.status} with an empty body` : "The configured upstream returned an empty response",
        requestId,
      ),
    }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return {
      status: upstream.status >= 400 ? upstream.status : 502,
      body: failure(
        upstream.status >= 400 ? "upstream_http_error" : "upstream_response_invalid",
        upstream.status >= 400 ? `Upstream returned HTTP ${upstream.status}` : "The configured upstream did not return JSON",
        requestId,
      ),
    }
  }
  if (isRecord(parsed) && isRecord(parsed.error) && typeof parsed.error.code === "string" && typeof parsed.error.message === "string") {
    const responseRequestId = isRecord(parsed.meta) && typeof parsed.meta.request_id === "string" && parsed.meta.request_id.trim() !== ""
      ? parsed.meta.request_id.trim()
      : requestId
    return { status: upstream.status >= 400 ? upstream.status : 502, body: failure(parsed.error.code, parsed.error.message, responseRequestId) }
  }
  if (upstream.status >= 400) {
    const responseRequestId = upstream.headers.get("x-kokoro-request-id")?.trim() || requestId
    return { status: upstream.status, body: failure("upstream_http_error", `Upstream returned HTTP ${upstream.status}`, responseRequestId) }
  }
  if (isRecord(parsed) && "data" in parsed) {
    const responseRequestId = isRecord(parsed.meta) && typeof parsed.meta.request_id === "string" && parsed.meta.request_id.trim() !== ""
      ? parsed.meta.request_id.trim()
      : requestId
    return { status: upstream.status, body: { ...parsed, meta: { request_id: responseRequestId } } }
  }
  return { status: upstream.status, body: ok(parsed, requestId) }
}
