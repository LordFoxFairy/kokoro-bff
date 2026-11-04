import "reflect-metadata"
import assert from "node:assert/strict"
import { once } from "node:events"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { setTimeout as sleep } from "node:timers/promises"
import { Test } from "@nestjs/testing"
import { BFF_CONFIG, BFF_DATABASE, MCP_PERSONAL_CLIENT } from "../dist/common/tokens.js"
import { DEFAULT_AGUI_CONFIG } from "../dist/config/runtime.js"
import { startMcpRequestBudget } from "../dist/http/mcp-request-budget.js"
import { BFF_NEST_APPLICATION_OPTIONS } from "../dist/main.js"
import { McpModule } from "../dist/modules/mcp/mcp.module.js"
import { fixtureIamCredentials, TEST_IAM_USER_CONTEXT_SECRET } from "./doubles/iam-credentials.ts"
import { fixtureNativeSession } from "./doubles/iam-native-session.ts"

const tenant = "123e4567-e89b-42d3-a456-426614174000"
const subject = "human-one"
const iamCredentials = await fixtureIamCredentials(tenant)
const ownerSecret = "fixture-platform-projection-" + "b".repeat(40)
const nativeSessionPath = "/iam/get-session?disableCookieCache=true&disableRefresh=true"
const authorizationPath = "/internal/v1/authorization/check"
const headers = {
  "x-kokoro-service": "web-bff",
  "x-kokoro-internal-secret": "test-secret",
  cookie: "kokoro-issuer.session_token=human-session",
  origin: "https://web.example.test",
  "x-request-id": "mcp-http-1",
}
const publicPaths = ["/v1/mcp/servers", "/v1/mcp/connections"]
const privatePaths = [
  ["/browser/v1/mcp/connectors", "connectors"],
  ["/browser/v1/mcp/connectors/connector-one", "connector"],
  ["/browser/v1/mcp/connectors/connector-one/connections", "connections"],
  ["/browser/v1/mcp/connections/connection-one", "connection"],
]
const connector = {
  availability: "unavailable",
  connector_id: "connector-one",
  connector_type: "mcp",
  provider_key: "provider-one",
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
const privateResults = {
  connectors: { items: [connector], next_cursor: null },
  connector: { connector },
  connections: { items: [connection], next_cursor: null },
  connection: { connection },
}
const mutation = {
  method: "POST",
  headers: { ...headers, "content-type": "application/json", "idempotency-key": "mcp-create-intent" },
  body: "{}",
}

async function listen(server) {
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  return `http://127.0.0.1:${server.address().port}`
}

async function close(server) {
  if (!server.listening) return
  server.closeAllConnections()
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
}

function reply(request, response, status, body, extra = {}) {
  if (response.destroyed || response.writableEnded) return
  response.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
    "x-request-id": request.headers["x-request-id"] ?? headers["x-request-id"],
    ...extra,
  })
  response.end(JSON.stringify(body))
}

