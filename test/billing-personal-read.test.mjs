import assert from "node:assert/strict"
import { createServer } from "node:http"
import { test } from "node:test"

import { DEFAULT_AGUI_CONFIG } from "../dist/config/runtime.js"
import { createLiveTestBffServer } from "./doubles/server.ts"
import { SessionAdmissionDouble } from "./doubles/session-admission.ts"

const account = {
  credit_account_id: "11111111-1111-4111-8111-111111111111",
  status: "active",
  available_micros: "42000000",
  held_micros: "1500000",
}

const ledgerEntry = {
  journal_id: "22222222-2222-4222-8222-222222222222",
  sequence: "17",
  delta_micros: "-500000",
  balance_after_micros: "42000000",
  source_kind: "usage_settlement",
  source_ref: "settlement_17",
  created_at: "2026-10-05T22:30:00.000Z",
}

function config(baseUrl, overrides = {}) {
  return {
    host: "127.0.0.1",
    port: 4300,
    mode: "live",
    domain: "dev.kokoro.localhost",
    tenantId: "ns_test",
    iamBaseUrl: null,
    sharedSecret: "test-secret",
    upstreamSecret: "billing-internal-secret",
    upstreamTimeoutMs: 75,
    upstreamMaxResponseBytes: 1024 * 1024,
    schedulerServiceToken: null,
    schedulerTargetUrl: null,
    agentEnabled: false,
    postgresUrl: null,
    redisUrl: null,
    agUi: DEFAULT_AGUI_CONFIG,
    upstreams: { system: null, platform: null, scheduler: null, agents: null, billing: baseUrl, music: null },
    platformProjection: { baseUrl: null, credentialFile: null, timeoutMs: 75 },
    skillDraft: { enabled: false, platformBaseUrl: null, credentialFile: null, timeoutMs: 75 },
    billingServiceToken: "billing-service-token",
    ...overrides,
  }
}

function publicHeaders(requestId) {
  return {
    "x-kokoro-service": "web-bff",
    "x-kokoro-internal-secret": "test-secret",
    "x-kokoro-request-id": requestId,
    authorization: "Bearer test-session",
  }
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  if (address === null || typeof address === "string") throw new Error("server did not bind")
  return `http://127.0.0.1:${address.port}`
}

async function close(server) {
  server.closeAllConnections?.()
  if (!server.listening) return
  await new Promise((resolve) => server.close(resolve))
}

async function within(promise, milliseconds, message) {
  let timeout
  try {
    await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), milliseconds)
      }),
    ])
  } finally {
    clearTimeout(timeout)
  }
}

async function withOwner(handler, run, overrides = {}, serverOptions = {}) {
  const owner = createServer(handler)
  let bff
  try {
    const ownerBase = await listen(owner)
    bff = createLiveTestBffServer(config(ownerBase, overrides), serverOptions)
    const bffBase = await listen(bff)
    await run(bffBase)
  } finally {
    if (bff !== undefined) await close(bff)
    await close(owner)
  }
}

function json(response, status, body) {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", "x-request-id": "billing-owner-request" })
  response.end(JSON.stringify(body))
}

test("personal Credit summary uses only the admitted subject and the fixed five-factor Billing transport", async () => {
  const received = []
  await withOwner(
    (request, response) => {
      received.push({ method: request.method, url: request.url, headers: request.headers })
      json(response, 200, { data: account })
    },
    async (base) => {
      const response = await fetch(`${base}/v1/billing/summary`, { headers: publicHeaders("billing-summary") })
      assert.equal(response.status, 200)
      assert.equal(response.headers.get("cache-control"), "no-store")
      assert.equal(response.headers.get("x-request-id"), "billing-summary")
      assert.deepEqual(await response.json(), { data: account, meta: { request_id: "billing-summary" } })
    },
  )
  assert.equal(received.length, 1)
  assert.equal(received[0].method, "GET")
  assert.equal(received[0].url, "/v2/billing/me/credit-account")
  assert.equal(received[0].headers["x-kokoro-service"], "web-bff")
  assert.equal(received[0].headers["x-kokoro-internal-secret"], "billing-internal-secret")
  assert.equal(received[0].headers.authorization, "Bearer billing-service-token")
  assert.equal(received[0].headers["x-kokoro-tenant-id"], "u1.bnNfdGVzdA")
  assert.equal(received[0].headers["x-kokoro-subject"], "u1.dXNlcl90ZXN0")
})

