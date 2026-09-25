import assert from "node:assert/strict"
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { afterEach, test } from "node:test"

import { loadConfig } from "../dist/config/runtime.js"
import { createLiveTestBffServer } from "./doubles/server.ts"

const servers: Server[] = []
const webOrigin = "http://web.example.test"
const webServiceHeaders = {
  "x-kokoro-service": "web-bff",
  "x-kokoro-internal-secret": "test-secret",
}

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

function bff(iamBaseUrl: string, limits: { timeoutMs?: number; responseBytes?: number; tenantId?: string } = {}): Server {
  return createLiveTestBffServer(
    loadConfig({
      KOKORO_BFF_SHARED_SECRET: "test-secret",
      KOKORO_BFF_POSTGRES_URL: "postgresql://localhost/unused_bff_relay_fixture?schema=kokoro_bff",
      KOKORO_BFF_REDIS_URL: "redis://localhost:6379/8",
      KOKORO_IAM_BASE_URL: iamBaseUrl,
      KOKORO_IAM_ISSUER_URL: `${webOrigin}/iam`,
      KOKORO_IAM_WEB_ORIGIN: webOrigin,
      KOKORO_IAM_WEB_CALLBACK_URI: `${webOrigin}/api/auth/callback/kokoro-iam`,
      KOKORO_IAM_WEB_POST_LOGOUT_URI: `${webOrigin}/auth/sign-in`,
      ...(limits.tenantId === undefined ? {} : { KOKORO_TENANT_ID: limits.tenantId }),
      ...(limits.timeoutMs === undefined ? {} : { KOKORO_UPSTREAM_TIMEOUT_MS: String(limits.timeoutMs) }),
      ...(limits.responseBytes === undefined ? {} : { KOKORO_UPSTREAM_MAX_RESPONSE_BYTES: String(limits.responseBytes) }),
    }),
  )
}

test("fixed-tenant relay rejects list and invalid set-active before IAM socket", async () => {
  const calls: Array<{ url: string | undefined; body: string; cookie: string | undefined }> = []
  const iam = await listen(
    createServer((request, response) => {
      const chunks: Buffer[] = []
      request.on("data", (chunk: Buffer) => chunks.push(chunk))
      request.on("end", () => {
        calls.push({ url: request.url, body: Buffer.concat(chunks).toString("utf8"), cookie: request.headers.cookie })
        response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" })
        response.end("{}")
      })
    }),
  )
  const base = await listen(bff(iam, { tenantId: "tenant-fixed" }))
  const query = "sig=signed%2Bvalue&ba_iat=123&ba_param=scope&ba_param=state"
  const body = (organizationId: unknown, oauthQuery: unknown, extra: Record<string, unknown> = {}): string =>
    JSON.stringify({ organizationId, oauth_query: oauthQuery, ...extra })
  const headers = {
    ...webServiceHeaders,
    origin: webOrigin,
    cookie: "authjs.session-token=product; kokoro-issuer.session_token=issuer-session",
    "content-type": "application/json",
  }
  const post = (payload: string, overrides: Record<string, string> = {}, path = "/iam/organization/set-active") =>
    fetch(`${base}${path}`, { method: "POST", headers: { ...headers, ...overrides }, body: payload })

  assert.equal((await fetch(`${base}/iam/organization/list`, { headers })).status, 404)
  assert.equal(
    (
      await fetch(`${base}/iam/organization/set-active`, {
        method: "POST",
        headers: { origin: webOrigin, cookie: headers.cookie, "content-type": "application/json" },
        body: body("tenant-fixed", query),
      })
    ).status,
    403,
  )
  for (const [payload, overrides, path, expectedStatus] of [
    [body("tenant-other", query), {}, "/iam/organization/set-active", 403],
    [body(null, query), {}, "/iam/organization/set-active", 400],
    [body("tenant-fixed", query, { organizationSlug: "tenant-other" }), {}, "/iam/organization/set-active", 400],
    [body("tenant-fixed", "sig=one&sig=two"), {}, "/iam/organization/set-active", 400],
    [body("tenant-fixed", "ba_iat=123"), {}, "/iam/organization/set-active", 400],
    [body("tenant-fixed", "sig=bad%XX"), {}, "/iam/organization/set-active", 400],
    [body("tenant-fixed", `sig=${"a".repeat(8192)}`), {}, "/iam/organization/set-active", 400],
    [body("tenant-fixed", query), { cookie: "authjs.session-token=product" }, "/iam/organization/set-active", 403],
    [body("tenant-fixed", query), { cookie: "kokoro-issuer.session_token=" }, "/iam/organization/set-active", 403],
    [body("tenant-fixed", query), { origin: "http://evil.example.test" }, "/iam/organization/set-active", 403],
    [body("tenant-fixed", query), { "content-type": "text/plain" }, "/iam/organization/set-active", 400],
    [body("tenant-fixed", query), {}, "/iam/organization/set-active?tenant=tenant-fixed", 400],
  ] as const) {
    const response = await post(payload, overrides, path)
    assert.equal(response.status, expectedStatus, payload)
  }
  assert.equal(calls.length, 0)

  const accepted = await post(body("tenant-fixed", query))
  assert.equal(accepted.status, 200)
  assert.deepEqual(calls, [{ url: "/iam/organization/set-active", body: body("tenant-fixed", query), cookie: "kokoro-issuer.session_token=issuer-session" }])

  const missingConfig = await listen(bff(iam))
  const absent = await fetch(`${missingConfig}/iam/organization/set-active`, { method: "POST", headers, body: body("tenant-fixed", query) })
  assert.equal(absent.status, 503)
  assert.equal(calls.length, 1)
})

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

