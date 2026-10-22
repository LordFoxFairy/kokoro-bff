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

for (const [label, body] of [
  ["array", "[]"],
  ["null", "null"],
  ["string", '""'],
  ["number", "0"],
  ["identity field", '{"subject":"forged"}'],
  ["duplicate key", '{"x":1,"x":2}'],
  ["escaped own key", '{"\\u0078":0}'],
  ["prototype key", '{"__proto__":{}}'],
  ["empty bytes", ""],
  ["trailing bytes", "{}x"],
  ["UTF8 BOM", Buffer.from([239, 187, 191, 123, 125])],
  ["invalid UTF8", Buffer.from([123, 34, 120, 34, 58, 34, 255, 34, 125])],
  ["over4096", " ".repeat(4097)],
]) {
  test(`initialize input rejects ${label} before owner I/O`, async (t) => {
    const f = await fixture(t)
    error(await f.raw(path, Buffer.from(body)), 400, "billing_credit_account_input_invalid")
    assert.equal(f.received.length, 0)
  })
}
for (const target of [
  path + "?",
  path + "?x=",
  path + "?x=1&x=2",
  path + "#fragment",
  path + "/",
  "/v1/billing/%63redit-account",
  "/v1//billing/credit-account",
  "/v1/billing/./credit-account",
]) {
  test(`initialize input rejects noncanonical target ${target}`, async (t) => {
    const f = await fixture(t)
    error(await f.raw(target), 400, "billing_credit_account_input_invalid")
    assert.equal(f.received.length, 0)
  })
}
for (const [name, value] of [
  ["Idempotency-Key", "not-a-command-receipt"],
  ["Content-Encoding", "identity"],
  ["Content-Type", "text/plain"],
  ["Content-Type", "application/json"],
  ["Authorization", "Bearer another"],
  ["X-Kokoro-Service", "web-bff"],
  ["X-Kokoro-Internal-Secret", "browser-internal"],
]) {
  test(`initialize input rejects forbidden or duplicate ${name}:${value}`, async (t) => {
    const f = await fixture(t)
    error(await f.raw(path, Buffer.from("{}"), [name, value]), 400, "billing_credit_account_input_invalid")
    assert.equal(f.received.length, 0)
  })
}
test("initialize accepts strict empty object with JSON whitespace and UTF8 charset, no receipt store", async (t) => {
  const f = await fixture(t)
  const r = await f.call({ body: " \r\n{ }\t", headers: { "content-type": "application/json; charset=utf-8" } })
  assert.equal(r.status, 200)
  assert.deepEqual(r.body.data, account)
  assert.equal(f.received.length, 1)
  assert.equal(f.received[0].body, "{}")
})
