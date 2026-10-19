import { createClient } from "../../../generated/billing-http/client/client.gen.js"
import { getCatalog } from "../../../generated/billing-http/sdk.gen.js"
import type { BffConfig } from "../../../config/runtime.js"
import type { RequestContext } from "../../../domain/request-context.js"

type Plan = Readonly<{
  id: string
  key: string
  name: string
  currency: string
  amount_minor: string
  credit_micros: string
  billing_interval: "once" | "month" | "year"
}>
type Result = Readonly<{ ok: true; plans: Plan[] }> | Readonly<{ ok: false }>

function tenantRef(value: string): string | null {
  if (!value || value.includes("\u0000") || [...value].length > 191 || /[\uD800-\uDFFF]/u.test(value)) return null
  return `u1.${Buffer.from(value, "utf8").toString("base64url")}`
}

/** Complete catalog only: no partial result, payment authority or synthesized offer key. */
export async function readBillingCatalog(config: BffConfig, context: RequestContext, signal: AbortSignal): Promise<Result> {
  const baseUrl = config.upstreams.billing
  const token = config.billingServiceToken
  const secret = config.upstreamSecret
  const tenant = tenantRef(context.identity.namespace)
  if (!baseUrl || !token || !secret || token === secret || !tenant || signal.aborted) return { ok: false }
  const abort = new AbortController()
  const onAbort = (): void => abort.abort()
  signal.addEventListener("abort", onAbort, { once: true })
  const expires = performance.now() + config.upstreamTimeoutMs
  const interrupted = new Promise<never>((_resolve, reject) => {
    abort.signal.addEventListener("abort", () => reject(new Error("Catalog request retired")), { once: true })
  })
  // Observe cancellation even before the first SDK call.
  void interrupted.catch(() => undefined)
  const timer = setTimeout(onAbort, config.upstreamTimeoutMs)
  let remaining = config.upstreamMaxResponseBytes
  const bounded: typeof fetch = async (input, init) => {
    const response = await fetch(input, { ...init, redirect: "manual", cache: "no-store", signal: abort.signal })
    const check = (): void => {
      if (abort.signal.aborted || performance.now() >= expires) throw new Error("Catalog deadline")
    }
    const reader = response.body?.getReader()
    const cancelBody = (): void => {
      void reader?.cancel().catch(() => undefined)
    }
    abort.signal.addEventListener("abort", cancelBody, { once: true })
    try {
      check()
      for (const [name, value] of response.headers) remaining -= Buffer.byteLength(name) + Buffer.byteLength(value) + 4
      remaining -= 2
      if (remaining < 0 || response.status !== 200 || response.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json")
        throw new Error("Catalog response")
      const chunks: Uint8Array[] = []
      for (;;) {
        const part = await reader?.read()
        check()
        if (!part || part.done) break
        remaining -= part.value.byteLength
        if (remaining < 0) throw new Error("Catalog budget")
        chunks.push(part.value)
      }
      return new Response(Buffer.concat(chunks), { status: 200, headers: response.headers })
    } finally {
      abort.signal.removeEventListener("abort", cancelBody)
      await reader?.cancel().catch(() => undefined)
      reader?.releaseLock()
    }
  }
  const client = createClient({ baseUrl, fetch: bounded })
  const cursors = new Set<string>()
  const ids = new Set<string>()
  const keys = new Set<string>()
  const plans: Plan[] = []
  let cursor: string | undefined
  try {
    for (let page = 0; page < 20; page += 1) {
      if (signal.aborted || abort.signal.aborted || performance.now() >= expires) return { ok: false }
      const result = await Promise.race([
        interrupted,
        getCatalog({
          client,
          signal: abort.signal,
          query: { limit: 100, ...(cursor === undefined ? {} : { cursor }) },
          headers: {
            authorization: `Bearer ${token}`,
            "x-kokoro-internal-secret": secret,
            "x-kokoro-service": "web-bff",
            "x-request-id": context.requestId,
            "x-kokoro-tenant-id": tenant,
          },
        }),
      ])
      if (abort.signal.aborted || performance.now() >= expires || result.response?.status !== 200 || !result.data) return { ok: false }
      const { items, page: pagination } = result.data.data
      for (const item of items) {
        if (ids.has(item.offer_revision_id) || keys.has(item.offer_key) || plans.length >= 2000) return { ok: false }
        ids.add(item.offer_revision_id)
        keys.add(item.offer_key)
        plans.push({
          id: item.offer_revision_id,
          key: item.offer_key,
          name: item.name,
          currency: item.currency_code,
          amount_minor: item.amount_minor,
          credit_micros: item.credit_micros,
          billing_interval: item.billing_interval,
        })
      }
      const next = pagination.next_cursor
      if (next === null) return { ok: true, plans }
      if (!items.length || !next.length || next.length > 2048 || cursors.has(next)) return { ok: false }
      cursors.add(next)
      cursor = next
    }
    return { ok: false }
  } catch {
    return { ok: false }
  } finally {
    clearTimeout(timer)
    signal.removeEventListener("abort", onAbort)
    abort.abort()
  }
}
