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

test("real source HTTP initializes current account without generic idempotency receipt or database", async (t) => {
  const f = await fixture(t)
  const r = await f.call()
  assert.equal(r.status, 200, "the existing real server must provide the new PUT, not a missing-entry response")
  assert.deepEqual(r.body.data, account)
  assert.equal(f.received.length, 1)
  assert.equal(f.admission.calls.length, 2)
})
for (const [label, result, status, code] of [
  ["revoked", { ok: false, status: 401, code: "session_invalid" }, 401, "session_invalid"],
  ["forbidden", { ok: false, status: 403, code: "session_forbidden" }, 403, "session_forbidden"],
  ["rate limited", { ok: false, status: 429, code: "session_rate_limited", retryAfter: "3" }, 429, "session_rate_limited"],
  ["unavailable", { ok: false, status: 503, code: "iam_admission_unavailable" }, 503, "iam_admission_unavailable"],
]) {
  test(`initialize initial IAM ${label} causes zero owner commands`, async (t) => {
    const f = await fixture(t, { admission: { verify: async () => result } })
    const r = await f.call()
    error(r, status, code)
    assert.equal(f.received.length, 0)
    if (status === 429) assert.equal(r.headers.get("retry-after"), "3")
  })
  test(`initialize final IAM ${label} discards owner ACK without another write`, async (t) => {
    let n = 0
    const f = await fixture(t, { admission: { verify: async () => (++n === 1 ? allow() : result) } })
    const r = await f.call()
    error(r, status, code)
    assert.equal(f.received.length, 1)
    assert.equal(n, 2)
  })
}
test("initialize final admitted subject change retires success without recovery or rollback command", async (t) => {
  let n = 0
  const f = await fixture(t, { admission: { verify: async () => allow(++n === 1 ? "owner" : "another") } })
  error(await f.call(), 503, "billing_unavailable")
  assert.equal(f.received.length, 1)
  assert.equal(n, 2)
})
for (const [label, identity] of [
  ["foreign tenant", { namespace: "foreign", userId: "owner" }],
  ["invalid subject UTF16", { namespace: "tenant", userId: "\ud800" }],
  ["overlong subject", { namespace: "tenant", userId: "x".repeat(256) }],
]) {
  test(`initialize ${label} never dispatches owner`, async (t) => {
    const f = await fixture(t, { admission: { verify: async () => ({ ok: true, identity, platformAdmin: false }) } })
    const r = await f.call()
    assert.equal(r.status, label === "foreign tenant" ? 403 : 503)
    assert.equal(f.received.length, 0)
  })
}
test("initialize missing Product bearer cannot reach IAM or owner", async (t) => {
  const f = await fixture(t)
  error(await f.call({ headers: { authorization: "" } }), 401, "session_authentication_required")
  assert.equal(f.received.length, 0)
  assert.equal(f.admission.calls.length, 0)
})
test("initialize insufficient remaining write reserve sends zero PUT", async (t) => {
  const f = await fixture(t, { timeout: 120 })
  error(await f.call(), 503, "billing_unavailable")
  assert.equal(f.received.length, 0)
})
test("initialize uncooperative initial IAM is bounded and late admission never dispatches", async (t) => {
  let resolve
  const pending = new Promise((r) => (resolve = r)),
    signals = []
  const f = await fixture(t, {
    timeout: 80,
    admission: {
      verify: ({ signal }) => {
        signals.push(signal)
        return pending
      },
    },
  })
  const start = performance.now()
  const r = await f.call()
  assert.equal(r.status, 503)
  assert.ok(performance.now() - start < 700)
  resolve(allow())
  await delay(35)
  assert.equal(f.received.length, 0)
  assert.ok(signals[0].aborted)
})
test("initialize body EOF is inside initial absolute budget and late body causes no dispatch", async (t) => {
  const f = await fixture(t, { timeout: 80 })
  const u = new URL(f.base)
  const r = await new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: u.hostname, port: u.port, path, method: "PUT", headers: { ...headers, "content-length": "2" } }, (res) => {
      res.resume()
      res.on("end", () => resolve(res.statusCode))
    })
    req.on("error", reject)
    req.setTimeout(1200, () => req.destroy(new Error("Body budget not enforced")))
    req.write("{")
    const timer = setTimeout(() => req.end("}"), 200)
    t.after(() => clearTimeout(timer))
  })
  assert.equal(r, 503)
  assert.equal(f.received.length, 0)
})
test("initialize disconnect while IAM pending aborts admission and cannot late-dispatch", async (t) => {
  let resolve, entered
  const admissionEntered = new Promise((r) => (entered = r))
  const pending = new Promise((r) => (resolve = r)),
    signals = []
  const f = await fixture(t, {
    admission: {
      verify: ({ signal }) => {
        signals.push(signal)
        entered()
        return pending
      },
    },
  })
  const u = new URL(f.base)
  const req = httpRequest({ hostname: u.hostname, port: u.port, path, method: "PUT", headers }, (res) => res.resume())
  req.on("error", () => {})
  req.end("{}")
  await Promise.race([admissionEntered, delay(400)])
  req.destroy()
  await delay(25)
  resolve(allow())
  await delay(35)
  assert.equal(signals.length, 1)
  assert.ok(signals[0].aborted)
  assert.equal(f.received.length, 0)
})
test("initialize final noncooperative IAM cannot hold HTTP beyond the original budget", async (t) => {
  let n = 0,
    resolve
  const pending = new Promise((r) => (resolve = r))
  const f = await fixture(t, { timeout: 1800, admission: { verify: () => (++n === 1 ? Promise.resolve(allow()) : pending) } })
  const start = performance.now()
  const r = await f.call()
  assert.equal(r.status, 503)
  assert.ok(performance.now() - start < 2500)
  assert.equal(f.received.length, 1)
  resolve(allow())
  await delay(20)
  assert.equal(f.received.length, 1)
})
test("initialize owner headers and incomplete body share one budget and only one recovery GET", async (t) => {
  const f = await fixture(t, {
    timeout: 1800,
    owner: (req, res, n) => {
      if (n === 1) {
        res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store", "x-request-id": "i5-credit-http" })
        res.write('{"data":')
      } else json(res, 200, { data: account })
    },
  })
  const start = performance.now()
  const r = await f.call()
  assert.equal(r.status, 200)
  assert.ok(performance.now() - start < 2500)
  assert.deepEqual(
    f.received.map((x) => x.method),
    ["PUT", "GET"],
  )
})

