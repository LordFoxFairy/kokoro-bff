import { startMcpRequestBudget } from "../dist/http/mcp-request-budget.js"
import assert from "node:assert/strict"
import { createServer, request as nodeRequest } from "node:http"
import test from "node:test"
import { createBffServer } from "../dist/bootstrap/server.js"
import { DEFAULT_AGUI_CONFIG } from "../dist/config/runtime.js"

const headers = {
  "x-kokoro-service": "web-bff",
  "x-kokoro-internal-secret": "test-secret",
  authorization: "Bearer human-session",
  "x-request-id": "mcp-http-1",
}
const paths = [
  "/v1/mcp/servers",
  "/v1/mcp/connections",
  "/browser/v1/mcp/connectors",
  "/browser/v1/mcp/connectors/connector-one",
  "/browser/v1/mcp/connectors/connector-one/connections",
  "/browser/v1/mcp/connections/connection-one",
]
async function fixture(decision, { realSession = false, check, routeHandler, mcpPersonalClient, verify, deadlineMs, sessionDelayMs = 0 } = {}) {
  const seen = []
  const iam = createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    seen.push({
      path: request.url,
      authorization: request.headers.authorization,
      body: chunks.length === 0 ? null : JSON.parse(Buffer.concat(chunks).toString()),
    })
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
                allowed: decision,
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
    upstreamTimeoutMs: 5000,
    upstreamMaxResponseBytes: 1024 * 1024,
    schedulerServiceToken: null,
    schedulerTargetUrl: null,
    agentEnabled: false,
    postgresUrl: null,
    redisUrl: null,
    agUi: DEFAULT_AGUI_CONFIG,
    upstreams: {
      system: null,
      capability: null,
      scheduler: null,
      agents: null,
      billing: null,
      music: null,
    },
  }
  const app = createBffServer(config, {
    businessStore: null,
    readiness: async () => undefined,
    ...(realSession
      ? {}
      : {
          sessionAdmission: {
            verify:
              verify ??
              (async () => {
                if (sessionDelayMs) await new Promise((resolve) => setTimeout(resolve, sessionDelayMs))
                return {
                  ok: true,
                  identity: { namespace: "tenant-server", userId: "human-one" },
                  platformAdmin: false,
                }
              }),
          },
        }),
    ...(check ? { mcpAuthorization: { check } } : {}),
    ...(routeHandler ? { routeHandler } : {}),
    ...(mcpPersonalClient ? { mcpPersonalClient } : {}),
  })
  if (deadlineMs !== undefined) {
    const handler = app.listeners("request")[0]
    app.removeAllListeners("request")
    app.on("request", (request, response) => {
      startMcpRequestBudget(request, deadlineMs)
      handler(request, response)
    })
  }
  await new Promise((resolve) => app.listen(0, "127.0.0.1", resolve))
  return {
    seen,
    origin: `http://127.0.0.1:${app.address().port}`,
    close: async () => {
      for (const server of [app, iam]) {
        server.closeAllConnections()
        await new Promise((resolve) => server.close(resolve))
      }
    },
  }
}

