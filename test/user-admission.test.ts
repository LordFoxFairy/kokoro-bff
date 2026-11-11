import { fixtureIamCredentials, TEST_IAM_USER_CONTEXT_SECRET } from "./doubles/iam-credentials.ts"
import { fixtureNativeSession } from "./doubles/iam-native-session.ts"
import "reflect-metadata"
import assert from "node:assert/strict"
import { Test } from "@nestjs/testing"
import {
  BFF_CONFIG,
  BFF_DATABASE,
  PROJECT_IDEMPOTENCY,
  PROJECT_READS,
  PROJECT_MUTATIONS,
  PUBLIC_SHARE_SERVICE,
  SESSION_ADMISSION,
  SKILL_AUTHORIZATION,
} from "../dist/common/tokens.js"
import { BFF_NEST_APPLICATION_OPTIONS } from "../dist/main.js"
import { AccountModule } from "../dist/modules/account/account.module.js"
import { ChatModule } from "../dist/modules/chat/chat.module.js"
import { ProjectsModule } from "../dist/modules/projects/projects.module.js"
import type { ProjectReadStore, ProjectMutationStore } from "../src/infrastructure/postgres/project-store.ts"
import type { IdempotencyRepository, PersistentReceipt } from "../src/application/ports/idempotency-repository.ts"
import type { SessionAdmission } from "../src/auth/session-admission.types.ts"
import { createServer, request as httpRequest, type Server, type IncomingMessage } from "node:http"
import { afterEach, test } from "node:test"

import { admitBrowserService } from "../src/auth/browser-service-credential.policy.ts"
import type { SkillAuthorizationInput } from "../src/auth/skill-authorization.types.ts"

import { DEFAULT_AGUI_CONFIG } from "../dist/config/runtime.js"
import { AppModule } from "../dist/app.module.js"
import type { BffConfig } from "../src/config/runtime.ts"
import { startAccountTestApp } from "./doubles/account-app.ts"
import { BffExpressAdapter } from "../dist/http/bff-express-adapter.js"
import { SessionAdmissionDouble } from "./doubles/session-admission.ts"
import { startSkillDraftTestApp } from "./doubles/skill-draft-app.ts"

const servers: Server[] = []
const iamCredentials = await fixtureIamCredentials("tenant-server")

