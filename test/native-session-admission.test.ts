import assert from "node:assert/strict"
import { createServer, IncomingMessage, ServerResponse, type Server } from "node:http"
import { Socket } from "node:net"
import { setImmediate as nextTurn } from "node:timers/promises"
import test from "node:test"
import { loadConfig } from "../dist/config/runtime.js"
import { handleBrowserAuthSessionRequest } from "../dist/auth/auth-session.http.js"
import { nativeSessionCookie } from "../dist/auth/user-admission.js"
import type { SessionAdmissionInput, SessionAdmissionResult } from "../src/auth/session-admission.types.js"
import { fixtureIamCredentials, TEST_IAM_USER_CONTEXT_SECRET } from "./doubles/iam-credentials.ts"

const tenant = "tenant-browser"
const origin = "https://web.example.test"
const sessionHeaders = {
  "x-kokoro-service": "web-bff",
  "x-kokoro-internal-secret": "browser-fixture",
  origin,
  cookie: "__Secure-kokoro-issuer.session_token=browser-session",
}
const native = () => ({
  session: {
    id: "PRIVATE_SID_CANARY",
    token: "PRIVATE_TOKEN_CANARY",
    userId: "subject",
    activeOrganizationId: tenant,
    expiresAt: "2099-01-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ipAddress: "PRIVATE_IP_CANARY",
    userAgent: "PRIVATE_UA_CANARY",
  },
  user: {
    id: "subject",
    name: "Person",
    email: "person@example.test",
    emailVerified: true,
    image: null,
    platformAdmin: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
})
async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  assert.ok(address && typeof address !== "string")
  return `http://127.0.0.1:${address.port}`
}
async function close(server: Server) {
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
}
async function fixture(
  run: (base: string, requests: IncomingMessage[], setState: (value: "valid" | "anonymous" | "foreign" | "outage") => void) => Promise<void>,
) {
  let state = "valid"
  const requests: IncomingMessage[] = []
  const peer = createServer((request, response) => {
    requests.push(request)
    response.setHeader("content-type", "application/json")
    response.setHeader("cache-control", "no-store")
    response.setHeader("x-request-id", request.headers["x-request-id"] ?? "peer")
    response.setHeader("set-auth-jwt", "PRIVATE_JWT_CANARY")
    if (request.url?.startsWith("/iam/get-session")) {
      if (state === "outage") {
        response.statusCode = 500
        response.end(JSON.stringify({ message: "PRIVATE_OWNER_ERROR_CANARY" }))
        return
      }
      response.setHeader("set-cookie", [
        "__Secure-kokoro-issuer.session_token=rolling; Path=/; HttpOnly; Secure; SameSite=Lax",
        "__Secure-kokoro-issuer.session_data=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
      ])
      const value = native()
      if (state === "foreign") value.session.activeOrganizationId = "foreign"
      response.end(JSON.stringify(state === "anonymous" ? null : value))
    } else {
      assert.equal(request.url, "/internal/v1/authorization/check")
      assert.equal(request.headers.authorization, `Bearer ${TEST_IAM_USER_CONTEXT_SECRET}`)
      assert.equal(request.headers["x-kokoro-actor-id"], "subject")
      assert.equal(request.headers.cookie, undefined)
      assert.equal(request.headers.origin, undefined)
      response.end(JSON.stringify({ data: { allowed: true, tenant_id: tenant, subject_id: "subject", decision_source: "current_membership" } }))
    }
  })
  try {
    const owner = await listen(peer)
    const config = {
      ...loadConfig({
        KOKORO_IAM_BASE_URL: owner,
        KOKORO_IAM_WEB_ORIGIN: origin,
        KOKORO_TENANT_ID: tenant,
        KOKORO_BFF_SHARED_SECRET: "browser-fixture",
        KOKORO_BFF_POSTGRES_URL: "postgresql://fixture:fixture@127.0.0.1:1/fixture?schema=kokoro_bff",
        KOKORO_BFF_REDIS_URL: "redis://127.0.0.1:1/8",
      }),
      ...(await fixtureIamCredentials(tenant)),
    }
    await import("reflect-metadata")
    const { Test } = await import("@nestjs/testing")
    const { AccountModule } = await import("../dist/modules/account/account.module.js")
    const { BFF_NEST_APPLICATION_OPTIONS } = await import("../dist/main.js")
    const { BFF_CONFIG, BFF_DATABASE } = await import("../dist/common/tokens.js")
    const unexpected = () => assert.fail("native session HTTP must not access the BFF database")
    const moduleRef = await Test.createTestingModule({ imports: [AccountModule] })
      .overrideProvider(BFF_CONFIG)
      .useValue(config)
      .overrideProvider(BFF_DATABASE)
      .useValue({ pool: { query: unexpected, connect: unexpected }, ready: unexpected })
      .compile()
    const app = moduleRef.createNestApplication({ ...BFF_NEST_APPLICATION_OPTIONS, logger: false })
    try {
      await app.listen(0, "127.0.0.1")
      const base = await app.getUrl()
      await run(base, requests, (value) => {
        state = value
      })
    } finally {
      await app.close()
    }
  } finally {
    if (peer.listening) await close(peer)
  }
}