async function fixture(t, { decision = "allow", privateClient, hold, deadlineMs, sessionDelayMs = 0, releaseAfterMs } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "bff-r357-mcp-"))
  const projectionCredential = join(directory, "projection.json")
  const events = []
  const held = Promise.withResolvers()
  let app
  const iam = createServer((request, response) => {
    void handleIam(request, response).catch((error) => {
      events.push({ stage: "unexpected_iam_error", error: String(error) })
      reply(request, response, 500, {})
    })
  })
  const platform = createServer((request, response) => {
    const path = new URL(request.url ?? "", "http://fixture.invalid").pathname
    const kind = path === publicPaths[1] ? "connections" : "servers"
    events.push({
      stage: "owner",
      path,
      method: request.method,
      credentialSeparate:
        request.headers.authorization === `Bearer ${ownerSecret}` && request.headers.cookie === undefined && request.headers.origin === undefined,
      tenant: request.headers["x-kokoro-tenant-id"],
      subject: request.headers["x-kokoro-subject"],
      requestId: request.headers["x-kokoro-request-id"],
    })
    reply(request, response, 200, { data: { [kind]: [] } }, { "x-kokoro-request-id": request.headers["x-kokoro-request-id"] ?? "missing" })
  })
  t.after(async () => {
    try {
      if (app) {
        app.getHttpServer().closeAllConnections()
        await app.close()
      }
    } finally {
      try {
        await Promise.all([close(iam), close(platform)])
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    }
  })

  async function stageReply(stage, response, send) {
    if (stage !== hold) {
      if (stage === "session" && sessionDelayMs) await sleep(sessionDelayMs)
      send()
      return
    }
    let sent = false
    const closed = Promise.withResolvers()
    response.once("close", () => closed.resolve(!sent))
    const release = () => {
      if (response.destroyed || response.writableEnded) return
      sent = true
      send()
    }
    held.resolve({ closed: closed.promise, release })
    if (releaseAfterMs !== undefined) {
      await Promise.race([closed.promise, sleep(releaseAfterMs, undefined, { ref: false })])
      release()
    }
  }

  async function handleIam(request, response) {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const body = chunks.length === 0 ? null : JSON.parse(Buffer.concat(chunks).toString("utf8"))
    const h = request.headers
    if (request.method === "GET" && request.url === nativeSessionPath) {
      events.push({
        stage: "session",
        cookieOnly: h.cookie === headers.cookie && h.origin === headers.origin && h.authorization === undefined && h["x-kokoro-actor-id"] === undefined,
        body,
      })
      await stageReply("session", response, () => {
        if (decision === "session-limited") {
          reply(request, response, 429, { message: "limited" }, { "retry-after": "60" })
          return
        }
        reply(request, response, 200, fixtureNativeSession(tenant, subject))
      })
      return
    }
    const stage = `${body?.resource}/${body?.action}`
    if (request.method !== "POST" || request.url !== authorizationPath || !["tenant/read", "mcp_personal/read", "mcp_personal/manage"].includes(stage)) {
      events.push({ stage: "unexpected_iam_request", method: request.method, path: request.url })
      reply(request, response, 404, {})
      return
    }
    events.push({
      stage,
      body,
      serviceOnly:
        h.cookie === undefined && h.origin === undefined && h.authorization === `Bearer ${TEST_IAM_USER_CONTEXT_SECRET}` && h["x-kokoro-actor-id"] === subject,
    })
    await stageReply(stage, response, () => {
      if (stage !== "tenant/read" && decision === "limited") {
        reply(request, response, 429, { error: { code: "RATE_LIMITED", message: "limited", retryable: true, details: [] } }, { "retry-after": "60" })
        return
      }
      reply(request, response, 200, {
        data: { allowed: stage === "tenant/read" || decision === "allow", tenant_id: tenant, subject_id: subject, decision_source: "current_membership" },
      })
    })
  }

  await writeFile(
    projectionCredential,
    JSON.stringify({
      version: 1,
      entries: [{ credential_id: "projection-fixture", caller: "kokoro-bff", surfaces: ["projection"], tenant_id: tenant, secret: ownerSecret }],
    }),
    { mode: 0o600, flag: "wx" },
  )
  const config = {
    ...iamCredentials,
    host: "127.0.0.1",
    port: 0,
    mode: "live",
    domain: "dev.kokoro.localhost",
    tenantId: tenant,
    iamBaseUrl: await listen(iam),
    iamWebOrigin: headers.origin,
    sharedSecret: headers["x-kokoro-internal-secret"],
    upstreamSecret: null,
    upstreamTimeoutMs: 2000,
    upstreamMaxResponseBytes: 1024 * 1024,
    schedulerServiceToken: null,
    schedulerTargetUrl: null,
    agentEnabled: false,
    postgresUrl: null,
    redisUrl: null,
    agUi: DEFAULT_AGUI_CONFIG,
    upstreams: {},
    platformProjection: { baseUrl: await listen(platform), credentialFile: projectionCredential, timeoutMs: 2000 },
  }
  const unexpected = () => assert.fail("R357 MCP HTTP must not access BFF storage")
  const builder = Test.createTestingModule({ imports: [McpModule] })
    .overrideProvider(BFF_CONFIG)
    .useValue(config)
    .overrideProvider(BFF_DATABASE)
    .useValue({ pool: { query: unexpected, connect: unexpected }, ready: unexpected })
  if (privateClient !== undefined) builder.overrideProvider(MCP_PERSONAL_CLIENT).useValue(privateClient(events))
  const module = await builder.compile()
  app = module.createNestApplication({ ...BFF_NEST_APPLICATION_OPTIONS, abortOnError: false, logger: false })
  if (deadlineMs !== undefined)
    app.use((request, _response, next) => {
      startMcpRequestBudget(request, deadlineMs)
      next()
    })
  await app.listen(0, "127.0.0.1")
  const base = await app.getUrl()
  return {
    events,
    held: held.promise,
    request: (path, init = {}) => fetch(base + path, { headers, signal: AbortSignal.timeout(3000), ...init }),
  }
}

