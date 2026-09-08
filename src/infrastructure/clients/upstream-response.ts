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

/** Validate the System v2 owner envelope without applying legacy owner compatibility wrapping. */
export function normalizeSystemUpstreamResponse(upstream: UpstreamResponse, requestId: string): { status: number; body: unknown } {
  let parsed: unknown
  try {
    parsed = JSON.parse(upstream.body.toString("utf8"))
  } catch {
    return { status: 502, body: failure("upstream_response_invalid", "System returned an invalid JSON envelope", requestId) }
  }
  if (!isRecord(parsed)) {
    return { status: 502, body: failure("upstream_response_invalid", "System returned an invalid response envelope", requestId) }
  }
  const rootKeys = Object.keys(parsed)
  if (upstream.status === 200) {
    if (rootKeys.length !== 1 || rootKeys[0] !== "data" || !isRecord(parsed.data)) {
      return { status: 502, body: failure("upstream_response_invalid", "System returned an invalid success envelope", requestId) }
    }
    return { status: upstream.status, body: parsed }
  }
  if (upstream.status < 400) {
    return { status: 502, body: failure("upstream_response_invalid", `System returned unexpected HTTP ${upstream.status}`, requestId) }
  }
  if (rootKeys.length !== 1 || rootKeys[0] !== "error" || !isRecord(parsed.error)) {
    return { status: 502, body: failure("upstream_response_invalid", "System returned an invalid error envelope", requestId) }
  }
  const errorKeys = Object.keys(parsed.error).sort()
  if (
    errorKeys.join(",") !== "code,message,retryable"
    || typeof parsed.error.code !== "string" || parsed.error.code.trim() === ""
    || typeof parsed.error.message !== "string"
    || typeof parsed.error.retryable !== "boolean"
  ) {
    return { status: 502, body: failure("upstream_response_invalid", "System returned an invalid error envelope", requestId) }
  }
  return { status: upstream.status, body: failure(parsed.error.code, parsed.error.message, requestId) }
}
