import assert from "node:assert/strict"
import { createServer } from "node:http"
import test from "node:test"
import { createBffServer } from "../dist/bootstrap/server.js"
import { DEFAULT_AGUI_CONFIG } from "../dist/config/runtime.js"

const headers = {
  "x-kokoro-service": "web-bff",
  "x-kokoro-internal-secret": "test-secret",
  authorization: "Bearer human-session",
  "x-request-id": "connector-list-request",
}

async function fixture({ client, permitted = true } = {}) {
  const iam = createServer(async (request, response) => {
    response.writeHead(200, {
      "content-type": "application/json",
      "cache-control": "no-store",
      "x-request-id": request.headers["x-request-id"],
    })
    response.end(
      JSON.stringify({
        data:
          request.url === "/internal/v1/session-authorizations/verify"
            ? {
                allowed: true,
                tenant_id: "tenant-server",
                user_id: "human-one",
                platform_admin: false,
                session_id: "session-one",
                client_id: "web-one",
              }
            : {
                allowed: permitted,
                tenant_id: "tenant-server",
                subject_id: "human-one",
                decision_source: "current_membership",
              },
      }),
    )
  })
  await new Promise((resolve) => iam.listen(0, "127.0.0.1", resolve))
  const config = {
    host: "127.0.0.1",
    port: 0,
    mode: "live",
    domain: "dev.kokoro.localhost",
    tenantId: "tenant-server",
    iamBaseUrl: `http://127.0.0.1:${iam.address().port}`,
    sharedSecret: "test-secret",
    upstreamSecret: "upstream-secret",
    upstreamTimeoutMs: 5_000,
    upstreamMaxResponseBytes: 1_048_576,
    schedulerServiceToken: null,
    schedulerTargetUrl: null,
    agentEnabled: false,
    postgresUrl: null,
    redisUrl: null,
    agUi: DEFAULT_AGUI_CONFIG,
    upstreams: { system: null, capability: null, scheduler: null, agents: null, billing: null, music: null },
  }
  const app = createBffServer(config, {
    businessStore: null,
    readiness: async () => undefined,
    sessionAdmission: {
      verify: async () => ({ ok: true, identity: { namespace: "tenant-server", userId: "human-one" }, platformAdmin: false }),
    },
    mcpAuthorization: { check: async () => ({ ok: permitted, status: permitted ? 200 : 403, code: "session_forbidden" }) },
    ...(client ? { mcpPersonalClient: client } : {}),
  })
  await new Promise((resolve) => app.listen(0, "127.0.0.1", resolve))
  return {
    origin: `http://127.0.0.1:${app.address().port}`,
    async close() {
      for (const server of [app, iam]) {
        server.closeAllConnections()
        await new Promise((resolve) => server.close(resolve))
      }
    },
  }
}

const connector = {
  connector_id: "connector-one",
  connector_type: "mcp",
  provider_key: "notion",
  status: "active",
  approved_scopes: [],
  enabled: false,
  state_version: "1",
  display_name: "Notion",
  description: "Search and update workspace pages",
}
const provider = {
  provider_key: "notion",
  display_name: "Notion",
  description: "Search and update workspace pages",
  directory_type: "app",
  category_keys: ["efficiency"],
  example_prompts: [],
  enabled: true,
  state_version: "1",
}

test("connector.list projects only active installed connectors with the Manus V1 shape", async () => {
  const calls = []
  const app = await fixture({
    client: {
      async read(operation, input) {
        calls.push({ operation, input })
        if (operation === "connectors") return { items: [connector], next_cursor: null }
        return { items: [provider], next_cursor: null }
      },
    },
  })
  try {
    const response = await fetch(`${app.origin}/v1/connector.list`, { headers })
    assert.equal(response.status, 200)
    assert.equal(response.headers.get("cache-control"), "no-store")
    assert.equal(response.headers.get("x-request-id"), "connector-list-request")
    assert.deepEqual(await response.json(), {
      ok: true,
      request_id: "connector-list-request",
      data: [
        {
          id: "connector-one",
          name: "Notion",
          type: "mcp",
          description: "Search and update workspace pages",
          category: "efficiency",
        },
      ],
    })
    assert.deepEqual(
      calls.map((call) => call.operation),
      ["connectors", "providers"],
    )
    assert.equal(calls[0].input.status, "active")
  } finally {
    await app.close()
  }
})

test("connector.list closes malformed public input before owner reads", async () => {
  let calls = 0
  const app = await fixture({ client: { read: async () => ((calls += 1), { items: [], next_cursor: null }) } })
  try {
    for (const suffix of ["?project_id=x", "?x=1", "?x=1&x=2"]) {
      const response = await fetch(`${app.origin}/v1/connector.list${suffix}`, { headers })
      assert.equal(response.status, 400)
      assert.deepEqual(await response.json(), {
        ok: false,
        request_id: "connector-list-request",
        error: { code: "InvalidArgument", message: "Connector list request is invalid" },
      })
    }
    assert.equal(calls, 0)
  } finally {
    await app.close()
  }
})

test("connector.list rejects a non-single provider category rather than inventing one", async () => {
  const app = await fixture({
    client: {
      async read(operation) {
        return operation === "connectors"
          ? { items: [connector], next_cursor: null }
          : { items: [{ ...provider, category_keys: ["efficiency", "business"] }], next_cursor: null }
      },
    },
  })
  try {
    const response = await fetch(`${app.origin}/v1/connector.list`, { headers })
    assert.equal(response.status, 502)
    assert.deepEqual(await response.json(), {
      ok: false,
      request_id: "connector-list-request",
      error: { code: "connector_response_invalid", message: "Connector list dependency returned an invalid response" },
    })
  } finally {
    await app.close()
  }
})

test("connector.list maps current IAM denial to the Manus-compatible permission envelope", async () => {
  let calls = 0
  const app = await fixture({
    permitted: false,
    client: { read: async () => ((calls += 1), { items: [], next_cursor: null }) },
  })
  try {
    const response = await fetch(`${app.origin}/v1/connector.list`, { headers })
    assert.equal(response.status, 403)
    assert.deepEqual(await response.json(), {
      ok: false,
      request_id: "connector-list-request",
      error: { code: "PermissionDenied", message: "Connector list access is unavailable" },
    })
    assert.equal(calls, 0)
  } finally {
    await app.close()
  }
})

test("connector.list does not fabricate a list when the Platform owner adapter is absent", async () => {
  const app = await fixture()
  try {
    const response = await fetch(`${app.origin}/v1/connector.list`, { headers })
    assert.equal(response.status, 503)
    assert.deepEqual(await response.json(), {
      ok: false,
      request_id: "connector-list-request",
      error: { code: "Unavailable", message: "Connector list dependency is unavailable" },
    })
  } finally {
    await app.close()
  }
})
