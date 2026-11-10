import { createServer, type Server } from "node:http"
import { existsSync, readFileSync } from "node:fs"
import assert from "node:assert/strict"
import { afterEach, describe, it } from "node:test"
import { fileURLToPath } from "node:url"

import type { INestApplication } from "@nestjs/common"

import { DEFAULT_AGUI_CONFIG } from "../dist/config/runtime.js"
import type { BffConfig } from "../src/config/runtime.ts"
import { SessionAdmissionDouble } from "./doubles/session-admission.ts"

const servers: Server[] = []
const ownerApps: INestApplication[] = []

const modelCatalogItem = {
  key: "chat/fast",
  display_name: "Fast chat",
  is_default: true,
  feature_key: "chat",
  model_id: "11111111-1111-4111-8111-111111111111",
  revision_id: "22222222-2222-4222-8222-222222222222",
  provider_id: "33333333-3333-4333-8333-333333333333",
  provider: "real-provider",
  request_model: "vendor/model-fast",
}

async function listen(server: Server): Promise<string> {
  servers.push(server)
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => resolve())
  })
  const address = server.address()
  if (address === null || typeof address === "string") throw new Error("server did not bind")
  return `http://127.0.0.1:${address.port}`
}

function config(overrides: Partial<BffConfig> = {}): BffConfig {
  return {
    host: "127.0.0.1",
    port: 4300,
    mode: "live",
    domain: "dev.kokoro.localhost",
    tenantId: "ns_test",
    iamBaseUrl: null,
    iamWebOrigin: "https://web.example.test",
    sharedSecret: "test-secret",
    upstreamSecret: "bff-upstream-secret",
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
      platform: null,
      storage: null,
      scheduler: null,
      agents: null,
      billing: null,
      music: null,
    },
    ...overrides,
  }
}

async function startSystemTestApp(configValue: BffConfig): Promise<string> {
  await import("reflect-metadata")
  const { Test } = await import("@nestjs/testing")
  const { BFF_CONFIG, SESSION_ADMISSION } = await import("../dist/common/tokens.js")
  const { BFF_NEST_APPLICATION_OPTIONS } = await import("../dist/main.js")
  const { SystemModule } = await import("../dist/modules/system/system.module.js")
  const module = await Test.createTestingModule({ imports: [SystemModule] })
    .overrideProvider(BFF_CONFIG)
    .useValue(configValue)
    .overrideProvider(SESSION_ADMISSION)
    .useValue(
      new SessionAdmissionDouble({
        "test-session": { namespace: "ns_test", userId: "user_test" },
        "control-session": { namespace: "tenant_control", userId: "user_control" },
      }),
    )
    .compile()
  const app = module.createNestApplication({ ...BFF_NEST_APPLICATION_OPTIONS, abortOnError: false, logger: false })
  ownerApps.push(app)
  await app.listen(0, "127.0.0.1")
  return app.getUrl()
}

async function startFocusedOwnerTestApp(feature: "library" | "billing-checkout" | "billing-credit" | "github" | "github-invalid", configValue: BffConfig) {
  await import("reflect-metadata")
  const { Test } = await import("@nestjs/testing")
  const { BFF_CONFIG, BFF_DATABASE, BILLING_IDEMPOTENCY, SESSION_ADMISSION, SKILL_AUTHORIZATION } = await import("../dist/common/tokens.js")
  const { BFF_NEST_APPLICATION_OPTIONS } = await import("../dist/main.js")
  const featureModule =
    feature === "library"
      ? (await import("../dist/modules/account/account.module.js")).AccountModule
      : feature === "billing-checkout" || feature === "billing-credit"
        ? (await import("../dist/modules/billing/billing.module.js")).BillingModule
        : (await import("../dist/modules/skills/skills.module.js")).SkillsModule
  const unexpectedDatabase = () => assert.fail("Owner HTTP fixture must not query PostgreSQL")
  const builder = Test.createTestingModule({ imports: [featureModule] })
    .overrideProvider(BFF_CONFIG)
    .useValue(configValue)
    .overrideProvider(BFF_DATABASE)
    .useValue({ pool: { query: unexpectedDatabase, connect: unexpectedDatabase } })
    .overrideProvider(SESSION_ADMISSION)
    .useValue(
      new SessionAdmissionDouble({
        "test-session": { namespace: "ns_test", userId: "user_test" },
        "control-session": { namespace: "tenant_control", userId: "user_control" },
      }),
    )
  if (feature === "billing-checkout") {
    // The disabled checkout may claim and release a pending receipt, never persist success.
    const pending = new Map<string, string>()
    builder.overrideProvider(BILLING_IDEMPOTENCY).useValue({
      claimReceipt: async (scope: string, fingerprint: string) => {
        assert.equal(pending.has(scope), false)
        pending.set(scope, fingerprint)
        return { claimed: true, receipt: null }
      },
      releaseReceipt: async (scope: string, fingerprint: string) => {
        assert.equal(pending.get(scope), fingerprint)
        pending.delete(scope)
      },
      putReceipt: async () => assert.fail("Disabled Billing checkout must not store a terminal receipt"),
    })
  }
  if (feature === "github-invalid") builder.overrideProvider(SKILL_AUTHORIZATION).useValue({ check: async () => ({ ok: true }) })
  const module = await builder.compile()
  const app = module.createNestApplication({ ...BFF_NEST_APPLICATION_OPTIONS, abortOnError: false, logger: false })
  ownerApps.push(app)
  await app.listen(0, "127.0.0.1")
  return app.getUrl()
}

function authHeaders(): Record<string, string> {
  return {
    "x-kokoro-service": "web-bff",
    "x-kokoro-internal-secret": "test-secret",
    cookie: "kokoro-issuer.session_token=test-session",
    origin: "https://web.example.test",
  }
}

afterEach(async () => {
  await Promise.all([
    ...ownerApps.splice(0).map((app) => app.close()),
    ...servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  ])
})

