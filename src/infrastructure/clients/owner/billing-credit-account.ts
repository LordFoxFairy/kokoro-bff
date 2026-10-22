import { createClient } from "../../../generated/billing-http/client/client.gen.js"
import { openMyCreditAccount, getMyCreditAccount } from "../../../generated/billing-http/sdk.gen.js"
import { zErrorResponse } from "../../../generated/billing-http/zod.gen.js"
import type { CreditAccount } from "../../../generated/billing-http/types.gen.js"
import type { BffConfig } from "../../../config/runtime.js"
import type { RequestContext } from "../../../domain/request-context.js"
import { strictParseRawJson } from "../../raw-json.js"
import { billingPersonalIdentity } from "./billing-personal-identity.js"

class InvalidBillingResponse extends Error {}
type InitializeBillingCreditAccountInput = Readonly<{
  config: BffConfig
  context: RequestContext
  signal: AbortSignal
  deadlineAt: number
}>
type InitializeBillingCreditAccountResult = Readonly<{ ok: true; data: CreditAccount }> | Readonly<{ ok: false; status: 403 | 502 | 503; code: string }>

export async function initializeBillingCreditAccount(input: InitializeBillingCreditAccountInput): Promise<InitializeBillingCreditAccountResult> {
  const { config, context, signal, deadlineAt } = input
  const fail = (status: 403 | 502 | 503, code: string) => ({ ok: false as const, status, code })
  const unavailable = () => fail(503, "billing_unavailable")
  const encoded = billingPersonalIdentity(context)
  const baseUrl = config.upstreams.billing,
    token = config.billingServiceToken,
    secret = config.upstreamSecret
  if (!baseUrl || !token || !secret || token === secret || !encoded || signal.aborted || deadlineAt - performance.now() <= 1500) return unavailable()
  const ownerBaseUrl: string = baseUrl
  const headers = {
    authorization: `Bearer ${token}`,
    "x-kokoro-internal-secret": secret,
    "x-kokoro-service": "web-bff" as const,
    "x-kokoro-tenant-id": encoded.tenant,
    "x-kokoro-subject": encoded.subject,
    "x-request-id": context.requestId,
  }
  async function call(operation: "put" | "get", end: number) {
    const controller = new AbortController()
    const stop = () => controller.abort()
    signal.addEventListener("abort", stop, { once: true })
    const timer = setTimeout(stop, Math.max(0, end - performance.now()))
    let reject!: (reason: Error) => void
    const retired = new Promise<never>((_, failPromise) => {
      reject = failPromise
    })
    const abort = () => reject(new Error("BILLING_OWNER_RETIRED"))
    controller.signal.addEventListener("abort", abort, { once: true })
    const active = () => {
      if (signal.aborted || controller.signal.aborted || performance.now() >= end) {
        stop()
        throw new Error("BILLING_OWNER_RETIRED")
      }
    }
    const boundedFetch: typeof fetch = async (url, init) => {
      active()
      const pending = Promise.resolve().then(() => {
        active()
        return fetch(url, { ...init, signal: controller.signal, redirect: "manual", cache: "no-store" })
      })
      void pending.then(
        (late) => {
          if (controller.signal.aborted) void late.body?.cancel().catch(() => undefined)
        },
        () => undefined,
      )
      const response = await Promise.race([pending, retired])
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
      try {
        active()
        const h = response.headers
        if (
          !/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(h.get("content-type") ?? "") ||
          h.get("cache-control") !== "no-store" ||
          h.get("x-request-id") !== context.requestId ||
          h.has("set-cookie") ||
          h.has("location") ||
          h.has("content-encoding")
        )
          throw new InvalidBillingResponse()
        let headerBytes = 0
        h.forEach((value, name) => {
          headerBytes += Buffer.byteLength(name) + Buffer.byteLength(value) + 4
        })
        const cap = Math.min(config.upstreamMaxResponseBytes, 1048576) - headerBytes
        const declared = h.get("content-length")
        if (cap < 0 || (declared !== null && (!/^(?:0|[1-9][0-9]*)$/u.test(declared) || Number(declared) > cap))) throw new InvalidBillingResponse()
        if (!response.body) throw new InvalidBillingResponse()
        reader = response.body.getReader()
        const chunks: Uint8Array[] = []
        let bytes = 0
        for (;;) {
          active()
          const chunk = await Promise.race([reader.read(), retired])
          active()
          if (chunk.done) break
          bytes += chunk.value.byteLength
          if (bytes > cap) throw new InvalidBillingResponse()
          chunks.push(chunk.value)
        }
        if (declared !== null && bytes !== Number(declared)) throw new InvalidBillingResponse()
        const raw = Buffer.concat(chunks)
        if (raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) throw new InvalidBillingResponse()
        try {
          strictParseRawJson(new TextDecoder("utf-8", { fatal: true }).decode(raw))
        } catch {
          throw new InvalidBillingResponse()
        }
        return new Response(raw, { status: response.status, headers: h })
      } catch (error) {
        if (reader) void reader.cancel().catch(() => undefined)
        else void response.body?.cancel().catch(() => undefined)
        throw error
      } finally {
        try {
          reader?.releaseLock()
        } catch {
          /* A pending read is retired with its owned request. */
        }
      }
    }
    try {
      active()
      const client = createClient({ baseUrl: ownerBaseUrl, fetch: boundedFetch, redirect: "manual" })
      const pending =
        operation === "put"
          ? openMyCreditAccount({ client, headers, body: {}, signal: controller.signal })
          : getMyCreditAccount({ client, headers, signal: controller.signal })
      const result = await Promise.race([pending, retired])
      active()
      if (result.error instanceof InvalidBillingResponse) throw result.error
      if (!result.response) throw new Error("BILLING_OWNER_NETWORK")
      if (result.response.status === 200) {
        if (!result.data || result.data.data.status !== "active") throw new InvalidBillingResponse()
        return { kind: "success" as const, data: result.data.data }
      }
      const parsed = zErrorResponse.safeParse(result.error)
      if (!parsed.success) throw new InvalidBillingResponse()
      const tuples: Record<number, readonly (readonly [string, boolean])[]> = {
        400: [["billing.invalid_request", false]],
        401: [["billing.unauthenticated", false]],
        403: [
          ["billing.forbidden", false],
          ["billing.credit_account_disabled", false],
        ],
        404: [
          ["billing.not_found", false],
          ["billing.credit_account_not_found", false],
        ],
        500: [["billing.internal_error", false]],
        503: [["billing.dependency_unavailable", true]],
      }
      if (!tuples[result.response.status]?.some(([code, retryable]) => code === parsed.data.error.code && retryable === parsed.data.error.retryable))
        throw new InvalidBillingResponse()
      if (result.response.status === 403 && parsed.data.error.code === "billing.credit_account_disabled") {
        if (parsed.data.error.retryable !== false) throw new InvalidBillingResponse()
        return { kind: "disabled" as const }
      }
      if (result.response.status >= 500 && result.response.status <= 599) return { kind: "unknown" as const }
      if ([401, 403, 429].includes(result.response.status)) return { kind: "unavailable" as const }
      if (operation === "get" && result.response.status === 404) return { kind: "unavailable" as const }
      throw new InvalidBillingResponse()
    } catch (error) {
      if (error instanceof InvalidBillingResponse) return { kind: "invalid" as const }
      // Generated validation exceptions describe a received protocol failure, not an unknown write.
      if (error instanceof Error && error.name === "ZodError") return { kind: "invalid" as const }
      return { kind: "unknown" as const }
    } finally {
      clearTimeout(timer)
      signal.removeEventListener("abort", stop)
      controller.signal.removeEventListener("abort", abort)
      controller.abort()
    }
  }
  let result = await call("put", deadlineAt - 1500)
  if (result.kind === "unknown" && !signal.aborted && performance.now() < deadlineAt) {
    result = await call("get", deadlineAt)
    if (result.kind !== "success") return unavailable()
  }
  if (result.kind === "success") return { ok: true, data: result.data }
  if (result.kind === "disabled") return fail(403, "billing_account_disabled")
  if (result.kind === "invalid") return fail(502, "upstream_response_invalid")
  return unavailable()
}
