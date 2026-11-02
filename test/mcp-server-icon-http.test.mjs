import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { createServer, request as nodeRequest } from "node:http"
import test from "node:test"
import { createBffServer } from "../dist/bootstrap/server.js"
import { DEFAULT_AGUI_CONFIG } from "../dist/config/runtime.js"
import { startMcpRequestBudget } from "../dist/http/mcp-request-budget.js"

const headers = { "x-kokoro-service": "web-bff", "x-kokoro-internal-secret": "test-secret", authorization: "Bearer human-session", "x-request-id": "icon-http" }
const path = "/browser/v1/mcp/servers/server-one/icon"
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64")
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex")
async function fixture(options = {}) {
  const seen = { owner: [], storage: 0, storageClosed: 0, actions: 0, sessions: 0 }
  const storage = createServer((request, response) => {
    seen.storage++
    response.once("close", () => seen.storageClosed++)
    if (options.storage) return options.storage(request, response)
    response.writeHead(200, { "content-type": "image/png", "content-length": png.length })
    response.end(png)
  })
  await new Promise((resolve) => storage.listen(0, "127.0.0.1", resolve))
  const objectOrigin = `http://127.0.0.1:${storage.address().port}`
  const icon = {
    intent_id: "11111111-1111-1111-1111-111111111111",
    content_sha256: sha(png),
    size_bytes: String(png.length),
    mime_type: "image/png",
    width: 1,
    height: 1,
    preview_reference: {
      url: objectOrigin + "/private?signature=temporary",
      method: "GET",
      required_headers: {},
      expires_at: new Date(Date.now() + 300000).toISOString(),
    },
    ...options.icon,
  }
  if (options.reference) icon.preview_reference = options.reference(icon.preview_reference)
  const server = createBffServer(
    {
      host: "127.0.0.1",
      port: 0,
      mode: "live",
      domain: "dev.kokoro.localhost",
      tenantId: "tenant-one",
      iamBaseUrl: "http://127.0.0.1:1",
      sharedSecret: "test-secret",
      upstreamSecret: "owner-secret",
      upstreamTimeoutMs: 5000,
      upstreamMaxResponseBytes: 1048576,
      schedulerServiceToken: null,
      schedulerTargetUrl: null,
      agentEnabled: false,
      postgresUrl: null,
      redisUrl: null,
      agUi: DEFAULT_AGUI_CONFIG,
      storageObjectOrigin: options.noOrigin ? null : objectOrigin,
      upstreams: { system: null, capability: null, scheduler: null, agents: null, billing: null, music: null },
    },
    {
      businessStore: null,
      readiness: async () => undefined,
      sessionAdmission: {
        verify: async () => {
          seen.sessions++
          return options.session?.(seen.sessions) ?? { ok: true, identity: { namespace: "tenant-one", userId: "human-one" }, platformAdmin: false }
        },
      },
      mcpAuthorization: {
        check: async (input) => {
          seen.actions++
          assert.equal(input.resource, "mcp_personal")
          assert.equal(input.action, "read")
          return options.action?.(seen.actions) ?? { ok: true }
        },
      },
      mcpPersonalClient: {
        read: async (operation) => {
          assert.equal(operation, "connectors")
          return { items: [], next_cursor: null }
        },
        server: async (operation, input, signal, deadline) => {
          seen.owner.push({ operation, input, signal, deadline })
          assert.equal(operation, "server")
          assert.equal(input.id, "server-one")
          assert.equal(input.tenant, "tenant-one")
          assert.equal(input.subject, "human-one")
          return options.owner?.(seen.owner.length, icon, signal) ?? { server: { server_id: "server-one", icon } }
        },
      },
    },
  )
  if (options.deadlineMs !== undefined) {
    const handler = server.listeners("request")[0]
    server.removeAllListeners("request")
    server.on("request", (request, response) => {
      startMcpRequestBudget(request, options.deadlineMs)
      handler(request, response)
    })
  }
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  return {
    seen,
    icon,
    origin: `http://127.0.0.1:${server.address().port}`,
    close: async () => {
      for (const value of [server, storage]) {
        value.closeAllConnections()
        await new Promise((resolve) => value.close(resolve))
      }
    },
  }
}
async function withFixture(options, work) {
  const f = await fixture(options)
  try {
    await work(f)
  } finally {
    await f.close()
  }
}
async function failure(f, status, code, suffix = "", extraHeaders = {}) {
  const result = await fetch(f.origin + path + suffix, { headers: { ...headers, ...extraHeaders } })
  assert.equal(result.status, status)
  assert.equal(result.headers.get("cache-control"), "no-store")
  const body = await result.json()
  assert.equal(body.error.code, code)
  assert.equal(body.error.retryable, status === 503 || status === 429)
  assert.ok(!JSON.stringify(body).includes("signature"))
}

