import type { BffConfig } from "../../../config/runtime.js"
import type { RequestContext } from "../../../domain/request-context.js"
import { createClient } from "../../../generated/billing-http/client/client.gen.js"
import { createAdminCreditGrant } from "../../../generated/billing-http/sdk.gen.js"
import { zErrorResponse, zAdminCreditGrantResponse } from "../../../generated/billing-http/zod.gen.js"
import type { AdminCreditGrantRequest } from "../../../generated/billing-http/types.gen.js"
import { strictParseRawJson } from "../../raw-json.js"
import { billingPersonalIdentity } from "./billing-personal-read.js"

export type CreditGrantReceipt = Readonly<{
  account_id: string
  grant_id: string
  journal_id: string
}>
export type CreditGrantResult = Readonly<{ ok: true; data: CreditGrantReceipt }> | Readonly<{ ok: false; status: 403 | 409 | 502 | 503; code: string }>
const unavailable = (): CreditGrantResult => ({
  ok: false,
  status: 503,
  code: "billing_credit_grant_unavailable",
})
const invalid = (): CreditGrantResult => ({
  ok: false,
  status: 502,
  code: "upstream_response_invalid",
})

export async function issueBillingCreditGrant(
  config: BffConfig,
  context: RequestContext,
  body: AdminCreditGrantRequest,
  key: string,
  signal: AbortSignal,
  deadlineAt: number,
): Promise<CreditGrantResult> {
  const origin = config.upstreams.billing,
    token = config.billingServiceToken,
    proxy = config.billingOperatorProxySecret,
    secret = config.upstreamSecret
  const identity = billingPersonalIdentity(context)
  if (
    !origin ||
    !token ||
    !proxy ||
    !secret ||
    !identity ||
    signal.aborted ||
    Date.now() >= deadlineAt ||
    !/^[\x21-\x7e]{32,2048}$/u.test(proxy) ||
    [token, secret, config.sharedSecret, config.adminWebSharedSecret].includes(proxy)
  )
    return unavailable()
  const checkBudget = () => {
    if (signal.aborted || Date.now() >= deadlineAt) throw new Error("Credit issuance deadline")
  }
  let invalidResponse = false
  const boundedFetch: typeof fetch = async (input, init) => {
    checkBudget()
    const response = await fetch(input, {
      ...init,
      redirect: "manual",
      cache: "no-store",
      signal,
    })
    try {
      checkBudget()
    } catch (error) {
      await response.body?.cancel().catch(() => undefined)
      throw error
    }
    const reject = async (): Promise<never> => {
      invalidResponse = true
      await response.body?.cancel().catch(() => undefined)
      throw new Error("Invalid Billing acknowledgement")
    }
    const mime = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase()
    if (
      mime !== "application/json" ||
      response.headers.get("x-request-id") !== context.requestId ||
      !response.headers
        .get("cache-control")
        ?.split(",")
        .some((v) => v.trim().toLowerCase() === "no-store") ||
      !response.body
    )
      return reject()
    let size = 0
    response.headers.forEach((value, name) => {
      size += Buffer.byteLength(name) + Buffer.byteLength(value) + 4
    })
    const cap = Math.min(config.upstreamMaxResponseBytes, 65536)
    const length = response.headers.get("content-length")
    if (size > cap || (length !== null && (!/^(?:0|[1-9][0-9]*)$/u.test(length) || BigInt(length) > BigInt(cap - size)))) return reject()
    const reader = response.body.getReader(),
      chunks: Uint8Array[] = []
    try {
      while (true) {
        const part = await reader.read()
        checkBudget()
        if (part.done) break
        size += part.value.byteLength
        if (size > cap) {
          invalidResponse = true
          throw new Error("Invalid Billing acknowledgement")
        }
        chunks.push(part.value)
      }
    } finally {
      await reader.cancel().catch(() => undefined)
      reader.releaseLock()
    }
    const bytes = Buffer.concat(chunks)
    try {
      if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) throw new Error()
      strictParseRawJson(bytes)
    } catch {
      invalidResponse = true
      throw new Error("Invalid Billing acknowledgement")
    }
    checkBudget()
    return new Response(bytes, {
      status: response.status,
      headers: response.headers,
    })
  }
  try {
    const result = await createAdminCreditGrant({
      client: createClient({ baseUrl: origin, fetch: boundedFetch }),
      signal,
      body,
      responseValidator: async (value: unknown) => {
        checkBudget()
        const parsed = zAdminCreditGrantResponse.safeParse(value)
        checkBudget()
        if (!parsed.success) {
          invalidResponse = true
          throw new Error("Invalid Billing acknowledgement")
        }
        return parsed.data
      },
      headers: {
        authorization: `Bearer ${token}`,
        "x-kokoro-service": "web-bff",
        "x-kokoro-internal-secret": secret,
        "x-kokoro-proxy-secret": proxy,
        "x-kokoro-tenant-id": identity.tenant,
        "x-kokoro-subject": identity.subject,
        "x-request-id": context.requestId,
        "idempotency-key": key,
      },
    })
    if (signal.aborted || Date.now() >= deadlineAt) return unavailable()
    if (!result.response) return invalidResponse ? invalid() : unavailable()
    if (result.response.status === 201 && result.data) return { ok: true, data: result.data.data }
    const error = zErrorResponse.safeParse(result.error)
    if (!error.success) return invalid()
    if (result.response.status === 403 && error.data.error.code === "billing.credit_account_disabled" && !error.data.error.retryable)
      return { ok: false, status: 403, code: "billing_account_disabled" }
    if (result.response.status === 409 && error.data.error.code === "billing.idempotency_conflict" && !error.data.error.retryable)
      return { ok: false, status: 409, code: "billing_credit_grant_conflict" }
    if (
      (result.response.status === 500 && error.data.error.code === "billing.internal_error" && !error.data.error.retryable) ||
      (result.response.status === 503 && error.data.error.code === "billing.dependency_unavailable" && error.data.error.retryable)
    )
      return unavailable()
    return invalid()
  } catch {
    return signal.aborted || Date.now() >= deadlineAt || !invalidResponse ? unavailable() : invalid()
  }
}