describe("kokoro-bff versioned HTTP contracts", () => {
  async function startAgentRunsTestApp(
    t: import("node:test").TestContext,
    configValue: BffConfig,
    query: (...args: unknown[]) => unknown = () => assert.fail("Unexpected BFF storage access"),
  ) {
    await import("reflect-metadata")
    const { Test } = await import("@nestjs/testing")
    const { BFF_NEST_APPLICATION_OPTIONS } = await import("../dist/main.js")
    const { BffExpressAdapter } = await import("../dist/http/bff-express-adapter.js")
    const { AgentRunsModule } = await import("../dist/modules/agent-runs/agent-runs.module.js")
    const { RunSteerDispatcher } = await import("../dist/infrastructure/postgres/run-steer-dispatch.js")
    const { BFF_CONFIG, BFF_DATABASE, SESSION_ADMISSION, AGENT_DISPATCH_DISPATCHER, AGENT_CANCELLATION_DISPATCHER, AGUI_PROJECTOR } =
      await import("../dist/common/tokens.js")
    const admission = new SessionAdmissionDouble({ "test-session": { namespace: "ns_test", userId: "user_test" } })
    const builder = Test.createTestingModule({ imports: [AgentRunsModule] })
      .overrideProvider(BFF_CONFIG)
      .useValue(configValue)
      .overrideProvider(SESSION_ADMISSION)
      .useValue(admission)
      .overrideProvider(BFF_DATABASE)
      .useValue({ pool: { query, connect: query } })
    for (const token of [AGENT_DISPATCH_DISPATCHER, AGENT_CANCELLATION_DISPATCHER, AGUI_PROJECTOR, RunSteerDispatcher])
      builder.overrideProvider(token).useValue(null)
    const module = await builder.compile()
    const app = module.createNestApplication(new BffExpressAdapter(), { ...BFF_NEST_APPLICATION_OPTIONS, logger: false, abortOnError: false })
    t.after(() => app.close())
    await app.listen(0, "127.0.0.1")
    return { base: await app.getUrl(), admission }
  }

  it("reads owned channel setup without creating it or forwarding to Agent", async (t) => {
    let agentCalls = 0
    const agent = createServer((_request, response) => {
      agentCalls++
      response.writeHead(418).end()
    })
    const agentBase = await listen(agent)
    const reads: unknown[][] = []
    const { base, admission } = await startAgentRunsTestApp(t, config({ agentEnabled: true, upstreams: { ...config().upstreams, agents: agentBase } }),
      (...args) => { reads.push(args); return { rows: [] } })
    const path = `${base}/v1/agents/connections/setup?platform=telegram`
    const headers = { ...authHeaders(), "x-request-id": "agent-setup-owner", "x-kokoro-subject-ref": "not-the-owner" }
    const invalid = await fetch(path.replace("telegram", "irc"), { headers })
    assert.equal(invalid.status, 400)
    const duplicate = await fetch(`${path}&platform=slack`, { headers })
    assert.equal(duplicate.status, 400)
    const disabled = await fetch(path, { headers })
    assert.equal(disabled.status, 503)
    assert.equal(disabled.headers.get("cache-control"), "no-store")
    assert.deepEqual(await disabled.json(), {
      error: { code: "agent_connection_provider_unavailable", message: "The external connection provider is unavailable" },
      meta: { request_id: "agent-setup-owner" },
    })
    const line = await fetch(path.replace("telegram", "line"), { headers })
    assert.equal(line.status, 503)
    const start = await fetch(path, { method: "POST", headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ action: "start", expected_state_version: "1" }) })
    assert.equal(start.status, 503)
    assert.equal(reads.length, 2)
    for (const [index, platform] of ["telegram", "line"].entries()) {
      const read = reads[index]?.[0] as { text: string; values: unknown[] }
      assert.match(read.text, /^SELECT/u)
      assert.deepEqual(read.values, ["ns_test", "user_test", platform])
    }
    assert.equal(admission.calls.length, 3)
    assert.equal(agentCalls, 0)
  })

  it("previews a GitHub skill without requiring Idempotency-Key", async () => {
    const base = await startFocusedOwnerTestApp("github", config()),
      originalFetch = globalThis.fetch
    const commit = "a".repeat(40),
      calls: string[] = [],
      zip = Buffer.from(
        "504b0304140000000000daa6485d153af49252000000520000000d000000726f6f742f534b494c4c2e6d642d2d2d0a6e616d653a205265616c20736b696c6c0a6465736372697074696f6e3a2041637475616c207061636b616765206d657461646174610a2d2d2d0a232041637475616c20536b696c6c20626f64790a504b01021403140000000000daa6485d153af49252000000520000000d0000000000000000000000800100000000726f6f742f534b494c4c2e6d64504b050600000000010001003b0000007d0000000000",
        "hex",
      )
    globalThis.fetch = async (url, init) => {
      const target = String(url)
      if (target.startsWith("http://127.0.0.1:")) return originalFetch(url, init)
      calls.push(target)
      if (target.endsWith("/commits/main")) return Response.json({ sha: commit })
      if (target.startsWith("https://codeload.github.com/")) return new Response(zip, { headers: { "content-type": "application/zip" } })
      assert.equal(target, "https://api.github.com/repos/acme/skill-pack")
      return Response.json({
        id: 1,
        private: false,
        full_name: "acme/skill-pack",
        html_url: "https://github.com/acme/skill-pack",
        owner: { login: "acme", html_url: "https://github.com/acme" },
        stargazers_count: 0,
        forks_count: 0,
        default_branch: "main",
      })
    }
    try {
      const response = await fetch(`${base}/v1/skills/github/preview`, {
        method: "POST",
        headers: { ...authHeaders(), "content-type": "application/json" },
        body: JSON.stringify({ repository_url: "https://github.com/acme/skill-pack" }),
      })
      assert.equal(response.status, 200)
      const body = (await response.json()) as { data: { selector: unknown; metadata: unknown; selection_required: boolean } }
      assert.equal(body.data.selection_required, false)
      assert.deepEqual(body.data.selector, { owner: "acme", repository: "skill-pack", commit, path: "" })
      assert.deepEqual(body.data.metadata, { display_name: "Real skill", summary: "Actual package metadata", tags: [] })
      assert.equal(response.headers.get("cache-control"), "no-store")
      assert.ok(response.headers.get("x-request-id"))
      assert.deepEqual(calls, [
        "https://api.github.com/repos/acme/skill-pack",
        "https://api.github.com/repos/acme/skill-pack/commits/main",
        `https://codeload.github.com/acme/skill-pack/zip/${commit}`,
      ])
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it("requires Idempotency-Key for GitHub skill import and replays the result", async () => {
    const { skillGithubImportRoute } = await import("../dist/http/routes/skill-github-import.js")
    const commit = "a".repeat(40),
      selector = { owner: "acme", repository: "skill-pack", commit, path: "" },
      zip = Buffer.from(
        "504b0304140000000000daa6485d153af49252000000520000000d000000726f6f742f534b494c4c2e6d642d2d2d0a6e616d653a205265616c20736b696c6c0a6465736372697074696f6e3a2041637475616c207061636b616765206d657461646174610a2d2d2d0a232041637475616c20536b696c6c20626f64790a504b01021403140000000000daa6485d153af49252000000520000000d0000000000000000000000800100000000726f6f742f534b494c4c2e6d64504b050600000000010001003b0000007d0000000000",
        "hex",
      )
    const originalFetch = globalThis.fetch
    let row: any = null,
      puts = 0,
      digest = "",
      providerCalls = 0
    const commands: string[] = [],
      creates: unknown[] = []
    const receipts = {
      getReceipt: async () => row,
      claimReceipt: async (_scope: string, fingerprint: string) => {
        row = { fingerprint, status: 102, body: {} }
        return { claimed: true, receipt: null }
      },
      compareAndSetReceipt: async (_scope: string, _fingerprint: string, expected: unknown, replacement: unknown) => {
        assert.deepEqual(row, expected)
        row = replacement
        return { updated: true, receipt: row }
      },
    }
    const client = {
      getPackageUpload: async () => ({ skillId: { value: "imported" }, attemptId: "attempt", uploadId: "upload", attemptEpoch: 1n }),
      command: async (operation: string, _identity: unknown, members: any) => {
        commands.push(operation)
        if (operation === "createSkillDraft") {
          creates.push(members)
          assert.equal(members.metadata.display_name, "Real skill")
          assert.equal(members.creation_provenance.github.asset_ref, undefined)
          return { skillId: { value: "imported" }, status: 1, revision: 1n, stateVersion: 7n }
        }
        if (operation === "beginSkillPackageUpload") {
          assert.equal(members.expected_state_version, "7")
          digest = members.content_sha256
          return {
            skillId: { value: "imported" },
            attemptId: "attempt",
            uploadId: "upload",
            attemptEpoch: 1n,
            stateVersion: 8n,
            transferReference: {
              url: "http://object.test/put",
              method: "PUT",
              requiredHeaders: { "content-type": "application/zip" },
              expiresAt: { seconds: BigInt(Math.floor(Date.now() / 1000) + 60), nanos: 0 },
            },
          }
        }
        if (operation === "completeSkillPackageUpload") {
          assert.equal(row.body.stage, "selected")
          assert.equal(members.source_version_id, "OPAQUE+/=")
          return { skillId: { value: "imported" }, scanState: 2, contentSha256: digest, stateVersion: 9n }
        }
        assert.equal(operation, "validateSkillDraft")
        return { skillId: { value: "imported" }, valid: true, contentDigest: digest, manifestIdentity: `zip-v2:sha256:${digest}`, stateVersion: 10n }
      },
    }
    globalThis.fetch = async (url, init) => {
      const target = String(url)
      if (target.startsWith("http://127.0.0.1:")) return originalFetch(url, init)
      if (target === "http://object.test/put") {
        puts++
        return new Response(null, { status: 200, headers: { "x-amz-version-id": "OPAQUE+/=" } })
      }
      providerCalls++
      if (target.endsWith(`/commits/${commit}`)) return Response.json({ sha: commit })
      if (target.startsWith("https://codeload.github.com/")) return new Response(zip, { headers: { "content-type": "application/zip" } })
      assert.equal(target, "https://api.github.com/repos/acme/skill-pack")
      return Response.json({
        id: 1,
        private: false,
        full_name: "acme/skill-pack",
        html_url: "https://github.com/acme/skill-pack",
        owner: { login: "acme", html_url: "https://github.com/acme" },
        stargazers_count: providerCalls,
        forks_count: 0,
      })
    }
    const base = await listen(
      createServer((request, response) => {
        void skillGithubImportRoute(
          request,
          response,
          { requestId: "import-id", identity: { namespace: "ns_test", userId: "user_test" } },
          config({ storage: { objectOrigin: "http://object.test" } as never }),
          receipts as never,
          client as never,
          async () => {},
        )
      }),
    )
    try {
      const missingKey = await fetch(`${base}/v1/skills/github/import`, {
        method: "POST",
        headers: { ...authHeaders(), "content-type": "application/json" },
        body: JSON.stringify(selector),
      })
      assert.equal(missingKey.status, 400)
      assert.equal(providerCalls, 0)
      const forged = await fetch(`${base}/v1/skills/github/import`, {
        method: "POST",
        headers: { ...authHeaders(), "content-type": "application/json", "idempotency-key": "k" },
        body: JSON.stringify({ ...selector, metadata: { display_name: "Fake" } }),
      })
      assert.equal(forged.status, 400)
      assert.equal(providerCalls, 0)
      const init = { method: "POST", headers: { ...authHeaders(), "content-type": "application/json", "idempotency-key": "k" }, body: JSON.stringify(selector) }
      const first = await fetch(`${base}/v1/skills/github/import`, init),
        firstBody = await first.json()
      assert.equal(first.status, 201)
      const second = await fetch(`${base}/v1/skills/github/import`, init)
      assert.equal(second.status, 201)
      assert.deepEqual(await second.json(), firstBody)
      assert.equal(puts, 1)
      assert.equal(commands.filter((x) => x === "completeSkillPackageUpload").length, 1)
      assert.equal(commands.filter((x) => x === "validateSkillDraft").length, 1)
      assert.equal(creates.length, 1)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it("rejects non-GitHub URLs for GitHub skill preview and import", async () => {
    const base = await startFocusedOwnerTestApp("github-invalid", config())
    for (const path of ["preview", "import"]) {
      const response = await fetch(`${base}/v1/skills/github/${path}`, {
        method: "POST",
        headers: { ...authHeaders(), "content-type": "application/json", ...(path === "import" ? { "idempotency-key": "github-import-invalid" } : {}) },
        body: JSON.stringify({ repository_url: "https://example.com/acme/skill-pack" }),
      })
      assert.equal(response.status, 400)
      assert.equal(((await response.json()) as { error: { code: string } }).error.code, "invalid_skill_request")
    }
  })

  it("requires explicit Library kind after admission and does not mistake an HTTP upstream for the Storage Connect adapter", async () => {
    let connections = 0
    let requests = 0
    const upstream = createServer((_request, response) => {
      requests += 1
      response.setHeader("content-type", "application/json")
      response.end(JSON.stringify({ data: { items: [] } }))
    })
    upstream.on("connection", () => {
      connections += 1
    })
    const upstreamBase = await listen(upstream)
    const base = await startFocusedOwnerTestApp("library", config({ mode: "live", upstreams: { ...config().upstreams, storage: upstreamBase } }))

    const unauthenticated = await fetch(`${base}/v1/library`, { headers: { "x-kokoro-request-id": "library-unauthenticated" } })
    assert.equal(unauthenticated.status, 403)
    assert.equal(((await unauthenticated.json()) as { error: { code: string } }).error.code, "service_auth_failed")

    const response = await fetch(`${base}/v1/library`, { headers: { ...authHeaders(), "x-domain": "evil.example", "x-kokoro-request-id": "library-live" } })
    assert.equal(response.status, 400)
    assert.deepEqual(await response.json(), {
      error: {
        code: "invalid_library_kind",
        message: "Personal library files could not be read",
      },
      meta: { request_id: "library-live" },
    })
    assert.equal(response.headers.get("x-request-id"), "library-live")

    const validButUnconfigured = await fetch(`${base}/v1/library?kind=file`, {
      headers: { ...authHeaders(), "x-kokoro-request-id": "library-unconfigured" },
    })
    assert.equal(validButUnconfigured.status, 503)
    assert.deepEqual(await validButUnconfigured.json(), {
      error: {
        code: "storage_unavailable",
        message: "Personal library files could not be read",
      },
      meta: { request_id: "library-unconfigured" },
    })

    await new Promise<void>((resolve) => setImmediate(resolve))
    assert.equal(connections, 0)
    assert.equal(requests, 0)
  })

  it("projects the canonical runtime manifest through System using configured tenant context", async () => {
    let received: {
      url: string | undefined
      service: string | undefined
      secret: string | undefined
      forwarded: string | undefined
      tenant: string | undefined
      subject: string | undefined
      actor: string | undefined
      authorization: string | undefined
    } = {
      url: undefined,
      service: undefined,
      secret: undefined,
      forwarded: undefined,
      tenant: undefined,
      subject: undefined,
      actor: undefined,
      authorization: undefined,
    }
    const upstream = createServer((request, response) => {
      received = {
        url: request.url,
        service: request.headers["x-kokoro-service"]?.toString(),
        secret: request.headers["x-kokoro-internal-secret"]?.toString(),
        forwarded: request.headers.forwarded?.toString(),
        tenant: request.headers["x-kokoro-tenant-id"]?.toString(),
        subject: request.headers["x-kokoro-subject"]?.toString(),
        actor: request.headers["x-kokoro-actor-id"]?.toString(),
        authorization: request.headers.authorization?.toString(),
      }
      response.setHeader("content-type", "application/json")
      response.end(
        JSON.stringify({
          data: {
            tenant_id: "tenant_manifest",
            product_id: "kokoro",
            locale: "en-US",
            navigation: [],
            locale_namespaces: [],
            theme: {},
            feature_flags: [],
            references: [],
            config_version: "1",
            release_id: null,
            digest: "sha256:manifest",
          },
        }),
      )
    })
    const upstreamBase = await listen(upstream)
    const runtimeConfig = config({ mode: "live", upstreams: { ...config().upstreams, system: upstreamBase } }) as BffConfig & { tenantId: string }
    runtimeConfig.tenantId = "tenant_manifest"
    const base = await startSystemTestApp(runtimeConfig)

    const response = await fetch(`${base}/v1/system/runtime-manifest?product_id=kokoro&locale=en-US&surface_id=user-web`, {
      headers: {
        "x-kokoro-service": "web-bff",
        "x-kokoro-internal-secret": "test-secret",
        "x-kokoro-request-id": "manifest-live",
        authorization: "Bearer irrelevant-user-session",
        origin: "https://web.example.test",
      },
    })
    assert.equal(response.status, 200)
    assert.deepEqual(received, {
      url: "/v1/system/runtime-manifest?product_id=kokoro&locale=en-US&surface_id=user-web",
      service: "web-bff",
      secret: "bff-upstream-secret",
      forwarded: "host=dev.kokoro.localhost",
      tenant: "tenant_manifest",
      subject: undefined,
      actor: undefined,
      authorization: "Bearer bff-upstream-secret",
    })
    assert.deepEqual(await response.json(), {
      data: {
        tenant_id: "tenant_manifest",
        product_id: "kokoro",
        locale: "en-US",
        navigation: [],
        locale_namespaces: [],
        theme: {},
        feature_flags: [],
        references: [],
        config_version: "1",
        release_id: null,
        digest: "sha256:manifest",
      },
      meta: { request_id: "manifest-live" },
    })
  })

  it("projects the Model catalog through its owner contract", async () => {
    const received: {
      url: string | undefined
      service: string | undefined
      tenant: string | undefined
      subject: string | undefined
      requestId: string | undefined
      permissions: string | undefined
    } = {
      url: undefined,
      service: undefined,
      tenant: undefined,
      subject: undefined,
      requestId: undefined,
      permissions: undefined,
    }
    const upstream = createServer((request, response) => {
      received.url = request.url
      received.service = request.headers["x-kokoro-service"]?.toString()
      received.tenant = request.headers["x-kokoro-tenant-id"]?.toString()
      received.subject = request.headers["x-kokoro-subject"]?.toString()
      received.requestId = request.headers["x-request-id"]?.toString()
      received.permissions = request.headers["x-kokoro-iam-permissions"]?.toString()
      response.setHeader("content-type", "application/json")
      response.end(
        JSON.stringify({
          data: {
            items: [modelCatalogItem],
            next_cursor: "model-cursor-next",
          },
        }),
      )
    })
    const upstreamBase = await listen(upstream)
    const base = await startSystemTestApp(
      config({
        mode: "live",
        upstreams: { ...config().upstreams, system: upstreamBase },
      }),
    )

    const response = await fetch(`${base}/v1/models?feature_key=chat&limit=20&cursor=cursor-1`, {
      headers: {
        ...authHeaders(),
        "x-kokoro-request-id": "model-owner-request",
        "x-kokoro-tenant-id": "tenant-attacker",
        "x-kokoro-iam-permissions": "system:write",
      },
    })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
      data: {
        models: [{ name: modelCatalogItem.key, ...Object.fromEntries(Object.entries(modelCatalogItem).filter(([key]) => key !== "key")) }],
        next_cursor: "model-cursor-next",
      },
      meta: { request_id: "model-owner-request" },
    })
    assert.deepEqual(received, {
      url: "/v1/system/model-catalog/catalog?feature_key=chat&limit=20&cursor=cursor-1",
      service: "web-bff",
      tenant: "ns_test",
      subject: "user_test",
      requestId: "model-owner-request",
      permissions: undefined,
    })
  })

  it("rejects incomplete, legacy, extra and invalid owner catalog fields without leaking configuration", async () => {
    const { is_default: _default, ...withoutDefault } = modelCatalogItem
    const { request_model: _requestModel, ...withoutRequestModel } = modelCatalogItem
    const data = (item: unknown) => ({ data: { items: [item], next_cursor: null } })
    for (const ownerBody of [
      data(withoutDefault),
      data({ ...modelCatalogItem, is_default: "true" }),
      { data: { items: [modelCatalogItem] } },
      { items: [modelCatalogItem], next_cursor: null },
      { ...data(modelCatalogItem), meta: { request_id: "legacy" } },
      data({ key: "model-a", display_name: "Model A", is_default: true }),
      data(withoutRequestModel),
      data({ ...modelCatalogItem, default_revision_id: modelCatalogItem.revision_id }),
      data({ ...modelCatalogItem, provider_id: "not-a-uuid" }),
      data({ ...modelCatalogItem, provider: "" }),
      data({ ...modelCatalogItem, key: "x".repeat(129) }),
      data({ ...modelCatalogItem, feature_key: "" }),
      data({ ...modelCatalogItem, display_name: "x".repeat(256) }),
      data({ ...modelCatalogItem, connection: { base_url: "https://private.invalid", secret_handle_ref: "private-secret" } }),
      { data: { items: [modelCatalogItem], next_cursor: null, extra: "private-secret" } },
    ]) {
      const upstream = createServer((_request, response) => {
        response.setHeader("content-type", "application/json")
        response.end(JSON.stringify(ownerBody))
      })
      const upstreamBase = await listen(upstream)
      const base = await startSystemTestApp(config({ upstreams: { ...config().upstreams, system: upstreamBase } }))
      const response = await fetch(`${base}/v1/models?feature_key=chat`, { headers: { ...authHeaders(), "x-kokoro-request-id": "invalid-model-owner" } })
      assert.equal(response.status, 502)
      const text = await response.text()
      const responseBody = JSON.parse(text) as { error: { code: string }; meta: { request_id: string } }
      assert.equal(responseBody.error.code, "upstream_response_invalid")
      assert.equal(responseBody.meta.request_id, "invalid-model-owner")
      assert.equal("data" in responseBody, false)
      assert.doesNotMatch(text, /private-secret|private\.invalid/u)
    }
  })

  it("keeps stable catalog identities when display aliases change or fall back to the request model", async () => {
    let item = modelCatalogItem
    const upstream = createServer((_request, response) => {
      response.setHeader("content-type", "application/json")
      response.end(JSON.stringify({ data: { items: [item], next_cursor: null } }))
    })
    const upstreamBase = await listen(upstream)
    const base = await startSystemTestApp(config({ upstreams: { ...config().upstreams, system: upstreamBase } }))
    for (const displayName of ["Optional alias", "m".repeat(255)]) {
      item = { ...modelCatalogItem, display_name: displayName, request_model: "m".repeat(255) }
      const response = await fetch(`${base}/v1/models?feature_key=chat`, { headers: authHeaders() })
      assert.equal(response.status, 200)
      const body = (await response.json()) as { data: { models: Array<Record<string, unknown>>; next_cursor: null } }
      assert.equal(body.data.next_cursor, null)
      assert.deepEqual(body.data.models, [
        {
          name: modelCatalogItem.key,
          ...Object.fromEntries(Object.entries(item).filter(([key]) => key !== "key")),
        },
      ])
    }
  })

  it("rejects malformed System errors and runtime manifests for another trusted tenant", async () => {
    for (const ownerResponse of [
      { status: 403, body: { error: { code: "forbidden", message: "denied" } } },
      { status: 403, body: { error: { code: "forbidden", message: "denied", retryable: "false" } } },
      {
        status: 201,
        body: {
          data: {
            tenant_id: "tenant_manifest",
            product_id: "kokoro",
            locale: "en-US",
            navigation: [],
            locale_namespaces: [],
            theme: {},
            feature_flags: [],
            references: [],
            config_version: "1",
            release_id: null,
            digest: "sha256:manifest",
          },
        },
      },
      {
        status: 302,
        body: {
          data: {
            tenant_id: "tenant_manifest",
            product_id: "kokoro",
            locale: "en-US",
            navigation: [],
            locale_namespaces: [],
            theme: {},
            feature_flags: [],
            references: [],
            config_version: "1",
            release_id: null,
            digest: "sha256:manifest",
          },
        },
      },
      {
        status: 200,
        body: {
          data: {
            tenant_id: "tenant_other",
            product_id: "kokoro",
            locale: "en-US",
            navigation: [],
            locale_namespaces: [],
            theme: {},
            feature_flags: [],
            references: [],
            config_version: "1",
            release_id: null,
            digest: "sha256:manifest",
          },
        },
      },
    ]) {
      const upstream = createServer((_request, response) => {
        response.statusCode = ownerResponse.status
        response.setHeader("content-type", "application/json")
        response.end(JSON.stringify(ownerResponse.body))
      })
      const upstreamBase = await listen(upstream)
      const runtimeConfig = config({ upstreams: { ...config().upstreams, system: upstreamBase } }) as BffConfig & { tenantId: string }
      runtimeConfig.tenantId = "tenant_manifest"
      const base = await startSystemTestApp(runtimeConfig)
      const response = await fetch(`${base}/v1/system/runtime-manifest?product_id=kokoro&locale=en-US&surface_id=user-web`, {
        headers: {
          "x-kokoro-service": "web-bff",
          "x-kokoro-internal-secret": "test-secret",
          "x-kokoro-request-id": "invalid-system-owner",
          origin: "https://web.example.test",
        },
      })
      assert.equal(response.status, 502)
      assert.equal(((await response.json()) as { error: { code: string } }).error.code, "upstream_response_invalid")
    }
  })

  it("projects v2 Billing catalog while checkout remains unavailable", async () => {
    const received: Array<{ url: string | undefined; body: string; service: string | undefined }> = []
    const upstream = createServer((request, response) => {
      const chunks: Buffer[] = []
      request.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
      request.on("end", () => {
        received.push({ url: request.url, body: Buffer.concat(chunks).toString("utf8"), service: request.headers["x-kokoro-service"]?.toString() })
        response.setHeader("content-type", "application/json")
        if (request.url?.startsWith("/v1/commerce/catalog?")) {
          response.end(
            JSON.stringify({
              data: {
                items: [
                  {
                    offer_revision_id: "11111111-1111-4111-8111-111111111111",
                    offer_key: "pro",
                    name: "Pro",
                    currency_code: "USD",
                    amount_minor: "1999",
                    credit_micros: "1000000",
                    billing_interval: "month",
                  },
                ],
                page: { next_cursor: null },
              },
            }),
          )
          return
        }
        response.statusCode = 201
        response.end(
          JSON.stringify({ data: { checkout_id: "checkout-1", checkout_url: "https://pay.test/checkout-1" }, meta: { request_id: "billing-checkout" } }),
        )
      })
    })
    const upstreamBase = await listen(upstream)
    const base = await startFocusedOwnerTestApp(
      "billing-checkout",
      config({
        mode: "live",
        billingServiceToken: "billing-service-token",
        upstreams: { ...config().upstreams, billing: upstreamBase },
      }),
    )

    const plans = await fetch(`${base}/v1/billing/plans`, { headers: { ...authHeaders(), "x-kokoro-request-id": "billing-catalog" } })
    assert.equal(plans.status, 200)
    assert.deepEqual(await plans.json(), {
      data: {
        plans: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            key: "pro",
            name: "Pro",
            currency: "USD",
            amount_minor: "1999",
            credit_micros: "1000000",
            billing_interval: "month",
          },
        ],
      },
      meta: { request_id: "billing-catalog" },
    })

    const checkout = await fetch(`${base}/v1/billing/checkout`, {
      method: "POST",
      headers: { ...authHeaders(), "content-type": "application/json", "idempotency-key": "billing-checkout-key", "x-kokoro-request-id": "billing-checkout" },
      body: JSON.stringify({ plan_id: "offer-revision-1" }),
    })
    assert.equal(checkout.status, 503)
    assert.deepEqual(await checkout.json(), {
      error: { code: "billing_unavailable", message: "Billing checkout is unavailable" },
      meta: { request_id: "billing-checkout" },
    })
    assert.equal(received[0]?.url, "/v1/commerce/catalog?limit=100")
    assert.equal(received[0]?.service, "web-bff")
    assert.equal(received.length, 1)
  })
  it("projects the admitted subject's fixed Credit account and ledger without a fake balance", async () => {
    const received: Array<{ url: string | undefined; authorization: string | undefined; tenant: string | undefined; subject: string | undefined }> = []
    const upstream = createServer((request, response) => {
      received.push({
        url: request.url,
        authorization: request.headers.authorization,
        tenant: request.headers["x-kokoro-tenant-id"]?.toString(),
        subject: request.headers["x-kokoro-subject"]?.toString(),
      })
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store", "x-request-id": "billing-owner" })
      if (request.url === "/v1/billing/me/credit-account") {
        response.end(
          JSON.stringify({
            data: {
              credit_account_id: "11111111-1111-4111-8111-111111111111",
              status: "active",
              available_micros: "42000000",
              held_micros: "1500000",
            },
          }),
        )
        return
      }
      response.end(JSON.stringify({ data: { items: [], page: { next_cursor: null } } }))
    })
    const upstreamBase = await listen(upstream)
    const runtimeConfig = {
      ...config({ upstreams: { ...config().upstreams, billing: upstreamBase } }),
      upstreamSecret: "billing-internal-secret",
      billingServiceToken: "billing-service-token",
    } as BffConfig
    const base = await startFocusedOwnerTestApp("billing-credit", runtimeConfig)

    const summary = await fetch(`${base}/v1/billing/summary`, { headers: { ...authHeaders(), "x-kokoro-request-id": "billing-summary" } })
    assert.equal(summary.status, 200)
    assert.equal(summary.headers.get("cache-control"), "no-store")
    assert.deepEqual(await summary.json(), {
      data: {
        credit_account_id: "11111111-1111-4111-8111-111111111111",
        status: "active",
        available_micros: "42000000",
        held_micros: "1500000",
      },
      meta: { request_id: "billing-summary" },
    })
    const ledger = await fetch(`${base}/v1/billing/ledger?limit=50`, { headers: { ...authHeaders(), "x-kokoro-request-id": "billing-ledger" } })
    assert.equal(ledger.status, 200)
    assert.deepEqual(await ledger.json(), { data: { items: [], page: { next_cursor: null } }, meta: { request_id: "billing-ledger" } })
    assert.deepEqual(received, [
      { url: "/v1/billing/me/credit-account", authorization: "Bearer billing-service-token", tenant: "u1.bnNfdGVzdA", subject: "u1.dXNlcl90ZXN0" },
      { url: "/v1/billing/me/credit-ledger?limit=50", authorization: "Bearer billing-service-token", tenant: "u1.bnNfdGVzdA", subject: "u1.dXNlcl90ZXN0" },
    ])
  })

  it("does not misroute BFF-owned projects or scheduled definitions to an owner", async () => {
    await import("reflect-metadata")
    const { Test } = await import("@nestjs/testing")
    const {
      AGENT_CANCELLATION_DISPATCHER,
      AGENT_DISPATCH_DISPATCHER,
      AGUI_PROJECTOR,
      BFF_CONFIG,
      BFF_DATABASE,
      PROJECT_READS,
      SCHEDULED_TASK_DISPATCHER,
      SESSION_ADMISSION,
    } = await import("../dist/common/tokens.js")
    const { BFF_NEST_APPLICATION_OPTIONS } = await import("../dist/main.js")
    const { ScheduledTasksModule } = await import("../dist/modules/scheduled-tasks/scheduled-tasks.module.js")
    const { SCHEDULED_TASK_SNAPSHOTS } = await import("../dist/modules/scheduled-tasks/scheduled-task.providers.js")
    const { SystemModule } = await import("../dist/modules/system/system.module.js")
    const ownerCalls: Array<string | undefined> = []
    const upstream = createServer((request, response) => {
      ownerCalls.push(request.url)
      response.setHeader("content-type", "application/json")
      response.end(JSON.stringify({ data: { items: [] }, meta: { request_id: "should-not-be-called" } }))
    })
    const upstreamBase = await listen(upstream)
    const unexpected = (): never => assert.fail("Definition-list fixture must not perform unrelated storage I/O")
    let localReadFailed = false
    const readLocalDefinitions = async (scope: { tenantId: string; subjectId: string }) => {
      assert.deepEqual(scope, { tenantId: "ns_test", subjectId: "user_test" })
      if (localReadFailed) throw new Error("local owner read unavailable")
      return []
    }
    // Keep the Scheduler client configured. Only the BFF-owned definition facts are substituted.
    const { ProjectsModule } = await import("../dist/modules/projects/projects.module.js")
    const builder = Test.createTestingModule({ imports: [ProjectsModule, ScheduledTasksModule, SystemModule] })
      .overrideProvider(BFF_CONFIG)
      .useValue(
        config({
          schedulerServiceToken: "scheduler-service-token",
          schedulerTargetUrl: "http://127.0.0.1:4300/internal/bff/scheduled-tasks/dispatch",
          upstreams: { ...config().upstreams, system: upstreamBase, scheduler: upstreamBase },
        }),
      )
      .overrideProvider(BFF_DATABASE)
      .useValue({ pool: { query: unexpected, connect: unexpected } })
      .overrideProvider(SESSION_ADMISSION)
      .useValue(new SessionAdmissionDouble({ "test-session": { namespace: "ns_test", userId: "user_test" } }))
      .overrideProvider(PROJECT_READS)
      .useValue({ list: readLocalDefinitions })
      .overrideProvider(SCHEDULED_TASK_SNAPSHOTS)
      .useValue({ snapshots: readLocalDefinitions })
    for (const token of [AGENT_CANCELLATION_DISPATCHER, AGENT_DISPATCH_DISPATCHER, AGUI_PROJECTOR, SCHEDULED_TASK_DISPATCHER]) {
      builder.overrideProvider(token).useValue(null)
    }
    const module = await builder.compile()
    const app = module.createNestApplication({ ...BFF_NEST_APPLICATION_OPTIONS, abortOnError: false, logger: false })
    ownerApps.push(app)
    await app.listen(0, "127.0.0.1")
    const base = await app.getUrl()

    for (const [path, field, failureCode] of [
      ["/v1/projects", "projects", "business_store_unavailable"],
      ["/v1/scheduled-tasks", "tasks", "scheduler_current_unavailable"],
    ] as const) {
      localReadFailed = false
      const response = await fetch(`${base}${path}`, { headers: authHeaders() })
      assert.equal(response.status, 200)
      assert.deepEqual(((await response.json()) as { data: unknown }).data, { [field]: [] })

      localReadFailed = true
      const failed = await fetch(`${base}${path}`, { headers: authHeaders() })
      assert.equal(failed.status, 503)
      assert.equal(((await failed.json()) as { error: { code: string } }).error.code, failureCode)
    }
    assert.deepEqual(ownerCalls, [])
  })

  it("keeps the v1 API documentation and canonical path census", () => {
    const baseDir = fileURLToPath(new URL("../docs/api/v1/", import.meta.url))
    for (const file of ["README.md", "projects.md", "system.md", "models.md", "skills.md", "mcp.md", "scheduled.md", "agents.md", "library.md", "billing.md"]) {
      assert.equal(existsSync(`${baseDir}/${file}`), true, file)
    }

    const openapi = readFileSync(fileURLToPath(new URL("../contract/openapi/v1/openapi.yaml", import.meta.url)), "utf8")
    assert.ok(!openapi.includes("/v1/skills/quota"))
    assert.ok(!openapi.includes("/v1/skills/{name}/revisions"))
    for (const path of [
      "/v1/projects",
      "/v1/projects/{projectId}",
      "/v1/projects/{projectId}/tasks",
      "/v1/projects/{projectId}/instruction-revisions",
      "/v1/projects/{projectId}/resources",
      "/v1/projects/{projectId}/skill-selection",
      "/v1/projects/{projectId}/scheduled-tasks",
      "/v1/skill.list",
      "/v1/skill-installations",
      "/v1/skill-installations/{installation_id}",
      "/v1/skill-installations/{installation_id}/enabled",
      "/v1/skills/github/preview",
      "/v1/skills/github/import",
      "/v1/mcp/servers",
      "/v1/scheduled-tasks",
      "/v1/scheduled-tasks/{id}",
      "/v1/scheduled-tasks/{id}/retry",
      "/v1/agents/connections/setup",
      "/v1/sessions",
      "/v1/models",
      "/v1/system/runtime-manifest",
      "/v1/sessions/{id}",
      "/v1/sessions/{id}/messages",
      "/v1/sessions/{id}/events",
      "/v1/sessions/{id}/runs/{runId}/control",
      "/v1/sessions/{id}/title",
      "/v1/sessions/{id}",
      "/v1/sessions/{id}/share",
      "/v1/shared/{shareId}",
      "/v1/library",
      "/v1/billing/plans",
      "/v1/billing/summary",
      "/v1/billing/checkout",
    ]) {
      assert.ok(openapi.includes(path), path)
    }
  })

  it("Chat scope and store failures never fall back to Agent-owned history or launch", async (t) => {
    let ownerCalls = 0
    const agentBase = await listen(
      createServer((_request, response) => {
        ownerCalls++
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({ data: { ok: true }, meta: { request_id: "agent" } }))
      }),
    )
    let storeAttempts = 0
    const unavailable = async (): Promise<never> => {
      storeAttempts++
      throw new Error("private-chat-store-outage")
    }
    const { base, admission } = await startAgentRunsTestApp(
      t,
      config({ agentEnabled: true, upstreams: { ...config().upstreams, agents: agentBase } }),
      unavailable,
    )

    const invalidScope = await fetch(`${base}/v1/sessions?scope=other-scope&project_ref=project_kokoro`, { headers: authHeaders() })
    assert.equal(invalidScope.status, 400)
    assert.equal(((await invalidScope.json()) as { error: { code: string } }).error.code, "invalid_scope")

    const denied = await fetch(`${base}/v1/sessions`, {
      headers: { ...authHeaders(), cookie: "kokoro-issuer.session_token=unknown-session" },
    })
    assert.equal(denied.status, 401)
    assert.equal(((await denied.json()) as { error: { code: string } }).error.code, "session_invalid")
    assert.equal(admission.calls.length, 2)
    assert.equal(storeAttempts, 0)
    assert.equal(ownerCalls, 0)

    const requests: Array<{ path: string; code: string; init?: RequestInit }> = [
      { path: "/v1/sessions", code: "business_store_unavailable" },
      { path: "/v1/sessions/session-live", code: "chat_unavailable" },
      { path: "/v1/sessions/session-live/messages", code: "chat_unavailable" },
      { path: "/v1/sessions/session-live/events", code: "agui_ledger_unavailable" },
      {
        path: "/v1/sessions/session-live/messages",
        code: "business_store_unavailable",
        init: {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": "live-chat-no-store" },
          body: JSON.stringify({ content: "hello" }),
        },
      },
      {
        path: "/v1/sessions/session-live/runs/run-live/control",
        code: "agent_control_unavailable",
        init: {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": "live-control-no-store" },
          body: JSON.stringify({ kind: "run.cancel" }),
        },
      },
    ]

    for (const { path, code, init } of requests) {
      const before = storeAttempts
      const response = await fetch(`${base}${path}`, { ...init, headers: { ...authHeaders(), ...init?.headers } })
      assert.equal(response.status, 503, path)
      const body = (await response.json()) as { error: { code: string } }
      assert.equal(body.error.code, code, path)
      assert.doesNotMatch(JSON.stringify(body), /private-chat-store-outage/u)
      assert.ok(storeAttempts > before, path)
    }
    assert.equal(ownerCalls, 0)
  })

  it("does not admit or forward retired MCP server mutations", async (t) => {
    await import("reflect-metadata")
    const { mkdtemp, rm, writeFile } = await import("node:fs/promises")
    const { tmpdir } = await import("node:os")
    const { join } = await import("node:path")
    const { Test } = await import("@nestjs/testing")
    const { AppModule } = await import("../dist/app.module.js")
    const { loadConfig } = await import("../dist/config/runtime.js")
    const { BFF_NEST_APPLICATION_OPTIONS } = await import("../dist/main.js")
    const { BffExpressAdapter } = await import("../dist/http/bff-express-adapter.js")
    const {
      AGENT_CANCELLATION_DISPATCHER,
      AGENT_DISPATCH_DISPATCHER,
      AGUI_PROJECTOR,
      BFF_CONFIG,
      BFF_DATABASE,
      MCP_AUTHORIZATION,
      PROJECT_SCOPE_RELEASE_DISPATCHER,
      SCHEDULED_AGENT_DISPATCHER,
      SCHEDULED_TASK_DISPATCHER,
      SESSION_ADMISSION,
    } = await import("../dist/common/tokens.js")

    let ownerCalls = 0
    const ownerBase = await listen(
      createServer((_request, response) => {
        ownerCalls++
        response.writeHead(502).end()
      }),
    )
    const directory = await mkdtemp(join(tmpdir(), "bff-retired-mcp-"))
    t.after(() => rm(directory, { recursive: true, force: true }))
    const credentialFile = join(directory, "projection.json")
    await writeFile(
      credentialFile,
      JSON.stringify({
        version: 1,
        entries: [
          {
            credential_id: "retired-mcp-projection",
            secret: "retired-mcp-projection-test-only-secret",
            caller: "kokoro-bff",
            surfaces: ["projection"],
            tenant_id: "ns_test",
          },
        ],
      }),
      { mode: 0o600 },
    )
    const admission = new SessionAdmissionDouble({ "test-session": { namespace: "ns_test", userId: "user_test" } })
    let databaseCalls = 0
    const unexpectedDatabase = (): never => {
      databaseCalls++
      assert.fail("retired MCP mutations must not read or write BFF storage")
    }
    let authorizationCalls = 0
    const configValue = loadConfig({
      KOKORO_BFF_SHARED_SECRET: "test-secret",
      KOKORO_IAM_WEB_ORIGIN: "https://web.example.test",
      KOKORO_BFF_POSTGRES_URL: "postgresql://fixture:fixture@127.0.0.1:1/fixture?schema=kokoro_bff",
      KOKORO_BFF_REDIS_URL: "redis://127.0.0.1:1/8",
      KOKORO_AGENT_ENABLED: "false",
      KOKORO_PLATFORM_BASE_URL: ownerBase,
      KOKORO_PLATFORM_PROJECTION_CREDENTIAL_FILE: credentialFile,
    })
    const builder = Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(BFF_CONFIG)
      .useValue(configValue)
      .overrideProvider(BFF_DATABASE)
      .useValue({ pool: { query: unexpectedDatabase, connect: unexpectedDatabase } })
      .overrideProvider(SESSION_ADMISSION)
      .useValue(admission)
      .overrideProvider(MCP_AUTHORIZATION)
      .useValue({
        check: async () => {
          authorizationCalls++
          return { ok: true }
        },
      })
    for (const token of [
      AGENT_CANCELLATION_DISPATCHER,
      AGENT_DISPATCH_DISPATCHER,
      AGUI_PROJECTOR,
      PROJECT_SCOPE_RELEASE_DISPATCHER,
      SCHEDULED_AGENT_DISPATCHER,
      SCHEDULED_TASK_DISPATCHER,
    ])
      builder.overrideProvider(token).useValue(null)
    const module = await builder.compile()
    const app = module.createNestApplication(new BffExpressAdapter(), { ...BFF_NEST_APPLICATION_OPTIONS, abortOnError: false, logger: false })
    ownerApps.push(app)
    await app.listen(0, "127.0.0.1")
    const base = await app.getUrl()

    for (const [method, path, key] of [
      ["POST", "/v1/mcp/servers", "mcp-register"],
      ["POST", "/v1/mcp/servers/legacy/enable", "mcp-enable"],
      ["POST", "/v1/mcp/servers/legacy/disable", "mcp-disable"],
      ["DELETE", "/v1/mcp/servers/legacy", "mcp-delete"],
    ]) {
      const response = await fetch(`${base}${path}`, {
        method,
        headers: { ...authHeaders(), "content-type": "application/json", "idempotency-key": key },
        body: "{}",
      })
      assert.equal(response.status, 404, path)
      assert.equal(((await response.json()) as { error: { code: string } }).error.code, "bff_route_not_found", path)
    }
    assert.equal(admission.calls.length, 0)
    assert.equal(authorizationCalls, 0)
    assert.equal(databaseCalls, 0)
    assert.equal(ownerCalls, 0)
  })
})
