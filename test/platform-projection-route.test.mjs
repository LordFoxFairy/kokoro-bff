import { startMcpRequestBudget } from "../dist/http/mcp-request-budget.js"
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

async function fixture(owner, { deadlineMs, entryDelayMs = 0 } = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "bff-projection-route-"))
  const credentialFile = path.join(dir, "projection.json")
  await writeFile(
    credentialFile,
    JSON.stringify({
      version: 1,
      entries: [
        {
          credential_id: "bff-projection",
          secret: "bff-projection-secret-000000000000",
          caller: "kokoro-bff",
          surfaces: ["projection"],
          tenant_id: "123e4567-e89b-42d3-a456-426614174000",
        },
      ],
    }),
  )
  await chmod(credentialFile, 0o600)
  const originalFetch = globalThis.fetch
  let ownerCalls = 0
  globalThis.fetch = async (input, init) => {
    const target = String(input)
    ownerCalls += 1
    return owner(input, init)
  }
  const config = { platformProjection: { baseUrl: "http://platform.test", credentialFile, timeoutMs: 1000 }, iamBaseUrl: "http://iam.test" }
  const context = { requestId: "route-request", identity: { namespace: "123e4567-e89b-42d3-a456-426614174000", userId: "person" } }
  const server = createServer(async (request, response) => {
    if (deadlineMs !== undefined) startMcpRequestBudget(request, deadlineMs)
    if (entryDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, entryDelayMs))
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

const skillUpdatedAt = "2026-10-08T12:34:56.123456789Z"

const ownerHeaders = { "content-type": "application/json", "x-kokoro-request-id": "route-request", "cache-control": "no-store" }

test("retired Product by-ID read is absent without owner I/O", async () => {
  const app = await fixture(async () => {
    throw new Error("retired alias reached owner")
  })
  try {
    for (const url of ["/v1/skills/skill-one", "/v1/skills/skill-one?cursor=unexpected"]) {
      const result = await app.get(url)
      assert.equal(result.status, 404)
      assert.equal(result.body, null)
    }
    assert.equal(app.ownerCalls, 0)
  } finally {
    await app.close()
  }
})

test("retired Product list is absent while MCP GET keeps owner-native identity and stable cursor", async () => {
  const mcp = {
    server_id: "server",
    provider_key: "provider",
    server_identity: "example",
    transport: "streamable_http",
    declaration_digest: "a".repeat(64),
    status: "registered",
  }
  const app = await fixture(async () => new Response(JSON.stringify({ data: { servers: [mcp], next_cursor: "next" } }), { status: 200, headers: ownerHeaders }))
  try {
    const skills = await app.get("/v1/skills?scope_kind=personal&limit=1&cursor=opaque")
    assert.equal(skills.status, 404)
    assert.equal(skills.body, null)
    assert.equal(app.ownerCalls, 0)
    const servers = await app.get("/v1/mcp/servers?limit=1")
    assert.equal(servers.status, 200)
    assert.deepEqual(servers.body, { data: { servers: [mcp], next_cursor: "next" } })
  } finally {
    await app.close()
  }
})

test("MCP projection fails closed before owner socket without credential", async () => {
  const app = await fixture(async () => {
    throw new Error("owner should not be called")
  })
  app.config.platformProjection.credentialFile = null
  try {
    const result = await app.get("/v1/mcp/servers")
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
    tenantId: "123e4567-e89b-42d3-a456-426614174000",
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
    for (const resource of ["/v1/mcp/servers", "/v1/mcp/connections"]) {
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
    assert.equal(requests[0].headers.get("x-kokoro-tenant-id"), "123e4567-e89b-42d3-a456-426614174000")
    assert.equal(requests[0].headers.get("authorization"), "Bearer bff-projection-secret-000000000000")
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

const managedSkills = ["draft", "active", "disabled", "withdrawn", "quarantined"].map((status, index) => ({
  skill_id: `skill-${status}`,
  source_ref: `skill:skill-${status}`,
  series_id: `series-${index + 1}`,
  revision: String(index + 1),
  name: `Skill ${status}`,
  summary: status === "draft" ? "" : `${status} summary`,
  tags: status === "active" ? ["featured"] : [],
  status,
  example_prompts: [],
  skill_updated_at: skillUpdatedAt,
  category_keys: [],
  product: { publication_audience: "owner", state_version: "1" },
}))

function managedConfig(credentialFile) {
  return {
    host: "127.0.0.1",
    port: 0,
    mode: "live",
    domain: "dev.kokoro.localhost",
    tenantId: "123e4567-e89b-42d3-a456-426614174000",
    iamBaseUrl: "http://iam.test",
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
    platformProjection: { baseUrl: "http://platform.test", credentialFile, timeoutMs: 1000 },
    skillDraft: { enabled: false, platformBaseUrl: null, credentialFile: null, timeoutMs: 1000 },
  }
}

function managedBrowserHeaders(extra = {}) {
  return {
    "x-kokoro-service": "web-bff",
    "x-kokoro-internal-secret": "test-secret",
    authorization: "Bearer current-session",
    ...extra,
  }
}

async function managedFixture({ owner, admission } = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "bff-managed-skills-"))
  const credentialFile = path.join(dir, "projection.json")
  await writeFile(
    credentialFile,
    JSON.stringify({
      version: 1,
      entries: [
        {
          credential_id: "bff-projection",
          secret: "bff-projection-secret-000000000000",
          caller: "kokoro-bff",
          surfaces: ["projection"],
          tenant_id: "123e4567-e89b-42d3-a456-426614174000",
        },
      ],
    }),
  )
  await chmod(credentialFile, 0o600)
  const calls = []
  const originalFetch = globalThis.fetch
  let origin
  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init)
    const target = new URL(request.url)
    if (origin !== undefined && target.origin === origin) return originalFetch(input, init)
    if (target.origin !== "http://platform.test") throw new Error(`unexpected fetch target ${request.url}`)
    calls.push(request)
    if (owner) return owner(request)
    const data = request.url.includes("/v1/self/skills/") ? managedSkills[0] : { skills: managedSkills }
    return new Response(JSON.stringify({ data }), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
        "x-kokoro-request-id": request.headers.get("x-kokoro-request-id") ?? "missing",
      },
    })
  }
  const admissionCalls = []
  const sessionAdmission = {
    verify: async (input) => {
      admissionCalls.push(input)
      if (admission) return admission(input)
      return { ok: true, identity: { namespace: "123e4567-e89b-42d3-a456-426614174000", userId: "person" }, platformAdmin: false }
    },
  }
  const server = createBffServer(managedConfig(credentialFile), { businessStore: null, readiness: async () => undefined, sessionAdmission })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  origin = `http://127.0.0.1:${server.address().port}`
  return {
    origin,
    calls,
    admissionCalls,
    async close() {
      globalThis.fetch = originalFetch
      server.closeAllConnections()
      await new Promise((resolve) => server.close(resolve))
      await rm(dir, { recursive: true, force: true })
    },
  }
}

