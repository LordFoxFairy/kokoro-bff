import assert from "node:assert/strict"
import { createServer, request as httpRequest, type IncomingMessage, type Server } from "node:http"
import { afterEach, test } from "node:test"
import { setImmediate as immediate } from "node:timers/promises"

import { DEFAULT_AGUI_CONFIG } from "../dist/config/runtime.js"
import type { SessionAdmission } from "../src/auth/session-admission.types.ts"
import type { BffConfig } from "../src/config/runtime.ts"
import { startAccountTestApp } from "./doubles/account-app.ts"
import { fixtureIamCredentials, TEST_IAM_USER_CONTEXT_SECRET } from "./doubles/iam-credentials.ts"
import { fixtureSessionCookie, fixtureSessionHeaders, TEST_WEB_ORIGIN } from "./doubles/session-admission.ts"
import { readIamAuditEvents } from "../src/infrastructure/clients/iam-audit-events.ts"

const servers: Server[] = []
const tenantId = "tenant-admin"
const adminToken = "admin-session"
const auditEvent = {
  id: "11111111-1111-4111-8111-111111111111",
  operation_id: "22222222-2222-4222-8222-222222222222",
  phase: "outcome_unknown",
  tenant_id: tenantId,
  actor_id: "user-admin",
  client_id: null,
  method: "PUT",
  route: "/internal/v1/tenants/tenant-admin/members/member-1/roles",
  resource_type: "member",
  resource_id: "member-1",
  result_code: "UNKNOWN",
  request_id: "audit-request-1",
  trace_id: null,
  created_at: "2026-11-13T00:00:00.000Z",
}
const { iamUserContextServiceCredentialFile } = await fixtureIamCredentials(tenantId)

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

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections()
          server.close(() => resolve())
        }),
    ),
  )
})

function config(iamBaseUrl: string): BffConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    mode: "live",
    domain: "dev.kokoro.localhost",
    tenantId,
    iamBaseUrl,
    iamWebOrigin: TEST_WEB_ORIGIN,
    iamUserContextServiceCredentialFile,
    sharedSecret: "web-secret",
    adminWebSharedSecret: "admin-secret",
    upstreamSecret: null,
    upstreamTimeoutMs: 1000,
    upstreamMaxResponseBytes: 1024 * 1024,
    schedulerServiceToken: null,
    schedulerTargetUrl: null,
    agentEnabled: false,
    postgresUrl: null,
    redisUrl: null,
    agUi: DEFAULT_AGUI_CONFIG,
    upstreams: {},
    platformProjection: { baseUrl: null, credentialFile: null, timeoutMs: 1000 },
    skillDraft: { enabled: false, platformBaseUrl: null, credentialFile: null, timeoutMs: 1000 },
  }
}

function admission(platformAdmin: boolean): SessionAdmission {
  return {
    async verify({ cookie }) {
      if (cookie !== fixtureSessionCookie(adminToken)) return { ok: false, status: 401, code: "session_invalid" }
      return {
        ok: true,
        identity: { namespace: tenantId, userId: "user-admin" },
        platformAdmin,
        expiresAt: "2099-01-01T00:00:00.000Z",
        setCookies: [],
      }
    },
  }
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return { "x-kokoro-service": "admin-web-bff", "x-kokoro-internal-secret": "admin-secret", ...fixtureSessionHeaders(adminToken), ...extra }
}

function page(kind: string): object {
  if (kind === "members")
    return {
      data: [{ member_id: "member-1", user_id: "user-1", display_name: "Member", image_url: null, roles: ["owner"], joined_at: "2026-10-09T12:00:00.000Z" }],
      meta: { next_cursor: null },
    }
  if (kind === "invitations")
    return {
      data: [
        {
          invitation_id: "invite-1",
          email: "member@example.test",
          roles: ["member"],
          status: "pending",
          created_at: "2026-10-09T12:00:00.000Z",
          expires_at: "2026-10-10T12:00:00.000Z",
        },
      ],
      meta: { next_cursor: null },
    }
  return { data: [{ role_id: null, name: "owner", kind: "builtin", permissions: { member: ["read"], tenant: ["read"] } }], meta: { next_cursor: null } }
}

