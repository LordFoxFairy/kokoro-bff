import assert from "node:assert/strict"
import { test, afterEach, mock } from "node:test"
import { requestBillingModelAdmission } from "../dist/infrastructure/clients/owner/billing-model-admission.js"
afterEach(() => mock.restoreAll())
const config = {
  upstreams: { billing: "http://billing.invalid" },
  billingServiceToken: "billing-model-service",
  upstreamSecret: "internal-secret",
  upstreamMaxResponseBytes: 32768,
}
const context = { requestId: "budget-transport", identity: { namespace: "tenant", userId: "submitter" } }
const body = {
  run_id: "run",
  attempt_id: "22222222-2222-4222-8222-222222222222",
  request_ref: "request",
  attempt_binding_digest: "a".repeat(64),
  planned_digest: "b".repeat(64),
  final_request_digest: "c".repeat(64),
}
const headers = { "content-type": "application/json", "cache-control": "no-store", "x-request-id": context.requestId }
const invoke = (signal) => requestBillingModelAdmission(config, context, body, "one-permanent-command", "execution-proof", signal, Date.now() + 1000)
test("owner fetch that ignores cancellation is bounded and its late response is discarded", async () => {
  let cancelled = 0,
    calls = 0
  mock.method(globalThis, "fetch", async () => {
    calls++
    await new Promise((resolve) => setTimeout(resolve, 90))
    return new Response(
      new ReadableStream({
        cancel() {
          cancelled++
        },
      }),
      { status: 201, headers },
    )
  })
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 20)
  try {
    const result = await invoke(controller.signal)
    assert.deepEqual(result, { ok: false, status: 503, code: "model_admission_unavailable" })
    await new Promise((resolve) => setTimeout(resolve, 120))
    assert.equal(calls, 1)
    assert.equal(cancelled, 1)
  } finally {
    clearTimeout(timer)
  }
})
test("unfinished EOF and stalled cancel hook do not hold budget completion open", async () => {
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
        { status: 201, headers },
      ),
  )
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 25)
  try {
    const result = await Promise.race([invoke(controller.signal), new Promise((resolve) => setTimeout(() => resolve({ hung: true }), 180))])
    assert.equal(result.hung, undefined)
    assert.deepEqual(result, { ok: false, status: 503, code: "model_admission_unavailable" })
    assert.equal(cancelled, 1)
  } finally {
    clearTimeout(timer)
  }
})
test("raw duplicate keys, excessive nesting and bad metadata never become a stripped successful receipt", async () => {
  for (const payload of ['{"data":{},"data":{}}', '{"data":' + "[".repeat(13) + "0" + "]".repeat(13) + "}"]) {
    let calls = 0
    mock.method(globalThis, "fetch", async () => {
      calls++
      return new Response(payload, { status: 201, headers })
    })
    assert.deepEqual(await invoke(new AbortController().signal), { ok: false, status: 502, code: "model_admission_upstream_invalid" })
    assert.equal(calls, 1)
    mock.restoreAll()
  }
  let cancel = 0
  mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(
        new ReadableStream({
          cancel() {
            cancel++
            return new Promise(() => {})
          },
        }),
        { status: 201, headers: { ...headers, "x-request-id": "wrong" } },
      ),
  )
  assert.deepEqual(await invoke(new AbortController().signal), { ok: false, status: 502, code: "model_admission_upstream_invalid" })
  assert.equal(cancel, 1)
})
