import type { IncomingMessage, ServerResponse } from "node:http"
import { isDeepStrictEqual } from "node:util"

import type { BffConfig } from "../../config/runtime.js"
import { failure } from "../../contracts/index.js"
import type { AdmittedUserRequestContext } from "../../domain/request-context.js"
import { zPutRoutingPolicyBody } from "../../generated/system-http/zod.gen.js"
import { strictParseRawJson } from "../../infrastructure/raw-json.js"
import { readSystemModelRouting, writeSystemModelRouting, type SystemModelRoutingReadKind } from "../../infrastructure/clients/owner/system-model-routing.js"
import { headerString, queryOf, requestContentType } from "../request.js"
import { send } from "../response.js"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const READ_KIND = new Map<string, SystemModelRoutingReadKind>([
  ["model-routing", "routing"],
  ["model-labels", "labels"],
  ["model-revisions", "revisions"],
])

function rawHeaderCount(request: IncomingMessage, name: string): number {
  let count = 0
  for (let index = 0; index < request.rawHeaders.length; index += 2) if (request.rawHeaders[index]?.toLowerCase() === name) count++
  return count
}

async function readBodyBeforeDeadline(request: IncomingMessage, signal: AbortSignal): Promise<Buffer> {
  if (signal.aborted) throw new Error("deadline exceeded")
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let settled = false
    const cleanup = (): void => {
      request.removeListener("data", onData)
      request.removeListener("end", onEnd)
      request.removeListener("error", onError)
      signal.removeEventListener("abort", onAbort)
    }
    const fail = (error: Error): void => {
      if (settled) return
      settled = true
      cleanup()
      request.resume()
      reject(error)
    }
    const onData = (chunk: Buffer | string): void => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += bytes.byteLength
      if (size > 1024 * 1024) fail(new Error("request body too large"))
      else chunks.push(bytes)
    }
    const onEnd = (): void => {
      if (settled) return
      settled = true
      cleanup()
      resolve(Buffer.concat(chunks))
    }
    const onError = (error: Error): void => fail(error)
    const onAbort = (): void => fail(new Error("deadline exceeded"))
    request.on("data", onData)
    request.once("end", onEnd)
    request.once("error", onError)
    signal.addEventListener("abort", onAbort, { once: true })
    if (signal.aborted) onAbort()
  })
}

function page(request: IncomingMessage): { limit: number; cursor: string | null } | null {
  const query = queryOf(request)
  if ([...query.keys()].some((key) => key !== "limit" && key !== "cursor")) return null
  if (query.getAll("limit").length > 1 || query.getAll("cursor").length > 1) return null
  const rawLimit = query.get("limit")
  const limit = rawLimit === null ? 50 : Number(rawLimit)
  if (rawLimit !== null && (!/^(?:[1-9]|[1-9][0-9]|100)$/u.test(rawLimit) || !Number.isSafeInteger(limit))) return null
  const cursor = query.get("cursor")
  if (cursor !== null && (cursor.length < 1 || cursor.length > 2048)) return null
  return { limit, cursor }
}

function errorMessage(status: number): string {
  if (status === 400) return "Admin model routing request is invalid"
  if (status === 403) return "Admin model routing access is forbidden"
  if (status === 404) return "Admin model routing resource was not found"
  if (status === 409) return "Admin model routing write conflicted"
  if (status === 502) return "System returned an invalid model routing response"
  return "Admin model routing is unavailable"
}

