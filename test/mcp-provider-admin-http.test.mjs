import assert from "node:assert/strict"
import test from "node:test"

import { Code, ConnectError } from "@connectrpc/connect"

import { createBffServer } from "../dist/bootstrap/server.js"
import { DEFAULT_AGUI_CONFIG } from "../dist/config/runtime.js"

const headers = {
  "x-kokoro-service": "admin-web-bff",
  "x-kokoro-internal-secret": "admin-test-secret",
  authorization: "Bearer admin-session",
  "x-request-id": "provider-admin-test",
}
const provider = {
  provider_key: "github",
  display_name: "GitHub",
  directory_type: "app",
  category_keys: ["development"],
  example_prompts: ["Review this pull request"],
  connector_types: ["mcp"],
  default_scopes: [],
  authorization_required: true,
  allowed_mcp_origins: [],
  enabled: true,
  state_version: "1",
}
async function fixture({ allowed = true, client = null } = {}) {
  const app = createBffServer(
    {
      host: "127.0.0.1",
      port: 0,
      mode: "live",
      domain: "dev.kokoro.localhost",
      tenantId: "tenant-one",
      iamBaseUrl: null,
      sharedSecret: "test-secret",
      adminWebSharedSecret: "admin-test-secret",
      upstreamSecret: "upstream-secret",
      upstreamTimeoutMs: 5_000,
      upstreamMaxResponseBytes: 1_048_576,
      schedulerServiceToken: null,
      schedulerTargetUrl: null,
      agentEnabled: false,
      postgresUrl: null,
      redisUrl: null,
      agUi: DEFAULT_AGUI_CONFIG,
      upstreams: { system: null, platform: null, scheduler: null, agents: null, billing: null, music: null },
      platformProjection: { baseUrl: null, credentialFile: null, timeoutMs: 5_000 },
      skillDraft: { platformBaseUrl: null, credentialFile: null, timeoutMs: 5_000 },
    },
    {
      businessStore: null,
      readiness: async () => undefined,
      sessionAdmission: { verify: async () => ({ ok: true, identity: { namespace: "tenant-one", userId: "admin-one" }, platformAdmin: true }) },
      mcpAuthorization: {
        check: async (input) => ({ ok: allowed && input.resource === "mcp_catalog" && input.action === "manage", status: 403, code: "session_forbidden" }),
      },
      ...(client === null ? {} : { mcpProviderAdminClient: client }),
    },
  )
  await new Promise((resolve) => app.listen(0, "127.0.0.1", resolve))
  return {
    origin: `http://127.0.0.1:${app.address().port}`,
    async close() {
      app.closeAllConnections()
      await new Promise((resolve) => app.close(resolve))
    },
  }
}

test("provider admin list uses current catalog admission and the owner client", async () => {
  const calls = []
  const app = await fixture({
    client: {
      execute: async (...args) => {
        calls.push(args)
        return { items: [provider], next_cursor: null }
      },
    },
  })
  try {
    const response = await fetch(`${app.origin}/v1/admin/mcp/providers?limit=20`, { headers })
    assert.equal(response.status, 200)
    assert.deepEqual((await response.json()).data, { items: [provider], next_cursor: null })
    assert.equal(calls.length, 1)
    assert.equal(calls[0][0], "list")
    assert.equal(calls[0][1].tenantId, "tenant-one")
    assert.equal(calls[0][1].subjectId, "admin-one")
  } finally {
    await app.close()
  }
})

test("provider admin rejects normal users before owner invocation", async () => {
  let calls = 0
  const app = await fixture({
    allowed: false,
    client: {
      execute: async () => {
        calls += 1
        return {}
      },
    },
  })
  try {
    const response = await fetch(`${app.origin}/v1/admin/mcp/providers`, { headers })
    assert.equal(response.status, 403)
    assert.equal(calls, 0)
  } finally {
    await app.close()
  }
})

test("provider admin validates a create command before owner invocation", async () => {
  let calls = 0
  const app = await fixture({
    client: {
      execute: async () => {
        calls += 1
        return {}
      },
    },
  })
  try {
    const response = await fetch(`${app.origin}/v1/admin/mcp/providers`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json", "idempotency-key": "create-github" },
      body: JSON.stringify({ provider: { provider_key: "github" } }),
    })
    assert.equal(response.status, 400)
    assert.equal(calls, 0)
  } finally {
    await app.close()
  }
})

test("provider admin accepts HTTPS directory metadata for a valid update", async () => {
  const examples = ["  First line\nsecond line  ", "Windows\r\nlines", "Repeat", "Repeat", "😀".repeat(1000)]
  let received
  const app = await fixture({
    client: {
      execute: async (_operation, input) => {
        received = input
        return { provider: { ...provider, ...input.provider, state_version: "2" }, replayed: false }
      },
    },
  })
  try {
    const response = await fetch(`${app.origin}/v1/admin/mcp/providers/github`, {
      method: "PATCH",
      headers: { ...headers, "content-type": "application/json", "idempotency-key": "update-github-directory" },
      body: JSON.stringify({
        expected_state_version: "1",
        provider: {
          provider_key: provider.provider_key,
          display_name: provider.display_name,
          directory_type: provider.directory_type,
          category_keys: provider.category_keys,
          example_prompts: examples,
          connector_types: provider.connector_types,
          default_scopes: provider.default_scopes,
          authorization_required: provider.authorization_required,
          allowed_mcp_origins: provider.allowed_mcp_origins,
          description: "Access, search, and organize GitHub repositories from Kokoro.",
          author: "GitHub",
          website: "https://github.com",
          privacy_url: "https://docs.github.com/site-policy/privacy-policies/github-privacy-statement",
          cover_image_url: "https://cdn.example.test/connectors/github.webp",
        },
      }),
    })
    assert.equal(response.status, 200)
    assert.deepEqual(received.provider.example_prompts, examples)
    assert.deepEqual((await response.json()).data.provider.example_prompts, examples)
    assert.equal(received.provider.website, "https://github.com")
    assert.equal(received.provider.privacy_url, "https://docs.github.com/site-policy/privacy-policies/github-privacy-statement")
    assert.equal(received.provider.cover_image_url, "https://cdn.example.test/connectors/github.webp")
  } finally {
    await app.close()
  }
})