test("saved MCP icon is an independently verified binary resource, with fresh owner binding and admission", () =>
  withFixture({}, async (f) => {
    const result = await fetch(f.origin + path, { headers })
    assert.equal(result.status, 200)
    for (const [key, value] of Object.entries({
      "content-type": "image/png",
      "content-length": String(png.length),
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "x-request-id": "icon-http",
    }))
      assert.equal(result.headers.get(key), value)
    assert.deepEqual(Buffer.from(await result.arrayBuffer()), png)
    assert.equal(f.seen.storage, 1)
    assert.equal(f.seen.owner.length, 2)
    assert.equal(f.seen.sessions, 2)
    assert.equal(f.seen.actions, 2)
    assert.equal(f.seen.owner[0].deadline, f.seen.owner[1].deadline)
  }))

test("metadata list remains independent from Storage and per-server reads", () =>
  withFixture({ noOrigin: true }, async (f) => {
    const result = await fetch(f.origin + "/browser/v1/mcp/connectors", { headers })
    assert.equal(result.status, 200)
    assert.deepEqual((await result.json()).data, { items: [], next_cursor: null })
    assert.equal(f.seen.owner.length, 0)
    assert.equal(f.seen.storage, 0)
  }))

for (const [suffix, extra] of [
  ["?foo=1", {}],
  ["", { "idempotency-key": "forbidden" }],
])
  test(`icon GET rejects query/body/command metadata ${suffix} ${Object.keys(extra)}`, () =>
    withFixture({}, async (f) => {
      await failure(f, 400, "invalid_mcp_personal_request", suffix, extra)
      assert.equal(f.seen.owner.length, 0)
      assert.equal(f.seen.storage, 0)
    }))

for (const badPath of ["/browser/v1/mcp/servers/server-one/icon/extra", "/browser/v1/mcp/servers/server-one/icons", "/v1/mcp/servers/server-one/icon"])
  test(`icon path is exact: ${badPath}`, () =>
    withFixture({}, async (f) => {
      assert.equal((await fetch(f.origin + badPath, { headers })).status, 404)
      assert.equal(f.seen.owner.length, 0)
      assert.equal(f.seen.storage, 0)
    }))

test("no saved binding returns 404 without Storage access", () =>
  withFixture({ owner: () => ({ server: { server_id: "server-one" } }) }, (f) => failure(f, 404, "mcp_personal_not_found")))
test("missing configured Storage origin is a dependency failure", () =>
  withFixture({ noOrigin: true }, (f) => failure(f, 503, "mcp_personal_dependency_unavailable")))
for (const [name, icon] of [
  ["digest", { content_sha256: "0".repeat(64) }],
  ["size", { size_bytes: String(png.length + 1) }],
  ["metadata limit", { size_bytes: "1048577" }],
  ["MIME", { mime_type: "image/jpeg" }],
])
  test(`icon validates ${name} before returning any bytes`, () => withFixture({ icon }, (f) => failure(f, 502, "mcp_personal_response_invalid")))

test("Storage redirects are not followed", () =>
  withFixture(
    {
      storage: (_req, res) => {
        res.writeHead(302, { location: "http://127.0.0.1:1/not-followed" })
        res.end()
      },
    },
    (f) => failure(f, 502, "mcp_personal_response_invalid"),
  ))
