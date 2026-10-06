import assert from "node:assert/strict"
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises"
import { createServer, request as httpRequest } from "node:http"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { PlatformProjectionHttpClient } from "../dist/infrastructure/clients/platform/projection-http.js"
import { livePlatformProjectionRead } from "../dist/http/routes/platform-projection.js"
import { createBffServer } from "../dist/bootstrap/server.js"
import { DEFAULT_AGUI_CONFIG } from "../dist/config/runtime.js"

async function fixture(owner) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "bff-projection-route-"))
  const credentialFile = path.join(dir, "projection.json")
  await writeFile(
    credentialFile,
    JSON.stringify([
      {
        tenantId: "tenant",
        generation: 1,
        credentialRefVersion: "v1",
        clientId: "projection",
        clientSecret: "secret",
        resource: "https://kokoro.dev/resources/platform-internal",
        scope: "platform:projection.read",
      },
    ]),
  )
  await chmod(credentialFile, 0o600)
  const originalFetch = globalThis.fetch
  let ownerCalls = 0
  globalThis.fetch = async (input, init) => {
    const target = String(input)
    if (target.includes("/iam/oauth2/token"))
      return new Response(JSON.stringify({ access_token: "projection-token", token_type: "Bearer", scope: "platform:projection.read", expires_in: 60 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    ownerCalls += 1
    return owner(input, init)
  }
  const config = { platformProjection: { baseUrl: "http://platform.test", credentialFile, timeoutMs: 1000 }, iamBaseUrl: "http://iam.test" }
  const context = { requestId: "route-request", identity: { namespace: "tenant", userId: "person" } }
  const server = createServer((request, response) => {
    const segments = new URL(request.url, "http://bff.test").pathname.split("/").filter(Boolean).slice(1)
    void livePlatformProjectionRead(request, response, config, context, segments).then((handled) => {
      if (!handled) response.writeHead(404).end()
    })
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const port = server.address().port
  return {
    config,
    context,
    get ownerCalls() {
      return ownerCalls
    },
    async get(url, headers = {}, signal) {
      return new Promise((resolve, reject) => {
        const request = httpRequest({ hostname: "127.0.0.1", port, method: "GET", path: url, headers, ...(signal ? { signal } : {}) }, (response) => {
          const chunks = []
          response.on("data", (chunk) => chunks.push(chunk))
          response.on("end", () =>
            resolve({
              status: response.statusCode,
              headers: response.headers,
              body: chunks.length === 0 ? null : JSON.parse(Buffer.concat(chunks).toString("utf8")),
            }),
          )
        })
        request.on("error", reject)
        request.end()
      })
    },
    async close() {
      globalThis.fetch = originalFetch
      await new Promise((resolve) => server.close(resolve))
      await rm(dir, { recursive: true, force: true })
    },
  }
}

const ownerHeaders = { "content-type": "application/json", "x-kokoro-request-id": "route-request", "cache-control": "no-store" }

test("Product by-ID GET is strict data-only and current-person bound", async () => {
  const resource = { skill_id: "skill-one", source_ref: "skill:skill-one", revision: "2", status: "active", name: "Sandbox", summary: "summary", tags: ["one"] }
  const app = await fixture(async () => new Response(JSON.stringify({ data: resource }), { status: 200, headers: ownerHeaders }))
  try {
    const result = await app.get("/v1/skills/skill-one")
    assert.equal(result.status, 200)
    assert.deepEqual(result.body, { data: resource })
    assert.equal(result.headers["cache-control"], "no-store")
    assert.equal(result.headers["x-request-id"], "route-request")
    const before = app.ownerCalls
    const invalid = await app.get("/v1/skills/skill-one?cursor=unexpected")
    assert.equal(invalid.status, 400)
    assert.deepEqual(Object.keys(invalid.body), ["error"])
    assert.equal(app.ownerCalls, before)
  } finally {
    await app.close()
  }
})

test("Product list and MCP GET keep owner-native identity and stable cursor", async () => {
  const skill = {
    source_ref: "skill:skill-one",
    name: "Sandbox",
    description: "summary",
    content_hash: "hash",
    scope: "personal",
    revision: "2",
    enabled: true,
    categories: [],
  }
  const mcp = {
    server_id: "server",
    provider_key: "provider",
    server_identity: "example",
    transport: "streamable_http",
    declaration_digest: "a".repeat(64),
    status: "registered",
  }
  const app = await fixture(
    async (input) =>
      new Response(
        JSON.stringify(
          (input instanceof Request ? input.url : String(input)).includes("/mcp/servers")
            ? { data: { servers: [mcp], next_cursor: "next" } }
            : { data: { skills: [skill], next_cursor: "next" } },
        ),
        { status: 200, headers: ownerHeaders },
      ),
  )
  try {
    const skills = await app.get("/v1/skills?scope_kind=personal&limit=1&cursor=opaque")
    assert.equal(skills.status, 200, JSON.stringify(skills))
    assert.deepEqual(skills.body, { data: { skills: [skill], next_cursor: "next" } })
    const servers = await app.get("/v1/mcp/servers?limit=1")
    assert.equal(servers.status, 200)
    assert.deepEqual(servers.body, { data: { servers: [mcp], next_cursor: "next" } })
  } finally {
    await app.close()
  }
})

test("Product projection fails closed before owner socket without credential", async () => {
  const app = await fixture(async () => {
    throw new Error("owner should not be called")
  })
  app.config.platformProjection.credentialFile = null
  try {
    const result = await app.get("/v1/skills/skill-one")
    assert.equal(result.status, 503)
    assert.equal(result.body.error.code, "skill_dependency_unavailable")
    assert.equal(app.ownerCalls, 0)
  } finally {
    await app.close()
  }
})

test("bootstrap admission rejects Platform reads with strict error-only envelopes before the owner", async () => {
  const config = {
    host: "127.0.0.1",
    port: 4300,
    mode: "live",
    domain: "dev.kokoro.localhost",
    tenantId: "tenant",
    iamBaseUrl: null,
    sharedSecret: "test-secret",
    upstreamSecret: null,
    upstreamTimeoutMs: 1000,
    upstreamMaxResponseBytes: 1024 * 1024,
    schedulerServiceToken: null,
    schedulerTargetUrl: null,
    agentEnabled: false,
    postgresUrl: null,
    redisUrl: null,
    agUi: DEFAULT_AGUI_CONFIG,
    upstreams: { system: null, platform: null, scheduler: null, agents: null, billing: null, music: null },
    platformProjection: { baseUrl: null, credentialFile: null, timeoutMs: 1000 },
    skillDraft: { enabled: false, platformBaseUrl: null, credentialFile: null, timeoutMs: 1000 },
  }
  const server = createBffServer(config, {
    businessStore: null,
    readiness: async () => undefined,
    sessionAdmission: { verify: async () => ({ ok: false, status: 429, code: "session_rate_limited", retryAfter: "3" }) },
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  try {
    for (const resource of ["/v1/skills/skill-one", "/v1/skills", "/v1/skills/pool", "/v1/skills/catalog", "/v1/mcp/servers", "/v1/mcp/connections"]) {
      const missing = await fetch(`${origin}${resource}`, { headers: { "x-kokoro-service": "web-bff", "x-kokoro-internal-secret": "test-secret" } })
      assert.equal(missing.status, 401, resource)
      assert.deepEqual(Object.keys(await missing.json()), ["error"], resource)
      assert.equal(missing.headers.get("cache-control"), "no-store")
      assert.ok(missing.headers.get("x-request-id"))
      const limited = await fetch(`${origin}${resource}`, {
        headers: { "x-kokoro-service": "web-bff", "x-kokoro-internal-secret": "test-secret", authorization: "Bearer test-session" },
      })
      assert.equal(limited.status, 429, resource)
      assert.deepEqual(await limited.json(), { error: { code: "session_rate_limited", message: "BFF user admission failed", retryable: true } }, resource)
      assert.equal(limited.headers.get("retry-after"), "3")
    }
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

const selfConnection = {
  connection_id: "connection-one",
  connector_id: "connector-one",
  server_id: "server-one",
  provider_key: "provider-one",
  transport: "streamable_http",
  status: "active",
}

test("R257 Product self connections preserve trusted actor, six fields, distinct connections and opaque pagination", async () => {
  const requests = []
  const connections = [selfConnection, { ...selfConnection, connection_id: "connection-two", connector_id: "connector-two" }]
  const app = await fixture(async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init)
    requests.push(request)
    const first = request.headers.get("x-kokoro-subject") === "person"
    return new Response(JSON.stringify({ data: first ? { connections, next_cursor: "next-page" } : { connections: [] } }), {
      status: 200,
      headers: ownerHeaders,
    })
  })
  try {
    const first = await app.get("/v1/mcp/connections?provider_key=provider-one&limit=2&cursor=first-page", {
      "x-kokoro-subject": "attacker",
      "x-kokoro-tenant-id": "other",
    })
    assert.equal(first.status, 200)
    assert.deepEqual(first.body, { data: { connections, next_cursor: "next-page" } })
    assert.equal(first.headers["cache-control"], "no-store")
    assert.equal(first.headers["x-request-id"], "route-request")
    assert.equal(requests[0].headers.get("x-kokoro-subject"), "person")
    assert.equal(requests[0].headers.get("x-kokoro-tenant-id"), "tenant")
    assert.equal(requests[0].headers.get("authorization"), "Bearer projection-token")
    assert.equal(requests[0].headers.get("x-kokoro-request-id"), "route-request")
    assert.equal(new URL(requests[0].url).pathname, "/v1/mcp/connections")
    assert.equal(new URL(requests[0].url).searchParams.get("cursor"), "first-page")
    app.context.identity.userId = "second-person"
    const second = await app.get("/v1/mcp/connections?connection_id=connection-one")
    assert.equal(second.status, 200)
    assert.deepEqual(second.body, { data: { connections: [] } })
    assert.equal(requests[1].headers.get("x-kokoro-subject"), "second-person")
    assert.equal(new URL(requests[1].url).searchParams.get("connection_id"), "connection-one")
    assert.equal(requests.length, 2)
  } finally {
    await app.close()
  }
})

test("R257 Product self connections reject closed-query and body selectors before owner I/O", async () => {
  const app = await fixture(async () => {
    throw new Error("unexpected owner I/O")
  })
  try {
    for (const query of [
      "subject=other",
      "scope=personal",
      "connection_id=x&connection_id=y",
      "provider_key=x&provider_key=y",
      "limit=1&limit=2",
      "cursor=x&cursor=y",
      "connection_id=",
      "connection_id=%20",
      "connection_id=%2Fbad",
      "provider_key=",
      "provider_key=" + "x".repeat(192),
      "connection_id=" + "x".repeat(192),
      "cursor=",
      "cursor=" + "x".repeat(2049),
      "limit=0",
      "limit=101",
      "limit=1.5",
      "limit=1e1",
      "limit=01",
      "limit=%2B1",
    ]) {
      const result = await app.get("/v1/mcp/connections?" + query)
      assert.equal(result.status, 400, query)
      assert.equal(result.body.error.code, "invalid_query_parameter", query)
      assert.equal(result.body.error.retryable, false)
      assert.deepEqual(Object.keys(result.body), ["error"])
      assert.equal(result.headers["cache-control"], "no-store")
      assert.equal(result.headers["x-request-id"], "route-request")
    }
    const keyed = await app.get("/v1/mcp/connections", { "idempotency-key": "forbidden" })
    assert.equal(keyed.status, 400)
    assert.equal(keyed.body.error.code, "invalid_query_parameter")
    const body = await app.get("/v1/mcp/connections", { "content-length": "1" })
    assert.equal(body.status, 400)
    assert.equal(body.body.error.code, "invalid_query_parameter")
    assert.equal(app.ownerCalls, 0)
  } finally {
    await app.close()
  }
})

test("R257 Product self connections map only verified canonical owner cursor errors to 400", async () => {
  let body = { error: { code: "capability.invalid_request", message: "internal cursor detail", retryable: false } }
  let headers = ownerHeaders
  let status = 400
  const app = await fixture(async () => new Response(JSON.stringify(body), { status, headers }))
  try {
    const canonical = await app.get("/v1/mcp/connections?cursor=opaque-invalid")
    assert.equal(canonical.status, 400)
    assert.deepEqual(canonical.body, { error: { code: "invalid_query_parameter", message: "Read query is invalid", retryable: false } })
    for (const variant of [
      { body: { ...body, private: "internal" }, headers: ownerHeaders, status: 400 },
      { body: { error: { ...body.error, private: "internal" } }, headers: ownerHeaders, status: 400 },
      { body, headers: { ...ownerHeaders, "x-kokoro-request-id": "wrong" }, status: 400 },
      { body, headers: { ...ownerHeaders, "cache-control": "public" }, status: 400 },
      { body, headers: ownerHeaders, status: 403 },
    ]) {
      body = variant.body
      headers = variant.headers
      status = variant.status
      const invalid = await app.get("/v1/mcp/connections?cursor=opaque-invalid")
      assert.equal(invalid.status, 502)
      assert.equal(invalid.body.error.code, "mcp_connection_response_invalid")
      assert.equal(JSON.stringify(invalid.body).includes("internal"), false)
      assert.equal(invalid.headers["cache-control"], "no-store")
    }
  } finally {
    await app.close()
  }
})

test("R257 Product self connections caller cancellation retires the owner response", async () => {
  let entered
  const started = new Promise((resolve) => {
    entered = resolve
  })
  let ownerSignal
  let cancelled = false
  let observeCancellation
  const ownerCancelled = new Promise((resolve) => {
    observeCancellation = resolve
  })
  const app = await fixture(async (input) => {
    ownerSignal = input.signal
    entered()
    return new Response(
      new ReadableStream({
        cancel() {
          cancelled = true
          observeCancellation()
        },
      }),
      { status: 200, headers: ownerHeaders },
    )
  })
  const controller = new AbortController()
  try {
    const pending = app.get("/v1/mcp/connections", {}, controller.signal)
    const rejected = assert.rejects(pending, { name: "AbortError" })
    await started
    controller.abort()
    await rejected
    let deadline
    try {
      await Promise.race([
        ownerCancelled,
        new Promise((_resolve, reject) => {
          deadline = setTimeout(() => reject(new Error("owner cancellation did not settle")), 1000)
        }),
      ])
    } finally {
      clearTimeout(deadline)
    }
    assert.equal(ownerSignal.aborted, true)
    assert.equal(cancelled, true)
    assert.equal(app.ownerCalls, 1)
  } finally {
    controller.abort()
    await app.close()
  }
})

test("R257 Product route catch keeps MCP dependency errors separate from legacy Skill errors", async (t) => {
  const app = await fixture(async () => {
    throw new Error("unexpected owner I/O")
  })
  t.mock.method(PlatformProjectionHttpClient.prototype, "read", async () => {
    throw new Error("private unexpected dependency failure")
  })
  try {
    for (const [path, code, message] of [
      ["/v1/mcp/connections", "mcp_connection_dependency_unavailable", "MCP connection projection is unavailable"],
      ["/v1/mcp/servers", "skill_dependency_unavailable", "Skill projection is unavailable"],
    ]) {
      const result = await app.get(path)
      assert.equal(result.status, 503)
      assert.deepEqual(result.body, { error: { code, message, retryable: true } })
      assert.equal(result.headers["cache-control"], "no-store")
      assert.equal(result.headers["x-request-id"], "route-request")
    }
    assert.equal(app.ownerCalls, 0)
  } finally {
    t.mock.restoreAll()
    await app.close()
  }
})

test("R257 self connections honor Unicode code-point query bounds without changing legacy MCP Server validation", async () => {
  const requests = []
  const app = await fixture(async (input) => {
    requests.push(input)
    return new Response(JSON.stringify({ data: { connections: [] } }), { status: 200, headers: ownerHeaders })
  })
  try {
    for (const [key, count] of [
      ["provider_key", 191],
      ["cursor", 2048],
    ]) {
      const exact = key === "cursor" ? "😀".repeat(count / 2) + "x".repeat(count / 2) : "😀".repeat(count)
      const result = await app.get("/v1/mcp/connections?" + new URLSearchParams({ [key]: exact }))
      assert.equal(result.status, 200, key + " exact code-point bound")
      assert.equal(new URL(requests.at(-1).url).searchParams.get(key), exact)
      const before = app.ownerCalls
      const invalid = await app.get("/v1/mcp/connections?" + new URLSearchParams({ [key]: exact + "😀" }))
      assert.equal(invalid.status, 400, key + " code-point overflow")
      assert.equal(app.ownerCalls, before)
    }
  } finally {
    await app.close()
  }
})
