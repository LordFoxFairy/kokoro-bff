import assert from "node:assert/strict"
import { createServer, type IncomingMessage, type Server } from "node:http"
import { afterEach, test } from "node:test"

import { DEFAULT_AGUI_CONFIG } from "../dist/config/runtime.js"
import { createBffServer } from "../dist/bootstrap/server.js"
import type { BffConfig } from "../src/config/runtime.ts"
import { SessionAdmissionDouble } from "./doubles/session-admission.ts"
import { fixtureIamCredentials, TEST_IAM_USER_CONTEXT_SECRET } from "./doubles/iam-credentials.ts"

const credentials = await fixtureIamCredentials("tenant-verified")

const servers: Server[] = []
async function listen(server: Server): Promise<string> {
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
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
    tenantId: "tenant-verified",
    iamBaseUrl,
    iamWebOrigin: "https://web.example.test",
    ...credentials,
    sharedSecret: "test-secret",
    upstreamSecret: null,
    upstreamTimeoutMs: 1000,
    upstreamMaxResponseBytes: 4096,
    schedulerServiceToken: null,
    schedulerTargetUrl: null,
    agentEnabled: false,
    postgresUrl: null,
    redisUrl: null,
    agUi: DEFAULT_AGUI_CONFIG,
    upstreams: {},
  }
}
const headers = {
  "x-kokoro-service": "web-bff",
  "x-kokoro-internal-secret": "test-secret",
  cookie: "kokoro-issuer.session_token=team-token",
  origin: "https://web.example.test",
}
const routes = [
  {
    method: "POST",
    path: "/v1/team/invitations",
    owner: "/internal/v1/tenants/tenant-verified/invitations",
    body: { email: "new@example.test", roles: ["member"] },
    data: { invitation_id: "invite-1", status: "pending" },
  },
  {
    method: "POST",
    path: "/v1/team/invitations/invite-1/resend",
    owner: "/internal/v1/tenants/tenant-verified/invitations/invite-1/resend",
    data: { invitation_id: "invite-1", status: "pending" },
  },
  {
    method: "DELETE",
    path: "/v1/team/invitations/invite-1",
    owner: "/internal/v1/tenants/tenant-verified/invitations/invite-1",
    data: { invitation_id: "invite-1", status: "canceled" },
  },
  {
    method: "PUT",
    path: "/v1/team/members/member-1/roles",
    owner: "/internal/v1/tenants/tenant-verified/members/member-1/roles",
    body: { roles: ["admin"] },
    data: { member_id: "member-1", roles: ["admin"] },
  },
  {
    method: "DELETE",
    path: "/v1/team/members/member-1",
    owner: "/internal/v1/tenants/tenant-verified/members/member-1",
    data: { member_id: "member-1", status: "removed" },
  },
  {
    method: "DELETE",
    path: "/v1/team/members/me",
    owner: "/internal/v1/tenants/tenant-verified/members/me",
    data: { member_id: "member-self", status: "left" },
  },
] as const
function bff(owner: string): Server {
  return createBffServer(config(owner), {
    businessStore: null,
    readiness: async () => undefined,
    sessionAdmission: new SessionAdmissionDouble({ "team-token": { namespace: "tenant-verified", userId: "user-1" } }),
  })
}
function ownerHeaders() {
  return { "content-type": "application/json", "x-request-id": "iam-team-write-1" }
}

test("six Team mutations use only admitted tenant, actor and service credential, one IAM call, no cache", async () => {
  const seen: Array<{ method: string; path: string; body: string; headers: IncomingMessage["headers"] }> = []
  const owner = await listen(
    createServer(async (request, response) => {
      let body = ""
      for await (const part of request) body += part.toString()
      seen.push({ method: request.method ?? "", path: request.url ?? "", body, headers: request.headers })
      const route = routes.find((item) => item.owner === request.url && item.method === request.method)
      response.writeHead(route ? 200 : 404, ownerHeaders()).end(JSON.stringify({ data: route?.data ?? {} }))
    }),
  )
  const app = await listen(bff(owner))
  for (const route of routes) {
    const response = await fetch(`${app}${route.path}`, {
      method: route.method,
      headers: {
        ...headers,
        "x-kokoro-tenant-id": "tenant-attacker",
        "x-kokoro-principal-id": "user-attacker",
        "x-kokoro-actor-id": "user-attacker",
        ...(route.body ? { "content-type": "application/json" } : {}),
      },
      ...(route.body ? { body: JSON.stringify(route.body) } : {}),
    })
    assert.equal(response.status, 200, route.path)
    assert.equal(response.headers.get("cache-control"), "no-store")
    assert.deepEqual(await response.json(), { data: route.data, meta: { request_id: response.headers.get("x-request-id") } })
  }
  assert.equal(seen.length, 6)
  for (let index = 0; index < routes.length; index++) {
    assert.equal(seen[index]?.path, routes[index]?.owner)
    assert.equal(seen[index]?.headers.authorization, `Bearer ${TEST_IAM_USER_CONTEXT_SECRET}`)
    assert.equal(seen[index]?.headers["x-kokoro-actor-id"], "user-1")
    assert.equal(seen[index]?.headers.cookie, undefined)
    assert.equal(seen[index]?.headers.origin, undefined)
    assert.equal(seen[index]?.headers["x-kokoro-tenant-id"], undefined)
    assert.equal(seen[index]?.body, routes[index]?.body ? JSON.stringify(routes[index]?.body) : "")
  }
})