function statusRequest() {
  const socket = new Socket()
  const request = new IncomingMessage(socket)
  request.url = "/browser/v1/auth/session"
  request.method = "GET"
  request.headers = sessionHeaders
  request.rawHeaders = Object.entries(sessionHeaders).flat()
  const response = new ServerResponse(request)
  const config = {
    ...loadConfig({
      KOKORO_IAM_WEB_ORIGIN: origin,
      KOKORO_TENANT_ID: tenant,
      KOKORO_BFF_SHARED_SECRET: "browser-fixture",
      KOKORO_BFF_POSTGRES_URL: "postgresql://fixture:fixture@127.0.0.1:1/fixture?schema=kokoro_bff",
      KOKORO_BFF_REDIS_URL: "redis://127.0.0.1:1/8",
    }),
    upstreamTimeoutMs: 20,
  }
  return { socket, request, response, config }
}

const safeAdmission = (): SessionAdmissionResult => ({
  ok: true,
  identity: { namespace: tenant, userId: "subject" },
  platformAdmin: false,
  expiresAt: "2099-01-01T00:00:00.000Z",
  setCookies: ["__Secure-kokoro-issuer.session_token=late; Path=/; HttpOnly; Secure; SameSite=Lax"],
})

test("status deadline retires a non-cooperative admission and never adopts its late cookie", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const f = statusRequest()
  const end = t.mock.method(f.response, "end")
  let release!: (value: SessionAdmissionResult) => void
  let input!: SessionAdmissionInput
  let finished = false
  const held = new Promise<SessionAdmissionResult>((resolve) => {
    release = resolve
  })
  const pending = handleBrowserAuthSessionRequest(f.request, f.response, f.config, {
    verify: (value) => {
      input = value
      return held
    },
  }).then((value) => {
    finished = true
    return value
  })
  try {
    t.mock.timers.tick(20)
    await nextTurn()
    assert.equal(finished, true, "HTTP must settle even while admission ignores cancellation")
    assert.equal(input.signal.aborted, true)
    assert.equal(f.response.statusCode, 503)
    assert.match(String(end.mock.calls[0]?.arguments[0]), /"code":"iam_admission_unavailable"/u)
    assert.equal(f.response.getHeader("set-cookie"), undefined)
    assert.equal(f.request.listenerCount("aborted"), 0)
    assert.equal(f.response.listenerCount("close"), 0)
    release(safeAdmission())
    await nextTurn()
    assert.equal(end.mock.callCount(), 1)
    assert.equal(f.response.getHeader("set-cookie"), undefined)
  } finally {
    release(safeAdmission())
    await pending
    f.socket.destroy()
  }
})

test("pre-retired status requests never admit or write, including already-ended responses", async (t) => {
  for (const state of ["aborted", "destroyed", "ended"] as const) {
    const f = statusRequest()
    if (state === "aborted") f.request.destroy()
    if (state === "destroyed") f.response.destroy()
    if (state === "ended") f.response.end()
    const header = t.mock.method(f.response, "setHeader")
    const end = t.mock.method(f.response, "end")
    const verify = t.mock.fn(async () => safeAdmission())
    try {
      assert.equal(await handleBrowserAuthSessionRequest(f.request, f.response, f.config, { verify }), true)
      assert.equal(verify.mock.callCount(), 0, state)
      assert.equal(header.mock.callCount(), 0, state)
      assert.equal(end.mock.callCount(), 0, state)
      assert.equal(f.request.listenerCount("aborted"), 0)
      assert.equal(f.response.listenerCount("close"), 0)
    } finally {
      f.socket.destroy()
    }
  }
})