const connector = {
  availability: "unavailable",
  connector_id: "connector-one",
  connector_type: "mcp",
  provider_key: "test",
  status: "pending",
  approved_scopes: [],
  enabled: true,
  state_version: "1",
  display_name: "Example",
  description: "",
}
const privateServer = {
  availability: "unavailable",
  server_id: "server-one",
  display_name: "Private tools",
  server_url: "https://tools.example/mcp",
  status: "pending",
  state_version: "1",
  notes: "Internal only",
  headers: [
    {
      name: "x-api-key",
      configured: true,
      state_version: "1",
      status: "active",
    },
  ],
  oauth_client: {
    client_id: "client-one",
    configured: true,
    origin: "byo",
    status: "configured",
    state_version: "1",
  },
  prepare_status: "pending_prepare",
  declarations: [],
  declarations_available: false,
}
const provider = {
  provider_key: "test",
  display_name: "Provider",
  directory_type: "app",
  category_keys: [],
  example_prompts: [],
  enabled: true,
  state_version: "1",
}
for (const [method, path, body, status] of [
  [
    "POST",
    "/browser/v1/mcp/connectors",
    {
      provider_key: "test",
      connector_type: "mcp",
      display_name: "Example",
      description: "",
    },
    201,
  ],
  ["PATCH", "/browser/v1/mcp/connectors/connector-one", { display_name: "Example", description: "", expected_state_version: "1" }, 200],
  ["PUT", "/browser/v1/mcp/connectors/connector-one/enabled", { enabled: true, expected_state_version: "1" }, 200],
  ["DELETE", "/browser/v1/mcp/connectors/connector-one", { expected_state_version: "1" }, 200],
  ["GET", "/browser/v1/mcp/providers", undefined, 200],
  ["GET", "/browser/v1/mcp/providers/test", undefined, 200],
])
  test(`A2 six formal capabilities pass guard: ${method} ${path}`, async () => {
    const seen = []
    const client = {
      async read(operation, input) {
        seen.push({ operation, input })
        return operation === "providers" ? { items: [provider], next_cursor: null } : { provider }
      },
      async command(operation, input) {
        seen.push({ operation, input })
        return {
          connector:
            operation === "create"
              ? { ...connector, enabled: false }
              : operation === "remove"
                ? { ...connector, enabled: false, status: "revoked" }
                : connector,
        }
      },
    }
    const f = await fixture(true, { mcpPersonalClient: client })
    try {
      const response = await fetch(`${f.origin}${path}`, {
        method,
        headers: {
          ...headers,
          ...(body === undefined
            ? {}
            : {
                "content-type": "application/json",
                "idempotency-key": "original-intent",
              }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      assert.equal(response.status, status)
      const raw = await response.json()
      assert.ok(raw.data)
      assert.equal(seen.length, 1)
    } finally {
      await f.close()
    }
  })
for (const [label, request, expected] of [
  ["missing key", { headers: { "content-type": "application/json" }, body: "{}" }, 400],
  [
    "space key",
    {
      headers: {
        "content-type": "application/json",
        "idempotency-key": "bad key",
      },
      body: "{}",
    },
    400,
  ],
  [
    "unknown body",
    {
      body: JSON.stringify({
        display_name: "Example",
        description: "",
        expected_state_version: "1",
        extra: true,
      }),
    },
    400,
  ],
  [
    "unsafe CAS",
    {
      body: JSON.stringify({
        display_name: "Example",
        description: "",
        expected_state_version: "9007199254740992",
      }),
    },
    400,
  ],
  ["body cap", { body: "x".repeat(65537) }, 413],
  ["query", { suffix: "?extra=1", body: "{}" }, 400],
])
  test(`A2 command rejects ${label} before owner mutation`, async () => {
    let calls = 0
    const f = await fixture(true, {
      mcpPersonalClient: {
        read: async () => ({}),
        command: async () => {
          calls++
          return { connector }
        },
      },
    })
    try {
      const response = await fetch(f.origin + "/browser/v1/mcp/connectors/connector-one" + (request.suffix ?? ""), {
        method: "PATCH",
        headers: {
          ...headers,
          ...(request.headers ?? {
            "content-type": "application/json",
            "idempotency-key": "original-key",
          }),
        },
        body: request.body,
      })
      assert.equal(response.status, expected)
      assert.equal((await response.json()).error.retryable, false)
      assert.equal(calls, 0)
    } finally {
      await f.close()
    }
  })
for (const [code, status, fault, retryable] of [
  [6, 409, "mcp_personal_idempotency_conflict", false],
  [10, 409, "mcp_personal_command_in_progress", true],
  [9, 412, "mcp_personal_precondition_failed", false],
  [14, 503, "mcp_personal_dependency_unavailable", true],
])
  test(`A2 command maps formal owner code ${code} without retrying unknown intent`, async () => {
    const { ConnectError } = await import("@connectrpc/connect")
    const seen = []
    const f = await fixture(true, {
      mcpPersonalClient: {
        read: async () => ({}),
        command: async (operation, input) => {
          seen.push({ operation, input })
          throw new ConnectError("private owner diagnostic", code)
        },
      },
    })
    const body = JSON.stringify({
      display_name: "Example",
      description: "",
      expected_state_version: "1",
    })
    try {
      for (let replay = 0; replay < 2; replay++) {
        const response = await fetch(f.origin + "/browser/v1/mcp/connectors/connector-one", {
          method: "PATCH",
          headers: {
            ...headers,
            "content-type": "application/json",
            "idempotency-key": "original-intent",
          },
          body,
        })
        assert.equal(response.status, status)
        const raw = await response.json()
        assert.deepEqual(raw.error, {
          code: fault,
          message: "Personal MCP request failed",
          retryable,
        })
        assert.equal(seen.length, replay + 1)
      }
      assert.equal(seen[0].input.commandId, "original-intent")
      assert.equal(seen[1].input.expectedStateVersion, "1")
      assert.deepEqual(seen[1], seen[0])
    } finally {
      await f.close()
    }
  })
test("A2 command re-admits after ACK and hides committed result on revoked session", async () => {
  let sessions = 0,
    calls = 0
  const f = await fixture(true, {
    verify: async () =>
      ++sessions === 1
        ? {
            ok: true,
            identity: { namespace: "tenant-server", userId: "human-one" },
            platformAdmin: false,
          }
        : { ok: false, status: 401, code: "session_invalid" },
    mcpPersonalClient: {
      read: async () => ({}),
      command: async () => {
        calls++
        return { connector: { ...connector, enabled: false } }
      },
    },
  })
  try {
    const response = await fetch(f.origin + "/browser/v1/mcp/connectors", {
      method: "POST",
      headers: {
        ...headers,
        "content-type": "application/json",
        "idempotency-key": "original-intent",
      },
      body: JSON.stringify({
        provider_key: "test",
        connector_type: "mcp",
        display_name: "Example",
        description: "",
      }),
    })
    assert.equal(response.status, 401)
    assert.equal((await response.json()).error.code, "session_invalid")
    assert.equal(calls, 1)
  } finally {
    await f.close()
  }
})

test("JSON MCP import forwards one opaque document once and returns every atomic owner result", async () => {
  const seen = []
  const f = await fixture(true, {
    mcpPersonalClient: {
      read: async () => ({}),
      importJson: async (input) => {
        seen.push(input)
        return {
          imports: [
            {
              server: {
                ...privateServer,
                server_id: "imported-one",
                display_name: "Imported HTTP",
              },
              connector: {
                ...connector,
                connector_id: "connector-imported",
                server_id: "imported-one",
                enabled: false,
              },
            },
          ],
          replayed: false,
        }
      },
    },
  })
  const config_json = JSON.stringify({
    mcpServers: {
      "Imported HTTP": {
        type: "streamableHttp",
        url: "https://tools.example/mcp",
        headers: { "X-API-Key": "secret" },
      },
    },
  })
  try {
    const response = await fetch(f.origin + "/browser/v1/mcp/servers/import", {
      method: "POST",
      headers: {
        ...headers,
        "content-type": "application/json",
        "idempotency-key": "import-intent",
      },
      body: JSON.stringify({ config_json }),
    })
    assert.equal(response.status, 201)
    assert.equal(seen.length, 1)
    assert.equal(seen[0].commandId, "import-intent")
    assert.equal(seen[0].configJson, config_json)
    assert.equal((await response.json()).data.imports[0].server.server_id, "imported-one")
  } finally {
    await f.close()
  }
})
test("A2 command total deadline aborts RPC and never publishes late ACK", async () => {
  let signal, release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const f = await fixture(true, {
    deadlineMs: 30,
    mcpPersonalClient: {
      read: async () => ({}),
      command: async (_operation, _input, outer) => {
        signal = outer
        await gate
        return { connector: { ...connector, enabled: false } }
      },
    },
  })
  try {
    const response = await fetch(f.origin + "/browser/v1/mcp/connectors", {
      method: "POST",
      headers: {
        ...headers,
        "content-type": "application/json",
        "idempotency-key": "original-intent",
      },
      body: JSON.stringify({
        provider_key: "test",
        connector_type: "mcp",
        display_name: "Example",
        description: "",
      }),
    })
    assert.equal(response.status, 503)
    assert.equal((await response.json()).error.code, "mcp_personal_dependency_unavailable")
    assert.equal(signal.aborted, true)
  } finally {
    release()
    await f.close()
  }
})

test("A3 OAuth callback and connection lifecycle use a single BFF-admitted personal-MCP surface", async () => {
  const calls = []
  const f = await fixture(true, {
    mcpPersonalClient: {
      read: async () => ({}),
      authorization: async (operation, input) => {
        calls.push({ operation, input })
        if (operation === "complete")
          return {
            connector: { ...connector, status: "active", state_version: "3" },
          }
        if (operation === "createConnection")
          return {
            connection: {
              connection_id: "connection-one",
              connector_id: "connector-one",
              server_id: "server-one",
              allowed_selectors: ["tool.read"],
              policy_digest: "a".repeat(64),
              status: "active",
            },
          }
        return {
          authorization: {
            authorization_id: "authorization-one",
            authorization_url: "https://oauth.example.test/authorize?state=opaque",
            expires_at: "2027-01-15T08:00:00.000Z",
          },
          connector,
        }
      },
    },
  })
  const invoke = async (path, body, idempotencyKey) => {
    const response = await fetch(f.origin + path, {
      method: "POST",
      headers: {
        ...headers,
        "content-type": "application/json",
        ...(idempotencyKey === undefined ? {} : { "idempotency-key": idempotencyKey }),
      },
      body: JSON.stringify(body),
    })
    return [response, await response.json()]
  }
  try {
    const [begin, begun] = await invoke("/browser/v1/mcp/connectors/connector-one/authorization", { server_id: "server-one", expected_state_version: "1" })
    assert.equal(begin.status, 200)
    assert.equal(begun.data.authorization.authorization_url, "https://oauth.example.test/authorize?state=opaque")
    const [complete, completed] = await invoke("/browser/v1/mcp/authorization/callback", { state: "opaque-state", code: "opaque-code" })
    assert.equal(complete.status, 200)
    assert.equal(completed.data.connector.status, "active")
    const [connection, connected] = await invoke(
      "/browser/v1/mcp/connections",
      {
        connector_id: "connector-one",
        server_id: "server-one",
        allowed_selectors: ["tool.read"],
        expected_state_version: "3",
      },
      "connection-command",
    )
    assert.equal(connection.status, 201)
    assert.equal(connected.data.connection.connection_id, "connection-one")
    assert.deepEqual(
      calls.map((call) => call.operation),
      ["begin", "complete", "createConnection"],
    )
    assert.equal(calls[1].input.code, "opaque-code")
    assert.equal(calls[2].input.commandId, "connection-command")
  } finally {
    await f.close()
  }
})

test("private URL MCP follows registration, OAuth, declaration completion, connection, then enable without a generic retry error", async () => {
  const calls = []
  const f = await fixture(true, {
    mcpPersonalClient: {
      read: async () => ({}),
      server: async (operation, input) => {
        calls.push({ operation, input })
        if (operation === "server") return { server: privateServer }
        if (operation === "updateServer")
          return {
            server: {
              ...privateServer,
              display_name: "Private tools renamed",
              notes: undefined,
              headers: [
                {
                  name: "x-api-key",
                  configured: false,
                  state_version: "2",
                  status: "revoked",
                },
                {
                  name: "x-new-key",
                  configured: true,
                  state_version: "1",
                  status: "active",
                },
              ],
              oauth_client: {
                ...privateServer.oauth_client,
                configured: false,
                status: "revoked",
                state_version: "2",
              },
              state_version: "2",
            },
            connector: {
              ...connector,
              connector_id: "connector-one",
              server_id: "server-one",
              enabled: false,
              state_version: "2",
            },
            replayed: false,
          }
        if (operation === "prepareServer")
          return {
            server: {
              ...privateServer,
              state_version: "3",
              prepare_status: "needs_oauth",
            },
            connector: {
              ...connector,
              connector_id: "connector-one",
              server_id: "server-one",
              enabled: false,
              state_version: "3",
            },
            declarations: [],
            replayed: false,
          }
        return {
          server: privateServer,
          connector: {
            ...connector,
            connector_id: "connector-one",
            server_id: "server-one",
            enabled: false,
          },
          replayed: false,
        }
      },
      authorization: async (operation, input) => {
        calls.push({ operation, input })
        if (operation === "complete")
          return {
            connector: {
              ...connector,
              connector_id: "connector-one",
              server_id: "server-one",
              status: "active",
              state_version: "2",
              enabled: false,
            },
          }
        if (operation === "createConnection")
          return {
            connection: {
              connection_id: "connection-one",
              connector_id: "connector-one",
              server_id: "server-one",
              allowed_selectors: ["tool.read"],
              policy_digest: "a".repeat(64),
              status: "active",
            },
          }
        return {
          authorization: {
            authorization_id: "authorization-one",
            authorization_url: "https://oauth.example.test/authorize?state=opaque",
            expires_at: "2027-01-15T08:00:00.000Z",
          },
          connector: {
            ...connector,
            connector_id: "connector-one",
            server_id: "server-one",
            enabled: false,
          },
        }
      },
      command: async (operation, input) => {
        calls.push({ operation, input })
        return {
          connector: {
            ...connector,
            connector_id: "connector-one",
            server_id: "server-one",
            enabled: true,
            status: "active",
            state_version: "3",
          },
        }
      },
    },
  })
  const post = async (path, body, idempotencyKey) => {
    const response = await fetch(f.origin + path, {
      method: "POST",
      headers: {
        ...headers,
        "content-type": "application/json",
        ...(idempotencyKey === undefined ? {} : { "idempotency-key": idempotencyKey }),
      },
      body: JSON.stringify(body),
    })
    return [response, await response.json()]
  }
  try {
    const [registered, registration] = await post(
      "/browser/v1/mcp/servers",
      {
        display_name: "Private tools",
        server_url: "https://tools.example/mcp",
        notes: "Internal only",
        headers: [{ name: "X-API-Key", value: "header-secret" }],
        oauth_client: {
          client_id: "client-one",
          client_secret: "client-secret",
        },
      },
      "private-url-intent",
    )
    assert.equal(registered.status, 201)
    assert.equal(registration.data.server.server_id, "server-one")
    assert.equal(registration.data.connector.server_id, "server-one")
    assert.equal(JSON.stringify(registration).includes("header-secret"), false)
    assert.equal(JSON.stringify(registration).includes("client-secret"), false)
    const read = await fetch(f.origin + "/browser/v1/mcp/servers/server-one", {
      headers,
    })
    assert.equal(read.status, 200)
    assert.equal((await read.json()).data.server.declarations_available, false)
    const updated = await fetch(f.origin + "/browser/v1/mcp/servers/server-one", {
      method: "PATCH",
      headers: {
        ...headers,
        "content-type": "application/json",
        "idempotency-key": "private-update-intent",
      },
      body: JSON.stringify({
        expected_state_version: "1",
        display_name: "Private tools renamed",
        clear_notes: true,
        header_upserts: [{ name: "X-New-Key", value: "new-secret" }],
        header_removals: ["X-API-Key"],
        revoke_oauth_client: true,
      }),
    })
    assert.equal(updated.status, 200)
    assert.equal(JSON.stringify(await updated.json()).includes("new-secret"), false)
    const [prepared, preparation] = await post("/browser/v1/mcp/servers/server-one/prepare", { expected_state_version: "2" }, "private-prepare-intent")
    assert.equal(prepared.status, 200)
    assert.equal(preparation.data.server.prepare_status, "needs_oauth")
    const [begin] = await post("/browser/v1/mcp/connectors/connector-one/authorization", { server_id: "server-one", expected_state_version: "3" })
    assert.equal(begin.status, 200)
    const [completed] = await post("/browser/v1/mcp/authorization/callback", {
      state: "opaque-state",
      code: "opaque-code",
    })
    assert.equal(completed.status, 200)
    const [connected] = await post(
      "/browser/v1/mcp/connections",
      {
        connector_id: "connector-one",
        server_id: "server-one",
        allowed_selectors: ["tool.read"],
        expected_state_version: "2",
      },
      "connection-intent",
    )
    assert.equal(connected.status, 201)
    const enabled = await fetch(f.origin + "/browser/v1/mcp/connectors/connector-one/enabled", {
      method: "PUT",
      headers: {
        ...headers,
        "content-type": "application/json",
        "idempotency-key": "enable-intent",
      },
      body: JSON.stringify({ enabled: true, expected_state_version: "2" }),
    })
    assert.equal(enabled.status, 200)
    assert.deepEqual(
      calls.map((call) => call.operation),
      ["registerServer", "server", "updateServer", "prepareServer", "begin", "complete", "createConnection", "enabled"],
    )
    assert.deepEqual(calls[0].input, {
      tenant: "tenant-server",
      subject: "human-one",
      requestId: "mcp-http-1",
      displayName: "Private tools",
      serverUrl: "https://tools.example/mcp",
      notes: "Internal only",
      headers: [{ name: "x-api-key", value: "header-secret" }],
      oauthClient: { clientId: "client-one", clientSecret: "client-secret" },
      commandId: "private-url-intent",
    })
  } finally {
    await f.close()
  }
})

test("private URL MCP prepare/update/delete enforce idempotency and exact CAS while delete replays through its owner", async () => {
  const calls = []
  const f = await fixture(true, {
    mcpPersonalClient: {
      read: async () => ({}),
      server: async (operation, input) => {
        calls.push({ operation, input })
        if (operation === "deleteServer")
          return {
            server_id: input.id,
            deleted: true,
            replayed: calls.length > 1,
          }
        return { server: privateServer }
      },
    },
  })
  try {
    for (const request of [
      {
        method: "POST",
        path: "/browser/v1/mcp/servers/server-one/prepare",
        headers: { ...headers, "content-type": "application/json" },
        body: { expected_state_version: "1" },
      },
      {
        method: "POST",
        path: "/browser/v1/mcp/servers/server-one/prepare",
        headers: {
          ...headers,
          "content-type": "application/json",
          "idempotency-key": "prepare-key",
        },
        body: { expected_state_version: "2147483648" },
      },
      {
        method: "PATCH",
        path: "/browser/v1/mcp/servers/server-one",
        headers: {
          ...headers,
          "content-type": "application/json",
          "idempotency-key": "update-key",
        },
        body: { expected_state_version: "1" },
      },
      {
        method: "DELETE",
        path: "/browser/v1/mcp/servers/server-one",
        headers: { ...headers, "content-type": "application/json" },
        body: { expected_state_version: "1" },
      },
      {
        method: "DELETE",
        path: "/browser/v1/mcp/servers/server-one",
        headers: {
          ...headers,
          "content-type": "application/json",
          "idempotency-key": "delete-key",
        },
        body: { expected_state_version: "1", extra: true },
      },
    ]) {
      const response = await fetch(f.origin + request.path, {
        method: request.method,
        headers: request.headers,
        body: JSON.stringify(request.body),
      })
      assert.equal(response.status, 400)
      assert.equal((await response.json()).error.code, "invalid_mcp_personal_request")
    }
    assert.equal(calls.length, 0)
    for (const replayed of [false, true]) {
      const deletion = await fetch(f.origin + "/browser/v1/mcp/servers/server-one", {
        method: "DELETE",
        headers: {
          ...headers,
          "content-type": "application/json",
          "idempotency-key": "delete-key",
        },
        body: JSON.stringify({ expected_state_version: "4" }),
      })
      assert.equal(deletion.status, 200)
      assert.deepEqual((await deletion.json()).data, {
        server_id: "server-one",
        deleted: true,
        replayed,
      })
    }
    assert.equal(calls.length, 2)
    assert.deepEqual(
      calls.map(({ operation }) => operation),
      ["deleteServer", "deleteServer"],
    )
    assert.deepEqual(calls[0].input, {
      tenant: "tenant-server",
      subject: "human-one",
      requestId: "mcp-http-1",
      id: "server-one",
      expectedStateVersion: "4",
      commandId: "delete-key",
    })
  } finally {
    await f.close()
  }
})

test("private URL MCP maps typed owner business reasons to stable 412", async () => {
  const { Code, ConnectError } = await import("@connectrpc/connect")
  const { PersonalMcpErrorDetailSchema, PersonalMcpErrorReason } = await import("../dist/generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js")
  const f = await fixture(true, {
    mcpPersonalClient: {
      read: async () => ({}),
      server: async () => {
        throw new ConnectError("private detail", Code.FailedPrecondition, undefined, [
          {
            desc: PersonalMcpErrorDetailSchema,
            value: { reason: PersonalMcpErrorReason.NEEDS_CLIENT },
          },
        ])
      },
    },
  })
  try {
    const response = await fetch(f.origin + "/browser/v1/mcp/servers/server-one/prepare", {
      method: "POST",
      headers: {
        ...headers,
        "content-type": "application/json",
        "idempotency-key": "prepare-key",
      },
      body: JSON.stringify({ expected_state_version: "1" }),
    })
    assert.equal(response.status, 412)
    assert.deepEqual((await response.json()).error, {
      code: "mcp_personal_needs_client",
      message: "Personal MCP request failed",
      retryable: false,
    })
  } finally {
    await f.close()
  }
})

test("A3 OAuth lifecycle rejects callback ambiguity and command keys before Platform", async () => {
  let calls = 0
  const f = await fixture(true, {
    mcpPersonalClient: {
      read: async () => ({}),
      authorization: async () => {
        calls++
        return {}
      },
    },
  })
  try {
    for (const [path, body, headersExtra] of [
      ["/browser/v1/mcp/authorization/callback", { state: "opaque", code: "one", error: "two" }, {}],
      [
        "/browser/v1/mcp/connectors/connector-one/authorization",
        { server_id: "server-one", expected_state_version: "1" },
        { "idempotency-key": "not-allowed" },
      ],
      [
        "/browser/v1/mcp/connections",
        {
          connector_id: "connector-one",
          server_id: "server-one",
          allowed_selectors: [],
          expected_state_version: "1",
        },
        {},
      ],
    ]) {
      const response = await fetch(f.origin + path, {
        method: "POST",
        headers: {
          ...headers,
          "content-type": "application/json",
          ...headersExtra,
        },
        body: JSON.stringify(body),
      })
      assert.equal(response.status, 400)
    }
    assert.equal(calls, 0)
  } finally {
    await f.close()
  }
})

test("private MCP preserves published receipt states rather than retrying or exposing owner metadata", async () => {
  const { Code, ConnectError } = await import("@connectrpc/connect")
  let calls = 0,
    failure
  const f = await fixture(true, {
    mcpPersonalClient: {
      read: async () => ({}),
      server: async () => {
        calls++
        throw failure
      },
    },
  })
  try {
    for (const [reason, rpcCode, status, code, retryable] of [
      ["in_progress", Code.Aborted, 409, "mcp_personal_command_in_progress", true],
      ["outcome_unknown", Code.Unavailable, 503, "mcp_personal_command_outcome_unknown", false],
      ["replay_expired", Code.FailedPrecondition, 412, "mcp_personal_command_replay_expired", false],
      ["identity_conflict", Code.AlreadyExists, 409, "mcp_personal_idempotency_conflict", false],
      ["ownership_lost", Code.Aborted, 409, "mcp_personal_command_ownership_lost", false],
      ["invalid", Code.Internal, 502, "mcp_personal_response_invalid", false],
    ]) {
      failure = new ConnectError("private marker must not escape", rpcCode, { "x-kokoro-error-code": `command_receipt_${reason}` })
      const before = calls
      const response = await fetch(f.origin + "/browser/v1/mcp/servers/server-one/prepare", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json", "idempotency-key": "original-prepare" },
        body: JSON.stringify({ expected_state_version: "1" }),
      })
      assert.equal(response.status, status)
      assert.deepEqual((await response.json()).error, { code, message: "Personal MCP request failed", retryable })
      assert.equal(response.headers.get("x-kokoro-error-code"), null)
      assert.equal(response.headers.get("x-request-id"), headers["x-request-id"])
      assert.equal(calls, before + 1)
    }
    const read = await fetch(f.origin + "/browser/v1/mcp/servers/server-one", { headers })
    assert.equal(read.status, 502)
    assert.equal((await read.json()).error.code, "mcp_personal_response_invalid")
  } finally {
    await f.close()
  }
})

test("published expiry crosses a real Connect hop and the admitted browser adapter without becoming typed-detail 502", async () => {
  const { Code, ConnectError } = await import("@connectrpc/connect")
  const { connectNodeAdapter } = await import("@connectrpc/connect-node")
  const { ProductMcpPersonalService } = await import("../dist/generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js")
  const { McpPersonalConnectClient } = await import("../dist/infrastructure/clients/platform/mcp-personal-connect.js")
  let upstreamCalls = 0,
    credentialReads = 0
  // Controlled owner/auth boundaries; both HTTP hops and the production SDK are real.
  const upstream = createServer(
    connectNodeAdapter({
      routes(router) {
        router.rpc(ProductMcpPersonalService.method.preparePersonalMcpServer, (request, context) => {
          upstreamCalls++
          assert.equal(request.command.commandId, "original-expired-prepare")
          assert.equal(request.expectedStateVersion, 1n)
          assert.equal(request.serverId.value, "server-one")
          assert.equal(context.requestHeader.get("x-kokoro-tenant"), "tenant-server")
          assert.equal(context.requestHeader.get("x-kokoro-subject"), "human-one")
          assert.equal(context.requestHeader.get("authorization"), "Bearer fixture-service-only-not-a-real-credential")
          throw new ConnectError("private owner expiry", Code.FailedPrecondition, { "x-kokoro-error-code": "command_receipt_replay_expired" })
        })
      },
    }),
  )
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve))
  const client = new McpPersonalConnectClient(`http://127.0.0.1:${upstream.address().port}`, {
    get: async (tenant) => {
      assert.equal(tenant, "tenant-server")
      credentialReads++
      return "fixture-service-only-not-a-real-credential"
    },
  })
  let f
  try {
    f = await fixture(true, { mcpPersonalClient: client })
    const response = await fetch(f.origin + "/browser/v1/mcp/servers/server-one/prepare", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json", "idempotency-key": "original-expired-prepare" },
      body: JSON.stringify({ expected_state_version: "1" }),
    })
    assert.equal(response.status, 412)
    assert.deepEqual((await response.json()).error, { code: "mcp_personal_command_replay_expired", message: "Personal MCP request failed", retryable: false })
    assert.equal(response.headers.get("x-kokoro-error-code"), null)
    assert.equal(upstreamCalls, 1)
    assert.equal(credentialReads, 1)
  } finally {
    client.close()
    await f?.close()
    upstream.closeAllConnections()
    await new Promise((resolve) => upstream.close(resolve))
  }
})

