import type { IncomingMessage, ServerResponse } from "node:http"
import type { BffConfig } from "../../config/runtime.js"
import type { AdmittedUserRequestContext } from "../../domain/request-context.js"
import { failure } from "../../contracts/index.js"
import {
  matchModelConfiguration,
  modelConfigurationOperations,
  systemModelConfiguration,
} from "../../infrastructure/clients/owner/system-model-configuration.js"
import { strictParseRawJson } from "../../infrastructure/raw-json.js"
import { headerString, queryOf, requestContentType } from "../request.js"
import { send } from "../response.js"
import { page, errorMessage } from "./model-routing-admin.js"
import { rawHeaderCount, readBodyBeforeDeadline } from "../request-body.js"

export async function liveModelConfigurationAdmin(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  context: AdmittedUserRequestContext,
  path: readonly string[],
  sharedDeadline?: number,
): Promise<boolean> {
  const match = matchModelConfiguration(request.method ?? "", path)
  if (match === null) return false
  response.setHeader("x-request-id", context.requestId)
  const fail = (status: number, code: string) => send(response, status, failure(code, errorMessage(status), context.requestId))
  if (context.platformAdmin !== true) {
    fail(403, "admin_model_routing_forbidden")
    return true
  }
  const abort = new AbortController(),
    deadlineAt = Math.min(sharedDeadline ?? Infinity, Date.now() + Math.min(config.upstreamTimeoutMs, 10_000))
  const timeout = setTimeout(() => abort.abort(), Math.max(0, deadlineAt - Date.now()))
  timeout.unref()
  const close = () => {
      if (!response.writableEnded) abort.abort()
    },
    cancel = () => abort.abort()
  request.once("aborted", cancel)
  response.once("close", close)
  try {
    const spec = modelConfigurationOperations[match.operation],
      query = new URLSearchParams()
    let body: Record<string, unknown> | undefined, key: string | undefined, ifMatch: string | undefined
    if (spec.method === "GET") {
      if (
        match.operation === "upstreamModels" &&
        (queryOf(request).size !== 0 ||
          ["content-length", "transfer-encoding", "content-type", "idempotency-key", "if-match", "if-none-match"].some(
            (name) => rawHeaderCount(request, name) !== 0,
          ))
      ) {
        fail(400, "invalid_admin_model_routing_request")
        return true
      }
      if (
        (request.headers["content-length"] !== undefined && request.headers["content-length"] !== "0") ||
        request.headers["transfer-encoding"] !== undefined ||
        ["idempotency-key", "if-match", "if-none-match"].some((name) => rawHeaderCount(request, name) !== 0)
      ) {
        fail(400, "invalid_admin_model_routing_request")
        return true
      }
      if (match.operation === "providerCreation") {
        const raw = queryOf(request),
          value = raw.get("idempotency_key")
        if (raw.size !== 1 || raw.getAll("idempotency_key").length !== 1 || value === null || !/^[\x21-\x2b\x2d-\x7e]{1,128}$/u.test(value)) {
          fail(400, "invalid_admin_model_routing_request")
          return true
        }
        query.set("idempotency_key", value)
      } else if (match.operation !== "upstreamModels") {
        const selected = page(request)
        if (selected === null) {
          fail(400, "invalid_admin_model_routing_request")
          return true
        }
        query.set("limit", String(selected.limit))
        if (selected.cursor !== null) query.set("cursor", selected.cursor)
      }
    } else {
      if (
        queryOf(request).size !== 0 ||
        rawHeaderCount(request, "idempotency-key") !== 1 ||
        rawHeaderCount(request, "if-none-match") !== 0 ||
        rawHeaderCount(request, "if-match") > ("conditional" in spec ? 1 : 0)
      ) {
        fail(400, "invalid_admin_model_routing_request")
        return true
      }
      key = headerString(request.headers["idempotency-key"])
      if (!/^[\x21-\x2b\x2d-\x7e]{1,128}$/u.test(key)) {
        fail(400, "invalid_admin_model_routing_request")
        return true
      }
      if ("conditional" in spec) {
        ifMatch = headerString(request.headers["if-match"])
        if (ifMatch === "") {
          fail(428, "admin_model_routing_precondition_required")
          return true
        }
        if (!/^"[1-9][0-9]*"$/u.test(ifMatch)) {
          fail(400, "invalid_admin_model_routing_request")
          return true
        }
      }
      if (match.operation === "publishRevision") {
        const bytes = await readBodyBeforeDeadline(request, abort.signal)
        if (bytes.length !== 0 || request.headers["transfer-encoding"] !== undefined || rawHeaderCount(request, "content-type") !== 0) {
          fail(400, "invalid_admin_model_routing_request")
          return true
        }
      } else if ("body" in spec) {
        if (rawHeaderCount(request, "content-type") !== 1 || requestContentType(request).split(";", 1)[0]?.trim() !== "application/json") {
          fail(400, "invalid_admin_model_routing_request")
          return true
        }
        let raw: unknown
        try {
          const bytes = await readBodyBeforeDeadline(request, abort.signal)
          strictParseRawJson(bytes)
          raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown
        } catch {
          fail(abort.signal.aborted ? 503 : 400, abort.signal.aborted ? "admin_model_routing_unavailable" : "invalid_admin_model_routing_request")
          return true
        }
        if (!spec.body.safeParse(raw).success || raw === null || typeof raw !== "object" || Array.isArray(raw)) {
          fail(400, "invalid_admin_model_routing_request")
          return true
        }
        body = raw as Record<string, unknown>
      }
    }
    const result = await systemModelConfiguration({
      baseUrl: config.upstreams.system ?? null,
      secret: config.systemModelManagementToken ?? null,
      tenantId: context.identity.namespace,
      actorId: context.identity.userId,
      requestId: context.requestId,
      maxResponseBytes: config.upstreamMaxResponseBytes,
      signal: abort.signal,
      deadlineAt,
      operation: match.operation,
      ...(match.id === undefined ? {} : { id: match.id }),
      query,
      ...(body === undefined ? {} : { body }),
      ...(key === undefined ? {} : { key }),
      ...(ifMatch === undefined ? {} : { ifMatch }),
    })
    if (response.destroyed) return true
    if (!result.ok) {
      fail(result.status, result.code)
      return true
    }
    send(response, spec.method === "POST" && match.operation !== "publishRevision" ? 201 : 200, {
      data: result.data,
      meta: { request_id: context.requestId, ...(result.nextCursor === undefined ? {} : { next_cursor: result.nextCursor }) },
    })
    return true
  } catch {
    if (!response.destroyed) fail(503, "admin_model_routing_unavailable")
    return true
  } finally {
    clearTimeout(timeout)
    request.removeListener("aborted", cancel)
    response.removeListener("close", close)
  }
}