test("browser disconnect finishes the status wait without a late response or unobserved rejection", async (t) => {
  const f = statusRequest()
  const end = t.mock.method(f.response, "end")
  let reject!: (error: Error) => void
  let input!: SessionAdmissionInput
  let finished = false
  const held = new Promise<SessionAdmissionResult>((_resolve, fail) => {
    reject = fail
  })
  const pending = handleBrowserAuthSessionRequest(f.request, f.response, f.config, {
    verify: (value) => {
      input = value
      return held
    },
  }).then((value) => {
    finished = true
    return value
  })
  try {
    f.response.emit("close")
    await nextTurn()
    assert.equal(finished, true)
    assert.equal(input.signal.aborted, true)
    assert.equal(end.mock.callCount(), 0)
    assert.equal(f.request.listenerCount("aborted"), 0)
    assert.equal(f.response.listenerCount("close"), 0)
    reject(new Error("late admission failure"))
    await nextTurn()
    assert.equal(end.mock.callCount(), 0)
  } finally {
    reject(new Error("test cleanup"))
    await pending
    f.socket.destroy()
  }
})

test("normal and invalid-query status completion release their request resources", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  for (const invalid of [false, true]) {
    const f = statusRequest()
    if (invalid) f.request.url += "?refresh=invalid"
    const end = t.mock.method(f.response, "end")
    let input: SessionAdmissionInput | undefined
    const verify = t.mock.fn(async (value: SessionAdmissionInput) => {
      input = value
      return safeAdmission()
    })
    try {
      assert.equal(await handleBrowserAuthSessionRequest(f.request, f.response, f.config, { verify }), true)
      assert.equal(f.response.statusCode, invalid ? 400 : 200)
      assert.equal(verify.mock.callCount(), invalid ? 0 : 1)
      assert.equal(f.request.listenerCount("aborted"), 0)
      assert.equal(f.response.listenerCount("close"), 0)
      t.mock.timers.tick(5000)
      await nextTurn()
      assert.equal(input?.signal.aborted, invalid ? undefined : false)
      assert.equal(end.mock.callCount(), 1)
    } finally {
      f.socket.destroy()
    }
  }
})

test("native cookie projection rejects Product, duplicate, and malformed cookie headers", () => {
  const request = (rawHeaders: string[]) => ({ rawHeaders, headers: {} }) as IncomingMessage
  assert.equal(nativeSessionCookie(request(["Cookie", "kokoro-issuer.session_token=a"])), "kokoro-issuer.session_token=a")
  for (const raw of [
    ["Cookie", "product=a"],
    ["Cookie", "kokoro-issuer.session_token=a; kokoro-issuer.session_token=b"],
    ["Cookie", "kokoro-issuer.session_token=a", "Cookie", "kokoro-issuer.session_token=b"],
    ["Cookie", "bad"],
  ])
    assert.equal(nativeSessionCookie(request(raw)), null)
})

test("real browser HTTP closes raw Session relay and discloses only safe status or the unchanged me DTO", async () =>
  fixture(async (base, requests) => {
    for (const path of ["/iam/get-session", "/iam/get-session?disableCookieCache=true"]) {
      const rejected = await fetch(base + path, { headers: sessionHeaders })
      assert.equal(rejected.status, 404)
    }
    assert.equal(requests.length, 0)
    const status = await fetch(base + "/browser/v1/auth/session", { headers: sessionHeaders })
    assert.equal(status.status, 200)
    assert.equal(status.headers.get("cache-control"), "no-store")
    assert.equal(status.headers.getSetCookie().length, 2)
    assert.equal(status.headers.get("set-auth-jwt"), null)
    const body = await status.text()
    assert.doesNotMatch(body, /PRIVATE_|token|session_id|meta/)
    assert.deepEqual(JSON.parse(body), { data: { authenticated: true, subject: "subject", tenant_id: tenant, expires_at: "2099-01-01T00:00:00.000Z" } })
    assert.equal(requests[0]!.url, "/iam/get-session?disableCookieCache=true")
    const me = await fetch(base + "/v1/me", { headers: sessionHeaders })
    assert.equal(me.status, 200)
    const dto = await me.json()
    assert.deepEqual(dto.data, { user_id: "subject", tenant_id: tenant, platform_admin: false })
    assert.deepEqual(Object.keys(dto).sort(), ["data", "meta"])
    assert.equal(requests[2]!.url, "/iam/get-session?disableCookieCache=true&disableRefresh=true")
  }))

