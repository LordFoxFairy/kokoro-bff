import assert from "node:assert/strict"
import test from "node:test"

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
          example_prompts: provider.example_prompts,
          connector_types: provider.connector_types,
          default_scopes: provider.default_scopes,
          authorization_required: provider.authorization_required,
          allowed_mcp_origins: provider.allowed_mcp_origins,
          description: "Access, search, and organize GitHub repositories from Kokoro.",
          author: "GitHub",
          website: "https://github.com",
          privacy_url: "https://docs.github.com/site-policy/privacy-policies/github-privacy-statement",
        },
      }),
    })
    assert.equal(response.status, 200)
    assert.equal(received.provider.website, "https://github.com")
    assert.equal(received.provider.privacy_url, "https://docs.github.com/site-policy/privacy-policies/github-privacy-statement")
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