test("unbounded chunked Storage output is stopped at the declared bounded size", () =>
  withFixture(
    {
      storage: (_req, res) => {
        res.writeHead(200, { "content-type": "image/png" })
        res.end(Buffer.alloc(1048577))
      },
    },
    (f) => failure(f, 502, "mcp_personal_response_invalid"),
  ))
test("truncated Storage output is rejected", () =>
  withFixture(
    {
      storage: (_req, res) => {
        res.writeHead(200, { "content-type": "image/png", "content-length": png.length })
        res.write(png.subarray(0, 2))
        res.destroy()
      },
    },
    (f) => failure(f, 503, "mcp_personal_dependency_unavailable"),
  ))
for (const change of [
  undefined,
  { intent_id: "22222222-2222-2222-2222-222222222222" },
  { width: 2 },
  { size_bytes: "3" },
  { content_sha256: "b".repeat(64) },
  { mime_type: "image/jpeg" },
])
  test(`fresh binding rejects clear or replacement ${JSON.stringify(change)}`, () =>
    withFixture(
      {
        owner: (call, icon) => ({
          server: { server_id: "server-one", ...(call === 1 ? { icon } : change === undefined ? {} : { icon: { ...icon, ...change } }) },
        }),
      },
      (f) => failure(f, 404, "mcp_personal_not_found"),
    ))

test("denied MCP read never accesses owner or Storage", () =>
  withFixture({ action: () => ({ ok: false, status: 403, code: "session_forbidden" }) }, async (f) => {
    await failure(f, 403, "session_forbidden")
    assert.equal(f.seen.owner.length, 0)
    assert.equal(f.seen.storage, 0)
  }))
test("MCP read revoked during transfer prevents image output", () =>
  withFixture({ action: (call) => (call === 1 ? { ok: true } : { ok: false, status: 403, code: "session_forbidden" }) }, (f) =>
    failure(f, 403, "session_forbidden"),
  ))
test("changed Session subject at egress prevents image output", () =>
  withFixture(
    { session: (call) => ({ ok: true, identity: { namespace: "tenant-one", userId: call === 1 ? "human-one" : "human-two" }, platformAdmin: false }) },
    (f) => failure(f, 404, "mcp_personal_not_found"),
  ))
test("original absolute budget bounds a stalled Storage response", () =>
  withFixture({ deadlineMs: 80, storage: () => {} }, async (f) => {
    const started = performance.now()
    await failure(f, 503, "mcp_personal_dependency_unavailable")
    assert.ok(performance.now() - started < 1000)
  }))
test("browser cancellation aborts the in-flight object fetch", () =>
  withFixture(
    {
      storage: (_req, res) => {
        res.writeHead(200, { "content-type": "image/png" })
        res.write(png.subarray(0, 2))
      },
    },
    async (f) => {
      const request = nodeRequest(f.origin + path, { headers })
      request.on("error", () => {})
      request.end()
      for (let i = 0; i < 100 && f.seen.storage === 0; i++) await new Promise((resolve) => setTimeout(resolve, 5))
      assert.equal(f.seen.storage, 1)
      request.destroy()
      for (let i = 0; i < 100 && !f.seen.owner[0]?.signal.aborted; i++) await new Promise((resolve) => setTimeout(resolve, 5))
      assert.equal(f.seen.owner[0].signal.aborted, true)
      assert.equal(f.seen.owner.length, 1)
    },
  ))

// Native HTTP is required here: fetch strips content-length:0 from GET requests.
test("icon GET rejects an explicit empty body declaration before owner access", () =>
  withFixture({}, async (f) => {
    const result = await new Promise((resolve, reject) => {
      const req = nodeRequest(f.origin + path, { headers: { ...headers, "content-length": "0" } }, (res) => {
        const chunks = []
        res.on("data", (chunk) => chunks.push(chunk))
        res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) }))
      })
      req.on("error", reject)
      req.end()
    })
    assert.equal(result.status, 400)
    assert.equal(result.body.error.code, "invalid_mcp_personal_request")
    assert.equal(f.seen.owner.length, 0)
    assert.equal(f.seen.storage, 0)
  }))