function config(): BffConfig {
  return {
    ...iamCredentials,
    iamWebOrigin: "https://web.example.test",
    host: "127.0.0.1",
    port: 4300,
    mode: "live",
    domain: "dev.kokoro.localhost",
    tenantId: "tenant-server",
    iamBaseUrl: null,
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

const nestClosers: Array<() => Promise<void>> = []

async function listenNativeAdmission(config: BffConfig, feature = AccountModule): Promise<string> {
  const unexpected = (): never => assert.fail("session admission must not access account storage")
  const module = await Test.createTestingModule({ imports: [feature] })
    .overrideProvider(BFF_CONFIG)
    .useValue(config)
    .overrideProvider(BFF_DATABASE)
    .useValue({ pool: { query: unexpected, connect: unexpected }, ready: unexpected })
    .compile()
  const app = module.createNestApplication({ ...BFF_NEST_APPLICATION_OPTIONS, abortOnError: false, logger: false })
  nestClosers.push(() => app.close())
  await app.listen(0, "127.0.0.1")
  return app.getUrl()
}

async function listenNativeProjectAdmission(
  config: BffConfig,
  admission?: SessionAdmission,
  receipts?: Pick<IdempotencyRepository, "claimReceipt" | "putReceipt" | "releaseReceipt">,
  includeTeam = false,
): Promise<{ base: string; reads: ProjectReadStore; mutations: ProjectMutationStore }> {
  const unexpected = (): never => assert.fail("admission fixture must not access Project storage")
  const builder = Test.createTestingModule({ imports: includeTeam ? [ProjectsModule, AccountModule] : [ProjectsModule] })
    .overrideProvider(BFF_CONFIG)
    .useValue(config)
    .overrideProvider(BFF_DATABASE)
    .useValue({ pool: { query: unexpected, connect: unexpected }, redis: Object.freeze({}) })
  if (admission !== undefined) builder.overrideProvider(SESSION_ADMISSION).useValue(admission)
  if (receipts !== undefined) builder.overrideProvider(PROJECT_IDEMPOTENCY).useValue(receipts)
  const module = await builder.compile()
  const reads = module.get<ProjectReadStore>(PROJECT_READS)
  const mutations = module.get<ProjectMutationStore>(PROJECT_MUTATIONS)
  const app = module.createNestApplication({ ...BFF_NEST_APPLICATION_OPTIONS, abortOnError: false, logger: false })
  nestClosers.push(() => app.close())
  await app.listen(0, "127.0.0.1")
  return { base: await app.getUrl(), reads, mutations }
}

async function listenNativePublicShare(
  admission: SessionAdmission,
  owner: { findActiveShare: () => Promise<unknown>; listMessages: () => Promise<unknown> },
): Promise<string> {
  const unexpected = (): never => assert.fail("public Share fixture must not access BFF storage")
  const module = await Test.createTestingModule({ imports: [ChatModule] })
    .overrideProvider(BFF_CONFIG)
    .useValue(config())
    .overrideProvider(BFF_DATABASE)
    .useValue({ pool: { query: unexpected, connect: unexpected }, redis: Object.freeze({}) })
    .overrideProvider(SESSION_ADMISSION)
    .useValue(admission)
    .overrideProvider(PUBLIC_SHARE_SERVICE)
    .useValue(owner)
    .compile()
  const app = module.createNestApplication({ ...BFF_NEST_APPLICATION_OPTIONS, abortOnError: false, logger: false })
  nestClosers.push(() => app.close())
  await app.listen(0, "127.0.0.1")
  return app.getUrl()
}

afterEach(async () => {
  try {
    await Promise.all(nestClosers.splice(0).map((close) => close()))
  } finally {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
  }
})

test("GET /v1/me projects only the online IAM-admitted Product identity", async () => {
  const calls: IncomingMessage[] = []
  const iam = await listen(
    createServer((request, response) => {
      calls.push(request)
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store", "x-request-id": String(request.headers["x-request-id"]) })
      response.end(
        JSON.stringify(
          request.url?.startsWith("/iam/get-session")
            ? fixtureNativeSession("tenant-server", "user-trusted")
            : { data: { allowed: true, tenant_id: "tenant-server", subject_id: "user-trusted", decision_source: "current_membership" } },
        ),
      )
    }),
  )
  const base = await listenNativeAdmission({ ...config(), iamBaseUrl: iam })
  const headers = {
    "x-kokoro-service": "web-bff",
    "x-kokoro-internal-secret": "test-secret",
    cookie: "kokoro-issuer.session_token=product-token",
    origin: "https://web.example.test",
    "x-kokoro-namespace": "forged",
    "x-kokoro-principal-id": "forged",
    "x-kokoro-tenant-id": "forged",
    "x-request-id": "me-request",
  }
  const response = await fetch(base + "/v1/me", { headers })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get("cache-control"), "no-store")
  assert.deepEqual(await response.json(), {
    data: { user_id: "user-trusted", tenant_id: "tenant-server", platform_admin: false },
    meta: { request_id: "me-request" },
  })
  assert.equal(calls[0]?.headers.authorization, undefined)
  assert.equal(calls[1]?.headers.authorization, `Bearer ${TEST_IAM_USER_CONTEXT_SECRET}`)
  assert.equal(calls[1]?.headers["x-kokoro-actor-id"], "user-trusted")
  assert.equal(calls[1]?.headers.cookie, undefined)
  assert.equal(calls[1]?.headers.origin, undefined)
  const query = await fetch(base + "/v1/me?tenant_id=forged", { headers })
  assert.equal(query.status, 400)
  const status = await new Promise<number>((resolve, reject) => {
    const upload = httpRequest(
      base + "/v1/me",
      { method: "GET", headers: { ...headers, "content-type": "application/json", "content-length": "2" } },
      (reply) => {
        reply.resume()
        resolve(reply.statusCode ?? 0)
      },
    )
    upload.once("error", reject)
    upload.end("{}")
  })
  assert.equal(status, 400)
  assert.equal(calls.length, 6, "every protected observation freshly authenticates and qualifies")
})

test("GET /v1/me preserves fixed-tenant and IAM denial semantics without business store", async () => {
  const calls: string[] = []
  const iam = await listen(
    createServer((request, response) => {
      const cookie = request.headers.cookie ?? ""
      calls.push(cookie)
      const status = cookie.endsWith("foreign") ? 200 : cookie.endsWith("rate") ? 429 : 200
      response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", ...(status === 429 ? { "retry-after": "60" } : {}) })
      response.end(
        JSON.stringify(cookie.endsWith("foreign") ? fixtureNativeSession("tenant-foreign", "user-foreign") : status === 429 ? { message: "limited" } : null),
      )
    }),
  )
  const base = await listenNativeAdmission({ ...config(), iamBaseUrl: iam })
  const headers = { "x-kokoro-service": "web-bff", "x-kokoro-internal-secret": "test-secret", origin: "https://web.example.test" }
  assert.equal(
    (await fetch(base + "/v1/me", { headers: { ...headers, "x-kokoro-internal-secret": "wrong", cookie: "kokoro-issuer.session_token=invalid" } })).status,
    403,
  )
  assert.equal(calls.length, 0)
  for (const [session, status, code] of [
    [null, 401, "session_authentication_required"],
    ["invalid", 401, "session_invalid"],
    ["foreign", 403, "product_tenant_forbidden"],
    ["rate", 429, "session_rate_limited"],
  ] as const) {
    const response = await fetch(base + "/v1/me", {
      headers: { ...headers, ...(session === null ? {} : { cookie: `kokoro-issuer.session_token=${session}` }) },
    })
    assert.equal(response.status, status)
    assert.equal((await response.json()).error.code, code)
    assert.equal(response.headers.get("retry-after"), status === 429 ? "60" : null)
  }
  assert.deepEqual(
    calls,
    ["invalid", "foreign", "rate"].map((value) => `kokoro-issuer.session_token=${value}`),
  )
  const missing = await listenNativeAdmission({ ...config(), iamBaseUrl: iam, tenantId: null })
  const unavailable = await listenNativeAdmission({ ...config(), iamBaseUrl: null })
  for (const [url, code] of [
    [missing, "product_tenant_not_configured"],
    [unavailable, "iam_admission_unavailable"],
  ]) {
    const response = await fetch(url + "/v1/me", { headers: { ...headers, cookie: "kokoro-issuer.session_token=invalid" } })
    assert.equal(response.status, 503)
    assert.equal((await response.json()).error.code, code)
  }
  assert.equal(calls.length, 3)
})

test("legacy identity headers cannot authorize a user request without a native Session Cookie", async (t) => {
  const { base, reads } = await listenNativeProjectAdmission(config())
  const projectReads = t.mock.method(reads, "list")

  const response = await fetch(`${base}/v1/projects`, {
    headers: {
      "x-kokoro-service": "web-bff",
      "x-kokoro-internal-secret": "test-secret",
      "x-kokoro-namespace": "attacker-tenant",
      "x-kokoro-principal-id": "attacker-user",
      origin: "https://web.example.test",
    },
  })

  assert.equal(response.status, 401)
  assert.equal(((await response.json()) as { error: { code: string } }).error.code, "session_authentication_required")
  assert.equal(projectReads.mock.callCount(), 0)
})

test("the default production composition fails user traffic and readiness closed when IAM is not configured", async () => {
  const base = await listenNativeAdmission(config(), AppModule)

  const ready = await fetch(`${base}/readyz`)
  const user = await fetch(`${base}/v1/projects`, {
    headers: {
      "x-kokoro-service": "web-bff",
      "x-kokoro-internal-secret": "test-secret",
      cookie: "kokoro-issuer.session_token=token",
      origin: "https://web.example.test",
    },
  })

  assert.equal(ready.status, 503)
  assert.deepEqual(await ready.json(), { status: "ok", service: "kokoro-bff", mode: "live" })
  assert.equal(user.status, 503)
  assert.equal(((await user.json()) as { error: { code: string } }).error.code, "iam_admission_unavailable")
})

test("service and Cookie rejection happen before IAM and route work", async (t) => {
  const admission = new SessionAdmissionDouble({ token: { namespace: "tenant-a", userId: "user-a" } })
  const { base, reads } = await listenNativeProjectAdmission(config(), admission)
  const { base: secretlessBase, reads: secretlessReads } = await listenNativeProjectAdmission({ ...config(), sharedSecret: null }, admission)
  const projectReads = t.mock.method(reads, "list")
  const secretlessProjectReads = t.mock.method(secretlessReads, "list")
  const sessionHeaders = { cookie: "kokoro-issuer.session_token=token", origin: "https://web.example.test" }
  const serviceHeaders = { "x-kokoro-service": "web-bff", "x-kokoro-internal-secret": "test-secret" }
  const cases: Array<{ name: string; origin: string; headers: HeadersInit; status: number; code: string }> = [
    { name: "missing service", origin: base, headers: {}, status: 403, code: "service_auth_failed" },
    { name: "forged domain", origin: base, headers: { "x-domain": "evil.example" }, status: 403, code: "service_auth_failed" },
    {
      name: "wrong service secret",
      origin: base,
      headers: { ...sessionHeaders, ...serviceHeaders, "x-kokoro-internal-secret": "wrong" },
      status: 403,
      code: "service_auth_failed",
    },
    {
      name: "missing native Cookie",
      origin: base,
      headers: { ...serviceHeaders, origin: sessionHeaders.origin },
      status: 401,
      code: "session_authentication_required",
    },
    { name: "missing service with no configured secret", origin: secretlessBase, headers: sessionHeaders, status: 403, code: "service_auth_failed" },
    {
      name: "named service with no configured secret",
      origin: secretlessBase,
      headers: { ...sessionHeaders, ...serviceHeaders },
      status: 403,
      code: "service_auth_failed",
    },
  ]
  for (const { name, origin, headers, status, code } of cases) {
    const response = await fetch(`${origin}/v1/projects`, { headers })
    assert.equal(response.status, status, name)
    assert.equal(((await response.json()) as { error: { code: string } }).error.code, code, name)
  }
  assert.equal(admission.calls.length, 0)
  assert.equal(projectReads.mock.callCount(), 0)
  assert.equal(secretlessProjectReads.mock.callCount(), 0)
})

test("Admin Web credential reaches only current identity and exact named admin routes", async (t) => {
  const verify = t.mock.fn(async ({ cookie }: Parameters<SessionAdmission["verify"]>[0]) =>
    cookie === "kokoro-issuer.session_token=token"
      ? {
          ok: true as const,
          identity: { namespace: "tenant-server", userId: "admin-user" },
          platformAdmin: true,
          expiresAt: "2099-01-01T00:00:00.000Z",
          setCookies: [],
        }
      : { ok: false as const, status: 401 as const, code: "session_invalid" },
  )
  const noDb = (): never => assert.fail("Admin service scope test must not use BFF storage")
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(BFF_CONFIG)
    .useValue({ ...config(), adminWebSharedSecret: "admin-test-secret" })
    .overrideProvider(BFF_DATABASE)
    .useValue({ pool: { query: noDb, connect: noDb } })
    .overrideProvider(SESSION_ADMISSION)
    .useValue({ verify } satisfies SessionAdmission)
    .overrideProvider(SKILL_AUTHORIZATION)
    .useValue({ check: async () => ({ ok: true }) })
    .compile()
  const projectReads = t.mock.method(module.get<ProjectReadStore>(PROJECT_READS), "list", async () => [])
  const app = module.createNestApplication(new BffExpressAdapter(), { ...BFF_NEST_APPLICATION_OPTIONS, abortOnError: false, logger: false })
  nestClosers.push(() => app.close())
  await app.listen(0, "127.0.0.1")
  const base = await app.getUrl()
  const admin = {
    "x-kokoro-service": "admin-web-bff",
    "x-kokoro-internal-secret": "admin-test-secret",
    cookie: "kokoro-issuer.session_token=token",
    origin: "https://web.example.test",
  }

  const unconfiguredAdmission = new SessionAdmissionDouble({ token: { namespace: "tenant-server", userId: "admin-user" } })
  const { base: unconfiguredBase, close: closeUnconfigured } = await startAccountTestApp(config(), unconfiguredAdmission)
  nestClosers.push(closeUnconfigured)
  const unconfigured = await fetch(`${unconfiguredBase}/v1/me`, { headers: admin })
  assert.equal(unconfigured.status, 403)
  assert.equal(unconfiguredAdmission.calls.length, 0)

  for (const rawHeaders of [
    [
      "x-kokoro-service",
      "admin-web-bff",
      "x-kokoro-service",
      "admin-web-bff",
      "x-kokoro-internal-secret",
      "admin-test-secret",
      "cookie",
      "kokoro-issuer.session_token=token",
      "origin",
      "https://web.example.test",
    ],
    [
      "x-kokoro-service",
      "admin-web-bff",
      "x-kokoro-internal-secret",
      "admin-test-secret",
      "x-kokoro-internal-secret",
      "admin-test-secret",
      "cookie",
      "kokoro-issuer.session_token=token",
      "origin",
      "https://web.example.test",
    ],
  ]) {
    const status = await new Promise<number>((resolve, reject) => {
      const outgoing = httpRequest(`${base}/v1/me`, { headers: rawHeaders }, (response) => {
        response.resume()
        resolve(response.statusCode ?? 0)
      })
      outgoing.once("error", reject)
      outgoing.end()
    })
    assert.ok(status === 400 || status === 403)
  }
  assert.equal(verify.mock.callCount(), 0)

  assert.equal((await fetch(`${base}/v1/me`, { headers: admin })).status, 200)
  const skills = await fetch(`${base}/v1/admin/skills`, { headers: admin })
  assert.equal(skills.status, 503)
  assert.equal(((await skills.json()) as { error: { code: string } }).error.code, "skill_dependency_unavailable")
  const models = await fetch(`${base}/v1/admin/model-routing`, { headers: admin })
  assert.equal(models.status, 503)
  assert.equal(((await models.json()) as { error: { code: string } }).error.code, "admin_model_routing_unavailable")
  assert.equal(verify.mock.callCount(), 3)

  for (const [path, headers] of [
    ["/v1/projects", admin],
    ["/v1/team/members", admin],
    ["/v1/system/runtime-manifest?product_id=kokoro&locale=en-US&surface_id=admin-web", admin],
    ["/v1/admin/skills", { ...admin, "x-kokoro-internal-secret": "wrong" }],
    ["/v1/admin/skills", { ...admin, "x-kokoro-internal-secret": "test-secret" }],
    ["/v1/admin/skills", { ...admin, "x-kokoro-service": "web-bff", "x-kokoro-internal-secret": "admin-test-secret", origin: "https://web.example.test" }],
  ] as const) {
    const response = await fetch(`${base}${path}`, { headers })
    assert.equal(response.status, 403, path)
    assert.equal(((await response.json()) as { error: { code: string } }).error.code, "service_auth_failed")
  }
  const unknown = await fetch(`${base}/v1/admin/not-a-real-operation`, { headers: admin })
  assert.equal(unknown.status, 404)
  assert.equal(((await unknown.json()) as { error: { code: string } }).error.code, "bff_route_not_found")
  assert.equal(projectReads.mock.callCount(), 0)
  assert.equal(verify.mock.callCount(), 3)

  const userProjects = await fetch(`${base}/v1/projects`, {
    headers: {
      "x-kokoro-service": "web-bff",
      "x-kokoro-internal-secret": "test-secret",
      cookie: "kokoro-issuer.session_token=token",
      origin: "https://web.example.test",
    },
  })
  assert.equal(userProjects.status, 200)
  assert.deepEqual(((await userProjects.json()) as { data: unknown }).data, { projects: [] })
  assert.equal(projectReads.mock.callCount(), 1)
  assert.deepEqual(projectReads.mock.calls[0]?.arguments, [{ tenantId: "tenant-server", subjectId: "admin-user" }])
  assert.equal(verify.mock.callCount(), 4)
})

test("missing fixed Product tenant fails before IAM and business work without changing service-only or issuer paths", async (t) => {
  const admission = new SessionAdmissionDouble({ token: { namespace: "tenant-a", userId: "user-a" } })
  const { SystemModule } = await import("../dist/modules/system/system.module.js")
  const unexpected = (): never => assert.fail("missing Product tenant fixture must not access BFF storage")
  const shareOwner = {
    findActiveShare: t.mock.fn(async () => ({
      share: { shareId: "share-a" },
      conversation: {
        tenantId: "tenant-a",
        conversationId: "session-share",
        title: "Shared",
        ownerId: "owner",
        createdAt: new Date("2026-10-27T00:00:00.000Z"),
        updatedAt: new Date("2026-10-27T00:00:00.000Z"),
      },
    })),
    listMessages: t.mock.fn(async () => ({ messages: [] })),
  }
  const module = await Test.createTestingModule({ imports: [ProjectsModule, SystemModule] })
    .overrideProvider(BFF_CONFIG)
    .useValue({ ...config(), tenantId: null })
    .overrideProvider(BFF_DATABASE)
    .useValue({ pool: { query: unexpected, connect: unexpected }, redis: Object.freeze({}) })
    .overrideProvider(SESSION_ADMISSION)
    .useValue(admission)
    .overrideProvider(PUBLIC_SHARE_SERVICE)
    .useValue(shareOwner)
    .compile()
  const projectReads = t.mock.method(module.get<ProjectReadStore>(PROJECT_READS), "list")
  const app = module.createNestApplication({ ...BFF_NEST_APPLICATION_OPTIONS, abortOnError: false, logger: false })
  nestClosers.push(() => app.close())
  await app.listen(0, "127.0.0.1")
  const base = await app.getUrl()
  const headers = {
    "x-kokoro-service": "web-bff",
    "x-kokoro-internal-secret": "test-secret",
    cookie: "kokoro-issuer.session_token=token",
    origin: "https://web.example.test",
  }

  const user = await fetch(`${base}/v1/projects`, { headers })
  const share = await fetch(`${base}/v1/shared/share-a`, { headers })
  const manifest = await fetch(`${base}/v1/system/runtime-manifest?product_id=kokoro&locale=en-US&surface_id=user-web`, { headers })
  const issuer = await fetch(`${base}/iam/get-session`, { headers })

  assert.equal(user.status, 503)
  assert.equal(((await user.json()) as { error: { code: string } }).error.code, "product_tenant_not_configured")
  assert.equal(user.headers.get("cache-control"), "no-store")
  assert.match(user.headers.get("x-request-id") ?? "", /^[A-Za-z0-9_-]{1,128}$/u)
  assert.equal(share.status, 200)
  assert.equal(manifest.status, 503)
  assert.equal(((await manifest.json()) as { error: { code: string } }).error.code, "upstream_not_configured")
  assert.equal(issuer.status, 503)
  assert.equal(((await issuer.json()) as { error: { code: string } }).error.code, "iam_relay_unavailable")
  assert.equal(admission.calls.length, 0)
  assert.equal(projectReads.mock.callCount(), 0)
  assert.deepEqual(
    shareOwner.findActiveShare.mock.calls.map((call) => call.arguments),
    [["share-a", undefined, undefined]],
  )
  assert.deepEqual(
    shareOwner.listMessages.mock.calls.map((call) => call.arguments),
    [["share-a", "tenant-a", "session-share", 100]],
  )
})

test("foreign IAM tenant is denied before body parsing, receipt claim, Team or owner I/O despite forged tenant headers", async (t) => {
  const admission = new SessionAdmissionDouble({ token: { namespace: "tenant-other", userId: "user-other" } })
  let teamOwnerCalls = 0
  const iamBaseUrl = await listen(
    createServer((_request, response) => {
      teamOwnerCalls++
      response.writeHead(500).end()
    }),
  )
  const claimReceipt = t.mock.fn(async () => assert.fail("foreign admission must not claim a Project receipt"))
  const { base, mutations } = await listenNativeProjectAdmission(
    { ...config(), ...(await fixtureIamCredentials("tenant-fixed")), tenantId: "tenant-fixed", iamBaseUrl },
    admission,
    {
      claimReceipt,
      async putReceipt() {
        assert.fail("foreign admission must not commit a Project receipt")
      },
      async releaseReceipt() {
        assert.fail("foreign admission must not release a Project receipt")
      },
    },
    true,
  )
  const projectCreates = t.mock.method(mutations, "create")
  const headers = {
    "x-kokoro-service": "web-bff",
    "x-kokoro-internal-secret": "test-secret",
    cookie: "kokoro-issuer.session_token=token",
    origin: "https://web.example.test",
    "x-kokoro-tenant-id": "tenant-fixed",
    "x-kokoro-namespace": "tenant-fixed",
    "x-kokoro-principal-id": "forged",
  }
  const mutation = await fetch(`${base}/v1/projects`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json", "idempotency-key": "fixed-tenant-key" },
    body: "not-json",
  })
  const team = await fetch(`${base}/v1/team/members`, { headers })

  for (const response of [mutation, team]) {
    assert.equal(response.status, 403)
    assert.equal(((await response.json()) as { error: { code: string } }).error.code, "product_tenant_forbidden")
    assert.equal(response.headers.get("cache-control"), "no-store")
  }
  assert.equal(admission.calls.length, 2)
  assert.equal(claimReceipt.mock.callCount(), 0)
  assert.equal(projectCreates.mock.callCount(), 0)
  assert.equal(teamOwnerCalls, 0)
})

