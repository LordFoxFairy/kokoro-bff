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
  status: "active",
  approved_scopes: [],
  enabled: true,
  state_version: "1",
}
const connection = {
  connection_id: "connection-one",
  connector_id: "connector-one",
  server_id: "server-one",
  allowed_selectors: [],
  policy_digest: "a".repeat(64),
  status: "active",
}
for (const [path, response] of [
  ["/browser/v1/mcp/providers", { items: [], next_cursor: null }],
  ["/browser/v1/mcp/connectors", { items: [connector], next_cursor: null }],
])
  test(`personal read performs one session verification and one current action check: ${path}`, async () => {
    const f = await fixture(true, {
      realSession: true,
      mcpPersonalClient: { read: async () => response },
    })
    try {
      const result = await fetch(f.origin + path, { headers })
      assert.equal(result.status, 200)
      assert.equal(f.seen.filter(({ path: ownerPath }) => ownerPath === "/internal/v1/session-authorizations/verify").length, 1)
      assert.equal(f.seen.filter(({ path: ownerPath }) => ownerPath === "/internal/v1/authorization/check").length, 1)
    } finally {
      await f.close()
    }
  })
for (const path of paths.slice(2))
  test(`personal read admitted through guard: ${path}`, async () => {
    const reads = []
    const f = await fixture(true, {
      mcpPersonalClient: {
        read: async (operation, input) => {
          reads.push({ operation, input })
          return operation === "connectors"
            ? { items: [connector], next_cursor: null }
            : operation === "connector"
              ? { connector }
              : operation === "connections"
                ? { items: [connection], next_cursor: null }
                : { connection }
        },
      },
    })
    try {
      const result = await fetch(`${f.origin}${path}`, { headers })
      assert.equal(result.status, 200)
      assert.equal(reads.length, 1)
      assert.equal(reads[0].input.tenant, "tenant-server")
      assert.equal(reads[0].input.subject, "human-one")
    } finally {
      await f.close()
    }
  })

for (const suffix of ["?limit=01", "?limit=101", "?limit=1&limit=2", "?cursor=", "?status=unknown", "?extra=yes", "?status=%20active"])
  test(`rejects closed query ${suffix} before owner`, async () => {
    let reads = 0
    const f = await fixture(true, {
      mcpPersonalClient: {
        read: async () => {
          reads++
          return {}
        },
      },
    })
    try {
      const response = await fetch(`${f.origin}/browser/v1/mcp/connectors${suffix}`, { headers })
      assert.equal(response.status, 400)
      assert.equal((await response.json()).error.code, "invalid_mcp_personal_request")
      assert.equal(reads, 0)
    } finally {
      await f.close()
    }
  })
for (const key of ["content-length", "idempotency-key"])
  test(`rejects read header ${key} without owner IO`, async () => {
    let reads = 0
    const f = await fixture(true, {
      mcpPersonalClient: {
        read: async () => {
          reads++
          return {}
        },
      },
    })
    try {
      const status = await new Promise((resolve, reject) => {
        const request = nodeRequest(
          `${f.origin}/browser/v1/mcp/connectors`,
          { headers: { ...headers, [key]: key === "content-length" ? "0" : "key" } },
          (response) => {
            response.resume()
            response.on("end", () => resolve(response.statusCode))
          },
        )
        request.on("error", reject)
        request.end()
      })
      assert.equal(status, 400)
      assert.equal(reads, 0)
    } finally {
      await f.close()
    }
  })
test("unissued personal methods and provider writes remain blocked without owner IO", async () => {
  let reads = 0
  const f = await fixture(true, {
    mcpPersonalClient: {
      read: async () => {
        reads++
        return {}
      },
    },
  })
  try {
    for (const [path, method] of [
      ["/browser/v1/mcp/connectors", "PUT"],
      ["/browser/v1/mcp/providers", "POST"],
    ]) {
      const result = await fetch(f.origin + path, { method, headers })
      assert.equal(result.status, 404)
      assert.equal((await result.json()).error.code, "route_not_found")
    }
    assert.equal(reads, 0)
  } finally {
    await f.close()
  }
})
test("returns unavailable for missing personal composition while keeping active projection separate", async () => {
  const f = await fixture(true)
  try {
    const response = await fetch(`${f.origin}/browser/v1/mcp/connectors`, { headers })
    assert.equal(response.status, 503)
    assert.equal((await response.json()).error.code, "mcp_personal_dependency_unavailable")
  } finally {
    await f.close()
  }
})
test("rechecks current action after owner read and never returns withdrawn data", async () => {
  let checks = 0
  let ownerDone = false
  const f = await fixture(true, {
    check: async () => {
      checks++
      assert.equal(ownerDone, true)
      return { ok: false, status: 403, code: "session_forbidden" }
    },
    mcpPersonalClient: {
      read: async () => {
        ownerDone = true
        return { items: [connector], next_cursor: null }
      },
    },
  })
  try {
    const response = await fetch(`${f.origin}/browser/v1/mcp/connectors`, { headers })
    assert.equal(response.status, 403)
    assert.equal((await response.json()).error.code, "session_forbidden")
    assert.equal(checks, 1)
  } finally {
    await f.close()
  }
})
test("post-owner action check remains bound to the initially admitted tenant and subject", async () => {
  let verifies = 0
  let captured
  let ownerDone = false
  const f = await fixture(true, {
    verify: async () => {
      verifies++
      return { ok: true, identity: { namespace: "tenant-server", userId: "human-one" }, platformAdmin: false }
    },
    check: async (value) => {
      assert.equal(ownerDone, true)
      captured = value
      return { ok: true }
    },
    mcpPersonalClient: {
      read: async () => {
        ownerDone = true
        return { items: [connector], next_cursor: null }
      },
    },
  })
  try {
    const response = await fetch(`${f.origin}/browser/v1/mcp/connectors`, { headers })
    assert.equal(response.status, 200)
    assert.equal(verifies, 1)
    assert.equal(captured.tenantId, "tenant-server")
    assert.equal(captured.subjectId, "human-one")
    assert.equal(captured.action, "read")
  } finally {
    await f.close()
  }
})
test("one request deadline cancels stalled owner and discards its late result", async () => {
  let ownerSignal
  let release
  const f = await fixture(true, {
    deadlineMs: 80,
    mcpPersonalClient: {
      read: async (_operation, _input, signal) => {
        ownerSignal = signal
        return new Promise((resolve) => {
          release = resolve
        })
      },
    },
  })
  try {
    const response = await fetch(`${f.origin}/browser/v1/mcp/connectors`, { headers })
    assert.equal(response.status, 503)
    assert.equal((await response.json()).error.code, "mcp_personal_dependency_unavailable")
    assert.equal(ownerSignal.aborted, true)
    release({ items: [connector], next_cursor: null })
  } finally {
    await f.close()
  }
})