test("administrator audit exact GET uses the current actor and owner page with an explicit default limit", async (t) => {
  const calls: string[] = []
  const iam = await listen(
    createServer((request, response) => {
      calls.push(request.url ?? "")
      assert.equal(request.headers.authorization, `Bearer ${TEST_IAM_USER_CONTEXT_SECRET}`)
      assert.equal(request.headers["x-kokoro-actor-id"], "user-admin")
      assert.equal(request.headers.cookie, undefined)
      assert.equal(request.headers.origin, undefined)
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store", "x-request-id": "iam-audit-1" })
      response.end(JSON.stringify({ data: { items: [auditEvent], next_cursor: "opaque-next" } }))
    }),
  )
  const { base, close } = await startAccountTestApp(config(iam), admission(true))
  t.after(close)
  const response = await fetch(`${base}/v1/admin/identity/audit-events`, {
    headers: headers({ "x-kokoro-actor-id": "forged-actor", "x-kokoro-tenant-id": "forged-tenant" }),
  })
  assert.equal(response.status, 200)
  const result = (await response.json()) as { data: { items: unknown[]; next_cursor: string | null } }
  assert.deepEqual(result.data, { items: [auditEvent], next_cursor: "opaque-next" })
  const next = await fetch(`${base}/v1/admin/identity/audit-events?limit=1&cursor=opaque%2Fprevious`, { headers: headers() })
  assert.equal(next.status, 200)
  assert.deepEqual(calls, ["/internal/v1/audit-events?limit=25", "/internal/v1/audit-events?limit=1&cursor=opaque%2Fprevious"])
})

test("audit read rejects selectors, malformed queries, bodies and ordinary actors before owner dispatch", async (t) => {
  let calls = 0
  const iam = await listen(
    createServer((_request, response) => {
      calls += 1
      response.writeHead(500).end()
    }),
  )
  const { base, close } = await startAccountTestApp(config(iam), admission(true))
  const ordinary = await startAccountTestApp(config(iam), admission(false))
  t.after(close)
  t.after(ordinary.close)
  for (const query of [
    "tenant_id=tenant-admin",
    "siteId=site",
    "unknown=x",
    "limit=0",
    "limit=101",
    "limit=01",
    "limit=1&limit=2",
    "cursor=",
    "cursor=a&cursor=b",
  ])
    assert.equal((await fetch(`${base}/v1/admin/identity/audit-events?${query}`, { headers: headers() })).status, 400, query)
  for (const extra of [{ "content-length": "0" }, { "content-type": "application/json" }, { "idempotency-key": "not-a-command" }])
    assert.equal(
      await new Promise<number>((resolve, reject) => {
        // fetch drops Content-Length: 0 on GET; retain the actual wire header here.
        const request = httpRequest(`${base}/v1/admin/identity/audit-events`, { headers: headers(extra) }, (response) => {
          response.resume()
          resolve(response.statusCode ?? 0)
        })
        request.once("error", reject)
        request.end()
      }),
      400,
      JSON.stringify(extra),
    )
  assert.equal((await fetch(`${ordinary.base}/v1/admin/identity/audit-events`, { headers: headers() })).status, 403)
  assert.equal((await fetch(`${base}/v1/admin/identity/audit-events/`, { headers: headers() })).status, 403)
  assert.equal((await fetch(`${base}/v1/admin/identity/audit-events`, { method: "POST", headers: headers() })).status, 403)
  assert.equal(calls, 0)
})

