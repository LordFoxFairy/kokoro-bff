import assert from "node:assert/strict"
import { createServer, request as nodeRequest } from "node:http"
import test from "node:test"
import { createBffServer } from "../dist/bootstrap/server.js"
import { DEFAULT_AGUI_CONFIG } from "../dist/config/runtime.js"
import { SessionAdmissionDouble } from "./doubles/session-admission.ts"

const session = (id) => ({ session_id: id, created_at: "2026-10-01T01:02:03.000Z", expires_at: "2026-11-01T01:02:03.000Z" })
const headers = {
  "x-kokoro-service": "web-bff",
  "x-kokoro-internal-secret": "test-secret",
  authorization: "Bearer account-token",
  "x-kokoro-request-id": "account-http",
}
async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  return `http://127.0.0.1:${server.address().port}`
}
async function fixture(t, body, options = {}) {
  const seen = []
  let ownerClosed = false
  const owner = createServer((req, res) => {
    const entry = { method: req.method, path: req.url, headers: req.headers }
    seen.push(entry)
    const chunks = []
    req.on("data", (chunk) => chunks.push(chunk))
    req.on("end", () => {
      if (chunks.length) entry.body = JSON.parse(Buffer.concat(chunks).toString("utf8"))
    })
    const output = typeof body === "function" ? body(req) : { status: 200, body }
    res.writeHead(output.status, { "content-type": "application/json", "cache-control": "no-store", "x-request-id": req.headers["x-request-id"] })
    if (output.hold) {
      res.flushHeaders()
      res.once("close", () => {
        ownerClosed = true
      })
      return
    }
    res.end(
      JSON.stringify(
        output.body ??
          (req.method === "DELETE"
            ? { data: { session_id: "other", revoked: true } }
            : { data: { current_session: session("current"), sessions: [session("other")] }, meta: { next_cursor: null } }),
      ),
    )
  })
  const ownerUrl = await listen(owner)
  const config = {
    host: "127.0.0.1",
    port: 0,
    mode: "live",
    domain: "dev.kokoro.localhost",
    tenantId: "tenant-verified",
    iamBaseUrl: ownerUrl,
    sharedSecret: "test-secret",
    upstreamSecret: null,
    upstreamTimeoutMs: options.timeout ?? 1000,
    upstreamMaxResponseBytes: 4096,
    schedulerServiceToken: null,
    schedulerTargetUrl: null,
    agentEnabled: false,
    postgresUrl: null,
    redisUrl: null,
    agUi: DEFAULT_AGUI_CONFIG,
    upstreams: {},
  }
  const admission = options.admission ?? new SessionAdmissionDouble({ "account-token": { namespace: "tenant-verified", userId: "user-one" } })
  const bff = createBffServer(config, { businessStore: null, readiness: async () => undefined, sessionAdmission: admission })
  const base = await listen(bff)
  t.after(async () => {
    for (const server of [bff, owner]) {
      server.closeAllConnections()
      await new Promise((resolve) => server.close(resolve))
    }
  })
  return { base, seen, admission, ownerClosed: () => ownerClosed }
}

test("profile PATCH preserves exact name and CAS through Product bearer without BFF storage or receipt", async (t) => {
  const { base, seen } = await fixture(t, { data: { subject: "user-one", name: "New 名" } })
  const response = await fetch(`${base}/v1/account/profile`, {
    method: "PATCH",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ name: "New 名", expected_name: "Old" }),
  })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { data: { subject: "user-one", name: "New 名" } })
  assert.equal(seen.length, 1)
  assert.equal(seen[0].path, "/internal/v1/account/profile")
  assert.equal(seen[0].headers.authorization, "Bearer account-token")
  assert.equal(seen[0].headers["idempotency-key"], undefined)
})

const patch = (base, body, extra = {}) =>
  fetch(`${base}/v1/account/profile`, { method: "PATCH", headers: { ...headers, "content-type": "application/json", ...extra }, body })