test("personal Credit ledger forwards only the bounded owner pagination query and preserves decimal strings", async () => {
  const received = []
  const publicCursor = "opaque%2Fsegment%3Fx%3D1%26y%3D2"
  await withOwner(
    (request, response) => {
      received.push({ url: request.url, headers: request.headers })
      json(response, 200, { data: { items: [ledgerEntry], page: { next_cursor: "cursor_next" } } })
    },
    async (base) => {
      const response = await fetch(`${base}/v1/billing/ledger?limit=25&cursor=${publicCursor}`, { headers: publicHeaders("billing-ledger") })
      assert.equal(response.status, 200)
      assert.equal(response.headers.get("cache-control"), "no-store")
      assert.deepEqual(await response.json(), {
        data: { items: [ledgerEntry], page: { next_cursor: "cursor_next" } },
        meta: { request_id: "billing-ledger" },
      })
    },
  )
  assert.equal(received.length, 1)
  assert.equal(received[0].url, `/v2/billing/me/credit-ledger?limit=25&cursor=${publicCursor}`)
})

test("personal Credit transport preserves the maximum admitted Unicode identities as canonical unpadded u1 headers", async () => {
  const tenant = "😀".repeat(191)
  const subject = "😀".repeat(255)
  const admission = new SessionAdmissionDouble({ "boundary-session": { namespace: tenant, userId: subject } })
  let ownerHeaders
  await withOwner(
    (request, response) => {
      ownerHeaders = request.headers
      json(response, 200, { data: account })
    },
    async (base) => {
      const response = await fetch(`${base}/v1/billing/summary`, {
        headers: { ...publicHeaders("billing-boundary"), authorization: "Bearer boundary-session" },
      })
      assert.equal(response.status, 200)
    },
    { tenantId: tenant },
    { sessionAdmission: admission },
  )
  assert.equal(ownerHeaders["x-kokoro-tenant-id"], `u1.${Buffer.from(tenant, "utf8").toString("base64url")}`)
  assert.equal(ownerHeaders["x-kokoro-subject"], `u1.${Buffer.from(subject, "utf8").toString("base64url")}`)
  assert.match(ownerHeaders["x-kokoro-tenant-id"], /^u1\.[A-Za-z0-9_-]+$/u)
  assert.match(ownerHeaders["x-kokoro-subject"], /^u1\.[A-Za-z0-9_-]+$/u)
  assert.doesNotMatch(ownerHeaders["x-kokoro-tenant-id"], /=/u)
  assert.doesNotMatch(ownerHeaders["x-kokoro-subject"], /=/u)
})

for (const [name, identity] of [
  ["empty subject", { namespace: "tenant", userId: "" }],
  ["tenant NUL", { namespace: "tenant\u0000", userId: "subject" }],
  ["isolated subject surrogate", { namespace: "tenant", userId: "subject\ud800" }],
  ["tenant over code-point limit", { namespace: "t".repeat(192), userId: "subject" }],
  ["subject over code-point limit", { namespace: "tenant", userId: "s".repeat(256) }],
]) {
  test(`personal Credit transport rejects admitted ${name} before owner I/O`, async () => {
    const admission = new SessionAdmissionDouble({ "invalid-identity-session": identity })
    let ownerCalls = 0
    await withOwner(
      (_request, response) => {
        ownerCalls += 1
        json(response, 200, { data: account })
      },
      async (base) => {
        const response = await fetch(`${base}/v1/billing/summary`, {
          headers: { ...publicHeaders("billing-invalid-identity"), authorization: "Bearer invalid-identity-session" },
        })
        assert.equal(response.status, 503)
        assert.equal(((await response.json()).error ?? {}).code, "billing_unavailable")
      },
      { tenantId: identity.namespace },
      { sessionAdmission: admission },
    )
    assert.equal(ownerCalls, 0)
  })
}

test("personal Credit admission rejects an empty tenant before owner I/O", async () => {
  const admission = new SessionAdmissionDouble({ "empty-tenant-session": { namespace: "", userId: "subject" } })
  let ownerCalls = 0
  await withOwner(
    (_request, response) => {
      ownerCalls += 1
      json(response, 200, { data: account })
    },
    async (base) => {
      const response = await fetch(`${base}/v1/billing/summary`, {
        headers: { ...publicHeaders("billing-empty-tenant"), authorization: "Bearer empty-tenant-session" },
      })
      assert.equal(response.status, 403)
      assert.equal(((await response.json()).error ?? {}).code, "product_tenant_forbidden")
    },
    { tenantId: "tenant" },
    { sessionAdmission: admission },
  )
  assert.equal(ownerCalls, 0)
})