test("audit owner safety rejects foreign tenants, secret extensions, page overflow, malformed JSON and unsafe headers", async (t) => {
  let body = ""
  let extraHeaders: Record<string, string> = {}
  const iam = await listen(
    createServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store", "x-request-id": "iam-audit-safe", ...extraHeaders })
      response.end(body)
    }),
  )
  const { base, close } = await startAccountTestApp({ ...config(iam), upstreamMaxResponseBytes: 4096 }, admission(true))
  t.after(close)
  const good = { data: { items: [auditEvent], next_cursor: null } }
  const samples = [
    { data: { ...good.data, items: [{ ...auditEvent, tenant_id: "another-tenant" }] } },
    { data: { ...good.data, items: [{ ...auditEvent, details: { forbidden: true } }] } },
    { data: { ...good.data, items: [auditEvent, auditEvent] } },
    { data: { ...good.data, next_cursor: "" } },
    { data: { ...good.data, items: [{ ...auditEvent, phase: "unknown-ack" }] } },
  ]
  for (const sample of samples) {
    body = JSON.stringify(sample)
    const response = await fetch(`${base}/v1/admin/identity/audit-events?limit=1`, { headers: headers() })
    assert.equal(response.status, 502)
    assert.equal(((await response.json()) as { error: { code: string } }).error.code, "admin_identity_owner_response_invalid")
  }
  for (const raw of [
    '{"data":{},"data":{"items":[],"next_cursor":null}}',
    "not-json",
    JSON.stringify({ data: { items: [], next_cursor: "x".repeat(5000) } }),
  ]) {
    body = raw
    assert.equal((await fetch(`${base}/v1/admin/identity/audit-events`, { headers: headers() })).status, 502)
  }
  body = JSON.stringify(good)
  for (const extra of [{ "cache-control": "public" }, { "set-cookie": "forbidden=value" }, { location: "https://example.invalid/" }]) {
    extraHeaders = extra
    assert.equal((await fetch(`${base}/v1/admin/identity/audit-events`, { headers: headers() })).status, 502)
  }
})

test("audit owner current denial, cursor errors and rate limits remain distinct from unavailable or malformed peers", async (t) => {
  let status = 400,
    code = "INVALID_ARGUMENT"
  const iam = await listen(
    createServer((_request, response) => {
      response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", "x-request-id": "iam-audit-error", "retry-after": "7" })
      response.end(JSON.stringify({ error: { code, message: "private owner diagnostic", retryable: false, details: [] } }))
    }),
  )
  const { base, close } = await startAccountTestApp(config(iam), admission(true))
  t.after(close)
  for (const row of [
    [400, "INVALID_ARGUMENT", 400],
    [403, "PERMISSION_DENIED", 403],
    [429, "RATE_LIMITED", 429],
    [503, "DEPENDENCY_UNAVAILABLE", 503],
    [401, "bff_user_context_service_unauthenticated", 503],
    [503, "PERMISSION_DENIED", 502],
  ] as const) {
    ;[status, code] = row
    const response = await fetch(`${base}/v1/admin/identity/audit-events?cursor=opaque`, { headers: headers() })
    assert.equal(response.status, row[2])
    assert.equal(response.headers.get("retry-after"), row[2] === 429 ? "7" : null)
    assert.equal((await response.text()).includes("private owner diagnostic"), false)
  }
})

