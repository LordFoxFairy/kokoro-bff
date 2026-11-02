import assert from "node:assert/strict"
import { createServer } from "node:http"
import { test } from "node:test"
import { Code, ConnectError } from "@connectrpc/connect"
import { projectMcpRecommendationsRoute } from "../src/http/routes/project-mcp-recommendations.ts"
import { startMcpRequestBudget } from "../src/http/mcp-request-budget.ts"
const context = { requestId: "request", identity: { namespace: "tenant", userId: "subject" } }
const ref = { kind: "provider", provider_key: "p" }
async function fixture(t, patch = {}) {
  const calls = { read: 0, owner: [], write: 0, access: [] }
  let state = { project_id: "project", recommendations: [], state_version: "1" }
  const services = {
    projects: {
      mcpRecommendations: async (q) => {
        calls.read++
        assert.equal(q.tenantId, "tenant")
        assert.equal(q.subjectId, "subject")
        return structuredClone(state)
      },
      replaceMcpRecommendations: async (q) => {
        calls.write++
        if (patch.beforeWrite) await patch.beforeWrite(q)
        if (q.expectedStateVersion !== state.state_version) return { kind: "precondition_failed" }
        if (JSON.stringify(q.recommendations) !== JSON.stringify(state.recommendations))
          state = { ...state, recommendations: q.recommendations, state_version: String(Number(state.state_version) + 1) }
        return { kind: "replaced", data: structuredClone(state) }
      },
    },
  }
  const clients = {
    mcpPersonalClient: {
      read: async (op, q, signal, deadline) => {
        calls.owner.push([op, q])
        if (patch.owner) return patch.owner(op, q, signal, deadline)
        return {
          provider: { provider_key: q.id, display_name: "P", directory_type: "app", category_keys: [], example_prompts: [], enabled: true, state_version: "1" },
        }
      },
    },
    customApiClient: null,
  }
  const server = createServer((req, res) => {
    startMcpRequestBudget(req, patch.budget ?? 1000)
    void projectMcpRecommendationsRoute(req, res, context, ["projects", "project", "mcp-recommendations"], { services }, clients, async (read, signal) => {
      calls.access.push(read)
      if (patch.access) return patch.access(calls.access.length, read, signal)
      return "project"
    }).catch((error) => {
      res.statusCode = 500
      res.end(String(error))
    })
  })
  await new Promise((r) => server.listen(0, "127.0.0.1", r))
  t.after(async () => {
    server.closeAllConnections()
    await new Promise((r) => server.close(r))
  })
  const base = `http://127.0.0.1:${server.address().port}/v1/projects/project/mcp-recommendations`
  const request = async (body, extra = {}) => {
    const r = await fetch(
      `${base}${extra.query ?? ""}`,
      body === undefined
        ? { headers: extra.headers ?? {} }
        : { method: "PUT", headers: { "content-type": "application/json", ...extra.headers }, body: typeof body === "string" ? body : JSON.stringify(body) },
    )
    return { status: r.status, body: await r.json(), id: r.headers.get("x-request-id") }
  }
  return {
    calls,
    request,
    set: (value) => {
      state = value
    },
    state: () => state,
  }
}
test("GET/PUT is closed scoped configuration; same values are no-op and stale CAS fails even for same values", async (t) => {
  const f = await fixture(t)
  assert.equal((await f.request()).status, 200)
  assert.deepEqual((await f.request({ expected_state_version: "1", recommendations: [ref] })).body.data, {
    project_id: "project",
    recommendations: [ref],
    state_version: "2",
  })
  const before = f.state()
  assert.equal((await f.request({ expected_state_version: "2", recommendations: [ref] })).status, 200)
  assert.deepEqual(f.state(), before)
  assert.equal(f.calls.owner.length, 1)
  assert.equal((await f.request({ expected_state_version: "1", recommendations: [ref] })).status, 412)
  assert.equal(f.calls.owner.length, 1)
  assert.equal((await f.request({ expected_state_version: "2", recommendations: [] })).body.data.state_version, "3")
  assert.equal(f.calls.owner.length, 1)
  assert.ok(f.calls.access.includes(true))
})
test("bad query/identity/duplicate JSON/command headers never enter Project or owner reads", async (t) => {
  const f = await fixture(t)
  for (const [body, extra] of [
    [{ expected_state_version: "1", recommendations: [], tenant_id: "forged" }, {}],
    ['{"expected_state_version":"1","recommendations":[],"recommendations":[]}', {}],
    [{ expected_state_version: "1", recommendations: [] }, { headers: { "idempotency-key": "forbidden" } }],
    [{ expected_state_version: "1", recommendations: [] }, { query: "?tenant_id=forged" }],
    [undefined, { headers: { "content-type": "application/json" } }],
  ])
    assert.equal((await f.request(body, extra)).status, 400)
  assert.deepEqual([f.calls.read, f.calls.write, f.calls.owner.length], [0, 0, 0])
})
test("retained lost references remain readable/removable without owner reads; only additions are validated", async (t) => {
  const f = await fixture(t, {
    owner: () => {
      throw new ConnectError("private diagnostics", Code.NotFound)
    },
  })
  f.set({ project_id: "project", recommendations: [ref], state_version: "2" })
  assert.deepEqual((await f.request()).body.data.recommendations, [ref])
  assert.equal((await f.request({ expected_state_version: "2", recommendations: [ref] })).status, 200)
  assert.equal(f.calls.owner.length, 0)
  assert.equal((await f.request({ expected_state_version: "2", recommendations: [ref, { kind: "provider", provider_key: "lost" }] })).status, 412)
  assert.equal(f.calls.write, 1)
  assert.equal((await f.request({ expected_state_version: "2", recommendations: [] })).status, 200)
})
test("owner reads hold no mutation lock; CAS drift and deadline/late owner success never override", async (t) => {
  const f = await fixture(t, { beforeWrite: () => f.set({ project_id: "project", recommendations: [], state_version: "2" }) })
  assert.equal((await f.request({ expected_state_version: "1", recommendations: [ref] })).status, 412)
  assert.equal(f.calls.owner.length, 1)
  const slow = await fixture(t, {
    budget: 20,
    owner: async () => {
      await new Promise((r) => setTimeout(r, 60))
      return {}
    },
  })
  assert.equal((await slow.request({ expected_state_version: "1", recommendations: [ref] })).status, 503)
  await new Promise((r) => setTimeout(r, 70))
  assert.equal(slow.calls.write, 0)
})
test("late owner ACK or write followed by lost current Project access is not returned as success", async (t) => {
  const f = await fixture(t, {
    access: (n) => {
      if (n >= 4) throw new ConnectError("no current access", Code.NotFound)
      return "project"
    },
  })
  assert.equal((await f.request({ expected_state_version: "1", recommendations: [ref] })).status, 404)
  assert.equal(f.calls.write, 1)
  assert.equal(f.state().state_version, "2")
})