test("the IAM identity replaces malicious legacy identity headers", async (t) => {
  const admission = new SessionAdmissionDouble({ token: { namespace: "tenant-iam", userId: "user-iam" } })
  const { base, reads } = await listenNativeProjectAdmission({ ...config(), tenantId: "tenant-iam" }, admission)
  const projectReads = t.mock.method(reads, "list", async () => [])

  const response = await fetch(`${base}/v1/projects`, {
    headers: {
      "x-kokoro-service": "web-bff",
      "x-kokoro-internal-secret": "test-secret",
      cookie: "kokoro-issuer.session_token=token",
      origin: "https://web.example.test",
      "x-kokoro-namespace": "tenant-attacker",
      "x-kokoro-principal-id": "user-attacker",
    },
  })

  assert.equal(response.status, 200)
  assert.deepEqual(((await response.json()) as { data: unknown }).data, { projects: [] })
  assert.deepEqual(
    projectReads.mock.calls.map((call) => call.arguments),
    [[{ tenantId: "tenant-iam", subjectId: "user-iam" }]],
  )
  assert.equal(admission.calls.length, 1)
})

test("a revoked session is denied before an existing idempotency result can replay", async (t) => {
  const admission = new SessionAdmissionDouble({ token: { namespace: "tenant-a", userId: "user-a" } })
  const scope = JSON.stringify(["tenant-a", "user-a", "POST", "/projects", "same-key"])
  let receipt: PersistentReceipt | null = null
  let receiptClaims = 0
  let receiptWrites = 0
  let claimedFingerprint: string | null = null
  const receipts: Pick<IdempotencyRepository, "claimReceipt" | "putReceipt" | "releaseReceipt"> = {
    async claimReceipt(key, fingerprint) {
      assert.equal(key, scope)
      receiptClaims++
      claimedFingerprint = fingerprint
      return receipt === null ? { claimed: true, receipt: null } : { claimed: false, receipt }
    },
    async putReceipt(key, value) {
      assert.equal(key, scope)
      receiptWrites++
      receipt = value
    },
    async releaseReceipt() {
      assert.fail("successful Project create must not release its receipt")
    },
  }
  const { base, reads, mutations } = await listenNativeProjectAdmission({ ...config(), tenantId: "tenant-a" }, admission, receipts)
  const project = {
    id: "project-a",
    name: "Project A",
    slug: "project-a",
    description: "",
    created_at: "2026-10-27T00:00:00.000Z",
    updated_at: "2026-10-27T00:00:00.000Z",
  }
  const projectCreates = t.mock.method(mutations, "create", async () => project)
  t.mock.method(mutations, "withReceipt", async (mutation, work) => {
    const completed = await work(mutations)
    await receipts.putReceipt(mutation.scope, { fingerprint: mutation.fingerprint, ...completed })
    return { kind: "receipt" as const, receipt: completed }
  })
  const projectReads = t.mock.method(reads, "list", async () => [project])
  const headers = {
    "x-kokoro-service": "web-bff",
    "x-kokoro-internal-secret": "test-secret",
    cookie: "kokoro-issuer.session_token=token",
    origin: "https://web.example.test",
  }
  const init = {
    method: "POST",
    headers: { ...headers, "content-type": "application/json", "idempotency-key": "same-key" },
    body: JSON.stringify({ name: project.name }),
  }

  const created = await fetch(`${base}/v1/projects`, init)
  assert.equal(created.status, 200)
  const createdBody = (await created.json()) as { data: unknown }
  assert.deepEqual(createdBody.data, { project })
  const committed = receipt as PersistentReceipt | null
  assert.ok(committed)
  assert.notEqual(claimedFingerprint, null)
  assert.equal(committed.fingerprint, claimedFingerprint)
  assert.equal(committed.status, 200)
  assert.deepEqual(committed.body, createdBody)

  const replay = await fetch(`${base}/v1/projects`, init)
  assert.equal(replay.status, 200)
  assert.deepEqual(await replay.json(), createdBody)
  assert.equal(claimedFingerprint, committed.fingerprint)

  const conflict = await fetch(`${base}/v1/projects`, { ...init, body: JSON.stringify({ name: project.name, description: "Different payload" }) })
  assert.equal(conflict.status, 409)
  assert.equal(((await conflict.json()) as { error: { code: string } }).error.code, "idempotency_conflict")
  assert.notEqual(claimedFingerprint, committed.fingerprint)
  assert.equal(receipt, committed)

  const list = await fetch(`${base}/v1/projects`, { headers: { ...headers, "x-kokoro-request-id": "request-projects" } })
  assert.equal(list.status, 200)
  assert.equal(list.headers.get("x-request-id"), "request-projects")
  assert.deepEqual(await list.json(), { data: { projects: [project] }, meta: { request_id: "request-projects" } })
  assert.deepEqual(
    projectReads.mock.calls.map((call) => call.arguments),
    [[{ tenantId: "tenant-a", subjectId: "user-a" }]],
  )

  assert.equal(receiptClaims, 3)
  admission.deny("token", { ok: false, status: 401, code: "session_invalid" })
  const denied = await fetch(`${base}/v1/projects`, init)

  assert.equal(denied.status, 401)
  assert.equal(((await denied.json()) as { error: { code: string } }).error.code, "session_invalid")
  assert.equal(admission.calls.length, 5)
  assert.equal(projectCreates.mock.callCount(), 1)
  assert.equal(receiptClaims, 3)
  assert.equal(receiptWrites, 1)
})