test("provider admin rejects invalid examples without invoking the owner", async () => {
  let calls = 0
  const app = await fixture({
    client: {
      execute: async () => {
        calls += 1
        return {}
      },
    },
  })
  const input = Object.fromEntries(Object.entries(provider).filter(([name]) => !["enabled", "state_version"].includes(name)))
  try {
    const invalidExamples = [[""], [" \r\n\t "], ["\ud800"], ["😀".repeat(1001)], Array(11).fill("Example")]
    for (const [index, examples] of invalidExamples.entries()) {
      const response = await fetch(`${app.origin}/v1/admin/mcp/providers`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json", "idempotency-key": `invalid-examples-${index}` },
        body: JSON.stringify({ provider: { ...input, example_prompts: examples } }),
      })
      assert.equal(response.status, 400, `invalid example class ${index}`)
      assert.equal((await response.json()).error.code, "invalid_mcp_provider_admin_request")
    }
    assert.equal(calls, 0)
  } finally {
    await app.close()
  }
})

test("provider admin requires a configured owner client", async () => {
  const app = await fixture()
  try {
    const response = await fetch(`${app.origin}/v1/admin/mcp/providers`, { headers })
    assert.equal(response.status, 503)
  } finally {
    await app.close()
  }
})

test("provider admin maps only operation-valid typed owner failures without trusting messages", async () => {
  const updateBody = JSON.stringify({
    expected_state_version: "1",
    provider: {
      provider_key: provider.provider_key,
      display_name: provider.display_name,
      directory_type: provider.directory_type,
      category_keys: provider.category_keys,
      example_prompts: provider.example_prompts,
      connector_types: provider.connector_types,
      default_scopes: provider.default_scopes,
      authorization_required: provider.authorization_required,
      allowed_mcp_origins: provider.allowed_mcp_origins,
    },
  })
  const cases = [
    {
      operation: "get",
      code: Code.NotFound,
      message: "secret owner detail",
      method: "GET",
      path: "/github",
      status: 404,
      wire: "mcp_provider_admin_not_found",
      retryable: false,
    },
    {
      operation: "update",
      code: Code.InvalidArgument,
      message: "not found text is not authority",
      method: "PATCH",
      path: "/github",
      body: updateBody,
      status: 400,
      wire: "invalid_mcp_provider_admin_request",
      retryable: false,
    },
    {
      operation: "update",
      code: Code.AlreadyExists,
      message: "CAS message is deliberately opaque",
      method: "PATCH",
      path: "/github",
      body: updateBody,
      status: 409,
      wire: "mcp_provider_admin_conflict",
      retryable: false,
    },
    {
      operation: "update",
      code: Code.Aborted,
      message: "owner processing detail",
      method: "PATCH",
      path: "/github",
      body: updateBody,
      status: 409,
      wire: "mcp_provider_admin_command_in_progress",
      retryable: true,
    },
    {
      operation: "update",
      code: Code.FailedPrecondition,
      message: "owner state detail",
      method: "PATCH",
      path: "/github",
      body: updateBody,
      status: 412,
      wire: "mcp_provider_admin_precondition_failed",
      retryable: false,
    },
    {
      operation: "list",
      code: Code.NotFound,
      message: "list must not expose not-found",
      method: "GET",
      path: "",
      status: 503,
      wire: "mcp_provider_admin_dependency_unavailable",
      retryable: true,
    },
    {
      operation: "get",
      code: Code.NotFound,
      message: "invalid_mcp_provider_admin_request",
      method: "GET",
      path: "/github",
      status: 404,
      wire: "mcp_provider_admin_not_found",
      retryable: false,
    },
    {
      operation: "get",
      code: Code.PermissionDenied,
      message: "mcp_provider_admin_body_too_large",
      method: "GET",
      path: "/github",
      status: 503,
      wire: "mcp_provider_admin_dependency_unavailable",
      retryable: true,
    },
    {
      operation: "get",
      code: Code.PermissionDenied,
      message: "service credential detail",
      method: "GET",
      path: "/github",
      status: 503,
      wire: "mcp_provider_admin_dependency_unavailable",
      retryable: true,
    },
  ]
  for (const item of cases) {
    const app = await fixture({
      client: {
        execute: async (operation) => {
          assert.equal(operation, item.operation)
          const error = new ConnectError(item.message, item.code)
          Object.defineProperty(error, "message", { value: item.message })
          throw error
        },
      },
    })
    try {
      const response = await fetch(`${app.origin}/v1/admin/mcp/providers${item.path}`, {
        method: item.method,
        headers: item.body === undefined ? headers : { ...headers, "content-type": "application/json", "idempotency-key": `typed-${item.code}` },
        ...(item.body === undefined ? {} : { body: item.body }),
      })
      assert.equal(response.status, item.status)
      const payload = await response.json()
      assert.deepEqual(payload.error, { code: item.wire, message: "MCP provider administration failed", retryable: item.retryable })
      assert.doesNotMatch(JSON.stringify(payload), new RegExp(item.message, "u"))
    } finally {
      await app.close()
    }
  }
})