test("BFF relays only Web-authenticated OIDC discovery to the fixed IAM origin", async () => {
  const upstreamCalls: Array<{
    url: string | undefined
    headers: IncomingMessage["headers"]
  }> = []
  const iam = await listen(
    createServer((request: IncomingMessage, response: ServerResponse) => {
      upstreamCalls.push({ url: request.url, headers: request.headers })
      response.writeHead(200, {
        "content-type": "application/json",
        "cache-control": "no-store",
      })
      response.end(JSON.stringify({ issuer: `${webOrigin}/iam` }))
    }),
  )
  const base = await listen(bff(iam))

  const absent = await fetch(`${base}/iam/.well-known/openid-configuration`)
  assert.equal(absent.status, 403)
  assert.equal(upstreamCalls.length, 0)

  const accepted = await fetch(`${base}/iam/.well-known/openid-configuration`, {
    headers: webServiceHeaders,
  })
  assert.equal(accepted.status, 200)
  assert.deepEqual(await accepted.json(), { issuer: `${webOrigin}/iam` })
  assert.equal(accepted.headers.get("cache-control"), "no-store")
  assert.equal(upstreamCalls.length, 1)
  assert.equal(upstreamCalls[0]?.url, "/iam/.well-known/openid-configuration")
  assert.equal(upstreamCalls[0]?.headers["x-kokoro-internal-secret"], undefined)
})

test("BFF preserves IAM signed interaction query and filters Product Session cookie", async () => {
  let forwardedCookie: string | undefined
  const iam = await listen(
    createServer((request, response) => {
      forwardedCookie = request.headers.cookie
      response.writeHead(302, {
        location: `${webOrigin}/auth/select-tenant?client_id=client-1&ba_param=scope&ba_param=state&sig=abc%2Bdef`,
        "cache-control": "no-store",
      })
      response.end()
    }),
  )
  const base = await listen(bff(iam))
  const response = await fetch(`${base}/iam/oauth2/authorize?client_id=client-1`, {
    headers: {
      ...webServiceHeaders,
      cookie: "authjs.session-token=private; kokoro-issuer.session_token=issuer-token",
    },
    redirect: "manual",
  })
  assert.equal(response.status, 302)
  assert.equal(response.headers.get("location"), `${webOrigin}/auth/select-tenant?client_id=client-1&ba_param=scope&ba_param=state&sig=abc%2Bdef`)
  assert.equal(forwardedCookie, "kokoro-issuer.session_token=issuer-token")
})

test("email verification keeps the raw token query and native same-origin 302 without Product credentials", async () => {
  const upstreamCalls: Array<{ url: string | undefined; authorization: string | undefined; cookie: string | undefined }> = []
  const iam = await listen(
    createServer((request, response) => {
      upstreamCalls.push({ url: request.url, authorization: request.headers.authorization, cookie: request.headers.cookie })
      response.writeHead(302, {
        location: `${webOrigin}/auth/sign-in`,
        "cache-control": "no-store",
      })
      response.end()
    }),
  )
  const base = await listen(bff(iam))
  const rawQuery = "?token=opaque%2B%2F%3D&callbackURL=http%3A%2F%2Fweb.example.test%2Fauth%2Fsign-in&x=one&x=two"
  const response = await fetch(`${base}/iam/verify-email${rawQuery}`, {
    headers: {
      ...webServiceHeaders,
      cookie: "authjs.session-token=product-secret; kokoro-issuer.session_token=issuer-session",
    },
    redirect: "manual",
  })
  assert.equal(response.status, 302)
  assert.equal(response.headers.get("location"), `${webOrigin}/auth/sign-in`)
  assert.equal(response.headers.get("cache-control"), "no-store")
  assert.equal(response.headers.get("referrer-policy"), "no-referrer")
  assert.deepEqual(upstreamCalls, [{ url: `/iam/verify-email${rawQuery}`, authorization: undefined, cookie: "kokoro-issuer.session_token=issuer-session" }])
})

test("email verification overrides missing or cacheable native headers on 200 and same-origin 302", async () => {
  let mode: "success" | "redirect" = "success"
  const iam = await listen(
    createServer((_request, response) => {
      if (mode === "success") response.writeHead(200, { "content-type": "application/json" })
      else response.writeHead(302, { location: `${webOrigin}/auth/sign-in`, "cache-control": "public, max-age=600", "referrer-policy": "unsafe-url" })
      response.end(mode === "success" ? "{}" : "")
    }),
  )
  const base = await listen(bff(iam))
  const success = await fetch(`${base}/iam/verify-email?token=opaque`, { headers: webServiceHeaders, redirect: "manual" })
  assert.equal(success.status, 200)
  assert.equal(success.headers.get("cache-control"), "no-store")
  assert.equal(success.headers.get("referrer-policy"), "no-referrer")

  mode = "redirect"
  const redirect = await fetch(`${base}/iam/verify-email?token=opaque`, { headers: webServiceHeaders, redirect: "manual" })
  assert.equal(redirect.status, 302)
  assert.equal(redirect.headers.get("location"), `${webOrigin}/auth/sign-in`)
  assert.equal(redirect.headers.get("cache-control"), "no-store")
  assert.equal(redirect.headers.get("referrer-policy"), "no-referrer")
})