test("duplicate raw Cookie headers are rejected before IAM", async () => {
  const admission = new SessionAdmissionDouble({ first: { namespace: "tenant-a", userId: "user-a" } })
  const app = await listenNativeProjectAdmission(config(), admission)
  const base = new URL(app.base)

  const result = await new Promise<{ status: number; body: string }>((resolve, reject) => {
    const request = httpRequest(
      {
        host: base.hostname,
        port: Number(base.port),
        path: "/v1/projects",
        method: "GET",
        headers: {
          "x-kokoro-service": "web-bff",
          "x-kokoro-internal-secret": "test-secret",
          cookie: ["kokoro-issuer.session_token=first", "kokoro-issuer.session_token=second"],
          origin: "https://web.example.test",
        },
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
        response.on("end", () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }))
      },
    )
    request.once("error", reject)
    request.end()
  })

  assert.equal(result.status, 401)
  assert.equal((JSON.parse(result.body) as { error: { code: string } }).error.code, "session_authentication_required")
  assert.equal(admission.calls.length, 0)
})

test("IAM rate limiting forwards only the admitted Retry-After value", async () => {
  const admission = new SessionAdmissionDouble()
  admission.deny("limited", { ok: false, status: 429, code: "session_rate_limited", retryAfter: "60" })
  const { base } = await listenNativeProjectAdmission(config(), admission)

  const response = await fetch(`${base}/v1/projects`, {
    headers: {
      "x-kokoro-service": "web-bff",
      "x-kokoro-internal-secret": "test-secret",
      cookie: "kokoro-issuer.session_token=limited",
      origin: "https://web.example.test",
    },
  })

  assert.equal(response.status, 429)
  assert.equal(response.headers.get("retry-after"), "60")
  assert.equal(response.headers.get("cache-control"), "no-store")
  assert.match(response.headers.get("x-request-id") ?? "", /^[A-Za-z0-9_-]{1,128}$/u)
  assert.equal(((await response.json()) as { error: { code: string } }).error.code, "session_rate_limited")
})