test("status separates anonymous, qualification and dependency failures; false is nonrolling and ambiguous input is rejected", async () =>
  fixture(async (base, requests, setState) => {
    for (const path of ["?refresh=0", "?refresh=true&refresh=false", "?extra=true"])
      assert.equal((await fetch(base + "/browser/v1/auth/session" + path, { headers: sessionHeaders })).status, 400)
    assert.equal(requests.length, 0)
    const missing = await fetch(base + "/browser/v1/auth/session", { headers: { ...sessionHeaders, cookie: "", authorization: "Bearer not-a-native-login" } })
    assert.deepEqual(await missing.json(), { data: { authenticated: false } })
    assert.equal(requests.length, 0, "Bearer never falls back to login")
    setState("anonymous")
    const anonymous = await fetch(base + "/browser/v1/auth/session?refresh=false", { headers: sessionHeaders })
    assert.deepEqual(await anonymous.json(), { data: { authenticated: false } })
    assert.equal(anonymous.headers.getSetCookie().length, 2, "invalid Cookie cleanup survives nonrolling reads")
    assert.equal(requests[0]!.url, "/iam/get-session?disableCookieCache=true&disableRefresh=true")
    setState("foreign")
    const forbidden = await fetch(base + "/browser/v1/auth/session", { headers: sessionHeaders })
    assert.equal(forbidden.status, 403)
    assert.deepEqual(await forbidden.json(), { error: { code: "product_tenant_forbidden", message: "Product tenant is not permitted", retryable: false } })
    setState("outage")
    const outage = await fetch(base + "/browser/v1/auth/session", { headers: sessionHeaders })
    assert.equal(outage.status, 503)
    assert.doesNotMatch(await outage.text(), /PRIVATE_|authenticated/)
  }))

test("real Nest middleware share one explicit authentication provider across status and Account before response", async () => {
  await import("reflect-metadata")
  const { Test } = await import("@nestjs/testing")
  const { AuthenticationModule } = await import("../dist/modules/authentication/authentication.module.js")
  const { AccountModule } = await import("../dist/modules/account/account.module.js")
  const { BFF_CONFIG, BFF_DATABASE, SESSION_ADMISSION } = await import("../dist/common/tokens.js")
  const config = loadConfig({
    KOKORO_BFF_SHARED_SECRET: "browser-fixture",
    KOKORO_BFF_ADMIN_WEB_SHARED_SECRET: "admin-fixture",
    KOKORO_IAM_BASE_URL: "http://127.0.0.1:1",
    KOKORO_IAM_WEB_ORIGIN: origin,
    KOKORO_TENANT_ID: tenant,
    KOKORO_BFF_POSTGRES_URL: "postgresql://fixture:fixture@127.0.0.1:1/fixture?schema=kokoro_bff",
    KOKORO_BFF_REDIS_URL: "redis://127.0.0.1:1/8",
  })
  const calls: unknown[] = []
  const provider = {
    verify: async (input: unknown) => {
      calls.push(input)
      return { ok: true, identity: { namespace: tenant, userId: "subject" }, platformAdmin: false, expiresAt: "2099-01-01T00:00:00.000Z", setCookies: [] }
    },
  }
  const unexpected = () => assert.fail("HTTP authentication must not access owner databases")
  const module = await Test.createTestingModule({ imports: [AuthenticationModule, AccountModule] })
    .overrideProvider(BFF_CONFIG)
    .useValue(config)
    .overrideProvider(BFF_DATABASE)
    .useValue({ pool: { query: unexpected }, close: async () => undefined })
    .overrideProvider(SESSION_ADMISSION)
    .useValue(provider)
    .compile()
  const app = module.createNestApplication({ logger: false })
  await app.listen(0, "127.0.0.1")
  const base = await app.getUrl()
  try {
    assert.equal(module.get(SESSION_ADMISSION, { each: true }).length, 1)
    const me = await fetch(base + "/v1/me", { headers: sessionHeaders })
    assert.equal(me.status, 200)
    const status = await fetch(base + "/browser/v1/auth/session?refresh=false", {
      headers: { ...sessionHeaders, "x-kokoro-service": "admin-web-bff", "x-kokoro-internal-secret": "admin-fixture" },
    })
    assert.equal(status.status, 200)
    assert.equal(calls.length, 2)
  } finally {
    await app.close()
  }
})

