import { startMcpRequestBudget } from "../dist/http/mcp-request-budget.js"
import assert from "node:assert/strict"
import { createServer } from "node:http"
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
  "/v1/self/mcp/connectors",
  "/v1/self/mcp/connectors/connector-one",
  "/v1/self/mcp/connectors/connector-one/connections",
  "/v1/self/mcp/connections/connection-one",
]
async function fixture(decision, { realSession = false, check, routeHandler, deadlineMs, sessionDelayMs = 0 } = {}) {
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
            verify: async () => {
              if (sessionDelayMs) await new Promise((resolve) => setTimeout(resolve, sessionDelayMs))
              return {
                ok: true,
                identity: { namespace: "tenant-server", userId: "human-one" },
                platformAdmin: false,
              }
            },
          },
        }),
    ...(check ? { mcpAuthorization: { check } } : {}),
    ...(routeHandler ? { routeHandler } : {}),
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
test("R357 HTTP current human false decision denies all six MCP reads before owner IO", async () => {
  const f = await fixture(false)
  try {
    for (const path of paths) {
      const response = await fetch(f.origin + path, { headers })
      assert.equal(response.status, 403, path)
      assert.equal(response.headers.get("cache-control"), "no-store")
      assert.equal((await response.json()).error.code, "session_forbidden")
    }
    assert.equal(f.seen.length, paths.length)
    for (const seen of f.seen)
      assert.deepEqual(seen, {
        path: "/internal/v1/authorization/check",
        authorization: "Bearer human-session",
        body: { resource: "mcp_personal", action: "read" },
      })
  } finally {
    await f.close()
  }
})
test("R357 HTTP authorized personal reads without composition and unimplemented MCP mutations remain explicit 503", async () => {
  const f = await fixture(true)
  try {
    for (const path of paths.slice(2)) {
      const response = await fetch(f.origin + path, { headers })
      assert.equal(response.status, 503, path)
      assert.equal(response.headers.get("cache-control"), "no-store")
      assert.equal((await response.json()).error.code, "mcp_personal_dependency_unavailable")
    }
    const response = await fetch(f.origin + "/v1/self/mcp/connectors", {
      method: "POST",
      headers: {
        ...headers,
        "content-type": "application/json",
        "idempotency-key": "mcp-create-intent",
      },
      body: "{}",
    })
    assert.equal(response.status, 503)
    assert.equal((await response.json()).error.code, "platform_operation_not_available")
    assert.deepEqual(f.seen.at(-1).body, {
      resource: "mcp_personal",
      action: "manage",
    })
  } finally {
    await f.close()
  }
})

test("R357 HTTP real session then human MCP check preserves bearer and current identity", async () => {
  const f = await fixture(false, { realSession: true })
  try {
    const response = await fetch(f.origin + paths[0], { headers })
    assert.equal(response.status, 403)
    assert.equal((await response.json()).error.code, "session_forbidden")
    assert.deepEqual(
      f.seen.map((item) => item.path),
      ["/internal/v1/session-authorizations/verify", "/internal/v1/authorization/check"],
    )
    assert.equal(f.seen[0].body, null)
    assert.deepEqual(f.seen[1].body, {
      resource: "mcp_personal",
      action: "read",
    })
    assert.ok(f.seen.every((item) => item.authorization === "Bearer human-session"))
    const missing = await fetch(f.origin + paths[0], {
      headers: {
        "x-kokoro-service": "web-bff",
        "x-kokoro-internal-secret": "test-secret",
      },
    })
    assert.equal(missing.status, 401)
    assert.equal(f.seen.length, 2)
  } finally {
    await f.close()
  }
})
test("R357 HTTP disconnect cancels MCP human check and a late success reaches no owner route", async () => {
  let started,
    finish,
    checkSignal,
    ownerCalls = 0
  const ready = new Promise((resolve) => {
    started = resolve
  })
  const pending = new Promise((resolve) => {
    finish = resolve
  })
  const f = await fixture(true, {
    check: async (input) => {
      checkSignal = input.signal
      started()
      return pending
    },
    routeHandler: async () => {
      ownerCalls++
      return { status: 200, body: { data: {} } }
    },
  })
  try {
    const controller = new AbortController()
    const request = fetch(f.origin + paths[0], {
      headers,
      signal: controller.signal,
    })
    await ready
    controller.abort()
    await assert.rejects(request)
    await new Promise((resolve) => setTimeout(resolve, 10))
    assert.equal(checkSignal.aborted, true)
    finish({ ok: true })
    await new Promise((resolve) => setTimeout(resolve, 10))
    assert.equal(ownerCalls, 0)
  } finally {
    await f.close()
  }
})
test("R357 HTTP session and MCP check share one entrance deadline and late action cannot reach owner", async () => {
  let checkSignal,
    ownerCalls = 0
  const f = await fixture(true, {
    deadlineMs: 60,
    sessionDelayMs: 20,
    check: async (input) => {
      checkSignal = input.signal
      await new Promise((resolve) => setTimeout(resolve, 65))
      return { ok: true }
    },
    routeHandler: async () => {
      ownerCalls++
      return { status: 200, body: { data: {} } }
    },
  })
  try {
    const response = await fetch(f.origin + paths[0], { headers })
    assert.equal(response.status, 503)
    assert.equal((await response.json()).error.code, "iam_admission_unavailable")
    assert.equal(checkSignal.aborted, true)
    await new Promise((resolve) => setTimeout(resolve, 65))
    assert.equal(ownerCalls, 0)
  } finally {
    await f.close()
  }
})