for (const [name, query] of [
  ["zero limit", "?limit=0"],
  ["over-limit page", "?limit=101"],
  ["fractional limit", "?limit=1.5"],
  ["exponent limit", "?limit=1e1"],
  ["leading-zero limit", "?limit=01"],
  ["signed limit", "?limit=%2B1"],
  ["duplicate limit", "?limit=10&limit=20"],
  ["duplicate cursor", "?cursor=first&cursor=second"],
  ["empty cursor", "?cursor="],
  ["oversized cursor", `?cursor=${"x".repeat(2049)}`],
  ["unknown query", "?unknown=value"],
]) {
  test(`personal Credit ledger rejects ${name} before owner I/O`, async () => {
    let ownerCalls = 0
    await withOwner(
      (_request, response) => {
        ownerCalls += 1
        json(response, 200, { data: { items: [], page: { next_cursor: null } } })
      },
      async (base) => {
        const response = await fetch(`${base}/v1/billing/ledger${query}`, { headers: publicHeaders("billing-query") })
        assert.equal(response.status, 400)
        assert.equal(response.headers.get("cache-control"), "no-store")
        assert.equal(((await response.json()).error ?? {}).code, "invalid_query_parameter")
      },
    )
    assert.equal(ownerCalls, 0)
  })
}

test("personal Credit reads map missing accounts, invalid successes and dependency failures without partial data", async () => {
  for (const ownerCase of [
    {
      status: 404,
      body: { error: { code: "billing.not_found", message: "private owner detail", retryable: false } },
      expectedStatus: 404,
      expectedCode: "billing_account_not_found",
    },
    { status: 200, body: { data: { ...account, available_micros: 42 } }, expectedStatus: 502, expectedCode: "upstream_response_invalid" },
    {
      status: 401,
      body: { error: { code: "billing.authentication_required", message: "private owner detail", retryable: false } },
      expectedStatus: 503,
      expectedCode: "billing_unavailable",
    },
    {
      status: 403,
      body: { error: { code: "billing.forbidden", message: "private owner detail", retryable: false } },
      expectedStatus: 503,
      expectedCode: "billing_unavailable",
    },
    {
      status: 500,
      body: { error: { code: "billing.internal", message: "private owner detail", retryable: true } },
      expectedStatus: 503,
      expectedCode: "billing_unavailable",
    },
    {
      status: 503,
      body: { error: { code: "billing.dependency_unavailable", message: "private owner detail", retryable: true } },
      expectedStatus: 503,
      expectedCode: "billing_unavailable",
    },
  ]) {
    await withOwner(
      (_request, response) => json(response, ownerCase.status, ownerCase.body),
      async (base) => {
        const response = await fetch(`${base}/v1/billing/summary`, { headers: publicHeaders("billing-error") })
        assert.equal(response.status, ownerCase.expectedStatus)
        assert.equal(response.headers.get("cache-control"), "no-store")
        const body = await response.json()
        assert.equal(body.error.code, ownerCase.expectedCode)
        assert.equal("data" in body, false)
        assert.doesNotMatch(JSON.stringify(body), /private owner detail/u)
      },
    )
  }
})

test("personal Credit owner timeout is bounded and fails closed", async () => {
  await withOwner(
    () => undefined,
    async (base) => {
      const started = Date.now()
      const response = await fetch(`${base}/v1/billing/summary`, { headers: publicHeaders("billing-timeout") })
      assert.equal(response.status, 503)
      assert.equal(((await response.json()).error ?? {}).code, "billing_unavailable")
      assert.ok(Date.now() - started < 1000)
    },
    { upstreamTimeoutMs: 25 },
  )
})

