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
async function fixture(t, body) {
  const seen = []
  let ownerClosed = false
  const owner = createServer((req, res) => {
    seen.push({ method: req.method, path: req.url, headers: req.headers })
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
    upstreamTimeoutMs: 1000,
    upstreamMaxResponseBytes: 4096,
    schedulerServiceToken: null,
    schedulerTargetUrl: null,
    agentEnabled: false,
    postgresUrl: null,
    redisUrl: null,
    agUi: DEFAULT_AGUI_CONFIG,
    upstreams: {},
  }
  const admission = new SessionAdmissionDouble({ "account-token": { namespace: "tenant-verified", userId: "user-one" } })
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

test("account list reaches only the owner after Product admission and projects a separate current session", async (t) => {
  const { base, seen } = await fixture(t)
  const response = await fetch(`${base}/v1/account/sessions?limit=2`, { headers })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.data.current_session.session_id, "current")
  assert.equal(body.data.sessions[0].session_id, "other")
  assert.equal(body.meta.next_cursor, null)
  assert.equal(body.meta.request_id, "account-http")
  assert.equal(response.headers.get("cache-control"), "no-store")
  assert.equal(seen[0].path, "/internal/v1/account/sessions?limit=2")
  assert.equal(seen[0].headers.authorization, "Bearer account-token")
})

test("revoke projects only a confirmed matching owner ACK without receipt or body", async (t) => {
  const { base, seen } = await fixture(t)
  const response = await fetch(`${base}/v1/account/sessions/other`, { method: "DELETE", headers })
  assert.equal(response.status, 200)
  assert.deepEqual((await response.json()).data, { session_id: "other", revoked: true })
  assert.equal(seen.length, 1)
  assert.equal(seen[0].method, "DELETE")
  assert.equal(seen[0].path, "/internal/v1/account/sessions/other")
  assert.equal(seen[0].headers["idempotency-key"], undefined)
})
test("rejects raw duplicate query and revoke query/body/receipt key before owner I/O", async (t) => {
  const { base, seen } = await fixture(t)
  for (const [method, path, extra, body] of [
    ["GET", "/v1/account/sessions?limit=1&limit=2", {}, undefined],
    ["GET", "/v1/account/sessions?subject_id=foreign", {}, undefined],
    ["DELETE", "/v1/account/sessions/other?", {}, undefined],
    ["DELETE", "/v1/account/sessions/other?limit=1", {}, undefined],
    ["DELETE", "/v1/account/sessions/other", { "idempotency-key": "receipt" }, undefined],
    ["DELETE", "/v1/account/sessions/other", { "content-type": "application/json" }, "{}"],
  ]) {
    const response = path.endsWith("?")
      ? await new Promise((resolve, reject) => {
          const req = nodeRequest(new URL(base), { method, path, headers: { ...headers, ...extra } }, (res) => {
            const chunks = []
            res.on("data", (chunk) => chunks.push(chunk))
            res.on("end", () => resolve(new Response(Buffer.concat(chunks), { status: res.statusCode })))
          })
          req.on("error", reject)
          req.end()
        })
      : await fetch(`${base}${path}`, { method, headers: { ...headers, ...extra }, body })
    assert.equal(response.status, 400, `${method} ${path}`)
    assert.equal((await response.json()).error.code, "account_session_input_invalid")
  }
  assert.equal(seen.length, 0)
})
test("normal Product and browser-service admission still reject anonymous and machine callers", async (t) => {
  const { base, seen } = await fixture(t)
  for (const [extra, expected] of [
    [{ authorization: "" }, 401],
    [{ "x-kokoro-service": "machine" }, 403],
    [{ authorization: "Bearer retired" }, 401],
  ]) {
    const response = await fetch(`${base}/v1/account/sessions`, { headers: { ...headers, ...extra } })
    assert.equal(response.status, expected)
  }
  assert.equal(seen.length, 0)
})
test("current and foreign decisions are owner-derived and tenant disabled is forbidden rather than a conflict", async (t) => {
  const { base } = await fixture(t, (req) => {
    const id = req.url.split("/").at(-1)
    const code = id === "current" ? "CONFLICT" : id === "disabled" ? "TENANT_DISABLED" : "NOT_FOUND"
    return { status: code === "NOT_FOUND" ? 404 : 409, body: { error: { code, message: "owner-private", retryable: false, details: [] } } }
  })
  for (const [id, status, code] of [
    ["current", 409, "account_session_conflict"],
    ["foreign", 404, "account_session_not_found"],
    ["missing", 404, "account_session_not_found"],
    ["disabled", 403, "session_forbidden"],
  ]) {
    const response = await fetch(`${base}/v1/account/sessions/${id}`, { method: "DELETE", headers })
    assert.equal(response.status, status)
    const body = await response.json()
    assert.equal(body.error.code, code)
    assert.equal(JSON.stringify(body).includes("owner-private"), false)
  }
})

test("a closed browser response cancels an in-flight owner body and cannot emit a late ACK", async (t) => {
  const { base, seen, ownerClosed } = await fixture(t, () => ({ status: 200, hold: true }))
  const request = nodeRequest(`${base}/v1/account/sessions/other`, { method: "DELETE", headers })
  request.on("error", () => {})
  request.end()
  const deadline = performance.now() + 1000
  while (seen.length === 0 && performance.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5))
  assert.equal(seen.length, 1)
  request.destroy()
  while (!ownerClosed() && performance.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5))
  assert.equal(ownerClosed(), true)
  assert.equal(seen.length, 1)
})
