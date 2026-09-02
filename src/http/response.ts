import type { ServerResponse } from "node:http"

import { failure, ok } from "../contracts/index.js"
import { commitReceipt, type IdempotencyEntry, type MutationTicket } from "../application/idempotency.js"
import { headerString, isRecord, type Context } from "./request.js"
import type { UpstreamResponse } from "../upstream.js"

export function send(response: ServerResponse, status: number, body: unknown): void {
  const payload = Buffer.from(JSON.stringify(body))
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "content-length": payload.byteLength })
  response.end(payload)
}

export function normalizeUpstreamResponse(upstream: UpstreamResponse, requestId: string): { status: number; body: unknown } {
  const text = upstream.body.toString("utf8")
  if (text.trim() === "") return { status: upstream.status >= 400 ? upstream.status : 502, body: failure(upstream.status >= 400 ? "upstream_http_error" : "upstream_response_invalid", upstream.status >= 400 ? `Upstream returned HTTP ${upstream.status} with an empty body` : "The configured upstream returned an empty response", requestId) }
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { return { status: upstream.status >= 400 ? upstream.status : 502, body: failure(upstream.status >= 400 ? "upstream_http_error" : "upstream_response_invalid", upstream.status >= 400 ? `Upstream returned HTTP ${upstream.status}` : "The configured upstream did not return JSON", requestId) } }
  if (isRecord(parsed) && isRecord(parsed.error) && typeof parsed.error.code === "string" && typeof parsed.error.message === "string") {
    const responseRequestId = isRecord(parsed.meta) && typeof parsed.meta.request_id === "string" && parsed.meta.request_id.trim() !== "" ? parsed.meta.request_id.trim() : requestId
    return { status: upstream.status >= 400 ? upstream.status : 502, body: failure(parsed.error.code, parsed.error.message, responseRequestId) }
  }
  if (upstream.status >= 400) {
    const responseRequestId = headerString(upstream.headers.get("x-kokoro-request-id") ?? "").trim() || requestId
    return { status: upstream.status, body: failure("upstream_http_error", `Upstream returned HTTP ${upstream.status}`, responseRequestId) }
  }
  if (isRecord(parsed) && "data" in parsed) {
    const responseRequestId = isRecord(parsed.meta) && typeof parsed.meta.request_id === "string" && parsed.meta.request_id.trim() !== "" ? parsed.meta.request_id.trim() : requestId
    return { status: upstream.status, body: { ...parsed, meta: { request_id: responseRequestId } } }
  }
  return { status: upstream.status, body: ok(parsed, requestId) }
}

export async function reply(
  response: ServerResponse,
  status: number,
  body: unknown,
  context: Context,
  idempotency: Map<string, IdempotencyEntry>,
  mutation: MutationTicket | null,
): Promise<void> {
  try {
    await commitReceipt(idempotency, mutation, status, body)
    send(response, status, body)
  } catch {
    send(response, 503, failure("business_store_unavailable", "The BFF business store is unavailable", context.requestId))
  }
}