test("the HTTP boundary drops an uncontrolled Retry-After returned by an invalid admission implementation", async () => {
  const admission = new SessionAdmissionDouble()
  admission.deny("limited", { ok: false, status: 429, code: "session_rate_limited", retryAfter: "99999" })
  const { base } = await listenNativeProjectAdmission(config(), admission)

  const response = await fetch(`${base}/v1/projects`, {
    headers: {
      "x-kokoro-service": "web-bff",
      "x-kokoro-internal-secret": "test-secret",
      cookie: "kokoro-issuer.session_token=limited",
      origin: "https://web.example.test",
    },
  })

  assert.equal(response.status, 429)
  assert.equal(response.headers.get("retry-after"), null)
})

test("disconnecting during admission aborts IAM and prevents route work", { timeout: 4000 }, async (t) => {
  let admissionStarted!: () => void
  const started = new Promise<void>((resolve) => {
    admissionStarted = resolve
  })
  let observedAbort!: () => void
  const aborted = new Promise<void>((resolve) => {
    observedAbort = resolve
  })
  const admission = {
    verify: async ({ signal }: { signal: AbortSignal }): Promise<{ ok: false; status: 503; code: string }> => {
      admissionStarted()
      await new Promise<void>((resolve) => {
        if (signal.aborted) resolve()
        else signal.addEventListener("abort", () => resolve(), { once: true })
      })
      observedAbort()
      return { ok: false, status: 503, code: "iam_admission_unavailable" }
    },
  }
  const app = await listenNativeProjectAdmission(config(), admission)
  const projectReads = t.mock.method(app.reads, "list")
  const base = new URL(app.base)
  const request = httpRequest({
    host: base.hostname,
    port: Number(base.port),
    path: "/v1/projects",
    headers: {
      "x-kokoro-service": "web-bff",
      "x-kokoro-internal-secret": "test-secret",
      cookie: "kokoro-issuer.session_token=pending",
      origin: "https://web.example.test",
    },
  })
  request.on("error", () => undefined)
  request.end()
  try {
    await started
    request.destroy()
    await aborted
  } finally {
    request.destroy()
  }

  assert.equal(projectReads.mock.callCount(), 0)
})