test("personal Credit read enforces one combined response header and body budget", async () => {
  let ownerClosed
  const closed = new Promise((resolve) => {
    ownerClosed = resolve
  })
  await withOwner(
    (_request, response) => {
      response.once("close", ownerClosed)
      response.writeHead(200, {
        "content-type": "application/json",
        "cache-control": "no-store",
        "x-owner-padding": "x".repeat(300),
      })
      response.end(JSON.stringify({ data: account }))
    },
    async (base) => {
      const response = await fetch(`${base}/v1/billing/summary`, { headers: publicHeaders("billing-budget") })
      assert.equal(response.status, 503)
      const body = await response.json()
      assert.equal(body.error.code, "billing_unavailable")
      assert.equal("data" in body, false)
      await within(closed, 250, "owner response remained open after the response budget was exceeded")
    },
    { upstreamMaxResponseBytes: 512 },
  )
})

test("personal Credit read cancels a chunked response that crosses the body budget", async () => {
  let ownerClosed
  const closed = new Promise((resolve) => {
    ownerClosed = resolve
  })
  await withOwner(
    (_request, response) => {
      response.once("close", ownerClosed)
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" })
      response.write("x".repeat(1024))
    },
    async (base) => {
      const response = await fetch(`${base}/v1/billing/summary`, { headers: publicHeaders("billing-stream-budget") })
      assert.equal(response.status, 503)
      assert.equal(((await response.json()).error ?? {}).code, "billing_unavailable")
      await within(closed, 250, "owner chunked response was not cancelled after exceeding its budget")
    },
    { upstreamMaxResponseBytes: 512, upstreamTimeoutMs: 1000 },
  )
})

test("personal Credit total timeout cancels a response whose body arrives too late", async () => {
  let ownerClosed
  const closed = new Promise((resolve) => {
    ownerClosed = resolve
  })
  await withOwner(
    (_request, response) => {
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" })
      response.write('{"data":')
      const lateBody = setTimeout(() => response.end(JSON.stringify(account) + "}"), 250)
      response.once("close", () => {
        clearTimeout(lateBody)
        ownerClosed()
      })
    },
    async (base) => {
      const started = Date.now()
      const response = await fetch(`${base}/v1/billing/summary`, { headers: publicHeaders("billing-late-body") })
      assert.equal(response.status, 503)
      assert.equal(((await response.json()).error ?? {}).code, "billing_unavailable")
      assert.ok(Date.now() - started < 200)
      await within(closed, 250, "owner late body was not cancelled at the total deadline")
    },
    { upstreamTimeoutMs: 25 },
  )
})

test("personal Credit read does not follow an owner redirect or disclose credentials to its receiver", async () => {
  const receiverRequests = []
  const receiver = createServer((request, response) => {
    receiverRequests.push({ url: request.url, headers: request.headers })
    json(response, 200, { data: account })
  })
  const owner = createServer()
  let bff
  try {
    const receiverBase = await listen(receiver)
    owner.on("request", (_request, response) => {
      response.writeHead(302, { location: `${receiverBase}/credential-capture`, "cache-control": "no-store" })
      response.end()
    })
    const ownerBase = await listen(owner)
    bff = createLiveTestBffServer(config(ownerBase))
    const bffBase = await listen(bff)
    const response = await fetch(`${bffBase}/v1/billing/summary`, { headers: publicHeaders("billing-redirect") })
    assert.equal(response.status, 502)
    assert.equal(((await response.json()).error ?? {}).code, "upstream_response_invalid")
    await new Promise((resolve) => setTimeout(resolve, 25))
    assert.deepEqual(receiverRequests, [])
  } finally {
    if (bff !== undefined) await close(bff)
    await close(owner)
    await close(receiver)
  }
})

test("personal Credit caller cancellation aborts the in-flight owner read", async () => {
  let ownerStarted
  let ownerClosed
  const started = new Promise((resolve) => {
    ownerStarted = resolve
  })
  const closed = new Promise((resolve) => {
    ownerClosed = resolve
  })
  await withOwner(
    (_request, response) => {
      ownerStarted()
      response.once("close", ownerClosed)
    },
    async (base) => {
      const controller = new AbortController()
      const pending = fetch(`${base}/v1/billing/summary`, { headers: publicHeaders("billing-cancel"), signal: controller.signal })
      await Promise.race([started, new Promise((_, reject) => setTimeout(() => reject(new Error("owner request did not start")), 250))])
      controller.abort()
      await assert.rejects(pending, /abort/iu)
      await Promise.race([
        closed,
        new Promise((_, reject) => setTimeout(() => reject(new Error("owner request remained open after caller cancellation")), 250)),
      ])
    },
    { upstreamTimeoutMs: 1000 },
  )
})
