import assert from "node:assert/strict"
import { createServer, type IncomingMessage, type Server } from "node:http"
import { afterEach, test } from "node:test"

import { DEFAULT_AGUI_CONFIG } from "../dist/config/runtime.js"
import type { BffConfig } from "../src/config/runtime.ts"
import type { RequestContext } from "../src/domain/request-context.ts"

const servers: Server[] = []

async function listen(server: Server): Promise<string> {
  servers.push(server)
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  if (address === null || typeof address === "string") throw new Error("server did not bind")
  return `http://127.0.0.1:${address.port}`
}

function config(capability: string | null, overrides: Partial<BffConfig> = {}): BffConfig {
  return {
    host: "127.0.0.1",
    port: 4300,
    mode: "live",
    domain: "dev.kokoro.localhost",
    tenantId: "tenant_test",
    sharedSecret: "test-secret",
    upstreamSecret: "bff-upstream-secret",
    upstreamTimeoutMs: 1,
    upstreamMaxResponseBytes: 16 * 1024 * 1024,
    schedulerServiceToken: null,
    schedulerTargetUrl: null,
    agentEnabled: false,
    postgresUrl: null,
    redisUrl: null,
    agUi: DEFAULT_AGUI_CONFIG,
    upstreams: { system: null, capability, storage: null, scheduler: null, agents: null, billing: null, music: null },
    ...overrides,
  }
}

const context: RequestContext = {
  requestId: "request-capability",
  identity: { namespace: "tenant_test", userId: "subject_test" },
}

async function capabilityClient(): Promise<typeof import("../dist/infrastructure/clients/capability/client.js")> {
  const loaded = await import("../dist/infrastructure/clients/capability/client.js").catch(() => null)
  assert.notEqual(loaded, null, "the generated Capability facade must exist")
  return loaded as typeof import("../dist/infrastructure/clients/capability/client.js")
}

function skillBody(nextCursor: string | null = null): string {
  return JSON.stringify({
    data: {
      skills: [
        {
          source_selector: "skill:contract-review",
          name: "contract-review",
          description: "Review contracts",
          content_hash: "sha256:abc",
          scope: "personal",
          revision: "1",
          enabled: true,
          installed: true,
          categories: ["review"],
        },
      ],
      next_cursor: nextCursor,
    },
  })
}

function replyJson(response: import("node:http").ServerResponse, status: number, body: string): void {
  response.statusCode = status
  response.setHeader("content-type", "application/json")
  response.setHeader("x-kokoro-request-id", "owner-request")
  response.end(body)
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
})

test("Capability facade sends only the four canonical owner paths and allowlisted trusted context", async () => {
  const received: Array<{ url: string; headers: IncomingMessage["headers"] }> = []
  const upstream = createServer((request, response) => {
    received.push({ url: request.url ?? "", headers: request.headers })
    setTimeout(() => {
      if (request.url?.startsWith("/v1/mcp/servers")) {
        replyJson(
          response,
          200,
          JSON.stringify({
            data: {
              servers: [
                {
                  server_id: "server-1",
                  provider_key: "github",
                  server_identity: "https://mcp.example",
                  transport: "streamable_http",
                  declaration_digest: "a".repeat(64),
                  status: "registered",
                },
              ],
              next_cursor: "mcp-next",
            },
          }),
        )
      } else replyJson(response, 200, skillBody("skills-next"))
    }, 20)
  })
  const base = await listen(upstream)
  const { requestCapability } = await capabilityClient()
  const calls = [
    ["skills", new URLSearchParams("query=contract+review&tags=review&tags=security&scope_kind=personal&limit=10&cursor=skills-1")],
    ["skillPool", new URLSearchParams()],
    ["skillCatalog", new URLSearchParams()],
    ["mcpServers", new URLSearchParams("provider_key=github&limit=5&cursor=mcp-1")],
  ] as const
  for (const [operation, query] of calls) {
    const result = await requestCapability(config(base), context, operation, query)
    assert.equal(result.ok, true)
  }

  assert.deepEqual(
    received.map(({ url }) => url),
    [
      "/v1/skills?query=contract%20review&tags=review&tags=security&scope_kind=personal&limit=10&cursor=skills-1",
      "/v1/skills/pool",
      "/v1/skills/catalog",
      "/v1/mcp/servers?provider_key=github&limit=5&cursor=mcp-1",
    ],
  )
  for (const { headers } of received) {
    assert.equal(headers["x-kokoro-service"], "web-bff")
    assert.equal(headers["x-kokoro-internal-secret"], "bff-upstream-secret")
    assert.equal(headers["x-kokoro-tenant-id"], "tenant_test")
    assert.equal(headers["x-kokoro-subject"], "subject_test")
    assert.equal(headers["x-kokoro-request-id"], "request-capability")
    assert.equal(headers.host, `127.0.0.1:${new URL(base).port}`)
    assert.equal(headers["x-forwarded-for"], undefined)
  }
})

