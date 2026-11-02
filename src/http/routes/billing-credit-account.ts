import type { IncomingMessage, ServerResponse } from "node:http"
import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import { authorizeUserRequest, type UserAdmissionResult } from "../../auth/user-admission.js"
import { readBillingCreditAccountInput } from "../billing-credit-account-input.js"
import { initializeBillingCreditAccount } from "../../infrastructure/clients/owner/billing-credit-account.js"
import { send } from "../response.js"

export async function billingCreditAccountRoute(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  admission: SessionAdmission,
  requestId: string,
): Promise<void> {
  const deadlineAt = performance.now() + Math.min(config.upstreamTimeoutMs, 10000)
  const controller = new AbortController()
  let reject!: (error: Error) => void
  const interrupted = new Promise<never>((_, fail) => {
    reject = fail
  })
  const stop = () => {
    controller.abort()
    reject(new Error("BILLING_CREDIT_RETIRED"))
  }
  const close = () => {
    if (!response.writableEnded) stop()
  }
  const timer = setTimeout(stop, Math.max(0, deadlineAt - performance.now()))
  request.once("aborted", stop)
  response.once("close", close)
  response.setHeader("x-request-id", requestId)
  response.setHeader("cache-control", "no-store")
  const active = () => {
    if (controller.signal.aborted || request.aborted || response.destroyed || performance.now() >= deadlineAt) throw new Error("BILLING_CREDIT_RETIRED")
  }
  const fail = (status: number, code: string, retryAfter?: string) => {
    if (!response.destroyed && !response.writableEnded)
      send(response, status, { error: { code, message: code, retryable: status === 429 || status === 503 }, meta: { request_id: requestId } }, retryAfter)
  }
  const admitted = async (): Promise<Extract<UserAdmissionResult, { ok: true }>> => {
    active()
    const result = await Promise.race([authorizeUserRequest(request, config, admission, requestId, controller.signal), interrupted])
    active()
    if (result.ok) return result
    const allowed: Record<number, readonly string[]> = {
      401: ["session_authentication_required", "session_invalid"],
      403: ["service_auth_failed", "session_forbidden", "product_tenant_forbidden"],
      429: ["session_rate_limited"],
      503: ["product_tenant_not_configured", "iam_admission_unavailable"],
    }
    const valid =
      allowed[result.status]?.includes(result.code) &&
      (result.status !== 429 || (typeof result.retryAfter === "string" && /^[1-9][0-9]{0,4}$/u.test(result.retryAfter) && Number(result.retryAfter) <= 86400))
    fail(valid ? result.status : 503, valid ? result.code : "billing_unavailable", valid && result.status === 429 ? result.retryAfter : undefined)
    throw new Error("BILLING_CREDIT_ADMISSION")
  }
  try {
    active()
    await Promise.race([readBillingCreditAccountInput(request, controller.signal), interrupted])
    active()
    const first = await admitted()
    active()
    const result = await Promise.race([initializeBillingCreditAccount({ config, context: first.context, signal: controller.signal, deadlineAt }), interrupted])
    active()
    if (!result.ok) {
      fail(result.status, result.code)
      return
    }
    const final = await admitted()
    if (final.context.identity.namespace !== first.context.identity.namespace || final.context.identity.userId !== first.context.identity.userId)
      throw new Error("BILLING_CREDIT_CHANGED")
    active()
    send(response, 200, { data: result.data, meta: { request_id: requestId } })
  } catch (error) {
    fail(
      error instanceof Error && error.message === "BILLING_CREDIT_INPUT" ? 400 : 503,
      error instanceof Error && error.message === "BILLING_CREDIT_INPUT" ? "billing_credit_account_input_invalid" : "billing_unavailable",
    )
  } finally {
    clearTimeout(timer)
    request.removeListener("aborted", stop)
    response.removeListener("close", close)
  }
}