test("email verification fails closed on hostile Location and rejects aliases, wrong methods and browser Authorization before IAM I/O", async () => {
  let calls = 0
  const iam = await listen(
    createServer((_request, response) => {
      calls++
      response.writeHead(302, { location: "https://outside.example/steal?token=opaque", "cache-control": "no-store" })
      response.end()
    }),
  )
  const base = await listen(bff(iam))
  for (const target of [
    "/iam/%76erify-email?token=opaque",
    "/iam/verify-email/?token=opaque",
    "/iam//verify-email?token=opaque",
    "/iam/verify-email%2F?token=opaque",
  ]) {
    const response = await fetch(`${base}${target}`, { headers: webServiceHeaders, redirect: "manual" })
    assert.equal(response.status, 404, target)
  }
  assert.equal((await fetch(`${base}/iam/verify-email?token=opaque`, { method: "POST", headers: webServiceHeaders })).status, 404)
  assert.equal((await fetch(`${base}/iam/verify-email?token=opaque`, { headers: { ...webServiceHeaders, authorization: "Bearer browser-token" } })).status, 403)
  assert.equal(calls, 0)

  const hostile = await fetch(`${base}/iam/verify-email?token=opaque`, { headers: webServiceHeaders, redirect: "manual" })
  assert.equal(calls, 1)
  assert.equal(hostile.status, 502)
  assert.equal(hostile.headers.get("location"), null)
  assert.equal(hostile.headers.get("cache-control"), "no-store")
})

test("invitation relay admits only the fixed tenant, canonical UUID, exact Origin and issuer Session", async () => {
  const tenant = "tenant-fixed"
  const invitation = "123e4567-e89b-42d3-a456-426614174000"
  const calls: Array<{ url: string | undefined; method: string | undefined; cookie: string | undefined; body: string }> = []
  const iam = await listen(
    createServer((request, response) => {
      const chunks: Buffer[] = []
      request.on("data", (chunk: Buffer) => chunks.push(chunk))
      request.on("end", () => {
        calls.push({ url: request.url, method: request.method, cookie: request.headers.cookie, body: Buffer.concat(chunks).toString("utf8") })
        const action = request.url?.split("/").at(-1)
        const data =
          action === "context"
            ? {
                invitation_id: invitation,
                tenant_id: tenant,
                tenant_name: "Fixed tenant",
                roles: ["member"],
                status: "pending",
                expires_at: "2026-09-26T00:00:00.000Z",
              }
            : action === "accept"
              ? { invitation_id: invitation, member_id: "member-1", status: "accepted" }
              : { invitation_id: invitation, status: "rejected" }
        response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "public" })
        response.end(JSON.stringify({ data }))
      })
    }),
  )
  const base = await listen(bff(iam, { tenantId: tenant }))
  const prefix = `${base}/iam/v1/tenants/${tenant}/invitations/${invitation}`
  const headers = {
    ...webServiceHeaders,
    origin: webOrigin,
    cookie: "authjs.session-token=product; kokoro-issuer.session_token=issuer-session",
  }
  for (const [path, method] of [
    [`${prefix}/context`, "GET"],
    [`${prefix}/accept`, "POST"],
    [`${prefix}/reject`, "POST"],
  ] as const) {
    const response = await fetch(path, { method, headers })
    assert.equal(response.status, 200, `${method} ${path}`)
    assert.equal(response.headers.get("cache-control"), "no-store")
    assert.equal(response.headers.get("referrer-policy"), "no-referrer")
    assert.match(response.headers.get("x-request-id") ?? "", /^[A-Za-z0-9._:-]{1,128}$/u)
  }
  assert.deepEqual(
    calls.map((call) => ({ ...call, url: call.url?.replace(invitation, "INVITATION") })),
    [
      { url: `/iam/v1/tenants/${tenant}/invitations/INVITATION/context`, method: "GET", cookie: "kokoro-issuer.session_token=issuer-session", body: "" },
      { url: `/iam/v1/tenants/${tenant}/invitations/INVITATION/accept`, method: "POST", cookie: "kokoro-issuer.session_token=issuer-session", body: "" },
      { url: `/iam/v1/tenants/${tenant}/invitations/INVITATION/reject`, method: "POST", cookie: "kokoro-issuer.session_token=issuer-session", body: "" },
    ],
  )

  const rejected: Array<[string, RequestInit, number]> = [
    [`${prefix}/context?next=x`, { method: "GET", headers }, 404],
    [`${prefix}/context`, { method: "POST", headers }, 404],
    [`${base}/iam/v1/tenants/other/invitations/${invitation}/context`, { headers }, 403],
    [`${base}/iam/v1/tenants/${tenant}/invitations/${invitation.toUpperCase()}/context`, { headers }, 404],
    [`${prefix}/context`, { headers: { ...webServiceHeaders, cookie: headers.cookie } }, 403],
    [`${prefix}/context`, { headers: { ...webServiceHeaders, origin: webOrigin } }, 403],
    [`${prefix}/context`, { headers: { ...headers, authorization: "Bearer product" } }, 403],
    [`${prefix}/context`, { headers: { ...headers, "idempotency-key": "not-supported" } }, 400],
    [`${prefix}/accept`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: "{}" }, 400],
  ]
  for (const [path, init, status] of rejected) assert.equal((await fetch(path, init)).status, status, path)
  assert.equal(calls.length, 3)

  const noTenant = await listen(bff(iam))
  assert.equal((await fetch(`${noTenant}/iam/v1/tenants/${tenant}/invitations/${invitation}/context`, { headers })).status, 503)
  assert.equal(calls.length, 3)
})