test("current admission 401/429 retains the stable tuple rather than becoming forbidden or writable", async (t) => {
  const { ProjectMcpRecommendationsAdmissionError } = await import("../src/http/routes/project-mcp-recommendations.ts")
  for (const [status, code] of [
    [401, "session_invalid"],
    [429, "session_rate_limited"],
  ]) {
    const f = await fixture(t, {
      access: () => {
        throw new ProjectMcpRecommendationsAdmissionError(status, code, status === 429 ? "7" : undefined)
      },
    })
    const result = await f.request({ expected_state_version: "1", recommendations: [ref] })
    assert.equal(result.status, status)
    assert.equal(result.body.error.code, code)
    assert.equal(result.body.error.retryable, status === 429)
    assert.equal(f.calls.write, 0)
    assert.equal(f.calls.owner.length, 0)
  }
})

async function bootstrapFixture(t, { denyMcp = false } = {}) {
  const { createBffServer } = await import("../src/bootstrap/server.ts")
  const { DEFAULT_AGUI_CONFIG } = await import("../src/config/runtime.ts")
  const calls = { owner: [], mcp: 0, writes: 0, projects: 0 }
  let state = { project_id: "project", recommendations: [], state_version: "1" }
  const app = createBffServer(
    {
      host: "127.0.0.1",
      port: 0,
      mode: "live",
      domain: "test.localhost",
      tenantId: "tenant",
      sharedSecret: "test-secret",
      upstreamSecret: "owner-secret",
      upstreamTimeoutMs: 1000,
      upstreamMaxResponseBytes: 1048576,
      iamBaseUrl: null,
      schedulerServiceToken: null,
      schedulerTargetUrl: null,
      agentEnabled: false,
      postgresUrl: null,
      redisUrl: null,
      agUi: DEFAULT_AGUI_CONFIG,
      upstreams: { system: null, capability: null, scheduler: null, agents: null, billing: null, music: null },
    },
    {
      readiness: async () => {},
      sessionAdmission: { verify: async () => ({ ok: true, identity: { namespace: "tenant", userId: "subject" }, platformAdmin: false }) },
      mcpAuthorization: {
        check: async (input) => {
          calls.mcp++
          assert.equal(input.action, "read")
          return denyMcp ? { ok: false, status: 403, code: "session_forbidden" } : { ok: true }
        },
      },
      businessStore: {
        ready: async () => {},
        close: async () => {},
        services: {
          projects: {
            find: async (scope, id) => {
              assert.fail("recommendation bootstrap must not fall back to the unbounded legacy Project finder")
            },
            mcpRecommendations: async () => structuredClone(state),
            replaceMcpRecommendations: async (q) => {
              calls.writes++
              assert.equal(q.tenantId, "tenant")
              assert.equal(q.subjectId, "subject")
              if (q.expectedStateVersion !== state.state_version) return { kind: "precondition_failed" }
              state = { project_id: "project", recommendations: q.recommendations, state_version: String(Number(state.state_version) + 1) }
              return { kind: "replaced", data: structuredClone(state) }
            },
          },
        },
      },
      mcpPersonalClient: {
        read: async (op, q) => {
          calls.owner.push([op, q])
          return op === "provider"
            ? {
                provider: {
                  provider_key: q.id,
                  display_name: "P",
                  directory_type: "app",
                  category_keys: [],
                  example_prompts: [],
                  enabled: true,
                  state_version: "1",
                },
              }
            : {
                connector: {
                  connector_id: q.id,
                  connector_type: "mcp",
                  provider_key: "private-c",
                  status: "active",
                  approved_scopes: [],
                  enabled: true,
                  state_version: "1",
                  availability: "available",
                },
              }
        },
      },
      customApiClient: {
        execute: async (op, q) => {
          calls.owner.push([op, q])
          return {
            custom_api: {
              profile_id: q.profileId,
              name: "API",
              state_version: "1",
              environment: [],
              created_at: "2026-10-27T00:00:00Z",
              updated_at: "2026-10-27T00:00:00Z",
            },
          }
        },
      },
    },
  )
  await new Promise((r) => app.listen(0, "127.0.0.1", r))
  t.after(async () => {
    app.closeAllConnections()
    await new Promise((r) => app.close(r))
  })
  const headers = {
    "x-kokoro-service": "web-bff",
    "x-kokoro-internal-secret": "test-secret",
    authorization: "Bearer real-fixture-session",
    "x-request-id": "recommendation-bootstrap",
  }
  const request = (body, path = "/v1/projects/project/mcp-recommendations") =>
    fetch(
      `http://127.0.0.1:${app.address().port}${path}`,
      body === undefined ? { headers } : { method: "PUT", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body) },
    )
  return { request, calls }
}
test("production BFF bootstrap admits recommendation PUT through the MCP guard, validates three scoped refs, then GET reads the saved configuration", async (t) => {
  const f = await bootstrapFixture(t)
  const refs = [
    { kind: "provider", provider_key: "p" },
    { kind: "mcp_connector", connector_id: "c" },
    { kind: "custom_api", profile_id: "api" },
  ]
  const saved = await f.request({ expected_state_version: "1", recommendations: refs })
  assert.equal(saved.status, 200, "the public recommendation PUT must reach its owner route, not the legacy MCP write guard")
  assert.equal(f.calls.writes, 1)
  assert.equal(f.calls.owner.length, 3)
  assert.ok(f.calls.mcp > 0)
  const ack = await saved.json(),
    read = await f.request()
  assert.equal(read.status, 200)
  assert.deepEqual(await read.json(), ack)
  assert.equal(ack.data.state_version, "2")
  assert.equal(ack.data.recommendations.length, 3)
  for (const [, input] of f.calls.owner) {
    assert.equal(input.tenant, "tenant")
    assert.equal(input.subject, "subject")
    assert.equal(input.commandId, undefined)
  }
  const refused = await f.request({ expected_state_version: "1", recommendations: [] }, "/v1/mcp/servers")
  assert.notEqual(refused.status, 200, "excluding only the exact new route must not enable legacy MCP writes")
})
test("production BFF bootstrap keeps Custom API existing Session/owner reads independent of MCP permissions", async (t) => {
  const f = await bootstrapFixture(t, { denyMcp: true })
  const saved = await f.request({ expected_state_version: "1", recommendations: [{ kind: "custom_api", profile_id: "api" }] })
  assert.equal(saved.status, 200)
  assert.equal(f.calls.mcp, 0)
  assert.equal(f.calls.owner[0][0], "get")
  assert.equal(f.calls.writes, 1)
  const denied = await f.request({
    expected_state_version: "2",
    recommendations: [
      { kind: "custom_api", profile_id: "api" },
      { kind: "mcp_connector", connector_id: "c" },
    ],
  })
  assert.equal(denied.status, 403)
  assert.equal(f.calls.writes, 1)
  assert.equal(f.calls.owner.length, 1)
})