test("native OAuth exposes its typed needs-client failure without weakening an untyped CAS rejection", async () => {
  const { Code, ConnectError } = await import("@connectrpc/connect")
  const { PersonalMcpErrorDetailSchema, PersonalMcpErrorReason } = await import("../dist/generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js")
  let failure = new ConnectError("private auth context", Code.FailedPrecondition, undefined, [
    { desc: PersonalMcpErrorDetailSchema, value: { reason: PersonalMcpErrorReason.NEEDS_CLIENT } },
  ])
  const f = await fixture(true, {
    mcpPersonalClient: {
      read: async () => ({}),
      authorization: async () => {
        throw failure
      },
    },
  })
  try {
    for (const [error, status, code] of [
      [failure, 412, "mcp_personal_needs_client"],
      [new ConnectError("private CAS", Code.FailedPrecondition), 412, "mcp_personal_precondition_failed"],
      [
        new ConnectError("private unknown reason", Code.FailedPrecondition, undefined, [
          { desc: PersonalMcpErrorDetailSchema, value: { reason: PersonalMcpErrorReason.UNSPECIFIED } },
        ]),
        502,
        "mcp_personal_response_invalid",
      ],
    ]) {
      failure = error
      const response = await fetch(f.origin + "/browser/v1/mcp/connectors/connector-one/authorization", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ server_id: "server-one", expected_state_version: "1" }),
      })
      assert.equal(response.status, status)
      assert.deepEqual((await response.json()).error, { code, message: "Personal MCP request failed", retryable: false })
    }
  } finally {
    await f.close()
  }
})