test("Team mutation rejects extra identity, invalid body, query and absent session before IAM I/O", async () => {
  let calls = 0
  const owner = await listen(
    createServer((_request, response) => {
      calls++
      response.writeHead(500).end()
    }),
  )
  const app = await listen(bff(owner))
  const cases = [
    ["/v1/team/invitations", "POST", { email: "new@example.test", roles: ["member"], tenant_id: "tenant-attacker" }],
    ["/v1/team/invitations", "POST", { email: "bad", roles: ["member"] }],
    ["/v1/team/members/member-1/roles", "PUT", { roles: [] }],
    ["/v1/team/members/member-1", "DELETE", { actor_id: "user-attacker" }],
  ] as const
  for (const [path, method, body] of cases) {
    const response = await fetch(`${app}${path}`, { method, headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body) })
    assert.equal(response.status, 400, path)
  }
  assert.equal((await fetch(`${app}/v1/team/members/me?tenant_id=other`, { method: "DELETE", headers })).status, 400)
  assert.equal((await fetch(`${app}/v1/team/members/me`, { method: "DELETE", headers: { ...headers, "idempotency-key": "unsupported" } })).status, 400)
  assert.equal(
    (
      await fetch(`${app}/v1/team/members/me`, {
        method: "DELETE",
        headers: { "x-kokoro-service": "web-bff", "x-kokoro-internal-secret": "test-secret", origin: "https://web.example.test" },
      })
    ).status,
    401,
  )
  assert.equal(calls, 0)
})

test("Team preserves owner business 409 and fails closed on malformed owner envelopes", async () => {
  let status = 409
  let payload: object = { error: { code: "LAST_OWNER", message: "private", retryable: false, details: [] } }
  const owner = await listen(createServer((_request, response) => response.writeHead(status, ownerHeaders()).end(JSON.stringify(payload))))
  const app = await listen(bff(owner))
  const call = () => fetch(`${app}/v1/team/members/me`, { method: "DELETE", headers })
  let response = await call()
  assert.equal(response.status, 409)
  assert.equal(((await response.json()) as { error: { code: string } }).error.code, "LAST_OWNER")
  status = 200
  payload = { data: { member_id: "member-self", status: "left", secret: "leak" } }
  response = await call()
  assert.equal(response.status, 502)
  status = 409
  payload = { error: { code: "UNKNOWN_CODE", message: "private", retryable: false, details: [] } }
  response = await call()
  assert.equal(response.status, 502)
})

test("Team preserves owner not-found codes, validates status-code pairs and bounds Retry-After", async () => {
  let status = 404
  let code = "ROLE_NOT_FOUND"
  let retryAfter = "99999"
  const owner = await listen(
    createServer((_request, response) => {
      response
        .writeHead(status, { ...ownerHeaders(), "retry-after": retryAfter })
        .end(JSON.stringify({ error: { code, message: "private owner detail", retryable: status === 429, details: [] } }))
    }),
  )
  const app = await listen(bff(owner))
  const call = () =>
    fetch(`${app}/v1/team/members/member-1/roles`, {
      method: "PUT",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ roles: ["member"] }),
    })
  let response = await call()
  assert.equal(response.status, 404)
  assert.equal(((await response.json()) as { error: { code: string } }).error.code, "ROLE_NOT_FOUND")
  status = 409
  code = "INVITATION_CONFLICT"
  response = await call()
  assert.equal(response.status, 409)
  assert.equal(((await response.json()) as { error: { code: string } }).error.code, "INVITATION_CONFLICT")
  status = 401
  code = "LAST_OWNER"
  response = await call()
  assert.equal(response.status, 502)
  status = 429
  code = "RATE_LIMITED"
  response = await call()
  assert.equal(response.status, 429)
  assert.equal(response.headers.get("retry-after"), null)
  retryAfter = "60"
  response = await call()
  assert.equal(response.status, 429)
  assert.equal(response.headers.get("retry-after"), "60")
  status = 403
  code = "PERMISSION_DENIED"
  response = await call()
  assert.equal(response.status, 403)
  assert.equal(((await response.json()) as { error: { code: string } }).error.code, "team_forbidden")
  status = 503
  code = "DEPENDENCY_UNAVAILABLE"
  response = await call()
  assert.equal(response.status, 503)
})