test("invited-user sign-up is an exact four-field JSON relay with a server-owned callback", async () => {
  const invitation = "123e4567-e89b-42d3-a456-426614174000"
  const callbackURL = `${webOrigin}/iam/interactions/invitation?id=${invitation}`
  const calls: Array<{ url: string | undefined; cookie: string | undefined; body: string }> = []
  const iam = await listen(
    createServer((request, response) => {
      const chunks: Buffer[] = []
      request.on("data", (chunk: Buffer) => chunks.push(chunk))
      request.on("end", () => {
        calls.push({ url: request.url, cookie: request.headers.cookie, body: Buffer.concat(chunks).toString("utf8") })
        response.writeHead(200, { "content-type": "application/json; charset=utf-8" })
        response.end(
          JSON.stringify({
            token: null,
            user: {
              id: "user-1",
              email: "invitee@example.test",
              name: "Invitee",
              image: null,
              emailVerified: false,
              createdAt: "2026-09-25T00:00:00.000Z",
              updatedAt: "2026-09-25T00:00:00.000Z",
            },
          }),
        )
      })
    }),
  )
  const base = await listen(bff(iam, { tenantId: "tenant-fixed" }))
  const body = { name: "Invitee", email: "invitee@example.test", password: "Test-only-password-928384!", callbackURL }
  const headers = { ...webServiceHeaders, origin: webOrigin, "content-type": "application/json" }
  const accepted = await fetch(`${base}/iam/sign-up/email`, { method: "POST", headers, body: JSON.stringify(body) })
  assert.equal(accepted.status, 200)
  assert.equal(accepted.headers.get("cache-control"), "no-store")
  assert.equal(accepted.headers.get("referrer-policy"), "no-referrer")
  assert.deepEqual(calls, [{ url: "/iam/sign-up/email", cookie: undefined, body: JSON.stringify(body) }])

  const invalidBodies: unknown[] = [
    { ...body, image: "https://outside.example/image" },
    { ...body, rememberMe: false },
    { ...body, callbackURL: `${webOrigin}/iam/interactions/invitation?id=${invitation}&next=x` },
    { ...body, callbackURL: `https://outside.example/iam/interactions/invitation?id=${invitation}` },
    { ...body, callbackURL: `${webOrigin}/iam/interactions/invitation?id=${invitation.toUpperCase()}` },
    { ...body, name: "" },
    { ...body, email: "" },
    { ...body, password: "" },
  ]
  for (const invalid of invalidBodies) {
    assert.equal((await fetch(`${base}/iam/sign-up/email`, { method: "POST", headers, body: JSON.stringify(invalid) })).status, 400)
  }
  for (const [path, overrides, status] of [
    [`${base}/iam/sign-up/email?next=x`, {}, 400],
    [`${base}/iam/sign-up/email`, { cookie: "kokoro-issuer.session_token=issuer" }, 403],
    [`${base}/iam/sign-up/email`, { authorization: "Bearer product" }, 403],
    [`${base}/iam/sign-up/email`, { "idempotency-key": "not-supported" }, 400],
    [`${base}/iam/sign-up/email`, { origin: "https://outside.example" }, 403],
    [`${base}/iam/sign-up/email`, { "content-type": "text/plain" }, 400],
  ] as const) {
    assert.equal(
      (
        await fetch(path, {
          method: "POST",
          headers: { ...headers, ...overrides },
          body: JSON.stringify(body),
        })
      ).status,
      status,
      path,
    )
  }
  assert.equal(calls.length, 1)
})

test("verify-email permits only the invitation success Location or one owner-enumerated error", async () => {
  const invitation = "123e4567-e89b-42d3-a456-426614174000"
  let location = `${webOrigin}/iam/interactions/invitation?id=${invitation}`
  const iam = await listen(
    createServer((_request, response) => {
      response.writeHead(302, { location })
      response.end()
    }),
  )
  const base = await listen(bff(iam))
  const request = () => fetch(`${base}/iam/verify-email?token=opaque`, { headers: webServiceHeaders, redirect: "manual" })
  assert.equal((await request()).status, 302)
  for (const error of ["TOKEN_EXPIRED", "INVALID_TOKEN", "USER_NOT_FOUND", "INVALID_USER"]) {
    location = `${webOrigin}/iam/interactions/invitation?id=${invitation}&error=${error}`
    const response = await request()
    assert.equal(response.status, 302, error)
    assert.equal(response.headers.get("location"), location)
  }
  for (const query of [
    `id=${invitation}&error=OTHER`,
    `error=INVALID_TOKEN&id=${invitation}`,
    `id=${invitation}&error=INVALID_TOKEN&error=INVALID_TOKEN`,
    `id=${invitation}&code=INVALID_TOKEN`,
    `id=${invitation}&error=INVALID_TOKEN&next=x`,
    `id=${invitation.toUpperCase()}&error=INVALID_TOKEN`,
  ]) {
    location = `${webOrigin}/iam/interactions/invitation?${query}`
    assert.equal((await request()).status, 502, query)
  }
})