test("Prepare receipt GET binds only the original CAS/key, re-admits reads and never dispatches Prepare", async () => {
  const calls = []
  const actions = []
  const completed = {
    server: { ...privateServer, state_version: "2", prepare_status: "needs_oauth" },
    connector: { ...connector, enabled: false, server_id: "server-one" },
    declarations: [],
    replayed: true,
  }
  const f = await fixture(true, {
    check: async (value) => {
      actions.push(value.action)
      return { ok: true }
    },
    mcpPersonalClient: {
      read: async () => {
        throw Error("ordinary read unexpected")
      },
      server: async () => {
        throw Error("Prepare/mutation dispatch forbidden")
      },
      prepareReceipt: async (input) => {
        calls.push(input)
        return { completed }
      },
    },
  })
  try {
    const response = await fetch(`${f.origin}/browser/v1/mcp/servers/server-one/prepare-receipt?expected_state_version=1`, {
      headers: { ...headers, "idempotency-key": "original-intent" },
    })
    assert.equal(response.status, 200)
    assert.deepEqual((await response.json()).data, { completed })
    assert.equal(calls.length, 1)
    assert.equal(calls[0].expectedStateVersion, "1")
    assert.equal(calls[0].commandId, "original-intent")
    assert.equal(calls[0].id, "server-one")
    assert.ok(actions.length >= 2)
    assert.ok(actions.every((value) => value === "read"))
    for (const [query, key] of [
      ["", "original-intent"],
      ["?expected_state_version=01", "original-intent"],
      ["?expected_state_version=1&expected_state_version=1", "original-intent"],
      ["?expected_state_version=1&extra=1", "original-intent"],
      ["?expected_state_version=1", undefined],
    ]) {
      const invalid = await fetch(`${f.origin}/browser/v1/mcp/servers/server-one/prepare-receipt${query}`, {
        headers: { ...headers, ...(key ? { "idempotency-key": key } : {}) },
      })
      assert.equal(invalid.status, 400)
    }
    assert.equal(calls.length, 1)
    const ordinary = await fetch(`${f.origin}/browser/v1/mcp/servers/server-one`, { headers: { ...headers, "idempotency-key": "original-intent" } })
    assert.equal(ordinary.status, 400)
  } finally {
    await f.close()
  }
})

