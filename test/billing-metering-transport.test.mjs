import assert from "node:assert/strict"
import { afterEach, mock, test } from "node:test"
import { requestBillingMetering } from "../dist/infrastructure/clients/owner/billing-metering.js"
afterEach(() => mock.restoreAll())
const config = {
  upstreams: { billing: "http://owner.invalid" },
  billingServiceToken: "billing-service-token-000000000000001",
  billingOperatorProxySecret: "billing-operator-secret-00000000000001",
  upstreamSecret: "billing-internal-secret-0000000000001",
  sharedSecret: "product-browser-secret",
  adminWebSharedSecret: "admin-browser-secret",
  upstreamMaxResponseBytes: 1048576,
}
const context = { requestId: "fixture-transport", identity: { namespace: "tenant", userId: "operator" } }
function metadata() {
  return { "content-type": "application/json", "x-request-id": context.requestId, "cache-control": "no-store" }
}
test("a stalled cancellation hook cannot prevent the absolute response EOF deadline from settling", async () => {
  let cancelled = 0
  mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(
        new ReadableStream({
          pull: () => new Promise(() => {}),
          cancel: () => {
            cancelled++
            return new Promise(() => {})
          },
        }),
        { status: 200, headers: metadata() },
      ),
  )
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 35)
  try {
    const result = await Promise.race([
      requestBillingMetering(config, context, { kind: "read" }, controller.signal, Date.now() + 35),
      new Promise((resolve) => setTimeout(() => resolve({ timedOut: true }), 180)),
    ])
    assert.equal(result.timedOut, undefined, "consumer must settle even when stream cancel never acknowledges")
    assert.deepEqual(result, { ok: false, status: 503, code: "billing_metering_unavailable" })
    assert.equal(cancelled, 1)
  } finally {
    clearTimeout(timer)
  }
})
test("bad peer metadata still yields a bounded invalid response when peer cancel never acknowledges", async () => {
  mock.method(
    globalThis,
    "fetch",
    async () => new Response(new ReadableStream({ cancel: () => new Promise(() => {}) }), { status: 200, headers: { ...metadata(), "x-request-id": "wrong" } }),
  )
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 100)
  try {
    const result = await Promise.race([
      requestBillingMetering(config, context, { kind: "read" }, controller.signal, Date.now() + 100),
      new Promise((resolve) => setTimeout(() => resolve({ timedOut: true }), 200)),
    ])
    assert.equal(result.timedOut, undefined)
    assert.deepEqual(result, { ok: false, status: 502, code: "upstream_response_invalid" })
  } finally {
    clearTimeout(timer)
  }
})
