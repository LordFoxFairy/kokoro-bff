import assert from "node:assert/strict"
import { createServer, request as httpRequest } from "node:http"
import { test } from "node:test"
import { createBffServer } from "../src/bootstrap/server.ts"
import { DEFAULT_AGUI_CONFIG } from "../src/config/runtime.ts"
import { SessionAdmissionDouble } from "./doubles/session-admission.ts"

const path = "/v1/billing/credit-account"
const account = { credit_account_id: "11111111-1111-4111-8111-111111111111", status: "active", available_micros: "42000000", held_micros: "1500000" }
const headers = {
  "x-kokoro-service": "web-bff",
  "x-kokoro-internal-secret": "browser-internal",
  authorization: "Bearer product-session",
  "x-kokoro-request-id": "i5-credit-http",
  "content-type": "application/json",
}
const allow = (subject = "owner") => ({ ok: true, identity: { namespace: "tenant", userId: subject }, platformAdmin: false })
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
function json(res, status, body, extra = {}) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", "x-request-id": "i5-credit-http", ...extra })
  res.end(JSON.stringify(body))
}
async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  return `http://127.0.0.1:${server.address().port}`
}
async function fixture(t, options = {}) {
  const received = [],
    admission = options.admission ?? new SessionAdmissionDouble({ "product-session": { namespace: "tenant", userId: "owner" } })
  const owner = createServer((req, res) => {
    const chunks = []
    req.on("data", (chunk) => chunks.push(chunk))
    req.on("end", () => {
      const observation = { method: req.method, path: req.url, headers: req.headers, body: Buffer.concat(chunks).toString("utf8") }
      received.push(observation)
      Promise.resolve(options.owner ? options.owner(req, res, received.length, observation) : json(res, 200, { data: account })).catch(() => res.destroy())
    })
  })
  let bff
  t.after(async () => {
    for (const server of [bff, owner])
      if (server?.listening) {
        server.closeAllConnections()
        await new Promise((resolve) => server.close(resolve))
      }
  })
  const ownerBase = await listen(owner)
  const config = {
    host: "127.0.0.1",
    port: 0,
    mode: "live",
    domain: "dev.kokoro.localhost",
    tenantId: "tenant",
    iamBaseUrl: null,
    sharedSecret: "browser-internal",
    upstreamSecret: "owner-internal",
    billingServiceToken: "owner-service",
    upstreamTimeoutMs: options.timeout ?? 2500,
    upstreamMaxResponseBytes: 1048576,
    schedulerServiceToken: null,
    schedulerTargetUrl: null,
    agentEnabled: false,
    postgresUrl: null,
    redisUrl: null,
    agUi: DEFAULT_AGUI_CONFIG,
    upstreams: { billing: ownerBase },
    ...options.config,
  }
  bff = createBffServer(config, { businessStore: null, readiness: async () => {}, sessionAdmission: admission })
  const base = await listen(bff)
  async function call(overrides = {}) {
    const r = await fetch(base + (overrides.path ?? path), {
      method: "PUT",
      headers: { ...headers, ...overrides.headers },
      body: overrides.body ?? "{}",
      signal: AbortSignal.timeout(5000),
    })
    const raw = await r.text()
    return { status: r.status, body: JSON.parse(raw), headers: r.headers, raw }
  }
  function raw(target = path, body = Buffer.from("{}"), extra = []) {
    return new Promise((resolve, reject) => {
      const url = new URL(base)
      const req = httpRequest(
        {
          hostname: url.hostname,
          port: url.port,
          path: target,
          method: "PUT",
          headers: ["Host", url.host, ...Object.entries(headers).flat(), "Content-Length", String(body.byteLength), ...extra],
        },
        (res) => {
          const chunks = []
          res.on("data", (chunk) => chunks.push(chunk))
          res.on("end", () =>
            resolve({
              status: res.statusCode,
              body: (() => {
                const text = Buffer.concat(chunks).toString("utf8")
                try {
                  return JSON.parse(text)
                } catch {
                  return { nonJsonBody: text }
                }
              })(),
              headers: res.headers,
            }),
          )
        },
      )
      req.on("error", reject)
      req.setTimeout(5000, () => req.destroy(new Error("Owned fixture HTTP deadline")))
      req.end(body)
    })
  }
  return { base, ownerBase, received, admission, call, raw }
}
function error(result, status, code) {
  assert.equal(result.status, status)
  assert.equal(result.body.error.code, code)
  assert.equal(result.body.meta.request_id, "i5-credit-http")
}

