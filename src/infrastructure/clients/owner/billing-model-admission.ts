import { isDeepStrictEqual } from "node:util"
import type { BffConfig } from "../../../config/runtime.js"
import type { RequestContext } from "../../../domain/request-context.js"
import { createClient } from "../../../generated/billing-http/client/client.gen.js"
import { createAdmission } from "../../../generated/billing-http/sdk.gen.js"
import type { AdmissionCreateRequest, AdmissionResponse } from "../../../generated/billing-http/types.gen.js"
import { zAdmissionResponse, zErrorResponse } from "../../../generated/billing-http/zod.gen.js"
import { strictParseRawJson } from "../../raw-json.js"
import { billingPersonalIdentity } from "./billing-personal-read.js"

type Failure = Readonly<{ ok: false; status: 400 | 403 | 404 | 409 | 422 | 502 | 503; code: string }>
export type BillingModelAdmissionResult = Readonly<{ ok: true; data: AdmissionResponse }> | Failure
const fail = (status: Failure["status"], code: string): Failure => ({ ok: false, status, code: `model_admission_${code}` })

/** Fixed, single-send owner command; an unknown result is never retried here. */
export async function requestBillingModelAdmission(
  config: BffConfig,
  context: RequestContext,
  body: AdmissionCreateRequest,
  key: string,
  proof: string,
  signal: AbortSignal,
  deadlineAt: number,
): Promise<BillingModelAdmissionResult> {
  const identity = billingPersonalIdentity(context),
    origin = config.upstreams.billing,
    token = config.billingServiceToken,
    secret = config.upstreamSecret
  if (!identity || !origin || !token || !secret || token === secret || signal.aborted || Date.now() >= deadlineAt) return fail(503, "unavailable")
  const check = () => {
    if (signal.aborted || Date.now() >= deadlineAt) throw new Error("model_admission_cancelled")
  }
  const wait = <T>(work: () => Promise<T>, late?: (value: T) => void): Promise<T> => {
    check()
    return new Promise((resolve, reject) => {
      let settled = false
      const aborted = () => {
        if (!settled) {
          settled = true
          signal.removeEventListener("abort", aborted)
          reject(new Error("model_admission_cancelled"))
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
  let invalid = false
  const transport: typeof fetch = async (input, init) => {
    const response = await wait(
      () => fetch(input, { ...init, redirect: "manual", cache: "no-store", signal }),
      (value) => {
        void value.body?.cancel().catch(() => undefined)
      },
    )
    const reject = (): never => {
      invalid = true
      void response.body?.cancel().catch(() => undefined)
      throw new Error("invalid_model_admission_response")
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
    const cap = Math.min(config.upstreamMaxResponseBytes, 32768)
    let size = 0
    response.headers.forEach((value, name) => {
      size += Buffer.byteLength(name) + Buffer.byteLength(value) + 4
    })
    const length = response.headers.get("content-length")
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
          invalid = true
          throw new Error("model_admission_response_too_large")
        }
        chunks.push(part.value)
      }
    } finally {
      void reader.cancel().catch(() => undefined)
      reader.releaseLock()
    }
    try {
      check()
      const bytes = Buffer.concat(chunks)
      if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return reject()
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
      let depth = 0
      for (const token of text.match(/"(?:[^"\\]|\\[\s\S])*"|[{}[\]]/gu) ?? []) {
        if (token === "{" || token === "[") {
          if (++depth > 12) return reject()
        } else if (token === "}" || token === "]") depth--
      }
      strictParseRawJson(text)
      check()
      return new Response(bytes, { status: response.status, headers: response.headers })
    } catch (error) {
      if (!signal.aborted && Date.now() < deadlineAt) invalid = true
      throw error
    }
  }
  try {
    const result = await createAdmission({
      client: createClient({ baseUrl: origin, fetch: transport }),
      signal,
      body,
      headers: {
        authorization: `Bearer ${token}`,
        "x-kokoro-internal-secret": secret,
        "x-kokoro-service": "web-bff",
        "x-kokoro-tenant-id": identity.tenant,
        "x-kokoro-subject": identity.subject,
        "x-request-id": context.requestId,
        "idempotency-key": key,
        "x-billing-execution-proof": proof,
      },
    })
    check()
    if (result.response?.status === 201) {
      const parsed = zAdmissionResponse.safeParse(result.data)
      if (!parsed.success || !isDeepStrictEqual(parsed.data, result.data)) return fail(502, "upstream_invalid")
      const data = parsed.data.data
      if (
        Object.entries(body).some(([key, value]) => data[key as keyof typeof data] !== value) ||
        data.status !== "held" ||
        data.created_at !== data.updated_at ||
        new Date(data.created_at).toISOString() !== data.created_at
      )
        return fail(502, "upstream_invalid")
      return { ok: true, data: parsed.data }
    }
    if (!result.response) return fail(invalid ? 502 : 503, invalid ? "upstream_invalid" : "unavailable")
    const parsed = zErrorResponse.safeParse(result.error)
    if (!parsed.success) return fail(502, "upstream_invalid")
    const error = parsed.data.error,
      status = result.response.status
    const denials: Record<string, Readonly<[Failure["status"], string]>> = {
      "400:billing.invalid_request": [400, "invalid_request"],
      "403:billing.forbidden": [403, "forbidden"],
      "403:billing.credit_account_disabled": [403, "forbidden"],
      "404:billing.not_found": [404, "not_found"],
      "404:billing.credit_account_not_found": [404, "not_found"],
      "409:billing.idempotency_conflict": [409, "conflict"],
      "422:billing.insufficient_credit": [422, "insufficient_credit"],
      "422:billing.price_unavailable": [422, "price_unavailable"],
      "422:billing.invalid_state": [422, "ineligible"],
    }
    const denial = denials[`${status}:${error.code}`]
    if (denial && !error.retryable) return fail(...denial)
    if (
      (status === 500 && error.code === "billing.internal_error" && !error.retryable) ||
      (status === 503 && error.code === "billing.dependency_unavailable" && error.retryable)
    )
      return fail(503, "unavailable")
    return fail(502, "upstream_invalid")
  } catch {
    return signal.aborted || Date.now() >= deadlineAt || !invalid ? fail(503, "unavailable") : fail(502, "upstream_invalid")
  }
}
