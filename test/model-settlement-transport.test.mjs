import assert from "node:assert/strict"
import { test, afterEach, mock } from "node:test"
import { requestBillingModelSettlement } from "../dist/infrastructure/clients/owner/billing-model-settlement.js"
afterEach(() => mock.restoreAll())
const config = {
  upstreams: { billing: "http://billing.invalid" },
  billingServiceToken: "billing-model-service",
  upstreamSecret: "internal-secret",
  upstreamMaxResponseBytes: 32768,
}
const context = { requestId: "settlement-transport", identity: { namespace: "tenant", userId: "submitter" } }
const body = { run_id: "original-run", evidence_event_id: "66666666-6666-4666-8666-666666666666", evidence_revision: "1", evidence_digest: "a".repeat(64) }
const headers = { "content-type": "application/json", "cache-control": "no-store", "x-request-id": context.requestId }
const invoke = (signal) =>
  requestBillingModelSettlement(config, context, "33333333-3333-4333-8333-333333333333", body, "one-permanent-key", signal, Date.now() + 1000)
test("late settlement fetch ignoring abort is discarded once and response body cancelled", async () => {
  let calls = 0,
    cancelled = 0
  mock.method(globalThis, "fetch", async () => {
    calls++
    await new Promise((r) => setTimeout(r, 80))
    return new Response(
      new ReadableStream({
        cancel() {
          cancelled++
        },
      }),
      { status: 200, headers },
    )
  })
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 15)
  try {
    assert.deepEqual(await invoke(controller.signal), { ok: false, status: 503, code: "model_settlement_unavailable" })
    await new Promise((r) => setTimeout(r, 100))
    assert.equal(calls, 1)
    assert.equal(cancelled, 1)
  } finally {
    clearTimeout(timer)
  }
})
test("settlement response raw duplicates, malformed bytes and private unexpected error bodies never succeed or retry", async () => {
  for (const body of ['{"data":{},"data":{}}', new Uint8Array([0xff]), '{"data":' + "[".repeat(13) + "0" + "]".repeat(13) + "}"]) {
    let calls = 0
    mock.method(globalThis, "fetch", async () => {
      calls++
      return new Response(body, { status: 200, headers })
    })
    assert.deepEqual(await invoke(new AbortController().signal), { ok: false, status: 502, code: "model_settlement_upstream_invalid" })
    assert.equal(calls, 1)
    mock.restoreAll()
  }
  for (const [status, code, retryable, expected] of [
    [409, "billing.idempotency_conflict", false, 409],
    [422, "billing.invalid_state", false, 422],
    [500, "billing.internal_error", false, 503],
    [200, "unrecognized", false, 502],
  ]) {
    let calls = 0
    mock.method(globalThis, "fetch", async () => {
      calls++
      return new Response(JSON.stringify({ error: { code, message: "private owner details", retryable } }), { status, headers })
    })
    const result = await invoke(new AbortController().signal)
    assert.equal(result.status, expected)
    assert.ok(!JSON.stringify(result).includes("private owner"))
    assert.equal(calls, 1)
    mock.restoreAll()
  }
})
