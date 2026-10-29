import type { IncomingMessage, ServerResponse } from "node:http"
import type { BffConfig } from "../../config/runtime.js"
import type { AdmittedUserRequestContext } from "../../domain/request-context.js"
import type { SessionAdmission, SessionAdmissionResult } from "../../auth/session-admission.types.js"
import { failure, ok } from "../../contracts/index.js"
import { issueBillingCreditGrant } from "../../infrastructure/clients/owner/billing-credit-grant.js"
import { readIamTeamPage } from "../../infrastructure/clients/iam-team.js"
import { parseCreditGrantCommand } from "../billing-credit-grant-input.js"
import { rawHeaderCount, readBodyBeforeDeadline } from "../request-body.js"
import { send } from "../response.js"

export async function liveAdminCreditGrant(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  context: AdmittedUserRequestContext,
  token: string,
  admission: SessionAdmission,
  deadlineAt: number,
): Promise<void> {
  response.setHeader("cache-control", "no-store")
  response.setHeader("x-request-id", context.requestId)
  const fail = (status: number, code: string) => {
    if (!response.destroyed) send(response, status, failure(code, "Credit issuance was not confirmed", context.requestId))
  }
  if (!context.platformAdmin) {
    fail(403, "admin_billing_forbidden")
    return
  }
  if (
    request.method !== "POST" ||
    request.url !== "/v1/admin/billing/credit-grants" ||
    rawHeaderCount(request, "content-type") !== 1 ||
    !/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(String(request.headers["content-type"])) ||
    rawHeaderCount(request, "idempotency-key") !== 1 ||
    typeof request.headers["idempotency-key"] !== "string" ||
    !/^[\x21-\x2b\x2d-\x7e]{8,128}$/u.test(request.headers["idempotency-key"]) ||
    ["if-match", "if-none-match"].some((name) => rawHeaderCount(request, name) !== 0)
  ) {
    fail(400, "invalid_admin_credit_grant")
    return
  }
  const abort = new AbortController(),
    cancel = () => abort.abort(),
    close = () => {
      if (!response.writableEnded) abort.abort()
    }
  const checkBudget = () => {
    if (Date.now() >= deadlineAt) abort.abort()
    abort.signal.throwIfAborted()
  }
  const timeout = setTimeout(cancel, Math.max(0, deadlineAt - Date.now()))
  timeout.unref()
  request.once("aborted", cancel)
  response.once("close", close)
  try {
    checkBudget()
    let body
    try {
      body = parseCreditGrantCommand(await readBodyBeforeDeadline(request, abort.signal, 16384))
    } catch {
      fail(abort.signal.aborted ? 503 : 400, abort.signal.aborted ? "billing_credit_grant_unavailable" : "invalid_admin_credit_grant")
      return
    }
    checkBudget()
    if (body === null) {
      fail(400, "invalid_admin_credit_grant")
      return
    }
    if (!config.billingOperatorProxySecret || !config.upstreams.billing) {
      fail(503, "billing_credit_grant_unavailable")
      return
    }
    const cursors = new Set<string>(),
      key = request.headers["idempotency-key"]
    let cursor: string | null = null,
      found = false
    for (let page = 0; page < 20; page++) {
      checkBudget()
      const members = await readIamTeamPage({
        baseUrl: config.iamBaseUrl,
        tenantId: context.identity.namespace,
        token,
        kind: "members",
        limit: 100,
        cursor,
        requestId: context.requestId,
        signal: abort.signal,
        timeoutMs: Math.max(1, deadlineAt - Date.now()),
        maxResponseBytes: config.upstreamMaxResponseBytes,
      })
      checkBudget()
      if (!members.ok) {
        fail(members.status === 400 || members.status === 404 ? 502 : members.status, members.code)
        return
      }
      found = members.data.some((item) => item !== null && typeof item === "object" && "user_id" in item && item.user_id === body.subject_id)
      if (found) break
      cursor = members.nextCursor
      if (cursor === null) {
        fail(403, "admin_billing_recipient_forbidden")
        return
      }
      if (cursors.has(cursor)) {
        fail(502, "upstream_response_invalid")
        return
      }
      cursors.add(cursor)
    }
    if (!found) {
      fail(503, "billing_recipient_check_incomplete")
      return
    }
    checkBudget()
    const current = await new Promise<SessionAdmissionResult>((resolve, reject) => {
      const onAbort = () => {
        abort.signal.removeEventListener("abort", onAbort)
        reject(new Error("Administrator recheck deadline"))
      }
      abort.signal.addEventListener("abort", onAbort, { once: true })
      if (abort.signal.aborted) {
        onAbort()
        return
      }
      void Promise.resolve()
        .then(() =>
          admission.verify({
            token,
            requestId: context.requestId,
            signal: abort.signal,
          }),
        )
        .then(
          (value) => {
            abort.signal.removeEventListener("abort", onAbort)
            resolve(value)
          },
          () => {
            abort.signal.removeEventListener("abort", onAbort)
            reject(new Error("Administrator recheck unavailable"))
          },
        )
    })
    checkBudget()
    if (!current.ok) {
      fail(current.status, current.code)
      return
    }
    if (!current.platformAdmin || current.identity.namespace !== context.identity.namespace || current.identity.userId !== context.identity.userId) {
      fail(403, "admin_billing_forbidden")
      return
    }
    const issued = await issueBillingCreditGrant(config, context, body, key, abort.signal, deadlineAt)
    checkBudget()
    if (!issued.ok) {
      fail(issued.status, issued.code)
      return
    }
    if (!response.destroyed) send(response, 201, ok(issued.data, context.requestId))
  } catch {
    fail(503, "billing_credit_grant_unavailable")
  } finally {
    clearTimeout(timeout)
    request.removeListener("aborted", cancel)
    response.removeListener("close", close)
  }
}