function assertManagedEnvelope(response, body) {
  assert.equal(response.status, 200)
  assert.equal(response.headers.get("cache-control"), "no-store")
  const requestId = response.headers.get("x-request-id")
  assert.match(requestId ?? "", /^[A-Za-z0-9._:-]{1,128}$/u)
  assert.deepEqual(body.meta, { request_id: requestId })
}

test("R345 managed personal list projects all five statuses, safe nine fields, exact Skill instant and omitted cursor", async () => {
  const app = await managedFixture()
  try {
    const response = await fetch(`${app.origin}/v1/self/skills?limit=5`, {
      headers: managedBrowserHeaders({ "content-type": "application/json", "if-match": '"stale"' }),
    })
    const body = await response.json()
    assertManagedEnvelope(response, body)
    assert.deepEqual(body.data, { skills: managedSkills, next_cursor: null })
    assert.deepEqual(Object.keys(body.data.skills[0]), [
      "skill_id",
      "source_ref",
      "series_id",
      "revision",
      "name",
      "summary",
      "tags",
      "status",
      "skill_updated_at",
      "example_prompts",
      "category_keys",
      "product",
    ])
    assert.equal(body.data.skills[0].summary, "")
    assert.equal(body.data.skills[0].skill_updated_at, skillUpdatedAt)
    assert.equal(app.admissionCalls.length, 1)
    assert.equal(app.calls.length, 1)
    assert.equal(app.calls[0].headers.get("x-kokoro-tenant-id"), "123e4567-e89b-42d3-a456-426614174000")
    assert.equal(app.calls[0].headers.get("x-kokoro-subject"), "person")
    assert.equal(new URL(app.calls[0].url).pathname, "/v1/self/skills")
  } finally {
    await app.close()
  }
})

test("R266 managed personal detail is current-subject bound and preserves the exact safe item", async () => {
  const item = managedSkills[3]
  const app = await managedFixture({
    owner: async (request) =>
      new Response(JSON.stringify({ data: item }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "cache-control": "no-store",
          "x-kokoro-request-id": request.headers.get("x-kokoro-request-id"),
        },
      }),
  })
  try {
    const response = await fetch(`${app.origin}/v1/self/skills/${item.skill_id}`, {
      headers: managedBrowserHeaders({ "x-kokoro-subject": "attacker", "x-kokoro-tenant-id": "other" }),
    })
    const body = await response.json()
    assertManagedEnvelope(response, body)
    assert.deepEqual(body.data, item)
    assert.equal(app.calls.length, 1)
    assert.equal(app.calls[0].headers.get("x-kokoro-tenant-id"), "123e4567-e89b-42d3-a456-426614174000")
    assert.equal(app.calls[0].headers.get("x-kokoro-subject"), "person")
  } finally {
    await app.close()
  }
})