const session = { stage: "session", cookieOnly: true, body: null }
const tenantRead = { stage: "tenant/read", serviceOnly: true, body: { resource: "tenant", action: "read" } }
const mcpCheck = (action) => ({ stage: `mcp_personal/${action}`, serviceOnly: true, body: { resource: "mcp_personal", action } })
const admittedRead = [session, tenantRead, mcpCheck("read")]

async function publicDenial(response, status, code, retryAfter = null) {
  const body = await response.json()
  assert.equal(response.status, status, JSON.stringify(body))
  assert.deepEqual(body, { error: { code, message: "BFF user admission failed", retryable: status === 429 || status === 503 } })
  assert.equal(response.headers.get("cache-control"), "no-store")
  assert.equal(response.headers.get("x-request-id"), headers["x-request-id"])
  assert.equal(response.headers.get("retry-after"), retryAfter)
}

test("R357 public MCP denial and rate limiting happen before either Platform read", async (t) => {
  await t.test("native Session rate limit stops before membership", async (t) => {
    const f = await fixture(t, { decision: "session-limited" })
    await publicDenial(await f.request(publicPaths[0]), 429, "session_rate_limited", "60")
    assert.deepEqual(f.events, [session])
  })
  for (const [decision, status, code, retryAfter] of [
    ["deny", 403, "session_forbidden", null],
    ["limited", 429, "session_rate_limited", "60"],
  ]) {
    const f = await fixture(t, { decision })
    for (const path of publicPaths) {
      await t.test(`${decision} ${path}`, async () => {
        f.events.length = 0
        const response = await f.request(path)
        assert.deepEqual(f.events, admittedRead, "current action denial must reach IAM, never Platform")
        await publicDenial(response, status, code, retryAfter)
      })
    }
  }
})

test("R357 browser-private reads authorize after owner and missing composition remains explicit", async (t) => {
  const denied = await fixture(t, {
    decision: "deny",
    privateClient: (events) => ({
      read: async (operation, input) => {
        events.push({ stage: "private-read", operation, tenant: input.tenant, subject: input.subject })
        return privateResults[operation]
      },
      command: async () => {
        events.push({ stage: "private-command" })
        assert.fail("denied manage must not reach a Platform command")
      },
    }),
  })
  for (const [path, operation] of privatePaths) {
    denied.events.length = 0
    const response = await denied.request(path)
    assert.equal(response.status, 403, path)
    assert.equal(response.headers.get("cache-control"), "no-store")
    assert.deepEqual(await response.json(), { error: { code: "session_forbidden", message: "Personal MCP request failed", retryable: false } })
    assert.deepEqual(denied.events.slice(0, 3), [session, tenantRead, { stage: "private-read", operation, tenant, subject }])
    assert.deepEqual(
      denied.events.slice(3).sort((a, b) => a.stage.localeCompare(b.stage)),
      [mcpCheck("read"), session, tenantRead],
    )
  }
  denied.events.length = 0
  const rejectedMutation = await denied.request(privatePaths[0][0], mutation)
  assert.equal(rejectedMutation.status, 403)
  assert.equal((await rejectedMutation.json()).error.code, "session_forbidden")
  assert.deepEqual(denied.events, [session, tenantRead, mcpCheck("manage")])

  const unconfigured = await fixture(t)
  for (const [path, init] of [...privatePaths.map(([path]) => [path]), [privatePaths[0][0], mutation]]) {
    unconfigured.events.length = 0
    const response = await unconfigured.request(path, init)
    assert.equal(response.status, 503, path)
    assert.equal(response.headers.get("cache-control"), "no-store")
    assert.equal((await response.json()).error.code, "mcp_personal_dependency_unavailable")
    assert.deepEqual(unconfigured.events, [session, tenantRead])
  }
})