test("Capability facade rejects aliases, unknowns, empty values, combined tags, and owner bounds before I/O", async () => {
  let calls = 0
  const base = await listen(
    createServer((_request, response) => {
      calls += 1
      replyJson(response, 200, skillBody())
    }),
  )
  const { requestCapability } = await capabilityClient()
  const rejectedQueries = [
    new URLSearchParams([["q", "legacy"]]),
    ...[
      "unknown=value",
      "query=",
      "tags=review,security",
      "tags=",
      "scope_kind=invalid",
      "limit=0",
      "limit=101",
      "limit=1.5",
      `query=${"x".repeat(1025)}`,
      `cursor=${"x".repeat(2049)}`,
    ].map((query) => new URLSearchParams(query)),
  ]
  for (const query of rejectedQueries) {
    const result = await requestCapability(config(base), context, "skills", query)
    assert.deepEqual(
      result,
      {
        ok: false,
        status: 400,
        code: "invalid_query_parameter",
        message: "Capability query parameters are invalid",
      },
      query.toString(),
    )
  }
  const badMcp = await requestCapability(config(base), context, "mcpServers", new URLSearchParams("query=skill"))
  assert.equal(badMcp.ok, false)
  assert.equal(calls, 0)
})

test("Capability query bounds count Unicode code points instead of UTF-16 code units", async () => {
  let calls = 0
  const base = await listen(
    createServer((request, response) => {
      calls += 1
      replyJson(response, 200, request.url?.startsWith("/v1/mcp/servers") ? JSON.stringify({ data: { servers: [] } }) : skillBody())
    }),
  )
  const { requestCapability } = await capabilityClient()
  for (const query of [new URLSearchParams({ query: "😀".repeat(1024) }), new URLSearchParams({ tags: "😀".repeat(128) })]) {
    assert.equal((await requestCapability(config(base), context, "skills", query)).ok, true)
  }
  assert.equal((await requestCapability(config(base), context, "mcpServers", new URLSearchParams({ provider_key: "😀".repeat(191) }))).ok, true)
  assert.equal(calls, 3)
  for (const [operation, query] of [
    ["skills", new URLSearchParams({ query: "😀".repeat(1025) })],
    ["skills", new URLSearchParams({ tags: "😀".repeat(129) })],
    ["mcpServers", new URLSearchParams({ provider_key: "😀".repeat(192) })],
  ] as const) {
    const result = await requestCapability(config(base), context, operation, query)
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.code, "invalid_query_parameter")
  }
  assert.equal(calls, 3)
})

