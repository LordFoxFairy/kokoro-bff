import type { BffConfig } from "../../../config/runtime.js"
import type { RequestContext } from "../../../domain/request-context.js"
import { createClient } from "../../../generated/billing-http/client/client.gen.js"
import { getAdminMeteringPricing, publishAdminMeteringRate, publishAdminMeteringPolicy } from "../../../generated/billing-http/sdk.gen.js"
import { zErrorResponse } from "../../../generated/billing-http/zod.gen.js"
import { billingPersonalIdentity } from "./billing-personal-read.js"
import { parseMeteringJson, parseMeteringResult, type MeteringOperation, type MeteringValue } from "./billing-metering-wire.js"

type Result = Readonly<{ ok: true; data: MeteringValue }> | Readonly<{ ok: false; status: 400 | 403 | 409 | 502 | 503; code: string }>
const unavailable = (): Result => ({ ok: false, status: 503, code: "billing_metering_unavailable" })
const invalid = (): Result => ({ ok: false, status: 502, code: "upstream_response_invalid" })

export async function requestBillingMetering(
  config: BffConfig,
  context: RequestContext,
  operation: MeteringOperation,
  signal: AbortSignal,
  deadlineAt: number,
): Promise<Result> {
  const origin = config.upstreams.billing,
    token = config.billingServiceToken,
    proxy = config.billingOperatorProxySecret,
    secret = config.upstreamSecret,
    identity = billingPersonalIdentity(context)
  if (
    !origin ||
    !token ||
    !proxy ||
    !secret ||
    !identity ||
    signal.aborted ||
    Date.now() >= deadlineAt ||
    token === secret ||
    !/^[\x21-\x7e]{32,2048}$/u.test(proxy) ||
    [token, secret, config.sharedSecret, config.adminWebSharedSecret].includes(proxy)
  )
    return unavailable()
  const check = () => {
    if (signal.aborted || Date.now() >= deadlineAt) throw new Error("Metering deadline exceeded")
  }
  // Settle on cancellation even for an injected peer that ignores AbortSignal.
  const wait = <T>(work: () => Promise<T>, late?: (value: T) => void): Promise<T> => {
    check()
    return new Promise((resolve, reject) => {
      let settled = false
      const aborted = () => {
        if (!settled) {
          settled = true
          signal.removeEventListener("abort", aborted)
          reject(new Error("Metering cancelled"))
        }
      }
      signal.addEventListener("abort", aborted, { once: true })
      if (signal.aborted) {
        aborted()
        return
      }
      void Promise.resolve()
        .then(() => {
          check()
          return work()
        })
        .then(
          (value) => {
            signal.removeEventListener("abort", aborted)
            if (settled) {
              late?.(value)
              return
            }
            settled = true
            resolve(value)
          },
          (error) => {
            signal.removeEventListener("abort", aborted)
            if (!settled) {
              settled = true
              reject(error)
            }
          },
        )
    })
  }
  let invalidResponse = false
  const transport: typeof fetch = async (input, init) => {
    const response = await wait(
      () => fetch(input, { ...init, redirect: "manual", cache: "no-store", signal }),
      (value) => {
        void value.body?.cancel().catch(() => undefined)
      },
    )
    const reject = async (): Promise<never> => {
      invalidResponse = true
      void response.body?.cancel().catch(() => undefined)
      throw new Error("Invalid metering response")
    }
    try {
      check()
    } catch (error) {
      void response.body?.cancel().catch(() => undefined)
      throw error
    }
    if (
      response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json" ||
      response.headers.get("x-request-id") !== context.requestId ||
      !response.headers
        .get("cache-control")
        ?.split(",")
        .some((value) => value.trim().toLowerCase() === "no-store") ||
      response.body === null
    )
      return reject()
    let size = 0
    response.headers.forEach((value, name) => {
      size += Buffer.byteLength(name) + Buffer.byteLength(value) + 4
    })
    const cap = Math.min(config.upstreamMaxResponseBytes, 1_048_576),
      length = response.headers.get("content-length")
    if (size > cap || (length !== null && (!/^(?:0|[1-9][0-9]*)$/u.test(length) || BigInt(length) > BigInt(cap - size)))) return reject()
    const reader = response.body.getReader(),
      chunks: Uint8Array[] = []
    try {
      for (;;) {
        const part = await wait(() => reader.read())
        check()
        if (part.done) break
        size += part.value.byteLength
        if (size > cap) {
          invalidResponse = true
          throw new Error("Metering response too large")
        }
        chunks.push(part.value)
      }
    } finally {
      void reader.cancel().catch(() => undefined)
      reader.releaseLock()
    }
    const bytes = Buffer.concat(chunks)
    try {
      check()
      parseMeteringJson(bytes)
      check()
    } catch (error) {
      if (!signal.aborted && Date.now() < deadlineAt) invalidResponse = true
      throw error
    }
    return new Response(bytes, { status: response.status, headers: response.headers })
  }
  try {
    const client = createClient({ baseUrl: origin, fetch: transport })
    const headers = {
      authorization: `Bearer ${token}`,
      "x-kokoro-service": "web-bff" as const,
      "x-kokoro-internal-secret": secret,
      "x-kokoro-proxy-secret": proxy,
      "x-kokoro-tenant-id": identity.tenant,
      "x-kokoro-subject": identity.subject,
      "x-request-id": context.requestId,
    }
    let decoded: MeteringValue | null = null
    const responseValidator = async (value: unknown) => {
      check()
      decoded = parseMeteringResult(operation, value)
      check()
      if (decoded === null) {
        invalidResponse = true
        throw new Error("Invalid metering data")
      }
    }
    const options = { client, signal, responseValidator, headers }
    const result =
      operation.kind === "read"
        ? await getAdminMeteringPricing(options)
        : operation.kind === "rate"
          ? await publishAdminMeteringRate({ ...options, headers: { ...headers, "idempotency-key": operation.key }, body: operation.body })
          : await publishAdminMeteringPolicy({ ...options, headers: { ...headers, "idempotency-key": operation.key }, body: operation.body })
    check()
    if (!result.response) return invalidResponse ? invalid() : unavailable()
    if (result.response.status === (operation.kind === "read" ? 200 : 201) && decoded !== null) return { ok: true, data: decoded }
    const error = zErrorResponse.safeParse(result.error)
    if (!error.success) return invalid()
    const code = error.data.error.code
    if (!error.data.error.retryable && result.response.status === 400 && code === "billing.invalid_request")
      return { ok: false, status: 400, code: "invalid_admin_metering_request" }
    if (!error.data.error.retryable && result.response.status === 403 && code === "billing.forbidden")
      return { ok: false, status: 403, code: "admin_billing_forbidden" }
    if (!error.data.error.retryable && result.response.status === 409 && code === "billing.idempotency_conflict" && operation.kind !== "read")
      return { ok: false, status: 409, code: "billing_metering_conflict" }
    if (
      (result.response.status === 500 && code === "billing.internal_error" && !error.data.error.retryable) ||
      (result.response.status === 503 && code === "billing.dependency_unavailable" && error.data.error.retryable)
    )
      return unavailable()
    return invalid()
  } catch {
    return signal.aborted || Date.now() >= deadlineAt || !invalidResponse ? unavailable() : invalid()
  }
}