test("Team mutation has no automatic retry on an uncertain owner result", async () => {
  let calls = 0
  const owner = await listen(
    createServer((_request, response) => {
      calls += 1
      response.destroy()
    }),
  )
  const app = await listen(bff(owner))
  const response = await fetch(`${app}/v1/team/members/me`, { method: "DELETE", headers })
  assert.equal(response.status, 503)
  assert.equal(calls, 1)
})

test("Team mutation still rejects malformed owner media type and request ID without requiring Cache-Control", async () => {
  let responseHeaders: Record<string, string> = ownerHeaders()
  const owner = await listen(
    createServer((_request, response) => {
      response.writeHead(200, responseHeaders).end(JSON.stringify({ data: { invitation_id: "invite-1", status: "pending" } }))
    }),
  )
  const app = await listen(bff(owner))
  const call = () =>
    fetch(`${app}/v1/team/invitations`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ email: "new@example.test", roles: ["member"] }),
    })
  let result = await call()
  assert.equal(result.status, 200)
  assert.equal(result.headers.get("cache-control"), "no-store")
  responseHeaders = { ...ownerHeaders(), "cache-control": "public, max-age=60" }
  result = await call()
  assert.equal(result.status, 200)
  assert.equal(result.headers.get("cache-control"), "no-store")
  responseHeaders = { ...ownerHeaders(), "content-type": "text/plain" }
  result = await call()
  assert.equal(result.status, 502)
  responseHeaders = { ...ownerHeaders(), "x-request-id": "bad request id!" }
  result = await call()
  assert.equal(result.status, 502)
  responseHeaders = { "content-type": "application/json" }
  result = await call()
  assert.equal(result.status, 502)
})

test("real Team write service401 is dependency503 while unknown, malformed or wrong tuples remain502", async () => {
  let status = 401
  let error: Record<string, unknown> = { code: "bff_user_context_service_unauthenticated", message: "TEAM_SERVICE_CANARY", retryable: false, details: [] }
  let calls = 0
  const owner = await listen(
    createServer((request, reply) => {
      calls++
      assert.equal(request.method, "DELETE")
      assert.equal(request.url, "/internal/v1/tenants/tenant-verified/members/me")
      assert.equal(request.headers.authorization, `Bearer ${TEST_IAM_USER_CONTEXT_SECRET}`)
      assert.equal(request.headers["x-kokoro-actor-id"], "user-1")
      assert.equal(request.headers.cookie, undefined)
      assert.equal(request.headers.origin, undefined)
      reply.writeHead(status, ownerHeaders()).end(JSON.stringify({ error }))
    }),
  )
  const app = await listen(bff(owner))
  for (const [wireStatus, code, extra, expectedStatus] of [
    [401, "bff_user_context_service_unauthenticated", {}, 503],
    [401, "UNKNOWN_SERVICE_DENIAL", {}, 502],
    [403, "bff_user_context_service_unauthenticated", {}, 502],
    [401, "bff_user_context_service_unauthenticated", { token: "secret" }, 502],
  ] as const) {
    status = wireStatus
    error = { code, message: "TEAM_SERVICE_CANARY", retryable: false, details: [], ...extra }
    const result = await fetch(`${app}/v1/team/members/me`, { method: "DELETE", headers })
    assert.equal(result.status, expectedStatus)
    const body = await result.json()
    assert.equal(body.error.code, expectedStatus === 503 ? "team_owner_unavailable" : "team_owner_response_invalid")
    assert.doesNotMatch(JSON.stringify(body), /TEAM_SERVICE_CANARY|secret/)
  }
  assert.equal(calls, 4, "each mutation has exactly one owner attempt")
})