test("R357 public MCP preserves native Session and separate service-only action and Platform wire", async (t) => {
  const f = await fixture(t)
  const { cookie: _cookie, ...missingCookie } = headers
  for (const path of publicPaths) {
    await t.test(path, async () => {
      f.events.length = 0
      await publicDenial(await f.request(path, { headers: missingCookie }), 401, "session_authentication_required")
      await publicDenial(await f.request(path, { headers: { ...headers, origin: "https://wrong.example.test" } }), 403, "session_forbidden")
      assert.deepEqual(f.events, [], "missing Cookie or wrong Origin must not reach IAM or Platform")
      const response = await f.request(path)
      const kind = path.split("/").at(-1)
      const body = await response.json()
      assert.equal(response.status, 200, JSON.stringify(body))
      assert.deepEqual(body, { data: { [kind]: [] } })
      assert.equal(response.headers.get("cache-control"), "no-store")
      assert.equal(response.headers.get("x-request-id"), headers["x-request-id"])
      assert.deepEqual(f.events, [
        ...admittedRead,
        { stage: "owner", path, method: "GET", credentialSeparate: true, tenant, subject, requestId: headers["x-request-id"] },
      ])
    })
  }
})

test("R357 public MCP disconnect aborts real IAM transport and a late success cannot reach Platform", async (t) => {
  for (const stage of ["session", "mcp_personal/read"]) {
    await t.test(stage, async (t) => {
      const f = await fixture(t, { hold: stage })
      const caller = new AbortController()
      t.after(() => caller.abort())
      const pending = f
        .request(publicPaths[1], { signal: AbortSignal.any([caller.signal, AbortSignal.timeout(3000)]) })
        .then(async (response) => {
          await response.arrayBuffer()
          return { status: response.status }
        })
        .catch((error) => ({ error }))
      const started = await Promise.race([f.held, pending, sleep(1500, null, { ref: false })])
      assert.equal(typeof started?.release, "function", `expected held IAM stage, got ${JSON.stringify(started)}`)
      caller.abort()
      assert.equal((await pending).error?.name, "AbortError")
      const closedBeforeRelease = await Promise.race([started.closed, sleep(300, false, { ref: false })])
      started.release()
      if (!closedBeforeRelease) await sleep(100)
      assert.deepEqual(f.events, stage === "session" ? [session] : admittedRead, "late success must not advance admission or reach Platform")
      assert.equal(closedBeforeRelease, true, "caller disconnect must close the held IAM peer before it replies")
    })
  }
})

test("R357 public MCP shares one entrance deadline across real Session and action transport", async (t) => {
  for (const [stage, deadlineMs, sessionDelayMs, releaseAfterMs] of [
    ["session", 300, 0, 550],
    ["mcp_personal/read", 700, 350, 550],
  ]) {
    await t.test(stage, async (t) => {
      const f = await fixture(t, { hold: stage, deadlineMs, sessionDelayMs, releaseAfterMs })
      const response = await f.request(publicPaths[1])
      await publicDenial(response, 503, "iam_admission_unavailable")
      const started = await Promise.race([f.held, sleep(125, null, { ref: false })])
      assert.ok(started, "expected held IAM stage")
      assert.equal(await Promise.race([started.closed, sleep(125, false, { ref: false })]), true, "entrance deadline must abort held IAM before its reply")
      assert.deepEqual(f.events, stage === "session" ? [session] : admittedRead, "deadline must prevent remaining admission or Platform work")
    })
  }
})
