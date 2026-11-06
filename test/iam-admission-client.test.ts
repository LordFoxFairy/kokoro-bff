import assert from "node:assert/strict"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import { SkillAuthorizationClient } from "../dist/auth/skill-authorization.client.js"
import { SessionAdmissionClient } from "../dist/auth/session-admission.client.js"

const tenant = "tenant-a"
const credential = "user-context-service-secret-canary-0000"
function nativeSession(overrides: Record<string, unknown> = {}) {
  return {
    session: {
      id: "SESSION_SECRET_CANARY",
      token: "TOKEN_SECRET_CANARY",
      userId: "user-a",
      activeOrganizationId: tenant,
      expiresAt: "2099-01-01T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      ipAddress: "IP_CANARY",
      userAgent: "UA_CANARY",
    },
    user: {
      id: "user-a",
      name: "User",
      email: "user@example.test",
      emailVerified: true,
      image: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      platformAdmin: true,
    },
    ...overrides,
  }
}
async function withPeer(
  fn: (request: IncomingMessage, response: ServerResponse) => void,
  run: (client: SessionAdmissionClient, requests: string[], skillClient: SkillAuthorizationClient) => Promise<void>,
) {
  const directory = await mkdtemp(path.join(tmpdir(), "bff-auth-"))
  const file = path.join(directory, "credential.json")
  await writeFile(
    file,
    JSON.stringify({
      version: 1,
      entries: [{ credential_id: "test", caller: "kokoro-bff", surface: "bff_user_context", tenant_id: tenant, secret: credential }],
    }),
    { mode: 0o600 },
  )
  const requests: string[] = []
  const server = createServer((request, response) => {
    requests.push(request.url ?? "")
    response.setHeader("content-type", "application/json")
    response.setHeader("cache-control", "no-store")
    response.setHeader("x-request-id", request.headers["x-request-id"] ?? "test")
    fn(request, response)
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  assert.ok(address && typeof address !== "string")
  try {
    await run(
      new SessionAdmissionClient({
        baseUrl: `http://127.0.0.1:${address.port}`,
        credentialFile: file,
        tenantId: tenant,
        webOrigin: "https://app.example.test",
        timeoutMs: 500,
        maxResponseBytes: 8192,
      }),
      requests,
      new SkillAuthorizationClient({
        baseUrl: `http://127.0.0.1:${address.port}`,
        credentialFile: file,
        tenantId: tenant,
        timeoutMs: 500,
        maxResponseBytes: 8192,
      }),
    )
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(directory, { recursive: true, force: true })
  }
}
const input = () => ({
  cookie: "__Secure-kokoro-issuer.session_token=COOKIE_CANARY",
  origin: "https://app.example.test",
  requestId: "test-auth",
  signal: new AbortController().signal,
})
function membership(request: IncomingMessage, response: ServerResponse) {
  assert.equal(request.headers.authorization, `Bearer ${credential}`)
  assert.equal(request.headers["x-kokoro-actor-id"], "user-a")
  assert.equal(request.headers.cookie, undefined)
  assert.equal(request.headers.origin, undefined)
  response.end(JSON.stringify({ data: { allowed: true, tenant_id: tenant, subject_id: "user-a", decision_source: "current_membership" } }))
}

test("official session is read fresh, membership uses service+actor, and only real safe facts survive", async () => {
  await withPeer(
    (request, response) => {
      if (request.url?.startsWith("/iam/get-session")) {
        assert.equal(request.method, "GET")
        assert.equal(request.url, "/iam/get-session?disableCookieCache=true&disableRefresh=true")
        assert.equal(request.headers.cookie, input().cookie)
        assert.equal(request.headers.authorization, undefined)
        response.setHeader("set-auth-jwt", "JWT_SECRET_CANARY")
        response.end(JSON.stringify(nativeSession()))
      } else membership(request, response)
    },
    async (client, requests) => {
      const result = await client.verify(input())
      assert.deepEqual(result, {
        ok: true,
        identity: { namespace: tenant, userId: "user-a" },
        platformAdmin: true,
        expiresAt: "2099-01-01T00:00:00.000Z",
        setCookies: [],
      })
      assert.equal(requests.length, 2)
      assert.doesNotMatch(JSON.stringify(result), /SECRET_CANARY|IP_CANARY|UA_CANARY|COOKIE_CANARY/)
    },
  )
})

test("explicit anonymous and wrong tenant remain distinct from corrupt facts and dependency failure", async () => {
  const cases = [
    { body: null, status: 200, expected: 401 },
    { body: nativeSession({ session: { ...nativeSession().session, activeOrganizationId: "other" } }), status: 200, expected: 403 },
    { body: nativeSession({ session: { ...nativeSession().session, userId: "other" } }), status: 200, expected: 503 },
    { body: nativeSession({ user: { ...nativeSession().user, platformAdmin: undefined } }), status: 200, expected: 503 },
    { body: { error: "outage" }, status: 500, expected: 503 },
  ]
  for (const value of cases)
    await withPeer(
      (_request, response) => {
        response.statusCode = value.status
        response.end(JSON.stringify(value.body))
      },
      async (client) => {
        const result = await client.verify(input())
        assert.equal(result.ok, false)
        if (!result.ok) assert.equal(result.status, value.expected)
      },
    )
})

test("service denial never becomes human logout, and normal status refresh preserves separate safe cookies", async () => {
  let serviceDenied = true
  await withPeer(
    (request, response) => {
      if (request.url?.startsWith("/iam/get-session")) {
        assert.equal(request.url, "/iam/get-session?disableCookieCache=true")
        response.setHeader("set-cookie", [
          "__Secure-kokoro-issuer.session_token=fresh; Path=/; HttpOnly; Secure; SameSite=Lax",
          "__Secure-kokoro-issuer.session_data=gone; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
        ])
        response.end(JSON.stringify(nativeSession()))
      } else if (serviceDenied) {
        response.statusCode = 401
        response.end(JSON.stringify({ error: { code: "UNAUTHENTICATED", message: "bad service", details: [] } }))
      } else membership(request, response)
    },
    async (client) => {
      const denied = await client.verify({ ...input(), refresh: true })
      assert.equal(denied.ok, false)
      if (!denied.ok) {
        assert.equal(denied.status, 503)
        assert.equal(denied.setCookies?.length, 2, "rolling cookies survive later membership dependency failure")
      }
      serviceDenied = false
      const allowed = await client.verify({ ...input(), refresh: true })
      assert.equal(allowed.ok, true)
      if (allowed.ok) assert.equal(allowed.setCookies.length, 2)
    },
  )
})

test("official human401 requires its declared shape; arbitrary401 is not a logout oracle", async () => {
  for (const [body, expected] of [
    [{ message: "Session missing", code: "UNAUTHORIZED" }, 401],
    [{ error: "not an official human error" }, 503],
  ] as const) {
    await withPeer(
      (_request, response) => {
        response.statusCode = 401
        response.end(JSON.stringify(body))
      },
      async (client) => {
        const result = await client.verify(input())
        assert.equal(result.ok, false)
        if (!result.ok) assert.equal(result.status, expected)
      },
    )
  }
})

test("native transport bounds raw bytes, cancellation and redirects without a late success or retry", async () => {
  await withPeer(
    (_request, response) => {
      response.end(JSON.stringify({ padding: "x".repeat(9000) }))
    },
    async (client, requests) => {
      const result = await client.verify(input())
      assert.equal(result.ok, false)
      if (!result.ok) assert.equal(result.status, 503)
      assert.equal(requests.length, 1)
    },
  )
  await withPeer(
    (_request, response) => {
      response.statusCode = 302
      response.setHeader("location", "/must-not-follow")
      response.end("{}")
    },
    async (client, requests) => {
      const result = await client.verify(input())
      assert.equal(result.ok, false)
      assert.equal(requests.length, 1)
    },
  )
  await withPeer(
    (_request, response) => {
      response.flushHeaders()
    },
    async (client, requests) => {
      const abort = new AbortController()
      const result = client.verify({ ...input(), signal: abort.signal })
      setTimeout(() => abort.abort(), 10)
      const denied = await result
      assert.equal(denied.ok, false)
      if (!denied.ok) assert.equal(denied.status, 503)
      assert.equal(requests.length, 1)
    },
  )
})

const skillInput = () => ({ tenantId: tenant, subjectId: "user-a", action: "install" as const, requestId: "skill-check", signal: new AbortController().signal })
function assertSkillWire(request: IncomingMessage) {
  assert.equal(request.url, `/internal/v1/tenants/${tenant}/skill-authorizations/check`)
  assert.equal(request.method, "POST")
  assert.equal(request.headers.authorization, `Bearer ${credential}`)
  assert.equal(request.headers["x-kokoro-actor-id"], "user-a")
  assert.equal(request.headers["x-request-id"], "skill-check")
  assert.equal(request.headers.cookie, undefined)
  assert.equal(request.headers.origin, undefined)
  assert.equal(request.headers["x-kokoro-tenant-id"], undefined)
}

test("real generated Skill client binds service+actor to the requested tenant, subject and action without browser secrets", async () => {
  const seen: unknown[] = []
  await withPeer(
    (request, response) => {
      assertSkillWire(request)
      void (async () => {
        const chunks = []
        for await (const chunk of request) chunks.push(chunk)
        const body = JSON.parse(Buffer.concat(chunks).toString())
        assert.deepEqual(Object.keys(body), ["action"])
        seen.push(body)
        response.setHeader("set-auth-jwt", "JWT_SECRET_CANARY")
        response.end(JSON.stringify({ data: { allowed: true, tenant_id: tenant, subject_id: "user-a", action: body.action } }))
      })()
    },
    async (_session, requests, client) => {
      for (const action of ["create_draft", "install", "admin_read"] as const) {
        const result = await client.check({ ...skillInput(), action })
        assert.deepEqual(result, { ok: true })
        assert.doesNotMatch(JSON.stringify(result), /SECRET_CANARY|secret|TOKEN|COOKIE|JWT/)
      }
      assert.deepEqual(seen, [{ action: "create_draft" }, { action: "install" }, { action: "admin_read" }])
      assert.equal(requests.length, 3)
    },
  )
})

test("real Skill client rejects foreign or non-strict decisions and accepts only declared error status/code tuples", async () => {
  const unavailable = { ok: false, status: 503, code: "iam_admission_unavailable" }
  const allowed = { allowed: true, tenant_id: tenant, subject_id: "user-a", action: "install" }
  const error = (code: string) => ({ error: { code, message: "OWNER_SECRET_CANARY", retryable: false, details: [] } })
  const cases = [
    ["foreign tenant", 200, { data: { ...allowed, tenant_id: "other" } }, unavailable],
    ["foreign subject", 200, { data: { ...allowed, subject_id: "other" } }, unavailable],
    ["different action", 200, { data: { ...allowed, action: "admin_read" } }, unavailable],
    ["false is not success", 200, { data: { ...allowed, allowed: false } }, unavailable],
    ["nested secret", 200, { data: { ...allowed, token: "TOKEN_SECRET_CANARY" } }, unavailable],
    ["root secret", 200, { data: allowed, token: "TOKEN_SECRET_CANARY" }, unavailable],
    ["service401", 401, error("bff_user_context_service_unauthenticated"), unavailable],
    ["old401", 401, error("UNAUTHENTICATED"), unavailable],
    ["denied403", 403, error("PERMISSION_DENIED"), { ok: false, status: 403, code: "skill_forbidden" }],
    ["limited429", 429, error("RATE_LIMITED"), { ok: false, status: 429, code: "skill_rate_limited" }],
    ["wrong deny tuple", 401, error("PERMISSION_DENIED"), unavailable],
    ["wrong rate tuple", 403, error("RATE_LIMITED"), unavailable],
    ["strict error", 403, { error: { ...error("PERMISSION_DENIED").error, token: "TOKEN_SECRET_CANARY" } }, unavailable],
    ["missing error fact", 403, { error: { code: "PERMISSION_DENIED", message: "OWNER_SECRET_CANARY", details: [] } }, unavailable],
    ["unknown error", 403, error("UNDECLARED"), unavailable],
  ] as const
  let next = 0
  await withPeer(
    (request, response) => {
      assertSkillWire(request)
      request.resume()
      const value = cases[next++]!
      response.statusCode = value[1]
      response.end(JSON.stringify(value[2]))
    },
    async (_session, requests, client) => {
      for (const [label, _status, _body, expected] of cases) {
        const result = await client.check(skillInput())
        assert.deepEqual(result, expected, label)
        assert.doesNotMatch(JSON.stringify(result), /SECRET_CANARY|user-a|tenant-a/)
      }
      assert.equal(requests.length, cases.length, "no native Session request, fallback or automatic replay")
      for (const invalid of [
        { ...skillInput(), tenantId: "other" },
        { ...skillInput(), subjectId: "bad actor" },
        { ...skillInput(), action: "not_an_action" as "install" },
      ])
        assert.deepEqual(await client.check(invalid), unavailable)
      assert.equal(requests.length, cases.length, "invalid context is rejected before owner I/O")
    },
  )
})

test("core tenant qualification accepts only strict owner error status/code tuples and bounded retry hints", async (t) => {
  const error = (code: string) => ({ error: { code, message: "MEMBERSHIP_SECRET_CANARY", retryable: code === "RATE_LIMITED", details: [] } })
  const unavailable = { ok: false, status: 503, code: "iam_admission_unavailable" }
  const forbidden = { ok: false, status: 403, code: "session_forbidden", setCookies: [] }
  const limited = { ok: false, status: 429, code: "session_rate_limited", setCookies: [] }
  const cases = [
    ["declared forbidden", 403, error("PERMISSION_DENIED"), undefined, forbidden],
    ["declared limit lower bound", 429, error("RATE_LIMITED"), "1", { ...limited, retryAfter: "1" }],
    ["declared limit upper bound", 429, error("RATE_LIMITED"), "86400", { ...limited, retryAfter: "86400" }],
    ["oversized retry hint omitted", 429, error("RATE_LIMITED"), "86401", limited],
    ["service401 code at wrong403", 403, error("bff_user_context_service_unauthenticated"), undefined, unavailable],
    ["empty envelope at429", 429, {}, "1", unavailable],
    ["empty body at429", 429, undefined, "1", unavailable],
    ["rate code at wrong403", 403, error("RATE_LIMITED"), undefined, unavailable],
    ["permission code at wrong429", 429, error("PERMISSION_DENIED"), "1", unavailable],
    ["extra secret at429", 429, { error: { ...error("RATE_LIMITED").error, token: "TOKEN_SECRET_CANARY" } }, "1", unavailable],
    ["missing required fact at429", 429, { error: { code: "RATE_LIMITED", message: "MEMBERSHIP_SECRET_CANARY", details: [] } }, "1", unavailable],
  ] as const
  for (const [label, status, body, retryAfter, expected] of cases) {
    await t.test(label, async () => {
      await withPeer(
        (request, response) => {
          if (request.url?.startsWith("/iam/get-session")) {
            assert.equal(request.url, "/iam/get-session?disableCookieCache=true&disableRefresh=true")
            response.end(JSON.stringify(nativeSession()))
            return
          }
          assert.equal(request.url, "/internal/v1/authorization/check")
          assert.equal(request.headers.authorization, `Bearer ${credential}`)
          assert.equal(request.headers["x-kokoro-actor-id"], "user-a")
          assert.equal(request.headers.cookie, undefined)
          assert.equal(request.headers.origin, undefined)
          response.statusCode = status
          if (retryAfter !== undefined) response.setHeader("retry-after", retryAfter)
          response.end(body === undefined ? "" : JSON.stringify(body))
        },
        async (client, requests) => {
          const result = await client.verify(input())
          assert.deepEqual(result, expected)
          assert.doesNotMatch(JSON.stringify(result), /SECRET_CANARY|user-a|tenant-a/)
          assert.equal(requests.length, 2, "one framework authentication and one core qualification; no fallback or retry")
        },
      )
    })
  }
})