test("R266 managed reads reject closed query, mutation key and framing before owner I/O", async () => {
  const app = await managedFixture()
  try {
    for (const target of [
      "/v1/self/skills?unknown=x",
      "/v1/self/skills?limit=1&limit=2",
      "/v1/self/skills?limit=0",
      "/v1/self/skills?cursor=",
      "/v1/self/skills?status=removed",
      "/v1/self/skills/skill-active?status=active",
    ]) {
      const response = await fetch(`${app.origin}${target}`, { headers: managedBrowserHeaders() })
      const body = await response.json()
      assert.equal(response.status, 400, target)
      assert.equal(body.error.code, "invalid_skill_request", target)
      assert.equal(body.meta.request_id, response.headers.get("x-request-id"), target)
    }
    for (const headers of [{ "idempotency-key": "forbidden" }]) {
      const response = await fetch(`${app.origin}/v1/self/skills`, { headers: managedBrowserHeaders(headers) })
      assert.equal(response.status, 400)
      assert.equal((await response.json()).error.code, "invalid_skill_request")
    }
    assert.equal(app.calls.length, 0)
  } finally {
    await app.close()
  }
})

test("R266 managed reads preserve current admission denial and do not reach Platform", async () => {
  const app = await managedFixture({ admission: async () => ({ ok: false, status: 403, code: "session_forbidden" }) })
  try {
    const response = await fetch(`${app.origin}/v1/self/skills`, { headers: managedBrowserHeaders() })
    const body = await response.json()
    assert.equal(response.status, 403)
    assert.deepEqual(body, {
      error: { code: "session_forbidden", message: "BFF user admission failed" },
      meta: { request_id: response.headers.get("x-request-id") },
    })
    assert.equal(response.headers.get("cache-control"), "no-store")
    assert.equal(app.admissionCalls.length, 1)
    assert.equal(app.calls.length, 0)
  } finally {
    await app.close()
  }
})

test("R266 managed owner tuples are closed and subject mismatch is a dependency failure", async () => {
  let responseSpec = { status: 400, error: { code: "capability.subject_invalid", message: "private", retryable: false } }
  const app = await managedFixture({
    owner: async (request) =>
      new Response(JSON.stringify({ error: responseSpec.error }), {
        status: responseSpec.status,
        headers: {
          "content-type": "application/json",
          "cache-control": "no-store",
          "x-kokoro-request-id": request.headers.get("x-kokoro-request-id"),
        },
      }),
  })
  try {
    const mismatch = await fetch(`${app.origin}/v1/self/skills`, { headers: managedBrowserHeaders() })
    assert.equal(mismatch.status, 503)
    assert.equal((await mismatch.json()).error.code, "skill_dependency_unavailable")
    responseSpec = { status: 401, error: { code: "UNAUTHENTICATED", message: "private", retryable: false } }
    const unknown = await fetch(`${app.origin}/v1/self/skills`, { headers: managedBrowserHeaders() })
    assert.equal(unknown.status, 502)
    const body = await unknown.json()
    assert.equal(body.error.code, "skill_response_invalid")
    assert.equal(JSON.stringify(body).includes("private"), false)
  } finally {
    await app.close()
  }
})

test("R266 managed admission shares the absolute ten second deadline and late completion cannot reach owner", { timeout: 13_000 }, async () => {
  let releaseAdmission
  const held = new Promise((resolve) => {
    releaseAdmission = resolve
  })
  const app = await managedFixture({ admission: async () => held })
  const startedAt = performance.now()
  try {
    const response = await fetch(`${app.origin}/v1/self/skills`, {
      headers: managedBrowserHeaders(),
      signal: AbortSignal.timeout(12_000),
    })
    const elapsed = performance.now() - startedAt
    assert.equal(response.status, 503)
    assert.equal((await response.json()).error.code, "iam_admission_unavailable")
    assert.ok(elapsed >= 9_000 && elapsed <= 10_750, `deadline elapsed ${elapsed}ms`)
    releaseAdmission({ ok: true, identity: { namespace: "123e4567-e89b-42d3-a456-426614174000", userId: "person" }, platformAdmin: false })
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(app.calls.length, 0)
  } finally {
    releaseAdmission?.({ ok: false, status: 503, code: "iam_admission_unavailable" })
    await app.close()
  }
})

