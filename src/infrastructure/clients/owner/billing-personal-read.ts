import { createClient } from "../../../generated/billing-http/client/client.gen.js"
import { getMyCreditAccount, getMyCreditLedger, openMyCreditAccount } from "../../../generated/billing-http/sdk.gen.js"
import type { CreditAccount, CreditLedgerResponse } from "../../../generated/billing-http/types.gen.js"
import { zErrorResponse } from "../../../generated/billing-http/zod.gen.js"
import type { BffConfig } from "../../../config/runtime.js"
import type { RequestContext } from "../../../domain/request-context.js"

export type BillingPersonalReadResult<T> =
  | Readonly<{ ok: true; data: T }>
  | Readonly<{
      ok: false
      status: 403 | 404 | 502 | 503
      code: "billing_account_disabled" | "billing_account_not_found" | "upstream_response_invalid" | "billing_unavailable"
    }>

type PersonalIdentity = Readonly<{ tenant: string; subject: string }>

function unavailable<T>(): BillingPersonalReadResult<T> {
  return { ok: false, status: 503, code: "billing_unavailable" }
}

function invalidResponse<T>(): BillingPersonalReadResult<T> {
  return { ok: false, status: 502, code: "upstream_response_invalid" }
}

function u1(value: string, maxCodePoints: number): string | null {
  if (value.length === 0 || value.includes("\u0000")) return null
  let codePoints = 0
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const low = value.charCodeAt(index + 1)
      if (!Number.isInteger(low) || low < 0xdc00 || low > 0xdfff) return null
      index += 1
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return null
    codePoints += 1
    if (codePoints > maxCodePoints) return null
  }
  return `u1.${Buffer.from(value, "utf8").toString("base64url")}`
}

export function billingPersonalIdentity(context: RequestContext): PersonalIdentity | null {
  const tenant = u1(context.identity.namespace, 191)
  const subject = u1(context.identity.userId, 255)
  return tenant === null || subject === null ? null : { tenant, subject }
}

function responseHeaderBytes(headers: Headers): number {
  let bytes = 0
  headers.forEach((value, name) => {
    bytes += Buffer.byteLength(name, "utf8") + Buffer.byteLength(value, "utf8") + 4
  })
  return bytes
}

function boundedFetch(maxResponseBytes: number): typeof fetch {
  return async (input, init) => {
    const response = await fetch(input, { ...init, redirect: "manual", cache: "no-store" })
    const headerBytes = responseHeaderBytes(response.headers)
    const remaining = maxResponseBytes - headerBytes
    const declaredLength = Number(response.headers.get("content-length"))
    if (remaining < 0 || (Number.isFinite(declaredLength) && declaredLength > remaining)) {
      await response.body?.cancel().catch(() => undefined)
      throw new Error("Billing response exceeds the hard cap")
    }
    if (response.body === null) return new Response(null, { status: response.status, statusText: response.statusText, headers: response.headers })
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let consumed = 0
    try {
      for (;;) {
        const chunk = await reader.read()
        if (chunk.done) break
        consumed += chunk.value.byteLength
        if (consumed > remaining) {
          await reader.cancel("Billing response exceeds the hard cap").catch(() => undefined)
          throw new Error("Billing response exceeds the hard cap")
        }
        chunks.push(chunk.value)
      }
    } finally {
      reader.releaseLock()
    }
    const body = new Uint8Array(consumed)
    let offset = 0
    for (const chunk of chunks) {
      body.set(chunk, offset)
      offset += chunk.byteLength
    }
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers })
  }
}

async function request<T>(
  config: BffConfig,
  context: RequestContext,
  signal: AbortSignal,
  operation: "account" | "ledger" | "open",
  query?: Readonly<{ limit: number; cursor?: string }>,
): Promise<BillingPersonalReadResult<T>> {
  const baseUrl = config.upstreams.billing ?? null
  const serviceToken = config.billingServiceToken ?? null
  const internalSecret = config.upstreamSecret
  const encoded = billingPersonalIdentity(context)
  if (baseUrl === null || serviceToken === null || internalSecret === null || serviceToken === internalSecret || encoded === null || signal.aborted) {
    return unavailable()
  }
  const deadline = AbortSignal.timeout(config.upstreamTimeoutMs)
  const outboundSignal = AbortSignal.any([signal, deadline])
  const client = createClient({ baseUrl, fetch: boundedFetch(config.upstreamMaxResponseBytes), redirect: "error" })
  const headers = {
    authorization: `Bearer ${serviceToken}`,
    "x-kokoro-internal-secret": internalSecret,
    "x-request-id": context.requestId,
    "x-kokoro-service": "web-bff" as const,
    "x-kokoro-subject": encoded.subject,
    "x-kokoro-tenant-id": encoded.tenant,
  }
  try {
    const result =
      operation === "open"
        ? await openMyCreditAccount({ client, headers, body: {}, signal: outboundSignal })
        : operation === "account"
          ? await getMyCreditAccount({ client, headers, signal: outboundSignal })
          : await getMyCreditLedger({ client, headers, query: query!, signal: outboundSignal })
    const status = result.response?.status
    if (status === 200 && result.data !== undefined) return { ok: true, data: result.data.data as T }
    if (status === 403 && operation === "open") {
      const parsed = zErrorResponse.safeParse(result.error)
      if (parsed.success && parsed.data.error.code === "billing.credit_account_disabled" && !parsed.data.error.retryable)
        return { ok: false, status: 403, code: "billing_account_disabled" }
      return unavailable()
    }
    if (status === 404) {
      const parsed = zErrorResponse.safeParse(result.error)
      if (operation !== "open" && parsed.success && parsed.data.error.code === "billing.credit_account_not_found" && !parsed.data.error.retryable) {
        return { ok: false, status: 404, code: "billing_account_not_found" }
      }
      return invalidResponse()
    }
    if (status === 200 || (status !== undefined && status < 500 && status !== 401 && status !== 403 && status !== 429)) return invalidResponse()
    return unavailable()
  } catch {
    return unavailable()
  }
}

export function readBillingCreditAccount(config: BffConfig, context: RequestContext, signal: AbortSignal): Promise<BillingPersonalReadResult<CreditAccount>> {
  return request(config, context, signal, "account")
}

export function readBillingCreditLedger(
  config: BffConfig,
  context: RequestContext,
  query: Readonly<{ limit: number; cursor?: string }>,
  signal: AbortSignal,
): Promise<BillingPersonalReadResult<CreditLedgerResponse["data"]>> {
  return request(config, context, signal, "ledger", query)
}

export function initializeBillingCreditAccount(
  config: BffConfig,
  context: RequestContext,
  signal: AbortSignal,
): Promise<BillingPersonalReadResult<CreditAccount>> {
  return request(config, context, signal, "open")
}
