import assert from "node:assert/strict"
import { createServer } from "node:http"
import { test } from "node:test"
import { readBillingCatalog as sourceRead } from "../src/infrastructure/clients/owner/billing-catalog.ts"
import { readBillingCatalog as distRead } from "../dist/infrastructure/clients/owner/billing-catalog.js"

const context = { identity: { namespace: "tenant-é😀", userId: "user" }, requestId: "catalog-test" }
const item = (index = 1) => ({
  offer_revision_id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
  offer_key: `offer-${index}`,
  name: "Offer",
  amount_minor: "900719925474099312345",
  currency_code: "USD",
  credit_micros: "999999999999999999999",
  billing_interval: "month",
})
const page = (items, next_cursor = null) => ({ data: { items, page: { next_cursor } } })
async function fixture(run, responseFor) {
  const calls = []
  const server = createServer((request, response) => {
    calls.push(request)
    const result = responseFor(calls.length, request)
    response.writeHead(result.status ?? 200, { "content-type": "application/json", ...result.headers })
    response.end(JSON.stringify(result.body))
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const config = {
    upstreams: { billing: `http://127.0.0.1:${server.address().port}` },
    billingServiceToken: "independent-billing-token",
    upstreamSecret: "internal-bff-identity",
    upstreamTimeoutMs: 1000,
    upstreamMaxResponseBytes: 1024 * 1024,
  }
  try {
    await run(config, calls)
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
}
for (const [mode, read] of [
  ["source", sourceRead],
  ["dist", distRead],
]) {
  test(`${mode} complete catalog uses independent credentials and preserves decimal strings`, async () => {
    await fixture(
      async (config, calls) => {
        const result = await read(config, context, new AbortController().signal)
        assert.equal(result.ok, true)
        assert.equal(result.plans.length, 2)
        assert.equal(result.plans[0].amount_minor, item().amount_minor)
        assert.equal(result.plans[0].key, "offer-1")
        assert.equal(calls[0].url, "/v2/commerce/catalog?limit=100")
        assert.equal(calls[1].url, "/v2/commerce/catalog?limit=100&cursor=next")
        assert.equal(calls[0].headers.authorization, "Bearer independent-billing-token")
        assert.equal(calls[0].headers["x-kokoro-internal-secret"], "internal-bff-identity")
        assert.equal(calls[0].headers["x-kokoro-service"], "web-bff")
        assert.equal(calls[0].headers["x-kokoro-tenant-id"], `u1.${Buffer.from(context.identity.namespace).toString("base64url")}`)
      },
      (n) => ({ body: page([item(n)], n === 1 ? "next" : null) }),
    )
  })
  for (const [name, reply] of Object.entries({
    missingKey: () => ({ body: page([{ ...item(), offer_key: undefined }]) }),
    unknownItem: () => ({ body: page([{ ...item(), unknown: true }]) }),
    unknownEnvelope: () => ({ body: { ...page([]), meta: {} } }),
    unknownPage: () => ({ body: { data: { items: [], page: { next_cursor: null, unknown: true } } } }),
    invalidMoney: () => ({ body: page([{ ...item(), amount_minor: 42 }]) }),
    emptyNonterminal: () => ({ body: page([], "next") }),
    repeatedCursor: (n) => ({ body: page([item(n)], "next") }),
    duplicateRevision: () => ({ body: page([item()], "next") }),
    duplicateKey: (n) => ({ body: page([{ ...item(n), offer_key: "same" }], "next") }),
    failedTail: (n) => (n === 1 ? { body: page([item()], "next") } : { status: 503, body: {} }),
    pageBudget: (n) => ({ body: page([item(n)], `next-${n}`) }),
    itemBudget: () => ({ body: page(Array.from({ length: 2001 }, (_, i) => item(i + 1))) }),
    redirect: () => ({ status: 302, body: {} }),
  }))
    test(`${mode} catalog fails closed for ${name}`, async () => {
      await fixture(async (config, calls) => {
        assert.deepEqual(await read(config, context, new AbortController().signal), { ok: false })
        assert.ok(calls.length <= 20)
      }, reply)
    })
  test(`${mode} legal terminal empty catalog alone is success`, async () => {
    await fixture(
      async (config) => assert.deepEqual(await read(config, context, new AbortController().signal), { ok: true, plans: [] }),
      () => ({ body: page([]) }),
    )
  })
  test(`${mode} cumulative bytes and invalid identity do not yield partial success`, async () => {
    await fixture(
      async (config, calls) => {
        assert.deepEqual(await read({ ...config, upstreamMaxResponseBytes: 600 }, context, new AbortController().signal), { ok: false })
        const count = calls.length
        for (const namespace of ["", "\ud800", "a".repeat(192)])
          assert.deepEqual(await read(config, { ...context, identity: { namespace } }, new AbortController().signal), { ok: false })
        assert.equal(calls.length, count)
      },
      (n) => ({ body: page([item(n)], n === 1 ? "next" : null) }),
    )
  })
  test(`${mode} hanging transport respects the whole-request deadline`, async () => {
    const previous = globalThis.fetch
    let retired = false
    globalThis.fetch = (_input, init) =>
      new Promise(() => {
        init.signal.addEventListener("abort", () => {
          retired = true
        })
      })
    try {
      const start = performance.now()
      assert.deepEqual(
        await read(
          {
            upstreams: { billing: "http://127.0.0.1:1" },
            billingServiceToken: "token",
            upstreamSecret: "secret",
            upstreamTimeoutMs: 30,
            upstreamMaxResponseBytes: 1000,
          },
          context,
          new AbortController().signal,
        ),
        { ok: false },
      )
      assert.ok(performance.now() - start < 300)
      assert.equal(retired, true)
    } finally {
      globalThis.fetch = previous
    }
  })
}

for (const [mode, read] of [
  ["source", sourceRead],
  ["dist", distRead],
]) {
  test(`${mode} total deadline spans pages and cancels slow response bodies`, async () => {
    const previous = globalThis.fetch
    let calls = 0
    let canceled = false
    globalThis.fetch = async () => {
      calls += 1
      if (calls === 1) return new Response(JSON.stringify(page([item()], "next")), { headers: { "content-type": "application/json" } })
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"data":'))
          },
          cancel() {
            canceled = true
          },
        }),
        { headers: { "content-type": "application/json" } },
      )
    }
    const config = {
      upstreams: { billing: "http://127.0.0.1:1" },
      billingServiceToken: "token",
      upstreamSecret: "secret",
      upstreamTimeoutMs: 30,
      upstreamMaxResponseBytes: 10000,
    }
    try {
      assert.deepEqual(await read(config, context, new AbortController().signal), { ok: false })
      assert.equal(calls, 2)
      // Caller retires the operation even if a foreign fetch stream ignores AbortSignal.
      assert.equal(canceled, true)
    } finally {
      globalThis.fetch = previous
    }
  })
  test(`${mode} credentials and explicit cancellation fail before owner I/O`, async () => {
    await fixture(
      async (config, calls) => {
        for (const override of [{ billingServiceToken: null }, { upstreamSecret: null }, { billingServiceToken: config.upstreamSecret }]) {
          assert.deepEqual(await read({ ...config, ...override }, context, new AbortController().signal), { ok: false })
        }
        const abort = new AbortController()
        abort.abort()
        assert.deepEqual(await read(config, context, abort.signal), { ok: false })
        assert.equal(calls.length, 0)
      },
      () => ({ body: page([]) }),
    )
  })
}