test("Prepare receipt lookup rejects read denial before owner I/O and retires changed identity at exit", async () => {
  for (const changed of [false, true]) {
    let calls = 0,
      admissions = 0
    const f = await fixture(true, {
      check: async () => (changed ? { ok: true } : { ok: false, status: 403, code: "forbidden" }),
      verify: async () => ({
        ok: true,
        identity: { namespace: "tenant-server", userId: ++admissions === 1 ? "human-one" : "human-other" },
        platformAdmin: false,
      }),
      mcpPersonalClient: {
        read: async () => ({}),
        prepareReceipt: async () => {
          calls++
          return {
            completed: {
              server: { ...privateServer, state_version: "2", prepare_status: "needs_oauth" },
              connector: { ...connector, server_id: "server-one", enabled: false },
              declarations: [],
              replayed: true,
            },
          }
        },
      },
    })
    try {
      const response = await fetch(`${f.origin}/browser/v1/mcp/servers/server-one/prepare-receipt?expected_state_version=1`, {
        headers: { ...headers, "idempotency-key": "original-intent" },
      })
      assert.equal(response.status, changed ? 404 : 403)
      assert.equal(calls, changed ? 1 : 0)
    } finally {
      await f.close()
    }
  }
})

test("Prepare receipt lookup has one deadline, cancels its owner read and never settles late completed", async () => {
  let ownerSignal, release
  const pending = new Promise((resolve) => {
    release = resolve
  })
  const f = await fixture(true, {
    deadlineMs: 40,
    check: async () => ({ ok: true }),
    mcpPersonalClient: {
      read: async () => ({}),
      prepareReceipt: async (_input, signal) => {
        ownerSignal = signal
        await pending
        return { completed: {} }
      },
    },
  })
  try {
    const response = await fetch(`${f.origin}/browser/v1/mcp/servers/server-one/prepare-receipt?expected_state_version=1`, {
      headers: { ...headers, "idempotency-key": "original-intent" },
    })
    assert.equal(response.status, 503)
    assert.equal((await response.json()).error.code, "mcp_personal_dependency_unavailable")
    assert.equal(ownerSignal.aborted, true)
  } finally {
    release()
    await f.close()
  }
})