test("Share, runtime manifest, and Scheduler callback remain separate service boundaries", async () => {
  const admission = new SessionAdmissionDouble()
  const { SCHEDULED_TASK_DISPATCHER } = await import("../dist/common/tokens.js")
  const { ScheduledTasksModule } = await import("../dist/modules/scheduled-tasks/scheduled-tasks.module.js")
  const { SystemModule } = await import("../dist/modules/system/system.module.js")
  const unexpected = (): never => assert.fail("service-only boundary fixture must not access BFF storage")
  const module = await Test.createTestingModule({ imports: [SystemModule, ScheduledTasksModule] })
    .overrideProvider(BFF_CONFIG)
    .useValue(config())
    .overrideProvider(BFF_DATABASE)
    .useValue({ pool: { query: unexpected, connect: unexpected } })
    .overrideProvider(SESSION_ADMISSION)
    .useValue(admission)
    .overrideProvider(PUBLIC_SHARE_SERVICE)
    .useValue({
      findActiveShare: async () => ({
        share: { shareId: "share-a" },
        conversation: {
          tenantId: "tenant-server",
          conversationId: "session-share",
          title: "Shared",
          ownerId: "owner",
          createdAt: new Date("2026-10-27T00:00:00.000Z"),
          updatedAt: new Date("2026-10-27T00:00:00.000Z"),
        },
      }),
      listMessages: async () => ({ messages: [] }),
    })
    .overrideProvider(SCHEDULED_TASK_DISPATCHER)
    .useValue({ start() {}, async stop() {} })
    .compile()
  const app = module.createNestApplication({ ...BFF_NEST_APPLICATION_OPTIONS, abortOnError: false, logger: false })
  nestClosers.push(() => app.close())
  await app.listen(0, "127.0.0.1")
  const base = await app.getUrl()
  const serviceHeaders = {
    "x-kokoro-service": "web-bff",
    "x-kokoro-internal-secret": "test-secret",
    cookie: "kokoro-issuer.session_token=irrelevant-extra-header",
    origin: "https://web.example.test",
  }

  const share = await fetch(`${base}/v1/shared/share-a`, { headers: serviceHeaders })
  const manifest = await fetch(`${base}/v1/system/runtime-manifest?product_id=kokoro&locale=en-US&surface_id=user-web`, { headers: serviceHeaders })
  const scheduler = await fetch(`${base}/internal/bff/scheduled-tasks/dispatch`, { method: "POST", headers: serviceHeaders })

  assert.equal(share.status, 200)
  assert.equal(manifest.status, 503)
  assert.equal(((await manifest.json()) as { error: { code: string } }).error.code, "upstream_not_configured")
  assert.equal(scheduler.status, 401)
  assert.equal(admission.calls.length, 0)
})

test("GET /v1/me rereads current administrator qualification for the same Cookie and isolates users", async () => {
  let platformAdmin = true,
    unavailable = false
  const calls: string[] = []
  const iam = await listen(
    createServer((request, response) => {
      response.writeHead(unavailable ? 503 : 200, {
        "content-type": "application/json",
        "cache-control": "no-store",
        "x-request-id": String(request.headers["x-request-id"]),
      })
      const admin = request.headers.cookie?.endsWith("admin-token") ?? false
      if (request.url?.startsWith("/iam/get-session")) {
        calls.push(request.headers.cookie ?? "")
        response.end(
          JSON.stringify(
            unavailable
              ? { message: "private owner failure" }
              : fixtureNativeSession("tenant-server", admin ? "user-admin" : "user-ordinary", admin && platformAdmin),
          ),
        )
      } else
        response.end(
          JSON.stringify({
            data: { allowed: true, tenant_id: "tenant-server", subject_id: request.headers["x-kokoro-actor-id"], decision_source: "current_membership" },
          }),
        )
    }),
  )
  const base = await listenNativeAdmission({ ...config(), iamBaseUrl: iam })
  const read = (session: string) =>
    fetch(base + "/v1/me", {
      headers: {
        "x-kokoro-service": "web-bff",
        "x-kokoro-internal-secret": "test-secret",
        origin: "https://web.example.test",
        cookie: `kokoro-issuer.session_token=${session}`,
        "x-kokoro-platform-admin": "true",
        "x-kokoro-principal-id": "forged",
      },
    })
  for (const [session, user, expected] of [
    ["admin-token", "user-admin", true],
    ["ordinary-token", "user-ordinary", false],
  ] as const) {
    const response = await read(session)
    assert.equal(response.status, 200)
    assert.deepEqual((await response.json()).data, { user_id: user, tenant_id: "tenant-server", platform_admin: expected })
  }
  platformAdmin = false
  assert.equal((await (await read("admin-token")).json()).data.platform_admin, false)
  unavailable = true
  const failed = await read("admin-token")
  assert.equal(failed.status, 503)
  assert.doesNotMatch(await failed.text(), /platform_admin|private owner failure/)
  assert.deepEqual(
    calls,
    ["admin-token", "ordinary-token", "admin-token", "admin-token"].map((value) => `kokoro-issuer.session_token=${value}`),
  )
})

