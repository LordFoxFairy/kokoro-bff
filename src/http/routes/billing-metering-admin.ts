import type { IncomingMessage, ServerResponse } from "node:http"
import type { BffConfig } from "../../config/runtime.js"
import type { AdmittedUserRequestContext } from "../../domain/request-context.js"
import type { SessionAdmission, SessionAdmissionResult } from "../../auth/session-admission.types.js"
import { failure, ok } from "../../contracts/index.js"
import { requestBillingMetering } from "../../infrastructure/clients/owner/billing-metering.js"
import { parseMeteringCommand, type MeteringOperation } from "../../infrastructure/clients/owner/billing-metering-wire.js"
import { rawHeaderCount, readBodyBeforeDeadline } from "../request-body.js"
import { send } from "../response.js"

export function matchMeteringAdmin(method: string, path: readonly string[]): "read" | "rate" | "policy" | null {
  if (path.length !== 4 || path.slice(0, 3).join("/") !== "admin/billing/metering") return null
  if (method === "GET" && path[3] === "pricing") return "read"
  if (method === "POST" && path[3] === "rate-revisions") return "rate"
  if (method === "POST" && path[3] === "policy-revisions") return "policy"
  return null
}
export async function liveAdminMetering(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  context: AdmittedUserRequestContext,
  token: string,
  admission: SessionAdmission,
  kind: "read" | "rate" | "policy",
  deadlineAt: number,
): Promise<void> {
  response.setHeader("cache-control", "no-store")
  response.setHeader("x-request-id", context.requestId)
  const fail = (status: number, code: string) => {
    if (!response.destroyed && !response.writableEnded) send(response, status, failure(code, "Metering configuration was not confirmed", context.requestId))
  }
  if (!context.platformAdmin) {
    fail(403, "admin_billing_forbidden")
    return
  }
  const expected = "/v1/admin/billing/metering/" + (kind === "read" ? "pricing" : kind + "-revisions")
  if (request.url !== expected || ["if-match", "if-none-match", "content-encoding"].some((name) => rawHeaderCount(request, name) !== 0)) {
    fail(400, "invalid_admin_metering_request")
    return
  }
  if (kind === "read" && ["content-length", "transfer-encoding", "content-type", "idempotency-key"].some((name) => rawHeaderCount(request, name) !== 0)) {
    fail(400, "invalid_admin_metering_request")
    return
  }
  const key = request.headers["idempotency-key"]
  if (kind !== "read") {
    const length = request.headers["content-length"],
      encoding = request.headers["transfer-encoding"]
    if (
      request.method !== "POST" ||
      rawHeaderCount(request, "content-type") !== 1 ||
      !/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(String(request.headers["content-type"])) ||
      rawHeaderCount(request, "idempotency-key") !== 1 ||
      typeof key !== "string" ||
      !/^[\x21-\x2b\x2d-\x7e]{8,128}$/u.test(key) ||
      (length !== undefined &&
        (rawHeaderCount(request, "content-length") !== 1 ||
          typeof length !== "string" ||
          !/^[1-9][0-9]{0,6}$/u.test(length) ||
          BigInt(length) > 1_048_576n ||
          encoding !== undefined)) ||
      (encoding !== undefined && (rawHeaderCount(request, "transfer-encoding") !== 1 || encoding !== "chunked"))
    ) {
      fail(400, "invalid_admin_metering_request")
      return
    }
  }
  const abort = new AbortController(),
    cancel = () => abort.abort(),
    close = () => {
      if (!response.writableEnded) abort.abort()
    }
  const check = () => {
    if (Date.now() >= deadlineAt) abort.abort()
    abort.signal.throwIfAborted()
  }
  const timer = setTimeout(cancel, Math.max(0, deadlineAt - Date.now()))
  timer.unref()
  request.once("aborted", cancel)
  response.once("close", close)
  try {
    check()
    let operation: MeteringOperation = { kind: "read" }
    if (kind !== "read") {
      let parsed
      try {
        parsed = parseMeteringCommand(kind, await readBodyBeforeDeadline(request, abort.signal, 1_048_576), key as string)
      } catch {
        fail(abort.signal.aborted ? 503 : 400, abort.signal.aborted ? "billing_metering_unavailable" : "invalid_admin_metering_request")
        return
      }
      check()
      if (parsed === null) {
        fail(400, "invalid_admin_metering_request")
        return
      }
      operation = parsed
    }
    const current = await new Promise<SessionAdmissionResult>((resolve, reject) => {
      const onAbort = () => {
        abort.signal.removeEventListener("abort", onAbort)
        reject(new Error("Metering administrator deadline"))
      }
      abort.signal.addEventListener("abort", onAbort, { once: true })
      if (abort.signal.aborted) {
        onAbort()
        return
      }
      void Promise.resolve()
        .then(() => {
          check()
          return admission.verify({ token, requestId: context.requestId, signal: abort.signal })
        })
        .then(
          (value) => {
            abort.signal.removeEventListener("abort", onAbort)
            resolve(value)
          },
          () => {
            abort.signal.removeEventListener("abort", onAbort)
            reject(new Error("Metering administrator unavailable"))
          },
        )
    })
    check()
    if (!current.ok) {
      fail(current.status, current.code)
      return
    }
    if (!current.platformAdmin || current.identity.namespace !== context.identity.namespace || current.identity.userId !== context.identity.userId) {
      fail(403, "admin_billing_forbidden")
      return
    }
    const result = await requestBillingMetering(config, context, operation, abort.signal, deadlineAt)
    check()
    if (!result.ok) {
      fail(result.status, result.code)
      return
    }
    if (!response.destroyed && !response.writableEnded) send(response, kind === "read" ? 200 : 201, ok(result.data, context.requestId))
  } catch {
    fail(503, "billing_metering_unavailable")
  } finally {
    clearTimeout(timer)
    request.removeListener("aborted", cancel)
    response.removeListener("close", close)
  }
}