test("Prepare receipt lookup forwards only closed existing receipt faults, not a mutation capability", async () => {
  const { ConnectError, Code } = await import("@connectrpc/connect")
  for (const [reason, rpcCode, status, code] of [
    ["outcome_unknown", Code.Unavailable, 503, "mcp_personal_command_outcome_unknown"],
    ["in_progress", Code.Aborted, 409, "mcp_personal_command_in_progress"],
    ["replay_expired", Code.FailedPrecondition, 412, "mcp_personal_command_replay_expired"],
    ["identity_conflict", Code.AlreadyExists, 409, "mcp_personal_idempotency_conflict"],
  ]) {
    const f = await fixture(true, {
      check: async () => ({ ok: true }),
      mcpPersonalClient: {
        read: async () => ({}),
        prepareReceipt: async () => {
          throw new ConnectError("never parse me", rpcCode, { "x-kokoro-error-code": `command_receipt_${reason}` })
        },
      },
    })
    try {
      const response = await fetch(`${f.origin}/browser/v1/mcp/servers/server-one/prepare-receipt?expected_state_version=1`, {
        headers: { ...headers, "idempotency-key": "original-intent" },
      })
      assert.equal(response.status, status)
      const body = await response.json()
      assert.equal(body.error.code, code)
      assert.equal(Object.hasOwn(body, "data"), false)
      assert.equal(JSON.stringify(body).includes("never parse me"), false)
    } finally {
      await f.close()
    }
  }
})