test("R266 managed reads reject raw GET body and transfer framing before owner I/O", async () => {
  const app = await managedFixture()
  const sendRaw = (headers, body) => {
    const target = new URL("/v1/self/skills", app.origin)
    return new Promise((resolve, reject) => {
      const request = httpRequest(
        {
          hostname: target.hostname,
          port: target.port,
          method: "GET",
          path: target.pathname,
          headers: { host: target.host, ...managedBrowserHeaders(), ...headers },
        },
        (response) => {
          const chunks = []
          response.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
          response.on("end", () => resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) }))
        },
      )
      request.on("error", reject)
      request.end(body)
    })
  }
  try {
    for (const result of [
      await sendRaw({ "content-length": "0" }),
      await sendRaw({ "content-length": "1" }, "x"),
      await sendRaw({ "transfer-encoding": "chunked" }, "x"),
    ]) {
      assert.equal(result.status, 400)
      assert.equal(result.body.error.code, "invalid_skill_request")
    }
    assert.equal(app.calls.length, 0)
  } finally {
    await app.close()
  }
})

test("R266 managed reads reject a current session admitted for another tenant before owner I/O", async () => {
  const app = await managedFixture({
    admission: async () => ({ ok: true, identity: { namespace: "other-tenant", userId: "person" }, platformAdmin: false }),
  })
  try {
    const response = await fetch(`${app.origin}/v1/self/skills`, { headers: managedBrowserHeaders() })
    const body = await response.json()
    assert.equal(response.status, 403)
    assert.equal(body.error.code, "product_tenant_forbidden")
    assert.equal(body.meta.request_id, response.headers.get("x-request-id"))
    assert.equal(app.calls.length, 0)
  } finally {
    await app.close()
  }
})

test(
  "R266 managed reply rejects a legal owner result produced after the absolute deadline even when the event loop was blocked",
  { timeout: 14_000 },
  async () => {
    const app = await managedFixture({
      owner: (request) => {
        const blockedUntil = performance.now() + 11_000
        while (performance.now() < blockedUntil) {
          // Deliberately prevent the deadline timer from dispatching; the monotonic fence must still reject this late result.
        }
        return new Response(JSON.stringify({ data: { skills: managedSkills } }), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "cache-control": "no-store",
            "x-kokoro-request-id": request.headers.get("x-kokoro-request-id"),
          },
        })
      },
    })
    const startedAt = performance.now()
    try {
      const response = await fetch(`${app.origin}/v1/self/skills`, {
        headers: managedBrowserHeaders(),
        signal: AbortSignal.timeout(12_000),
      })
      assert.ok(performance.now() - startedAt >= 11_000)
      assert.equal(response.status, 503)
      assert.equal((await response.json()).error.code, "skill_dependency_unavailable")
      assert.equal(app.calls.length, 1)
    } finally {
      await app.close()
    }
  },
)

test("R266 managed caller abort reaches held admission and a late legal admission cannot start owner I/O", async () => {
  let releaseAdmission
  let entered
  let admissionSignal
  const held = new Promise((resolve) => {
    releaseAdmission = resolve
  })
  const started = new Promise((resolve) => {
    entered = resolve
  })
  const app = await managedFixture({
    admission: async ({ signal }) => {
      admissionSignal = signal
      entered()
      return held
    },
  })
  const controller = new AbortController()
  let removeAbortListener = () => undefined
  try {
    const pending = fetch(`${app.origin}/v1/self/skills`, { headers: managedBrowserHeaders(), signal: controller.signal })
    const rejected = assert.rejects(pending, { name: "AbortError" })
    await started
    const abortObserved = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("admission abort was not observed")), 1000)
      const observed = () => {
        clearTimeout(timeout)
        resolve()
      }
      admissionSignal.addEventListener("abort", observed, { once: true })
      removeAbortListener = () => {
        clearTimeout(timeout)
        admissionSignal.removeEventListener("abort", observed)
      }
      if (admissionSignal.aborted) observed()
    })
    controller.abort()
    await rejected
    await abortObserved
    assert.equal(admissionSignal.aborted, true)
    releaseAdmission({ ok: true, identity: { namespace: "123e4567-e89b-42d3-a456-426614174000", userId: "person" }, platformAdmin: false })
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(app.calls.length, 0)
  } finally {
    removeAbortListener()
    controller.abort()
    releaseAdmission?.({ ok: false, status: 503, code: "iam_admission_unavailable" })
    await app.close()
  }
})

test("R357 MCP owner projection uses only entrance remaining budget and never commits a late success", async () => {
  const app = await fixture(
    async () => {
      await new Promise((resolve) => setTimeout(resolve, 60))
      return new Response(JSON.stringify({ data: { connections: [] } }), {
        headers: ownerHeaders,
      })
    },
    { deadlineMs: 40, entryDelayMs: 20 },
  )
  try {
    const response = await app.get("/v1/mcp/connections", {}, AbortSignal.timeout(500))
    assert.equal(response.status, 503)
    assert.equal(response.body.error.code, "mcp_connection_dependency_unavailable")
    assert.ok(app.ownerCalls <= 1)
  } finally {
    await app.close()
  }
})