test("invitation responses are pinned to owner statuses, strict schemas and non-redirecting headers", async () => {
  const tenant = "tenant-fixed"
  const invitation = "123e4567-e89b-42d3-a456-426614174000"
  const success = {
    data: {
      invitation_id: invitation,
      tenant_id: tenant,
      tenant_name: "Fixed tenant",
      roles: ["member"],
      status: "pending",
      expires_at: "2026-09-26T00:00:00.000Z",
    },
  }
  const ownerError = { error: { code: "RATE_LIMITED", message: "Too many requests", retryable: true, details: [] } }
  let upstream = { status: 200, headers: { "content-type": "application/json; charset=utf-8" } as Record<string, string | string[]>, body: success as unknown }
  const iam = await listen(
    createServer((_request, response) => {
      response.writeHead(upstream.status, upstream.headers)
      response.end(typeof upstream.body === "string" ? upstream.body : JSON.stringify(upstream.body))
    }),
  )
  const base = await listen(bff(iam, { tenantId: tenant }))
  const target = `${base}/iam/v1/tenants/${tenant}/invitations/${invitation}/context`
  const headers = { ...webServiceHeaders, origin: webOrigin, cookie: "kokoro-issuer.session_token=issuer-session" }
  const request = () => fetch(target, { headers, redirect: "manual" })

  upstream = { status: 429, headers: { "content-type": "application/json", "retry-after": "60" }, body: ownerError }
  const rateLimited = await request()
  assert.equal(rateLimited.status, 429)
  assert.equal(rateLimited.headers.get("retry-after"), "60")
  assert.deepEqual(await rateLimited.json(), {
    error: { code: "RATE_LIMITED", message: "Too many invitation requests", retryable: true, details: [] },
  })
  assert.doesNotMatch(
    await (async () => {
      upstream = {
        status: 429,
        headers: { "content-type": "application/json", "retry-after": "60" },
        body: { error: { ...ownerError.error, message: "token=secret password=secret stack=/internal/path" } },
      }
      return (await request()).text()
    })(),
    /token|password|internal/iu,
  )

  const invalid: Array<{ label: string; status: number; headers: Record<string, string | string[]>; body: unknown }> = [
    { label: "undeclared status", status: 201, headers: { "content-type": "application/json" }, body: success },
    { label: "wrong media type", status: 200, headers: { "content-type": "text/plain" }, body: success },
    { label: "malformed JSON", status: 200, headers: { "content-type": "application/json" }, body: "{" },
    { label: "extra success field", status: 200, headers: { "content-type": "application/json" }, body: { ...success, extra: true } },
    {
      label: "extra nested field",
      status: 200,
      headers: { "content-type": "application/json" },
      body: { data: { ...success.data, extra: true } },
    },
    { label: "error body on 200", status: 200, headers: { "content-type": "application/json" }, body: ownerError },
    {
      label: "unknown owner error",
      status: 400,
      headers: { "content-type": "application/json" },
      body: { error: { ...ownerError.error, code: "UNKNOWN" } },
    },
    {
      label: "non-empty owner error details",
      status: 400,
      headers: { "content-type": "application/json" },
      body: { error: { ...ownerError.error, details: [{ token: "must-not-cross" }] } },
    },
    { label: "redirect", status: 302, headers: { location: `${webOrigin}/auth/sign-in` }, body: "" },
    {
      label: "issuer cookie",
      status: 200,
      headers: {
        "content-type": "application/json",
        "set-cookie": "kokoro-issuer.session_token=leak; Path=/iam; HttpOnly; SameSite=Lax",
      },
      body: success,
    },
    { label: "invalid retry", status: 429, headers: { "content-type": "application/json", "retry-after": "0" }, body: ownerError },
  ]
  for (const candidate of invalid) {
    upstream = candidate
    const response = await request()
    assert.equal(response.status, 502, candidate.label)
    assert.equal(response.headers.get("location"), null, candidate.label)
    assert.equal(response.headers.get("set-cookie"), null, candidate.label)
  }
})