test("Prepare receipt actual BFF HTTP to Native binary peer restores only the historical Get ACK and preserves expiry", async () => {
  const { connectNodeAdapter } = await import("@connectrpc/connect-node")
  const { ConnectError, Code } = await import("@connectrpc/connect")
  const { create } = await import("@bufbuild/protobuf")
  const p = await import("../dist/generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js")
  const { McpPersonalConnectClient } = await import("../dist/infrastructure/clients/platform/mcp-personal-connect.js")
  let queries = 0,
    prepares = 0,
    expired = false
  const native = createServer(
    connectNodeAdapter({
      routes: (router) =>
        router.service(p.ProductMcpPersonalService, {
          getPersonalMcpPrepareReceipt(request, context) {
            queries++
            assert.equal(request.expectedStateVersion, 1n)
            assert.equal(request.command.commandId, "original-intent")
            assert.equal(request.serverId.value, "server-one")
            assert.equal(context.requestHeader.get("x-kokoro-tenant"), "tenant-server")
            assert.equal(context.requestHeader.get("x-kokoro-subject"), "human-one")
            context.responseHeader.set("cache-control", "no-store")
            context.responseHeader.set("x-request-id", request.requestId)
            if (expired) throw new ConnectError("not visible to browser", Code.FailedPrecondition, { "x-kokoro-error-code": "command_receipt_replay_expired" })
            return {
              completed: create(p.PreparePersonalMcpServerResponseSchema, {
                server: {
                  serverId: { value: "server-one" },
                  displayName: "Historical name",
                  serverUrl: "https://tools.example/mcp",
                  status: "pending",
                  stateVersion: 2n,
                  prepareStatus: p.PersonalMcpPrepareStatus.NEEDS_OAUTH,
                  declarations: [],
                  declarationsAvailable: false,
                  availability: p.McpAvailability.UNAVAILABLE,
                },
                connector: {
                  connectorId: { value: "connector-one" },
                  serverId: { value: "server-one" },
                  connectorType: 3,
                  providerKey: "private-server-one",
                  status: 1,
                  enabled: false,
                  stateVersion: 2n,
                  approvedScopes: [],
                  availability: p.McpAvailability.UNAVAILABLE,
                },
                declarations: [],
                replayed: true,
              }),
            }
          },
          preparePersonalMcpServer() {
            prepares++
            throw Error("forbidden mutation")
          },
        }),
    }),
  )
  await new Promise((resolve) => native.listen(0, "127.0.0.1", resolve))
  const client = new McpPersonalConnectClient(`http://127.0.0.1:${native.address().port}`, { get: async () => "fixture-only" })
  const f = await fixture(true, { check: async () => ({ ok: true }), mcpPersonalClient: client })
  try {
    const request = () =>
      fetch(`${f.origin}/browser/v1/mcp/servers/server-one/prepare-receipt?expected_state_version=1`, {
        headers: { ...headers, "idempotency-key": "original-intent" },
      })
    const positive = await request()
    assert.equal(positive.status, 200)
    const body = await positive.json()
    assert.equal(body.data.completed.server.display_name, "Historical name")
    assert.equal(body.data.completed.server.state_version, "2")
    assert.equal(Object.hasOwn(body.data.completed.server, "transport"), false)
    assert.equal(body.data.completed.replayed, true)
    expired = true
    const negative = await request()
    assert.equal(negative.status, 412)
    assert.equal((await negative.json()).error.code, "mcp_personal_command_replay_expired")
    assert.equal(queries, 2)
    assert.equal(prepares, 0)
  } finally {
    await f.close()
    client.close()
    native.closeAllConnections()
    await new Promise((resolve) => native.close(resolve))
  }
})