export async function liveModelRoutingAdmin(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  context: AdmittedUserRequestContext,
  businessPath: readonly string[],
): Promise<void> {
  response.setHeader("x-request-id", context.requestId)
  if (context.platformAdmin !== true) {
    send(response, 403, failure("admin_model_routing_forbidden", "Current administrator qualification is required", context.requestId))
    return
  }
  const base = {
    baseUrl: config.upstreams.system ?? null,
    secret: config.upstreamSecret,
    tenantId: context.identity.namespace,
    actorId: context.identity.userId,
    requestId: context.requestId,
    maxResponseBytes: config.upstreamMaxResponseBytes,
  }
  const abort = new AbortController()
  const deadlineAt = Date.now() + Math.min(config.upstreamTimeoutMs, 10_000)
  const deadline = setTimeout(() => abort.abort(), Math.max(0, deadlineAt - Date.now()))
  deadline.unref()
  const onAbort = (): void => abort.abort()
  const onClose = (): void => {
    if (!response.writableEnded) abort.abort()
  }
  request.once("aborted", onAbort)
  response.once("close", onClose)
  try {
    if (request.aborted || response.destroyed || abort.signal.aborted) return
    const readKind = businessPath.length === 2 ? READ_KIND.get(businessPath[1] ?? "") : undefined
    if (request.method === "GET" && readKind !== undefined) {
      if (
        (request.headers["content-length"] !== undefined && request.headers["content-length"] !== "0") ||
        request.headers["transfer-encoding"] !== undefined ||
        ["idempotency-key", "if-match", "if-none-match"].some((name) => rawHeaderCount(request, name) !== 0)
      ) {
        send(response, 400, failure("invalid_admin_model_routing_request", "Admin model routing read shape is invalid", context.requestId))
        return
      }
      const parsedPage = page(request)
      if (parsedPage === null) {
        send(response, 400, failure("invalid_admin_model_routing_request", "Admin model routing page query is invalid", context.requestId))
        return
      }
      const result = await readSystemModelRouting({ ...base, ...parsedPage, kind: readKind, signal: abort.signal, deadlineAt })
      if (response.destroyed) return
      if (result.ok === false) {
        send(response, result.status, failure(result.code, errorMessage(result.status), context.requestId))
        return
      }
      send(response, 200, { data: result.data, meta: { request_id: context.requestId, next_cursor: result.nextCursor ?? null } })
      return
    }
    if (request.method !== "PUT" || businessPath.length !== 3 || businessPath[1] !== "model-routing" || !UUID.test(businessPath[2] ?? "")) {
      send(response, 404, failure("bff_route_not_found", "Business route was not found", context.requestId))
      return
    }
    if (queryOf(request).size !== 0) {
      send(response, 400, failure("invalid_admin_model_routing_request", "Admin model routing write does not accept query parameters", context.requestId))
      return
    }
    if (
      rawHeaderCount(request, "idempotency-key") !== 1 ||
      rawHeaderCount(request, "content-type") !== 1 ||
      rawHeaderCount(request, "if-match") > 1 ||
      rawHeaderCount(request, "if-none-match") > 1
    ) {
      send(response, 400, failure("invalid_admin_model_routing_request", "Admin model routing headers are invalid", context.requestId))
      return
    }
    const idempotencyKey = headerString(request.headers["idempotency-key"])
    const ifMatch = headerString(request.headers["if-match"])
    const ifNoneMatch = headerString(request.headers["if-none-match"])
    if (idempotencyKey.length < 1 || idempotencyKey.length > 128 || /[^\x21-\x7e]/u.test(idempotencyKey)) {
      send(response, 400, failure("invalid_admin_model_routing_request", "Idempotency-Key is invalid", context.requestId))
      return
    }
    const hasMatch = /^"[1-9][0-9]*"$/u.test(ifMatch)
    const hasNoneMatch = ifNoneMatch === "*"
    if (!hasMatch && !hasNoneMatch) {
      send(response, 428, failure("admin_model_routing_precondition_required", "Exactly one routing precondition is required", context.requestId))
      return
    }
    if ((hasMatch && hasNoneMatch) || (ifMatch !== "" && !hasMatch) || (ifNoneMatch !== "" && !hasNoneMatch)) {
      send(response, 400, failure("invalid_admin_model_routing_request", "Routing precondition is invalid", context.requestId))
      return
    }
    let raw: unknown
    try {
      const bytes = await readBodyBeforeDeadline(request, abort.signal)
      if (requestContentType(request).split(";", 1)[0]?.trim() !== "application/json" || bytes.byteLength === 0) throw new Error("invalid body")
      strictParseRawJson(bytes)
      raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown
    } catch {
      if (abort.signal.aborted) send(response, 503, failure("admin_model_routing_unavailable", "Admin model routing is unavailable", context.requestId))
      else send(response, 400, failure("invalid_admin_model_routing_request", "Admin model routing body is invalid", context.requestId))
      return
    }
    const parsed = zPutRoutingPolicyBody.safeParse(raw)
    if (!parsed.success || !isDeepStrictEqual(raw, parsed.data) || !("model_revision_id" in parsed.data)) {
      send(response, 400, failure("invalid_admin_model_routing_request", "Admin model routing body is invalid", context.requestId))
      return
    }
    if (abort.signal.aborted || Date.now() >= deadlineAt) {
      send(response, 503, failure("admin_model_routing_unavailable", "Admin model routing is unavailable", context.requestId))
      return
    }
    const result = await writeSystemModelRouting({
      ...base,
      labelId: businessPath[2]!,
      body: parsed.data as { model_revision_id: string | null; visible: boolean; is_default: boolean; priority: number },
      idempotencyKey,
      ifMatch: hasMatch ? ifMatch : null,
      ifNoneMatch: hasNoneMatch ? "*" : null,
      signal: abort.signal,
      deadlineAt,
    })
    if (response.destroyed) return
    if (result.ok === false) {
      send(response, result.status, failure(result.code, errorMessage(result.status), context.requestId))
      return
    }
    send(response, 200, { data: result.data, meta: { request_id: context.requestId } })
  } finally {
    clearTimeout(deadline)
    request.removeListener("aborted", onAbort)
    response.removeListener("close", onClose)
  }
}