test("invited-user sign-up accepts only pinned snapshot statuses and never forwards a credential token", async () => {
  const invitation = "123e4567-e89b-42d3-a456-426614174000"
  let upstream = { status: 302, headers: { location: `${webOrigin}/auth/sign-in` } as Record<string, string>, body: "" }
  const iam = await listen(
    createServer((_request, response) => {
      response.writeHead(upstream.status, upstream.headers)
      response.end(upstream.body)
    }),
  )
  const base = await listen(bff(iam))
  const request = () =>
    fetch(`${base}/iam/sign-up/email`, {
      method: "POST",
      headers: { ...webServiceHeaders, origin: webOrigin, "content-type": "application/json" },
      body: JSON.stringify({
        name: "Invitee",
        email: "invitee@example.test",
        password: "Test-only-password-928384!",
        callbackURL: `${webOrigin}/iam/interactions/invitation?id=${invitation}`,
      }),
      redirect: "manual",
    })
  assert.equal((await request()).status, 502)
  upstream = { status: 201, headers: { "content-type": "application/json" }, body: "{}" }
  assert.equal((await request()).status, 502)
  for (const status of [409, 503]) {
    upstream = { status, headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "UNDECLARED", message: "not in snapshot" }) }
    assert.equal((await request()).status, 502, String(status))
  }
  upstream = {
    status: 422,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "duplicate token=secret password=secret stack=/internal/path" }),
  }
  const rejected = await request()
  assert.equal(rejected.status, 422)
  assert.deepEqual(await rejected.json(), { code: "IAM_SIGN_UP_REJECTED", message: "Invitation sign-up was rejected" })
  for (const status of [403, 429]) {
    upstream = { status, headers: { "content-type": "application/json", ...(status === 429 ? { "retry-after": "60" } : {}) }, body: "{}" }
    const response = await request()
    assert.equal(response.status, status)
    assert.deepEqual(await response.json(), {
      code: status === 403 ? "IAM_SIGN_UP_FORBIDDEN" : "IAM_SIGN_UP_RATE_LIMITED",
      message: status === 403 ? "Invitation sign-up was not permitted" : "Too many invitation sign-up requests",
    })
    if (status === 429) assert.equal(response.headers.get("retry-after"), "60")
  }
  upstream = {
    status: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      token: null,
      user: {
        id: "user-1",
        email: "not-email",
        name: "Invitee",
        image: "not-uri",
        emailVerified: false,
        createdAt: "not-date",
        updatedAt: "2026-09-25T00:00:00.000Z",
      },
    }),
  }
  assert.equal((await request()).status, 502)
  upstream = {
    status: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      token: "must-not-cross-the-relay",
      user: {
        id: "user-1",
        email: "invitee@example.test",
        name: "Invitee",
        image: null,
        emailVerified: false,
        createdAt: "2026-09-25T00:00:00.000Z",
        updatedAt: "2026-09-25T00:00:00.000Z",
      },
    }),
  }
  assert.equal((await request()).status, 502)
  upstream = {
    status: 200,
    headers: {
      "content-type": "application/json",
      "set-cookie": "kokoro-issuer.session_token=must-not-cross; Path=/iam; HttpOnly; SameSite=Lax",
    },
    body: JSON.stringify({
      token: null,
      user: {
        id: "user-1",
        email: "invitee@example.test",
        name: "Invitee",
        image: null,
        emailVerified: false,
        createdAt: "2026-09-25T00:00:00.000Z",
        updatedAt: "2026-09-25T00:00:00.000Z",
      },
    }),
  }
  assert.equal((await request()).status, 502)
})

test("relay rejects path aliases, wrong methods and browser credentials before IAM I/O", async () => {
  let calls = 0
  const iam = await listen(
    createServer((_request, response) => {
      calls++
      response.end("unexpected")
    }),
  )
  const base = await listen(bff(iam))
  for (const path of [
    "/iam/oauth2/%74oken",
    "/iam//oauth2/token",
    "/iam/oauth2/../token",
    "/iam/OAuth2/token",
    "/iam/internal/v1/users",
    "/iam/oauth2/register",
  ]) {
    const response = await fetch(`${base}${path}`, {
      headers: webServiceHeaders,
      redirect: "manual",
    })
    assert.equal(response.status, 404, path)
  }
  assert.equal(
    (
      await fetch(`${base}/iam/oauth2/token`, {
        method: "POST",
        headers: { ...webServiceHeaders, origin: webOrigin },
      })
    ).status,
    403,
  )
  assert.equal(
    (
      await fetch(`${base}/iam/get-session`, {
        headers: {
          ...webServiceHeaders,
          authorization: "Bearer browser-token",
        },
      })
    ).status,
    403,
  )
  assert.equal(
    (
      await fetch(`${base}/iam/sign-in/email`, {
        method: "POST",
        headers: webServiceHeaders,
        body: "{}",
      })
    ).status,
    403,
  )
  assert.equal(calls, 0)
})

test("token Basic is only relayed on the exact endpoint and cookies are never forwarded", async () => {
  let authorization = ""
  let cookie: string | undefined
  const iam = await listen(
    createServer((request, response) => {
      authorization = request.headers.authorization ?? ""
      cookie = request.headers.cookie
      response.writeHead(200, {
        "content-type": "application/json",
        "cache-control": "no-store",
      })
      response.end('{"access_token":"owner-token"}')
    }),
  )
  const base = await listen(bff(iam))
  const response = await fetch(`${base}/iam/oauth2/token`, {
    method: "POST",
    headers: {
      ...webServiceHeaders,
      authorization: "Basic Y2xpZW50OnNlY3JldA==",
      cookie: "authjs.session-token=private",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=authorization_code&code=opaque",
  })
  assert.equal(response.status, 200)
  assert.equal(authorization, "Basic Y2xpZW50OnNlY3JldA==")
  assert.equal(cookie, undefined)
})

test("native 429 and logout security headers survive, while hostile redirect and cookies fail closed", async () => {
  let mode: "rate" | "logout" | "hostile" = "rate"
  const iam = await listen(
    createServer((_request, response) => {
      if (mode === "rate")
        response.writeHead(429, {
          "retry-after": "60",
          "cache-control": "no-store",
          "content-type": "application/json",
        })
      if (mode === "logout")
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "content-security-policy": "default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
          "x-content-type-options": "nosniff",
          pragma: "no-cache",
          "set-cookie": [
            "kokoro-issuer.session_token.oauth_logout_confirmation=state; Path=/iam/oauth2/end-session/confirm; HttpOnly; SameSite=Lax",
            "kokoro-issuer.session_token=active; Path=/iam; HttpOnly; SameSite=Lax",
          ],
        })
      if (mode === "hostile")
        response.writeHead(302, {
          location: "https://evil.example/steal",
          "set-cookie": "authjs.session-token=leak; Path=/; HttpOnly",
        })
      response.end(mode === "logout" ? "<html>Confirm</html>" : "{}")
    }),
  )
  const base = await listen(bff(iam))

  const rate = await fetch(`${base}/iam/.well-known/openid-configuration`, {
    headers: webServiceHeaders,
  })
  assert.equal(rate.status, 429)
  assert.equal(rate.headers.get("retry-after"), "60")

  mode = "logout"
  const logout = await fetch(`${base}/iam/oauth2/end-session`, {
    headers: webServiceHeaders,
  })
  assert.equal(logout.status, 200)
  assert.equal(logout.headers.get("content-security-policy"), "default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'")
  assert.equal(logout.headers.get("x-content-type-options"), "nosniff")
  assert.equal(logout.headers.get("pragma"), "no-cache")
  assert.equal(logout.headers.getSetCookie().length, 2)

  mode = "hostile"
  const hostile = await fetch(`${base}/iam/.well-known/openid-configuration`, {
    headers: webServiceHeaders,
    redirect: "manual",
  })
  assert.equal(hostile.status, 502)
  assert.equal(hostile.headers.get("location"), null)
  assert.equal(hostile.headers.getSetCookie().length, 0)
})