test("anonymous and rejected Product admission never call owner and have plain errors", async (t) => {
  const { base, seen, admission } = await fixture(t)
  for (const auth of ["", "Bearer denied"]) {
    admission.deny("denied", { ok: false, status: 403, code: "session_forbidden" })
    const r = await patch(base, JSON.stringify({ name: "New", expected_name: "Old" }), { authorization: auth })
    assert.ok([401, 403].includes(r.status))
    const b = await r.json()
    assert.deepEqual(Object.keys(b), ["error"])
    assert.equal(r.headers.get("cache-control"), "no-store")
    assert.equal(r.headers.get("x-request-id"), "account-http")
  }
  assert.equal(seen.length, 0)
})
test("raw body, Unicode, query and receipt keys fail without owner writes", async (t) => {
  const { base, seen } = await fixture(t)
  for (const body of [
    '{"name":"A","name":"B","expected_name":"Old"}',
    JSON.stringify({ name: " New", expected_name: "Old" }),
    JSON.stringify({ name: "New", expected_name: "Old", subject: "foreign" }),
  ])
    assert.equal((await patch(base, body)).status, 400)
  assert.equal((await patch(base, JSON.stringify({ name: "New", expected_name: "Old" }), { "idempotency-key": "key" })).status, 400)
  const query = await fetch(`${base}/v1/account/profile?`, { method: "PATCH", headers: { ...headers, "content-type": "application/json" }, body: "{}" })
  assert.equal(query.status, 400)
  assert.equal(seen.length, 0)
})
test("noncooperative admission consumes the single total budget and late acceptance cannot PATCH", async (t) => {
  let release
  const admission = {
    verify: () =>
      new Promise((r) => {
        release = r
      }),
  }
  const { base, seen } = await fixture(t, undefined, { timeout: 30, admission })
  const r = await patch(base, JSON.stringify({ name: "New", expected_name: "Old" }))
  assert.equal(r.status, 503)
  assert.deepEqual(Object.keys(await r.json()), ["error"])
  release({ ok: true, identity: { namespace: "tenant-verified", userId: "user-one" }, platformAdmin: false })
  await new Promise((r) => setTimeout(r, 10))
  assert.equal(seen.length, 0)
})
test("admission time is not renewed for owner body and no write is retried", async (t) => {
  const admission = {
    verify: async () => {
      await new Promise((r) => setTimeout(r, 400))
      return { ok: true, identity: { namespace: "tenant-verified", userId: "user-one" }, platformAdmin: false }
    },
  }
  const { base, seen, ownerClosed } = await fixture(t, () => ({ status: 200, hold: true }), { timeout: 1000, admission })
  const start = performance.now()
  const r = await patch(base, JSON.stringify({ name: "New", expected_name: "Old" }))
  assert.equal(r.status, 503)
  assert.ok(performance.now() - start < 1250)
  assert.equal(seen.length, 1)
  await new Promise((r) => setTimeout(r, 15))
  assert.equal(ownerClosed(), true)
})

test("partial chunked input is cancelled by the same budget before any owner PATCH", async (t) => {
  const { base, seen } = await fixture(t, undefined, { timeout: 35 })
  const result = await new Promise((resolve, reject) => {
    const req = nodeRequest(`${base}/v1/account/profile`, { method: "PATCH", headers: { ...headers, "content-type": "application/json" } }, (res) => {
      const chunks = []
      res.on("data", (chunk) => chunks.push(chunk))
      res.on("end", () => {
        resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) })
        req.destroy()
      })
    })
    req.on("error", reject)
    req.write('{"name":"New",')
  })
  assert.equal(result.status, 503)
  assert.equal(result.body.error.code, "account_profile_unavailable")
  assert.equal(seen.length, 0)
})
test("over-limit actual chunked body is413 and has zero owner I/O", async (t) => {
  const { base, seen } = await fixture(t)
  const r = await patch(base, JSON.stringify({ name: "New", expected_name: "x".repeat(66000) }))
  assert.equal(r.status, 413)
  assert.deepEqual(Object.keys(await r.json()), ["error"])
  assert.equal(seen.length, 0)
})
test("legitimate historical escaped lone expected_name reaches owner unchanged while new lone name never writes", async (t) => {
  const { base, seen } = await fixture(t, { data: { subject: "user-one", name: "New" } })
  const response = await patch(base, JSON.stringify({ name: "New", expected_name: "\ud800" }))
  assert.equal(response.status, 200)
  assert.equal(seen.length, 1)
  assert.deepEqual(seen[0].body, { name: "New", expected_name: "\ud800" })
  const invalid = await patch(base, JSON.stringify({ name: "\ud800", expected_name: "\ud800" }))
  assert.equal(invalid.status, 400)
  assert.equal(seen.length, 1)
})