test("initialize noncooperative owner fetch is bounded; late response is cancelled without a PUT retry", async (t) => {
  const f = await fixture(t, { timeout: 1800 })
  const nativeFetch = globalThis.fetch
  let resolve,
    putCalls = 0,
    getCalls = 0,
    cancelled = 0
  const signals = []
  const pending = new Promise((r) => (resolve = r))
  globalThis.fetch = (input, init) => {
    const url = String(input instanceof Request ? input.url : input)
    if (url.startsWith(f.ownerBase)) {
      const method = init?.method ?? (input instanceof Request ? input.method : "GET")
      signals.push(init?.signal ?? (input instanceof Request ? input.signal : undefined))
      if (method === "PUT") {
        putCalls++
        return pending
      }
      getCalls++
      return Promise.resolve(
        new Response(JSON.stringify({ data: account }), {
          status: 200,
          headers: { "content-type": "application/json", "cache-control": "no-store", "x-request-id": "i5-credit-http" },
        }),
      )
    }
    return nativeFetch(input, init)
  }
  t.after(() => {
    globalThis.fetch = nativeFetch
  })
  const started = performance.now()
  const result = await f.call()
  assert.equal(result.status, 200)
  assert.ok(performance.now() - started < 2500)
  assert.equal(putCalls, 1)
  assert.equal(getCalls, 1)
  assert.ok(signals[0].aborted)
  resolve(
    new Response(
      new ReadableStream({
        cancel() {
          cancelled++
        },
      }),
      { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store", "x-request-id": "i5-credit-http" } },
    ),
  )
  await delay(40)
  assert.equal(cancelled, 1)
  assert.equal(putCalls, 1)
})
test("initialize successful owner body followed by noncooperative cancel cannot hang invalid-response handling", async (t) => {
  const f = await fixture(t, { timeout: 1800 })
  const nativeFetch = globalThis.fetch
  let dispatched = 0,
    cancels = 0
  globalThis.fetch = (input, init) => {
    const url = String(input instanceof Request ? input.url : input)
    if (!url.startsWith(f.ownerBase)) return nativeFetch(input, init)
    dispatched++
    return Promise.resolve(
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode(" ".repeat(1048577)))
          },
          cancel() {
            cancels++
            return new Promise(() => {})
          },
        }),
        { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store", "x-request-id": "i5-credit-http" } },
      ),
    )
  }
  t.after(() => {
    globalThis.fetch = nativeFetch
  })
  const start = performance.now()
  error(await f.call(), 502, "upstream_response_invalid")
  assert.ok(performance.now() - start < 2500)
  assert.equal(dispatched, 1)
  assert.equal(cancels, 1)
})
