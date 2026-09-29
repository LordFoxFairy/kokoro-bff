import assert from "node:assert/strict"
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises"
import { createServer, request as httpRequest } from "node:http"
import os from "node:os"
import path from "node:path"
import test from "node:test"

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
    get ownerCalls() {
      return ownerCalls
    },
    async get(url, headers = {}) {
      return new Promise((resolve, reject) => {
        const request = httpRequest({ hostname: "127.0.0.1", port, method: "GET", path: url, headers }, (response) => {
          const chunks = []
          response.on("data", (chunk) => chunks.push(chunk))
          response.on("end", () =>
            resolve({ status: response.statusCode, headers: response.headers, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) }),
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
    for (const resource of ["/v1/skills/skill-one", "/v1/skills", "/v1/skills/pool", "/v1/skills/catalog", "/v1/mcp/servers"]) {
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