test("Capability facade validates owner envelopes and keeps failure mapping stable", async () => {
  const scenarios = [
    { status: 400, body: JSON.stringify({ error: { code: "bad_cursor", message: "cursor secret", retryable: false } }), expected: 400 },
    { status: 401, body: JSON.stringify({ error: { code: "bad_auth", message: "token secret", retryable: false } }), expected: 503 },
    { status: 503, body: JSON.stringify({ error: { code: "down", message: "provider secret", retryable: true } }), expected: 503 },
    { status: 500, body: JSON.stringify({ error: { code: "crash", message: "stack secret", retryable: true } }), expected: 502 },
    { status: 200, body: "not-json", expected: 502 },
    { status: 200, body: JSON.stringify({ data: { skills: [{ name: "legacy" }] } }), expected: 502 },
  ]
  for (const scenario of scenarios) {
    const base = await listen(createServer((_request, response) => replyJson(response, scenario.status, scenario.body)))
    const { requestCapability } = await capabilityClient()
    const result = await requestCapability(config(base), context, "skills", new URLSearchParams())
    assert.equal(result.ok, false)
    if (result.ok) continue
    assert.equal(result.status, scenario.expected)
    assert.equal(
      result.code,
      scenario.expected === 400 ? "invalid_query_parameter" : scenario.expected === 503 ? "capability_unavailable" : "capability_response_invalid",
    )
    assert.doesNotMatch(`${result.code} ${result.message}`, /cursor secret|token secret|provider secret|stack secret/u)
  }
})

test("Capability facade rejects owner response extensions and selects projection by the requested operation", async () => {
  const strictBodies = [
    { data: { skills: [] }, meta: { request_id: "legacy" } },
    { data: { skills: [{ ...JSON.parse(skillBody()).data.skills[0], legacy_name: "extra" }] } },
    { data: { skills: [], servers: [] } },
  ]
  for (const body of strictBodies) {
    const base = await listen(createServer((_request, response) => replyJson(response, 200, JSON.stringify(body))))
    const { requestCapability } = await capabilityClient()
    const result = await requestCapability(config(base), context, "skills", new URLSearchParams())
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.code, "capability_response_invalid")
  }
  const mcpBase = await listen(
    createServer((_request, response) =>
      replyJson(
        response,
        200,
        JSON.stringify({
          data: {
            servers: [
              {
                server_id: "server-1",
                provider_key: "github",
                server_identity: "github",
                transport: "streamable_http",
                declaration_digest: "a".repeat(64),
                status: "registered",
                legacy_url: "https://legacy.invalid",
              },
            ],
          },
        }),
      ),
    ),
  )
  const mcpResult = await (await capabilityClient()).requestCapability(config(mcpBase), context, "mcpServers", new URLSearchParams())
  assert.equal(mcpResult.ok, false)
  if (!mcpResult.ok) assert.equal(mcpResult.code, "capability_response_invalid")
  for (const body of [
    { error: { code: "bad", message: "bad", retryable: false }, legacy: true },
    { error: { code: "bad", message: "bad", retryable: false, details: "extra" } },
  ]) {
    const base = await listen(createServer((_request, response) => replyJson(response, 400, JSON.stringify(body))))
    const { requestCapability } = await capabilityClient()
    const result = await requestCapability(config(base), context, "skills", new URLSearchParams())
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.code, "capability_response_invalid")
  }
})

test("Capability facade validates owner request IDs by Unicode code-point length", async () => {
  const capability = await capabilityClient()
  const isValidOwnerRequestId = (capability as unknown as { isValidOwnerRequestId(value: string): boolean }).isValidOwnerRequestId
  const { requestCapability } = capability
  assert.equal(isValidOwnerRequestId("😀".repeat(255)), true)
  assert.equal(isValidOwnerRequestId("😀".repeat(256)), false)

  for (const ownerRequestId of [null, "x".repeat(256)]) {
    const base = await listen(
      createServer((_request, response) => {
        response.statusCode = 200
        response.setHeader("content-type", "application/json")
        if (ownerRequestId !== null) response.setHeader("x-kokoro-request-id", ownerRequestId)
        response.end(skillBody())
      }),
    )
    const result = await requestCapability(config(base), context, "skills", new URLSearchParams())
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.code, "capability_response_invalid")
  }
})