test("only native logout GET presents trusted browser navigation semantics to IAM", async () => {
  const calls: Array<{ path: string | undefined; method: string | undefined; mode: string | undefined; accept: string | undefined }> = []
  const iam = await listen(
    createServer((request, response) => {
      calls.push({ path: request.url, method: request.method, mode: request.headers["sec-fetch-mode"], accept: request.headers.accept })
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" })
      response.end("{}")
    }),
  )
  const base = await listen(bff(iam))

  const logout = await fetch(`${base}/iam/oauth2/end-session`, {
    headers: { ...webServiceHeaders, accept: "text/html", "sec-fetch-mode": "cors" },
  })
  assert.equal(logout.status, 200)

  const ordinary = await fetch(`${base}/iam/get-session`, {
    headers: { ...webServiceHeaders, "sec-fetch-mode": "navigate" },
  })
  assert.equal(ordinary.status, 200)

  const logoutPost = await fetch(`${base}/iam/oauth2/end-session`, {
    method: "POST",
    headers: { ...webServiceHeaders, origin: webOrigin, "sec-fetch-mode": "navigate" },
  })
  assert.equal(logoutPost.status, 200)

  assert.deepEqual(calls, [
    { path: "/iam/oauth2/end-session", method: "GET", mode: "navigate", accept: "text/html" },
    { path: "/iam/get-session", method: "GET", mode: "cors", accept: "*/*" },
    { path: "/iam/oauth2/end-session", method: "POST", mode: "cors", accept: "*/*" },
  ])
})

test("duplicate Authorization never downgrades to an anonymous issuer request", async () => {
  let calls = 0
  const iam = await listen(
    createServer((_request, response) => {
      calls++
      response.end("unexpected")
    }),
  )
  const base = await listen(bff(iam))
  const target = new URL(`${base}/iam/get-session`)
  const status = await new Promise<number>((resolve, reject) => {
    const request = httpRequest(
      {
        host: target.hostname,
        port: Number(target.port),
        path: target.pathname,
        method: "GET",
        headers: ["x-kokoro-service", "web-bff", "x-kokoro-internal-secret", "test-secret", "Authorization", "Basic first", "Authorization", "Bearer second"],
      },
      (response) => {
        response.resume()
        response.on("end", () => resolve(response.statusCode ?? 0))
      },
    )
    request.once("error", reject)
    request.end()
  })
  assert.ok(status === 400 || status === 403)
  assert.equal(calls, 0)
})

test("duplicate issuer Cookie headers are rejected rather than silently discarded", async () => {
  let calls = 0
  const iam = await listen(
    createServer((_request, response) => {
      calls++
      response.end("unexpected")
    }),
  )
  const base = await listen(bff(iam))
  const target = new URL(`${base}/iam/get-session`)
  const status = await new Promise<number>((resolve, reject) => {
    const request = httpRequest(
      {
        host: target.hostname,
        port: Number(target.port),
        path: target.pathname,
        method: "GET",
        headers: [
          "x-kokoro-service",
          "web-bff",
          "x-kokoro-internal-secret",
          "test-secret",
          "Cookie",
          "kokoro-issuer.session_token=one",
          "Cookie",
          "kokoro-issuer.session_token=two",
        ],
      },
      (response) => {
        response.resume()
        response.on("end", () => resolve(response.statusCode ?? 0))
      },
    )
    request.once("error", reject)
    request.end()
  })
  assert.equal(status, 400)
  assert.equal(calls, 0)
})

test("slow inbound body shares the relay deadline and never opens an IAM request", async () => {
  let calls = 0
  const iam = await listen(
    createServer((_request, response) => {
      calls++
      response.end("unexpected")
    }),
  )
  const base = await listen(bff(iam, { timeoutMs: 120 }))
  const target = new URL(`${base}/iam/sign-in/email`)
  const started = Date.now()
  const status = await new Promise<number>((resolve, reject) => {
    const request = httpRequest(
      {
        host: target.hostname,
        port: Number(target.port),
        path: target.pathname,
        method: "POST",
        headers: {
          ...webServiceHeaders,
          origin: webOrigin,
          "content-type": "application/json",
          "content-length": "1000",
        },
      },
      (response) => {
        response.resume()
        response.on("end", () => {
          clearTimeout(timer)
          resolve(response.statusCode ?? 0)
        })
      },
    )
    const timer = setTimeout(() => {
      request.destroy()
      reject(new Error("BFF did not enforce inbound deadline"))
    }, 600)
    request.once("error", (error) => {
      clearTimeout(timer)
      reject(error)
    })
    request.write('{"email":"a')
  })
  assert.equal(status, 503)
  assert.ok(Date.now() - started < 1000)
  assert.equal(calls, 0)
})