test("an already retired audit read does not dispatch and native disconnect retires admission before a late actor result", { timeout: 3000 }, async (t) => {
  let calls = 0
  const iam = await listen(
    createServer((_request, response) => {
      calls += 1
      response.writeHead(500).end()
    }),
  )
  const signal = AbortSignal.abort()
  assert.equal(
    (
      await readIamAuditEvents({
        baseUrl: iam,
        credentialFile: iamUserContextServiceCredentialFile,
        tenantId,
        subjectId: "user-admin",
        requestId: "retired-audit",
        limit: 25,
        cursor: null,
        signal,
        timeoutMs: 1000,
        maxResponseBytes: 4096,
      })
    ).ok,
    false,
  )
  let entered!: () => void, retired!: () => void, finish!: () => void
  const began = new Promise<void>((resolve) => {
    entered = resolve
  })
  const ended = new Promise<void>((resolve) => {
    retired = resolve
  })
  const deferred: SessionAdmission = {
    verify: ({ signal: lifetime }) => {
      entered()
      lifetime.addEventListener("abort", retired, { once: true })
      return new Promise((resolve) => {
        finish = () =>
          resolve({
            ok: true,
            identity: { namespace: tenantId, userId: "user-admin" },
            platformAdmin: true,
            expiresAt: "2099-01-01T00:00:00.000Z",
            setCookies: [],
          })
      })
    },
  }
  const { base, close } = await startAccountTestApp(config(iam), deferred)
  t.after(close)
  const controller = new AbortController()
  const request = fetch(`${base}/v1/admin/identity/audit-events`, { headers: headers(), signal: controller.signal }).catch(() => null)
  await began
  controller.abort()
  await ended
  finish()
  await request
  await immediate()
  assert.equal(calls, 0)
})

test("audit owner timeout is bounded and closes the read without accepting a late success", async (t) => {
  let retired!: () => void
  const ended = new Promise<void>((resolve) => {
    retired = resolve
  })
  const iam = await listen(
    createServer((_request, response) => {
      response.once("close", retired)
      const timer = setTimeout(() => {
        if (!response.destroyed) response.writeHead(200).end("{}")
      }, 2000)
      timer.unref()
    }),
  )
  const { base, close } = await startAccountTestApp({ ...config(iam), upstreamTimeoutMs: 50 }, admission(true))
  t.after(close)
  assert.equal((await fetch(`${base}/v1/admin/identity/audit-events`, { headers: headers() })).status, 503)
  await ended
})

test("administrator identity reads expose only the admitted tenant and accepted page query", async (t) => {
  const calls: string[] = []
  const iam = await listen(
    createServer((request, response) => {
      calls.push(request.url ?? "")
      const kind = request.url?.split("?")[0]?.split("/").at(-1) ?? ""
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store", "x-request-id": "iam-admin-1" })
      response.end(JSON.stringify(page(kind)))
    }),
  )
  const { base: bff, close } = await startAccountTestApp(config(iam), admission(true))
  t.after(close)

  for (const kind of ["members", "invitations", "roles"]) {
    const response = await fetch(`${bff}/v1/admin/identity/${kind}?limit=2&cursor=opaque`, { headers: headers({ "x-kokoro-tenant-id": "attacker" }) })
    assert.equal(response.status, 200, kind)
    assert.equal(response.headers.get("cache-control"), "no-store")
    const body = (await response.json()) as { meta: { next_cursor: string | null } }
    assert.equal(body.meta.next_cursor, null)
  }
  assert.deepEqual(calls, [
    `/internal/v1/tenants/${tenantId}/members?limit=2&cursor=opaque`,
    `/internal/v1/tenants/${tenantId}/invitations?limit=2&cursor=opaque`,
    `/internal/v1/tenants/${tenantId}/roles?limit=2&cursor=opaque`,
  ])
})

test("administrator identity reads reject ordinary users, malformed routes and malformed pages before IAM", async (t) => {
  let calls = 0
  const iam = await listen(
    createServer((_request, response) => {
      calls += 1
      response.writeHead(500).end()
    }),
  )
  const { base: adminBff, close: closeAdmin } = await startAccountTestApp(config(iam), admission(true))
  t.after(closeAdmin)
  const { base: ordinaryBff, close: closeOrdinary } = await startAccountTestApp(config(iam), admission(false))
  t.after(closeOrdinary)

  assert.equal((await fetch(`${ordinaryBff}/v1/admin/identity/members`, { headers: headers() })).status, 403)
  for (const target of ["members?limit=0", "members?limit=101", "members?cursor=", "members?tenant_id=attacker", "unknown"]) {
    assert.equal((await fetch(`${adminBff}/v1/admin/identity/${target}`, { headers: headers() })).status, target === "unknown" ? 403 : 400, target)
  }
  assert.equal(calls, 0)
})