test("GET /v1/me rejects malformed administrator snapshots and never substitutes false", async () => {
  const baseUser = fixtureNativeSession("tenant-server", "user-trusted").user
  const payloads = [undefined, null, "true", true].map((platformAdmin, index) => ({
    ...fixtureNativeSession("tenant-server", "user-trusted"),
    user: { ...baseUser, platformAdmin, ...(index === 3 ? { extra: "secret" } : {}) },
  }))
  let calls = 0
  const iam = await listen(
    createServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" })
      response.end(JSON.stringify(payloads[calls++]))
    }),
  )
  const base = await listenNativeAdmission({ ...config(), iamBaseUrl: iam })
  for (const _payload of payloads) {
    const response = await fetch(base + "/v1/me", {
      headers: {
        "x-kokoro-service": "web-bff",
        "x-kokoro-internal-secret": "test-secret",
        origin: "https://web.example.test",
        cookie: "kokoro-issuer.session_token=token",
      },
    })
    assert.equal(response.status, 503)
    assert.doesNotMatch(await response.text(), /platform_admin|secret/)
  }
  assert.equal(calls, payloads.length)
})

test("R357 MCP action admission forwards only trusted human tenant/subject and keeps other surfaces separate", async () => {
  const { authorizeMcpAction, mcpActionForRequest } = await import("../dist/auth/user-admission.js")
  const controller = new AbortController()
  const admitted = {
    ok: true as const,
    context: { requestId: "mcp-current", identity: { namespace: "tenant-server", userId: "human-one" }, platformAdmin: false },
  }
  let captured: unknown
  const result = await authorizeMcpAction(
    {
      check: async (input) => {
        captured = input
        return { ok: true }
      },
    },
    admitted,
    "manage",
    controller.signal,
  )
  assert.deepEqual(result, { ok: true })
  assert.deepEqual(captured, {
    requestId: "mcp-current",
    signal: controller.signal,
    tenantId: "tenant-server",
    subjectId: "human-one",
    resource: "mcp_personal",
    action: "manage",
  })
  assert.equal(mcpActionForRequest("GET", ["mcp", "connectors"], true), "read")
  assert.equal(mcpActionForRequest("GET", ["mcp", "connections"], true), "read")
  assert.equal(mcpActionForRequest("POST", ["mcp", "connectors"], true), "manage")
  for (const path of [["skills"], ["team"], ["admin", "skills"], ["runtime"]]) assert.equal(mcpActionForRequest("POST", path), null)
})
test("R357 MCP action cancellation after a late human permission never returns admission success", async () => {
  const { authorizeMcpAction } = await import("../dist/auth/user-admission.js")
  const controller = new AbortController()
  const admitted = {
    ok: true as const,
    context: { requestId: "mcp-current", identity: { namespace: "tenant-server", userId: "human-one" }, platformAdmin: false },
  }
  await assert.rejects(
    authorizeMcpAction(
      {
        check: async () => {
          controller.abort()
          return { ok: true }
        },
      },
      admitted,
      "read",
      controller.signal,
    ),
  )
})

test("Admin package service envelope admits exactly the four existing canonical operations", () => {
  const settings = { sharedSecret: "test-secret", adminWebSharedSecret: "admin-test-secret" }
  const rawHeaders = ["x-kokoro-service", "admin-web-bff", "x-kokoro-internal-secret", "admin-test-secret"]
  const admit = (method: string, url: string, headers = rawHeaders) =>
    admitBrowserService({ method, url, rawHeaders: headers } as IncomingMessage, settings, { kind: "business" })
  for (const id of ["a", "Skill_1.test:revision-2", "a".repeat(191)]) {
    assert.equal(admit("GET", `/v1/skills/${id}/package-upload`), "admin-web-bff")
    assert.equal(admit("POST", `/v1/skills/${id}/package-upload`), "admin-web-bff")
    assert.equal(admit("POST", `/v1/skills/${id}/package-upload/complete`), "admin-web-bff")
    assert.equal(admit("POST", `/v1/skills/${id}/validate`), "admin-web-bff")
  }
  for (const [method, path] of [
    ["PUT", "/v1/skills/a/package-upload"],
    ["PATCH", "/v1/skills/a/package-upload"],
    ["DELETE", "/v1/skills/a/package-upload"],
    ["HEAD", "/v1/skills/a/package-upload"],
    ["OPTIONS", "/v1/skills/a/package-upload"],
    ["get", "/v1/skills/a/package-upload"],
    ["GET", "/v1/skills/a/package-upload/complete"],
    ["GET", "/v1/skills/a/validate"],
    ["POST", "/v1/skills/a/publish"],
    ["POST", "/v1/skills/drafts"],
    ["POST", "/v1/skills/a/package-upload/unknown"],
    ["POST", "/v1/skills/a/validate/extra"],
    ["POST", "/v1/skills/a/package-upload/complete/extra"],
    ["GET", "/v1/skills/a/package-upload/"],
    ["POST", "/v1/skills/a/package-upload?extra=1"],
    ["POST", "/v1/skills/a/package-upload#fragment"],
    ["POST", "/v1/skills/a%2Fb/package-upload"],
    ["POST", "/v1/skills/a%2fb/validate"],
    ["POST", "/v1/skills/a%252Fb/package-upload"],
    ["POST", "/v1/skills/%61/package-upload"],
    ["POST", "/v1/skills//package-upload"],
    ["POST", "/v1/skills/_a/package-upload"],
    ["POST", `/v1/skills/${"a".repeat(192)}/package-upload`],
    ["POST", "/v1/skills/a/b/../package-upload"],
    ["POST", "/v1/skills/a/./package-upload"],
    ["POST", "http://bff.local/v1/skills/a/package-upload"],
    ["POST", "/browser/v1/skills/local-imports"],
    ["POST", "/v1/skill-installations"],
  ])
    assert.equal(admit(method!, path!), null, `${method} ${path}`)
  for (const headers of [
    [...rawHeaders, "x-kokoro-service", "admin-web-bff"],
    [...rawHeaders, "x-kokoro-internal-secret", "admin-test-secret"],
    ["x-kokoro-service", "admin-web-bff", "x-kokoro-internal-secret", "wrong"],
    ["x-kokoro-service", "admin-web-bff", "x-kokoro-internal-secret", "test-secret"],
    ["x-kokoro-service", "web-bff", "x-kokoro-internal-secret", "admin-test-secret"],
  ])
    assert.equal(admit("POST", "/v1/skills/a/package-upload", headers), null)
})