test("oversized inbound body is rejected before IAM I/O", async () => {
  let calls = 0
  const iam = await listen(
    createServer((_request, response) => {
      calls++
      response.end("unexpected")
    }),
  )
  const base = await listen(bff(iam))
  const response = await fetch(`${base}/iam/sign-in/email`, {
    method: "POST",
    headers: {
      ...webServiceHeaders,
      origin: webOrigin,
      "content-type": "application/json",
    },
    body: "x".repeat(65_537),
  })
  assert.equal(response.status, 413)
  assert.equal(calls, 0)
})

test("oversized inbound headers never reach IAM", async () => {
  let calls = 0
  const iam = await listen(
    createServer((_request, response) => {
      calls++
      response.end("unexpected")
    }),
  )
  const base = await listen(bff(iam))
  const response = await fetch(`${base}/iam/get-session`, {
    headers: { ...webServiceHeaders, "x-oversized": "x".repeat(17_000) },
  })
  assert.ok(response.status === 413 || response.status === 431)
  assert.equal(calls, 0)
})

test("aborted inbound upload never opens an IAM request", async () => {
  let calls = 0
  const iam = await listen(
    createServer((_request, response) => {
      calls++
      response.end("unexpected")
    }),
  )
  const base = await listen(bff(iam, { timeoutMs: 100 }))
  const target = new URL(`${base}/iam/sign-in/email`)
  await new Promise<void>((resolve, reject) => {
    const request = httpRequest({
      host: target.hostname,
      port: Number(target.port),
      path: target.pathname,
      method: "POST",
      headers: {
        ...webServiceHeaders,
        origin: webOrigin,
        "content-length": "1000",
      },
    })
    request.once("error", (error) => {
      if ((error as NodeJS.ErrnoException).code !== "ECONNRESET") reject(error)
    })
    request.write("partial")
    setTimeout(() => {
      request.destroy()
      resolve()
    }, 20)
  })
  await new Promise((resolve) => setTimeout(resolve, 130))
  assert.equal(calls, 0)
})

test("upstream response body cap cancels the live IAM stream", async () => {
  let closed!: () => void
  const upstreamClosed = new Promise<void>((resolve) => {
    closed = resolve
  })
  const iam = await listen(
    createServer((_request, response) => {
      response.once("close", closed)
      response.writeHead(200, { "content-type": "application/json" })
      response.write("x".repeat(128))
      response.write("y")
    }),
  )
  const base = await listen(bff(iam, { responseBytes: 64 }))
  const result = await fetch(`${base}/iam/get-session`, {
    headers: webServiceHeaders,
  })
  assert.equal(result.status, 503)
  await Promise.race([upstreamClosed, new Promise((_, reject) => setTimeout(() => reject(new Error("IAM stream was not cancelled")), 500))])
})

test("upstream response header cap cancels the live IAM stream", async () => {
  let closed!: () => void
  const upstreamClosed = new Promise<void>((resolve) => {
    closed = resolve
  })
  const iam = await listen(
    createServer((_request, response) => {
      response.once("close", closed)
      response.writeHead(200, {
        "set-cookie": `large=${"x".repeat(8500)}; Path=/iam; HttpOnly; SameSite=Lax`,
      })
      response.write("pending")
    }),
  )
  const base = await listen(bff(iam))
  const result = await fetch(`${base}/iam/get-session`, {
    headers: webServiceHeaders,
  })
  assert.equal(result.status, 503)
  await Promise.race([upstreamClosed, new Promise((_, reject) => setTimeout(() => reject(new Error("IAM header stream was not cancelled")), 500))])
})

test("native logout navigation enforces the same upstream body cap and closes the socket", async () => {
  let closed!: () => void
  const upstreamClosed = new Promise<void>((resolve) => {
    closed = resolve
  })
  const iam = await listen(
    createServer((_request, response) => {
      response.once("close", closed)
      response.writeHead(200, { "content-type": "text/html" })
      response.write("x".repeat(128))
      response.write("y")
    }),
  )
  const base = await listen(bff(iam, { responseBytes: 64 }))
  const result = await fetch(`${base}/iam/oauth2/end-session`, {
    headers: { ...webServiceHeaders, accept: "text/html" },
  })
  assert.equal(result.status, 503)
  await Promise.race([upstreamClosed, new Promise((_, reject) => setTimeout(() => reject(new Error("IAM logout stream was not cancelled")), 500))])
})

test("native logout navigation shares the bounded upstream deadline", async () => {
  let closed!: () => void
  const upstreamClosed = new Promise<void>((resolve) => {
    closed = resolve
  })
  const iam = await listen(
    createServer((_request, response) => {
      response.once("close", closed)
      response.writeHead(200, { "content-type": "text/html" })
      response.write("pending")
    }),
  )
  const base = await listen(bff(iam, { timeoutMs: 120 }))
  const result = await fetch(`${base}/iam/oauth2/end-session`, {
    headers: { ...webServiceHeaders, accept: "text/html" },
  })
  assert.equal(result.status, 503)
  await Promise.race([upstreamClosed, new Promise((_, reject) => setTimeout(() => reject(new Error("IAM logout deadline did not close socket")), 500))])
})