test("initialize invokes exact owner v1 PUT once with five trusted factors and actual nonzero snapshot", async (t) => {
  const f = await fixture(t)
  const r = await f.call({ headers: { "x-kokoro-subject": "forged", "x-kokoro-tenant-id": "foreign" } })
  assert.equal(r.status, 200)
  assert.deepEqual(r.body, { data: account, meta: { request_id: "i5-credit-http" } })
  assert.equal(f.received.length, 1)
  const o = f.received[0]
  assert.equal(o.method, "PUT")
  assert.equal(o.path, "/v1/billing/me/credit-account")
  assert.equal(o.body, "{}")
  assert.equal(o.headers.authorization, "Bearer owner-service")
  assert.equal(o.headers["x-kokoro-service"], "web-bff")
  assert.equal(o.headers["x-kokoro-internal-secret"], "owner-internal")
  assert.equal(o.headers["x-kokoro-tenant-id"], "u1.dGVuYW50")
  assert.equal(o.headers["x-kokoro-subject"], "u1.b3duZXI")
  assert.equal(o.headers["x-request-id"], "i5-credit-http")
  assert.equal(o.headers["idempotency-key"], undefined)
  assert.equal(r.headers.get("cache-control"), "no-store")
  assert.equal(r.headers.get("x-request-id"), "i5-credit-http")
  assert.equal(Number(r.headers.get("content-length")), Buffer.byteLength(r.raw))
})
for (const [label, status, code, retryable, expectedStatus, expectedCode] of [
  ["disabled", 403, "billing.credit_account_disabled", false, 403, "billing_account_disabled"],
  ["wrong disabled retryability", 403, "billing.credit_account_disabled", true, 502, "upstream_response_invalid"],
  ["owner service rejection", 403, "billing.forbidden", false, 503, "billing_unavailable"],
  ["owner unauthorized", 401, "billing.unauthenticated", false, 503, "billing_unavailable"],
  ["owner invalid request", 400, "billing.invalid_request", false, 502, "upstream_response_invalid"],
]) {
  test(`initialize maps ${label} without recovery GET or PUT retry`, async (t) => {
    const f = await fixture(t, { owner: (_q, res) => json(res, status, { error: { code, message: "Controlled owner failure", retryable } }) })
    const r = await f.call()
    error(r, expectedStatus, expectedCode)
    assert.equal(f.received.length, 1)
  })
}
for (const [label, raw, extra] of [
  ["unknown top field", JSON.stringify({ data: account, secret: "do-not-project" }), {}],
  ["unknown account field", JSON.stringify({ data: { ...account, tenant_id: "foreign" } }), {}],
  ["duplicate raw key", '{"data":' + JSON.stringify(account) + ',"data":' + JSON.stringify(account) + "}", {}],
  ["invalid decimal", JSON.stringify({ data: { ...account, available_micros: "01" } }), {}],
  ["negative held", JSON.stringify({ data: { ...account, held_micros: "-1" } }), {}],
  ["disabled success", JSON.stringify({ data: { ...account, status: "disabled" } }), {}],
  ["BOM", Buffer.concat([Buffer.from([239, 187, 191]), Buffer.from(JSON.stringify({ data: account }))]), {}],
  ["invalid UTF8", Buffer.from([123, 34, 120, 34, 58, 34, 255, 34, 125]), {}],
  ["nonJSON MIME", JSON.stringify({ data: account }), { "content-type": "text/plain" }],
  ["cookie", JSON.stringify({ data: account }), { "set-cookie": "unexpected=private" }],
  ["location", JSON.stringify({ data: account }), { location: "https://invalid.example/" }],
  ["missing no-store", JSON.stringify({ data: account }), { "cache-control": "public" }],
  ["oversized body", " ".repeat(1048577), {}],
]) {
  test(`initialize rejects owner ${label} before generated strip, no success fallback`, async (t) => {
    const f = await fixture(t, {
      owner: (_q, res) => {
        res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store", "x-request-id": "i5-credit-http", ...extra })
        res.end(raw)
      },
    })
    error(await f.call(), 502, "upstream_response_invalid")
    assert.equal(f.received.length, 1)
  })
}
for (const loss of ["socket", "valid503"]) {
  test(`initialize ${loss} unknown PUT gets exactly one same-subject GET, never a second PUT`, async (t) => {
    const f = await fixture(t, {
      owner: (q, res, n) => {
        if (n === 1) {
          if (loss === "socket") res.destroy()
          else json(res, 503, { error: { code: "billing.dependency_unavailable", message: "Controlled unavailable", retryable: true } })
        } else json(res, 200, { data: account })
      },
    })
    assert.equal((await f.call()).status, 200)
    assert.deepEqual(
      f.received.map((x) => [x.method, x.path]),
      [
        ["PUT", "/v1/billing/me/credit-account"],
        ["GET", "/v1/billing/me/credit-account"],
      ],
    )
    assert.equal(f.received[0].headers["x-kokoro-subject"], f.received[1].headers["x-kokoro-subject"])
  })
}
for (const outcome of ["missing", "failed", "disabled"]) {
  test(`initialize unknown PUT plus ${outcome} recovery cannot pretend initialized`, async (t) => {
    const f = await fixture(t, {
      owner: (_q, res, n) => {
        if (n === 1) res.destroy()
        else if (outcome === "missing") json(res, 404, { error: { code: "billing.credit_account_not_found", message: "Missing", retryable: false } })
        else if (outcome === "failed") res.destroy()
        else json(res, 200, { data: { ...account, status: "disabled" } })
      },
    })
    error(await f.call(), 503, "billing_unavailable")
    assert.deepEqual(
      f.received.map((x) => x.method),
      ["PUT", "GET"],
    )
  })
}
for (const config of [{ billingServiceToken: null }, { upstreamSecret: null }, { billingServiceToken: "owner-internal" }, { upstreams: { billing: null } }]) {
  test(`initialize incomplete or colliding credential configuration is unavailable with zero owner I/O ${JSON.stringify(config)}`, async (t) => {
    const f = await fixture(t, { config })
    error(await f.call(), 503, "billing_unavailable")
    assert.equal(f.received.length, 0)
  })
}
test("existing Billing summary/ledger stay read-only and never initialize missing account", async (t) => {
  const f = await fixture(t, {
    owner: (_q, res) => json(res, 404, { error: { code: "billing.credit_account_not_found", message: "Missing", retryable: false } }),
  })
  for (const p of ["/v1/billing/summary", "/v1/billing/ledger"]) {
    const r = await fetch(f.base + p, { headers, signal: AbortSignal.timeout(3000) })
    assert.equal(r.status, 404)
    assert.equal((await r.json()).error.code, "billing_account_not_found")
  }
  assert.deepEqual(
    f.received.map((x) => x.method),
    ["GET", "GET"],
  )
})

for (const [status, code, retryable] of [
  [401, "billing.forbidden", false],
  [503, "billing.dependency_unavailable", false],
  [500, "billing.internal_error", true],
]) {
  test(`initialize rejects owner status/code/retryability mismatch ${status}/${code}/${retryable}`, async (t) => {
    const f = await fixture(t, { owner: (_q, res) => json(res, status, { error: { code, message: "Controlled mismatch", retryable } }) })
    error(await f.call(), 502, "upstream_response_invalid")
    assert.equal(f.received.length, 1)
  })
}

test("initialize rejects mismatched owner request ID before success or recovery", async (t) => {
  const f = await fixture(t, { owner: (_q, res) => json(res, 200, { data: account }, { "x-request-id": "other-request" }) })
  error(await f.call(), 502, "upstream_response_invalid")
  assert.equal(f.received.length, 1)
})