test("Capability facade preserves exact list shapes and maps every supported MCP transport explicitly", async () => {
  const upstream = createServer((request, response) => {
    if (request.url?.startsWith("/v1/mcp/servers")) {
      const provider = new URL(request.url, "http://owner.invalid").searchParams.get("provider_key")
      replyJson(
        response,
        200,
        JSON.stringify({
          data: {
            servers: [
              {
                server_id: "server-1",
                provider_key: provider ?? "streamable",
                server_identity: `server-${provider}`,
                transport: provider ?? "streamable_http",
                declaration_digest: "a".repeat(64),
                status: "registered",
              },
            ],
          },
        }),
      )
      return
    }
    replyJson(response, 200, JSON.stringify({ data: { skills: [] } }))
  })
  const base = await listen(upstream)
  const { requestCapability } = await capabilityClient()
  const skills = await requestCapability(config(base), context, "skills", new URLSearchParams())
  const pool = await requestCapability(config(base), context, "skillPool", new URLSearchParams())
  const catalog = await requestCapability(config(base), context, "skillCatalog", new URLSearchParams())
  assert.deepEqual(skills, { ok: true, status: 200, data: { skills: [] } })
  assert.deepEqual(pool, { ok: true, status: 200, data: { skills: [] } })
  assert.deepEqual(catalog, { ok: true, status: 200, data: { skills: [], next_cursor: null } })

  for (const [ownerTransport, publicTransport] of [
    ["stdio", "http"],
    ["streamable_http", "streamable_http"],
    ["sse_compat", "streamable_http"],
  ] as const) {
    const result = await requestCapability(config(base), context, "mcpServers", new URLSearchParams({ provider_key: ownerTransport }))
    assert.equal(result.ok, true)
    if (result.ok && "servers" in result.data) assert.equal(result.data.servers[0]?.transport, publicTransport)
  }
  const unknown = await requestCapability(config(base), context, "mcpServers", new URLSearchParams({ provider_key: "unknown" }))
  assert.equal(unknown.ok, false)
  if (!unknown.ok) assert.equal(unknown.code, "capability_response_invalid")
})

test("Capability facade enforces one attempt and a fixed one-MiB response cap", async () => {
  let attempts = 0
  const oversized = JSON.stringify({ data: { skills: [], padding: "x".repeat(1024 * 1024) } })
  const base = await listen(
    createServer((_request, response) => {
      attempts += 1
      replyJson(response, 200, oversized)
    }),
  )
  const { requestCapability, CAPABILITY_MAX_RESPONSE_BYTES, CAPABILITY_TIMEOUT_MS } = await capabilityClient()
  assert.equal(CAPABILITY_TIMEOUT_MS, 5000)
  assert.equal(CAPABILITY_MAX_RESPONSE_BYTES, 1024 * 1024)
  const result = await requestCapability(config(base), context, "skills", new URLSearchParams())
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.status, 502)
  assert.equal(attempts, 1)
})

test("Capability facade aborts one hanging attempt at its five-second hard deadline", { timeout: 7000 }, async () => {
  let attempts = 0
  const base = await listen(
    createServer((_request, _response) => {
      attempts += 1
    }),
  )
  const { requestCapability } = await capabilityClient()
  const startedAt = performance.now()
  const result = await requestCapability(config(base), context, "skills", new URLSearchParams())
  const elapsedMs = performance.now() - startedAt
  assert.equal(result.ok, false)
  if (!result.ok) assert.deepEqual({ status: result.status, code: result.code }, { status: 502, code: "capability_response_invalid" })
  assert.equal(attempts, 1)
  assert.ok(elapsedMs >= 4500 && elapsedMs < 6500, `elapsed ${elapsedMs}ms`)
})