test("icon GET rejects an empty query delimiter on the raw HTTP request", () =>
  withFixture({}, async (f) => {
    const url = new URL(f.origin)
    const status = await new Promise((resolve, reject) => {
      const req = nodeRequest({ hostname: url.hostname, port: url.port, path: path + "?", method: "GET", headers }, (res) => {
        res.resume()
        res.on("end", () => resolve(res.statusCode))
      })
      req.on("error", reject)
      req.end()
    })
    assert.equal(status, 400)
    assert.equal(f.seen.owner.length, 0)
    assert.equal(f.seen.storage, 0)
  }))

for (const [name, change] of [
  ["foreign origin", (ref) => ({ ...ref, url: "https://other.example/icon" })],
  ["credentials", (ref) => ({ ...ref, url: ref.url.replace("://", "://user:secret@") })],
  ["empty userinfo", (ref) => ({ ...ref, url: ref.url.replace("://", "://@") })],
  ["fragment", (ref) => ({ ...ref, url: ref.url + "#fragment" })],
  ["empty fragment", (ref) => ({ ...ref, url: ref.url + "#" })],
  ["required headers", (ref) => ({ ...ref, required_headers: { "x-owner-token": "never-forwarded" } })],
  ["PUT method", (ref) => ({ ...ref, method: "PUT" })],
  ["expired", (ref) => ({ ...ref, expires_at: new Date(Date.now() - 1000).toISOString() })],
  ["excessive TTL", (ref) => ({ ...ref, expires_at: new Date(Date.now() + 302000).toISOString() })],
])
  test(`invalid current image capability never reaches Storage: ${name}`, () =>
    withFixture({ reference: change }, async (f) => {
      await failure(f, 502, "mcp_personal_response_invalid")
      assert.equal(f.seen.storage, 0)
    }))

test("missing usable short GET reference fails closed", () =>
  withFixture({ reference: () => undefined }, async (f) => {
    await failure(f, 503, "mcp_personal_dependency_unavailable")
    assert.equal(f.seen.storage, 0)
  }))
test("owner exact ID mismatch never reaches Storage", () =>
  withFixture({ owner: (_call, icon) => ({ server: { server_id: "server-other", icon } }) }, async (f) => {
    await failure(f, 502, "mcp_personal_response_invalid")
    assert.equal(f.seen.storage, 0)
  }))
test("rotating fresh signed GET reference does not change the exact saved image binding", () =>
  withFixture(
    {
      owner: (_call, icon) => ({
        server: {
          server_id: "server-one",
          icon: { ...icon, preview_reference: { ...icon.preview_reference, url: icon.preview_reference.url + "&nonce=" + _call } },
        },
      }),
    },
    async (f) => {
      const result = await fetch(f.origin + path, { headers })
      assert.equal(result.status, 200)
      assert.deepEqual(Buffer.from(await result.arrayBuffer()), png)
    },
  ))

for (const status of [429, 500, 503])
  test(`Storage ${status} is a private media dependency outage, without upstream policy/body leakage`, () =>
    withFixture(
      {
        storage: (_req, res) => {
          res.writeHead(status, { "content-type": "application/json", "retry-after": "99999" })
          res.end(JSON.stringify({ error: "never-return-storage-details" }))
        },
      },
      async (f) => {
        const result = await fetch(f.origin + path, { headers })
        assert.equal(result.status, 503)
        assert.equal(result.headers.get("retry-after"), null)
        const body = await result.json()
        assert.equal(body.error.code, "mcp_personal_dependency_unavailable")
        assert.equal(body.error.retryable, true)
        assert.ok(!JSON.stringify(body).includes("never-return-storage-details"))
      },
    ))
for (const status of [403, 404])
  test(`Storage ${status} does not imply an absent owner binding`, () =>
    withFixture(
      {
        storage: (_req, res) => {
          res.writeHead(status)
          res.end("private storage failure")
        },
      },
      (f) => failure(f, 502, "mcp_personal_response_invalid"),
    ))
test("orderly short EOF is invalid image bytes rather than a dependency outage", () =>
  withFixture(
    {
      storage: (_req, res) => {
        res.writeHead(200, { "content-type": "image/png" })
        res.end(png.subarray(0, 2))
      },
    },
    (f) => failure(f, 502, "mcp_personal_response_invalid"),
  ))