test("Admin package HTTP admission preserves fresh human identity, tenant and ordinary Skill action denial", async () => {
  const admission = new SessionAdmissionDouble({
    token: { namespace: "tenant-server", userId: "admin-user" },
    foreign: { namespace: "tenant-other", userId: "foreign-user" },
  })
  const checks: SkillAuthorizationInput[] = []
  let allowed = false
  const { base, close } = await startSkillDraftTestApp(
    { ...config(), adminWebSharedSecret: "admin-test-secret" },
    {
      sessionAdmission: admission,
      skillAuthorization: {
        check: async (input) => {
          checks.push(input)
          return allowed ? { ok: true as const } : { ok: false as const, status: 403 as const, code: "skill_forbidden" }
        },
      },
    },
  )
  nestClosers.push(close)
  const headers = {
    "x-kokoro-service": "admin-web-bff",
    "x-kokoro-internal-secret": "admin-test-secret",
    cookie: "kokoro-issuer.session_token=token",
    origin: "https://web.example.test",
    "x-kokoro-tenant-id": "tenant-forged",
    "x-kokoro-principal-id": "user-forged",
  }
  const mutations = [
    ["/v1/skills/a/package-upload", "begin_upload"],
    ["/v1/skills/a/package-upload/complete", "complete_upload"],
    ["/v1/skills/a/validate", "validate_draft"],
  ] as const
  for (const [path, action] of mutations) {
    const response = await fetch(`${base}${path}`, { method: "POST", headers })
    assert.equal(response.status, 403)
    assert.equal(((await response.json()) as { error: { code: string } }).error.code, "skill_forbidden")
    assert.equal(checks.at(-1)?.action, action)
    assert.equal(checks.at(-1)?.tenantId, "tenant-server")
    assert.equal(checks.at(-1)?.subjectId, "admin-user")
    assert.equal("token" in checks.at(-1)!, false)
    assert.equal("cookie" in checks.at(-1)!, false)
    assert.equal("origin" in checks.at(-1)!, false)
  }
  assert.equal(admission.calls.length, 3)
  assert.equal(checks.length, 3)
  for (const [token, status, code] of [
    ["foreign", 403, "product_tenant_forbidden"],
    ["invalid", 401, "session_invalid"],
  ] as const) {
    const response = await fetch(`${base}/v1/skills/a/package-upload/complete`, {
      method: "POST",
      headers: { ...headers, cookie: `kokoro-issuer.session_token=${token}`, origin: "https://web.example.test" },
    })
    assert.equal(response.status, status)
    assert.equal(((await response.json()) as { error: { code: string } }).error.code, code)
  }
  assert.equal(checks.length, 3)
  allowed = true
  for (const [method, path] of [["GET", "/v1/skills/a/package-upload"], ...mutations.map(([path]) => ["POST", path])] as const) {
    const response = await fetch(`${base}${path}`, { method, headers })
    assert.equal(response.status, 503)
    assert.equal(((await response.json()) as { error: { code: string } }).error.code, "skill_dependency_unavailable")
  }
  assert.equal(admission.calls.length, 9)
  assert.equal(checks.length, 6)
})

test("anonymous Share business-store exposes only the original public message projection with a null process", async (t) => {
  const admission = new SessionAdmissionDouble()
  const canary = "PRIVATE_TOOL_DETAIL_CANARY"
  const createdAt = "2026-10-27T00:00:00.000Z"
  const messages = [
    {
      message_id: "user-public",
      role: "user",
      content: "question",
      status: "completed",
      created_at: createdAt,
      selected_skill_source_refs: ["skill:one"],
      private_value: canary,
    },
    {
      message_id: "answer-public",
      role: "assistant",
      content: "original answer",
      status: "failed",
      created_at: createdAt,
      run_id: "run-public",
      failure: { source: "agent", code: "model_unavailable", retryable: true, private_value: canary },
      rendering: { parts_cursor: canary },
      ordered_parts: [{ display_detail: { kind: "file", name: canary } }],
      private_value: canary,
    },
  ]
  const session = {
    session_id: "session-public",
    title: "Public title",
    owner_id: "owner-public",
    created_at: createdAt,
    updated_at: createdAt,
    private_value: canary,
  }
  const publicShares = {
    findActiveShare: t.mock.fn(async () => ({
      share: { shareId: "share-public" },
      conversation: {
        tenantId: "tenant-public",
        conversationId: session.session_id,
        title: session.title,
        ownerId: session.owner_id,
        createdAt: new Date(createdAt),
        updatedAt: new Date(createdAt),
      },
    })),
    listMessages: t.mock.fn(async () => ({ messages })),
  }
  const base = await listenNativePublicShare(admission, publicShares)
  const response = await fetch(`${base}/v1/shared/share-public`, {
    headers: { "x-kokoro-service": "web-bff", "x-kokoro-internal-secret": "test-secret", origin: "https://web.example.test" },
  })
  assert.equal(response.status, 200)
  const body = (await response.json()) as { data: unknown }
  assert.deepEqual(body.data, {
    session: { session_id: session.session_id, title: session.title, owner_id: session.owner_id, created_at: createdAt, updated_at: createdAt },
    messages: [
      { message_id: "user-public", role: "user", content: "question", status: "completed", created_at: createdAt, selected_skill_source_refs: ["skill:one"] },
      {
        message_id: "answer-public",
        role: "assistant",
        content: "original answer",
        status: "failed",
        created_at: createdAt,
        run_id: "run-public",
        failure: { source: "agent", code: "model_unavailable", retryable: true },
      },
    ],
    files: [],
    deliveries: [],
    deliveries_has_more: false,
    event_watermark: null,
    execution_process: null,
  })
  assert.equal(JSON.stringify(body).includes(canary), false)
  assert.equal(admission.calls.length, 0)
  assert.deepEqual(
    publicShares.findActiveShare.mock.calls.map((call) => call.arguments),
    [["share-public", undefined, undefined]],
  )
  assert.deepEqual(
    publicShares.listMessages.mock.calls.map((call) => call.arguments),
    [["share-public", "tenant-public", session.session_id, 100]],
  )
})

test("anonymous Share refuses a private ordered message instead of emitting a null success body", async (t) => {
  const at = new Date("2026-10-27T00:00:00.000Z")
  const admission = new SessionAdmissionDouble()
  const publicShares = {
    findActiveShare: t.mock.fn(async () => ({
      share: { shareId: "share-public" },
      conversation: { tenantId: "tenant", conversationId: "conversation", title: "title", ownerId: "owner", createdAt: at, updatedAt: at },
    })),
    listMessages: t.mock.fn(async () => ({
      messages: [
        {
          message_id: "message",
          role: "assistant",
          content: null,
          status: "completed",
          created_at: at.toISOString(),
          rendering: { parts_cursor: "PRIVATE_CURSOR_CANARY" },
        },
      ],
    })),
  }
  const base = await listenNativePublicShare(admission, publicShares)
  const response = await fetch(`${base}/v1/shared/share-public`, {
    headers: { "x-kokoro-service": "web-bff", "x-kokoro-internal-secret": "test-secret", origin: "https://web.example.test" },
  })
  assert.equal(response.status, 503)
  const body = await response.text()
  assert.equal(body.includes("PRIVATE_CURSOR_CANARY"), false)
  assert.equal((JSON.parse(body) as { error: { code: string } }).error.code, "share_projection_invalid")
  assert.equal(admission.calls.length, 0)
  assert.deepEqual(
    publicShares.findActiveShare.mock.calls.map((call) => call.arguments),
    [["share-public", undefined, undefined]],
  )
  assert.deepEqual(
    publicShares.listMessages.mock.calls.map((call) => call.arguments),
    [["share-public", "tenant", "conversation", 100]],
  )
})