test("production Project middleware rejects failed native authentication before body, receipt claim or owner mutation", { timeout: 10000 }, async () => {
  const { SessionAdmissionClient } = await import("../dist/auth/session-admission.client.js")
  const { ProjectMutationMiddleware } = await import("../dist/modules/projects/project-mutation.middleware.js")
  for (const [scenario, expected] of [
    ["anonymous", 401],
    ["foreign", 403],
    ["corrupt", 503],
    ["service-denied", 503],
    ["wrong-origin", 403],
  ] as const) {
    let ownerCalls = 0,
      claims = 0,
      mutations = 0
    const peer = createServer((request, response) => {
      ownerCalls++
      response.setHeader("content-type", "application/json")
      response.setHeader("cache-control", "no-store")
      response.setHeader("x-request-id", request.headers["x-request-id"] ?? "project")
      if (request.url?.startsWith("/iam/get-session")) {
        const value = native()
        if (scenario === "foreign") value.session.activeOrganizationId = "foreign"
        response.end(
          JSON.stringify(scenario === "anonymous" ? null : scenario === "corrupt" ? { ...value, user: { ...value.user, platformAdmin: undefined } } : value),
        )
      } else {
        response.statusCode = 401
        response.end(
          JSON.stringify({ error: { code: "bff_user_context_service_unauthenticated", message: "private service failure", retryable: false, details: [] } }),
        )
      }
    })
    const owner = await listen(peer)
    const config = {
      ...loadConfig({
        KOKORO_IAM_BASE_URL: owner,
        KOKORO_IAM_WEB_ORIGIN: origin,
        KOKORO_TENANT_ID: tenant,
        KOKORO_BFF_SHARED_SECRET: "browser-fixture",
        KOKORO_BFF_POSTGRES_URL: "postgresql://fixture:fixture@127.0.0.1:1/fixture?schema=kokoro_bff",
        KOKORO_BFF_REDIS_URL: "redis://127.0.0.1:1/8",
      }),
      ...(await fixtureIamCredentials(tenant)),
    }
    const authentication = new SessionAdmissionClient({
      baseUrl: owner,
      credentialFile: config.iamUserContextServiceCredentialFile,
      tenantId: tenant,
      webOrigin: origin,
      timeoutMs: 200,
      maxResponseBytes: 8192,
    })
    const middleware = new ProjectMutationMiddleware(
      config,
      authentication,
      {
        create: async () => {
          mutations++
          assert.fail("rejected authentication must not mutate")
        },
      } as never,
      {
        claimReceipt: async () => {
          claims++
          assert.fail("rejected authentication must not claim a receipt")
        },
      } as never,
    )
    const bff = createServer((request, response) =>
      middleware.use(request, response, () => {
        response.statusCode = 404
        response.end()
      }),
    )
    const base = await listen(bff)
    try {
      const response = await fetch(base + "/v1/projects", {
        method: "POST",
        headers: {
          ...sessionHeaders,
          origin: scenario === "wrong-origin" ? "https://foreign.example.test" : origin,
          authorization: "Bearer forbidden-fallback",
          "content-type": "application/json",
          "idempotency-key": "native-negative",
        },
        body: JSON.stringify({ name: "Must not be read" }),
      })
      assert.equal(response.status, expected, scenario)
      assert.equal(claims, 0)
      assert.equal(mutations, 0)
      if (scenario === "wrong-origin") assert.equal(ownerCalls, 0)
      assert.doesNotMatch(await response.text(), /private service failure|forbidden-fallback/)
    } finally {
      await close(bff)
      await close(peer)
    }
  }
})