test("caller disconnect cancels the personal owner read without late response", async () => {
  let ownerSignal
  let entered
  const started = new Promise((resolve) => {
    entered = resolve
  })
  const f = await fixture(true, {
    mcpPersonalClient: {
      read: async (_operation, _input, signal) => {
        ownerSignal = signal
        entered()
        return new Promise((resolve) => signal.addEventListener("abort", () => resolve({ items: [], next_cursor: null }), { once: true }))
      },
    },
  })
  try {
    const caller = new AbortController()
    const pending = fetch(`${f.origin}/browser/v1/mcp/connectors`, { headers, signal: caller.signal })
    const rejection = assert.rejects(pending)
    await started
    caller.abort()
    await rejection
    for (let i = 0; i < 20 && !ownerSignal.aborted; i++) await new Promise((resolve) => setTimeout(resolve, 5))
    assert.equal(ownerSignal.aborted, true)
  } finally {
    await f.close()
  }
})

test("post-owner current action check blocks release without repeating session verification", async () => {
  let verifies = 0
  let checks = 0
  let ownerDone = false
  let releaseCheck
  let enteredCheck
  const checkStarted = new Promise((resolve) => {
    enteredCheck = resolve
  })
  const identity = { ok: true, identity: { namespace: "tenant-server", userId: "human-one" }, platformAdmin: false }
  const f = await fixture(true, {
    verify: async () => {
      verifies++
      return identity
    },
    check: async () => {
      checks++
      assert.equal(ownerDone, true)
      enteredCheck()
      return new Promise((resolve) => {
        releaseCheck = resolve
      })
    },
    mcpPersonalClient: {
      read: async () => {
        ownerDone = true
        return { items: [connector], next_cursor: null }
      },
    },
  })
  let completed = false
  const pending = fetch(`${f.origin}/browser/v1/mcp/connectors`, { headers }).then((response) => {
    completed = true
    return response
  })
  let timeout
  try {
    await Promise.race([
      checkStarted,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error("post-owner check did not start")), 500)
      }),
    ])
    clearTimeout(timeout)
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(completed, false)
    releaseCheck({ ok: true })
    const response = await pending
    assert.equal(response.status, 200)
    assert.equal(verifies, 1)
    assert.equal(checks, 1)
  } finally {
    clearTimeout(timeout)
    await checkStarted
    releaseCheck?.({ ok: true })
    await pending
    await f.close()
  }
})

test("post-owner current action check preserves revoked session denial", async () => {
  let verifies = 0
  let checks = 0
  let ownerDone = false
  const f = await fixture(true, {
    verify: async () => {
      verifies++
      return { ok: true, identity: { namespace: "tenant-server", userId: "human-one" }, platformAdmin: false }
    },
    check: async () => {
      checks++
      assert.equal(ownerDone, true)
      return { ok: false, status: 401, code: "session_invalid" }
    },
    mcpPersonalClient: {
      read: async () => {
        ownerDone = true
        return { items: [connector], next_cursor: null }
      },
    },
  })
  try {
    const response = await fetch(`${f.origin}/browser/v1/mcp/connectors`, { headers })
    assert.equal(response.status, 401)
    assert.equal((await response.json()).error.code, "session_invalid")
    assert.equal(verifies, 1)
    assert.equal(checks, 1)
  } finally {
    await f.close()
  }
})

test("post-owner action transport failure does not leak the owner response", async () => {
  let verifies = 0
  let checks = 0
  let ownerDone = false
  const f = await fixture(true, {
    verify: async () => {
      verifies++
      return { ok: true, identity: { namespace: "tenant-server", userId: "human-one" }, platformAdmin: false }
    },
    check: async () => {
      checks++
      assert.equal(ownerDone, true)
      throw new Error("action_transport_failure")
    },
    mcpPersonalClient: {
      read: async () => {
        ownerDone = true
        return { items: [connector], next_cursor: null }
      },
    },
  })
  try {
    const response = await fetch(`${f.origin}/browser/v1/mcp/connectors`, { headers })
    assert.equal(response.status, 503)
    assert.equal((await response.json()).error.code, "mcp_personal_dependency_unavailable")
    assert.equal(verifies, 1)
    assert.equal(checks, 1)
  } finally {
    await f.close()
  }
})
