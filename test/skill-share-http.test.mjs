import assert from "node:assert/strict"
import test from "node:test"
test("Skill Share source route exists separately from anonymous conversation Share", async () => {
  const module = await import("../src/http/routes/skill-share.ts").catch(() => ({}))
  assert.equal(typeof module.skillShareRoute, "function")
})

import { createServer } from "node:http"
import { once } from "node:events"
import { create } from "@bufbuild/protobuf"
import { ConnectError, Code } from "@connectrpc/connect"
import { InspectSkillPackageResponseSchema } from "../src/generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.ts"
import { skillShareRoute } from "../src/http/routes/skill-share.ts"

const summary = {
  skill_id: "one",
  series_id: "series",
  revision: "1",
  display_name: "Skill one",
  description: "Description",
  tags: [],
  example_prompts: [],
  category_keys: [],
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  owner_type: "personal",
  source_kind: "personal",
}

test("Skill Share HTTP requires current exact qualification before create and resolve while preserving creator revoke", async () => {
  let share = null,
    sourceStatus = "active",
    reads = 0,
    creates = 0,
    revokes = 0,
    summaries = 0,
    summaryMode = "valid",
    summaryAvailable = true,
    withdrawOnCreate = false
  let routeCompleted = Promise.resolve(),
    enterSummary,
    releaseSummary,
    observeAbort
  const repository = {
    create: async (scope, sourceRef, urlFor, expiresAt) => {
      creates++
      share ??= {
        shareId: "share",
        tenantId: scope.tenantId,
        creatorSubjectId: scope.creatorSubjectId,
        resourceKind: "skill_revision",
        sourceRef,
        url: urlFor("share"),
        createdAt: new Date(),
        expiresAt,
        revokedAt: null,
      }
      if (withdrawOnCreate) sourceStatus = "withdrawn"
      return share
    },
    findActive: async (tenant, id) => (share && share.shareId === id && share.tenantId === tenant && !share.revokedAt ? share : null),
    revoke: async (scope, id) => {
      if (!share || share.shareId !== id || share.tenantId !== scope.tenantId || share.creatorSubjectId !== scope.creatorSubjectId) return null
      revokes++
      share = { ...share, revokedAt: new Date() }
      return share
    },
  }
  const client = {
    // A creator can still inspect a withdrawn/draft package. Preview is not share qualification.
    inspect: async (input) => {
      reads++
      return create(InspectSkillPackageResponseSchema, { sourceRef: { value: input.sourceRef }, revision: 1n, files: [] })
    },
  }
  const specification = {
    revisionSummary: async (sourceRef, context, signal) => {
      summaries++
      assert.equal(sourceRef, "skill:one")
      assert.equal(context.identity.userId, "creator")
      if (sourceStatus !== "active") throw new ConnectError("not shareable", Code.NotFound)
      if (summaryMode === "hold") {
        signal.addEventListener("abort", () => observeAbort(), { once: true })
        const pending = new Promise((resolve) => {
          releaseSummary = resolve
        })
        enterSummary()
        return pending
      }
      if (summaryMode === "wrong-source") return { ...summary, skill_id: "different-revision" }
      if (summaryMode === "extra-field") return { ...summary, private_locator: "never-wire" }
      return summary
    },
  }
  const server = createServer((request, response) => {
    routeCompleted = skillShareRoute(
      request,
      response,
      {
        requestId: "request",
        identity: { namespace: request.headers["x-fixture-tenant"] ?? "tenant", userId: request.headers["x-fixture-subject"] ?? "creator" },
      },
      new URL(request.url, "http://bff.local").pathname.split("/").slice(2),
      repository,
      client,
      "http://127.0.0.1:3310",
      summaryAvailable ? specification : undefined,
    )
    void routeCompleted
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  try {
    const base = `http://127.0.0.1:${server.address().port}/v1/skill-shares`
    const post = (options = {}) =>
      fetch(base, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ source_ref: "skill:one" }), ...options })
    let response = await post()
    assert.equal(response.status, 201)
    assert.equal((await response.json()).data.url, "http://127.0.0.1:3310/skills/shared/share")
    assert.equal(reads, 2)
    assert.equal(creates, 1)
    response = await fetch(`${base}/share`, { headers: { "x-fixture-tenant": "foreign" } })
    assert.equal(response.status, 404)
    assert.equal(reads, 2)
    response = await fetch(`${base}/share`, { method: "DELETE", headers: { "x-fixture-subject": "other" } })
    assert.equal(response.status, 404)
    response = await fetch(`${base}/share`)
    assert.equal(response.status, 200)
    assert.equal(reads, 3)
    const qualifiedReads = reads
    for (sourceStatus of ["withdrawn", "disabled", "draft", "quarantined"]) {
      response = await fetch(`${base}/share`)
      assert.equal(response.status, 404, `${sourceStatus} resolve`)
      assert.equal((await post()).status, 404, `${sourceStatus} existing-share create`)
      assert.equal(creates, 1)
      assert.equal(reads, qualifiedReads)
      assert.equal(share.revokedAt, null)
    }
    sourceStatus = "active"
    summaryAvailable = false
    assert.equal((await post()).status, 503)
    assert.equal((await fetch(`${base}/share`)).status, 503)
    assert.equal(creates, 1)
    assert.equal(reads, qualifiedReads)
    summaryAvailable = true
    for (summaryMode of ["wrong-source", "extra-field"]) {
      assert.equal((await post()).status, 502)
      assert.equal(creates, 1)
      assert.equal(reads, qualifiedReads)
    }
    summaryMode = "hold"
    const entered = new Promise((resolve) => {
      enterSummary = resolve
    })
    const aborted = new Promise((resolve) => {
      observeAbort = resolve
    })
    const controller = new AbortController()
    const canceled = post({ signal: controller.signal })
    await entered
    controller.abort()
    await assert.rejects(canceled, { name: "AbortError" })
    await aborted
    releaseSummary(summary)
    await routeCompleted
    assert.equal(creates, 1)
    assert.equal(reads, qualifiedReads)
    summaryMode = "valid"
    withdrawOnCreate = true
    assert.equal((await post()).status, 404)
    // Cross-owner withdrawal after create may leave the existing BFF locator, not a misleading 201.
    assert.equal(creates, 2)
    assert.equal(share.revokedAt, null)
    assert.equal(revokes, 0)
    assert.equal((await fetch(`${base}/share`)).status, 404)
    const beforeDeleteSummaries = summaries
    response = await fetch(`${base}/share`, { method: "DELETE" })
    assert.equal(response.status, 200)
    assert.equal(summaries, beforeDeleteSummaries)
    assert.equal(revokes, 1)
    assert.equal((await fetch(`${base}/share`)).status, 404)
  } finally {
    releaseSummary?.(summary)
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
})

test("Skill Share composition uses the validated browser origin, not an invented HTTPS domain", async (t) => {
  await import("reflect-metadata")
  const { Test } = await import("@nestjs/testing")
  const { BFF_CONFIG, BFF_DATABASE, SESSION_ADMISSION, SKILL_PRODUCT_CLIENT, SKILL_SHARE_REPOSITORY, SKILL_SPECIFICATION_SOURCE } =
    await import("../dist/common/tokens.js")
  const { loadConfig } = await import("../dist/config/runtime.js")
  const { BFF_NEST_APPLICATION_OPTIONS } = await import("../dist/main.js")
  const { SkillsModule } = await import("../dist/modules/skills/skills.module.js")
  const { SessionAdmissionDouble } = await import("./doubles/session-admission.ts")

  const origin = "http://127.0.0.1:3310"
  const config = loadConfig({
    KOKORO_DOMAIN: "different-product.example.test",
    KOKORO_TENANT_ID: "tenant",
    KOKORO_IAM_WEB_ORIGIN: origin,
    KOKORO_BFF_SHARED_SECRET: "fixture-secret",
    KOKORO_BFF_POSTGRES_URL: "postgresql://db.invalid/fixture?schema=kokoro_bff",
    KOKORO_BFF_REDIS_URL: "redis://cache.invalid/8",
  })
  const admission = new SessionAdmissionDouble({ session: { namespace: "tenant", userId: "creator" } })
  const inspect = t.mock.fn(async (input) => create(InspectSkillPackageResponseSchema, { sourceRef: { value: input.sourceRef }, revision: 1n, files: [] }))
  const revisionSummary = t.mock.fn(async () => summary)
  const createShare = t.mock.fn(async (scope, sourceRef, urlFor, expiresAt) => ({
    shareId: "share",
    tenantId: scope.tenantId,
    creatorSubjectId: scope.creatorSubjectId,
    resourceKind: "skill_revision",
    sourceRef,
    url: urlFor("share"),
    createdAt: new Date("2026-01-01T00:00:00Z"),
    expiresAt,
    revokedAt: null,
  }))
  const module = await Test.createTestingModule({ imports: [SkillsModule] })
    .overrideProvider(BFF_CONFIG)
    .useValue(config)
    .overrideProvider(BFF_DATABASE)
    .useValue({ pool: Object.freeze({}) })
    .overrideProvider(SESSION_ADMISSION)
    .useValue(admission)
    .overrideProvider(SKILL_PRODUCT_CLIENT)
    .useValue({ inspect })
    .overrideProvider(SKILL_SHARE_REPOSITORY)
    .useValue({ create: createShare })
    .overrideProvider(SKILL_SPECIFICATION_SOURCE)
    .useValue({ revisionSummary })
    .compile()
  const app = module.createNestApplication({ ...BFF_NEST_APPLICATION_OPTIONS, abortOnError: false, logger: false })
  t.after(() => app.close())
  await app.listen(0, "127.0.0.1")
  const base = await app.getUrl()
  const post = (browserOrigin) =>
    fetch(`${base}/v1/skill-shares`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-kokoro-service": "web-bff",
        "x-kokoro-internal-secret": "fixture-secret",
        cookie: "kokoro-issuer.session_token=session",
        origin: browserOrigin,
        "x-forwarded-host": "untrusted-host.example.test",
        "x-forwarded-proto": "https",
      },
      body: '{"source_ref":"skill:one"}',
    })

  const rejected = await post("https://untrusted-host.example.test")
  assert.equal(rejected.status, 403)
  assert.equal((await rejected.json()).error.code, "session_forbidden")
  assert.equal(admission.calls.length, 0)
  assert.equal(inspect.mock.callCount(), 0)
  assert.equal(revisionSummary.mock.callCount(), 0)
  assert.equal(createShare.mock.callCount(), 0)

  const admitted = await post(origin)
  assert.equal(admitted.status, 201)
  assert.equal((await admitted.json()).data.url, "http://127.0.0.1:3310/skills/shared/share")
  assert.deepEqual(
    admission.calls.map((call) => call.origin),
    [origin],
  )
  assert.equal(createShare.mock.callCount(), 1)
  assert.deepEqual(createShare.mock.calls[0].arguments[0], { tenantId: "tenant", creatorSubjectId: "creator" })
})

test("Skill Share POST without a trusted public origin fails before owner inspection or share creation", async () => {
  let effects = 0
  const server = createServer(
    (request, response) =>
      void skillShareRoute(
        request,
        response,
        { requestId: "origin-negative", identity: { namespace: "tenant", userId: "creator" } },
        ["skill-shares"],
        {
          create: async () => {
            effects++
            throw new Error("unexpected write")
          },
        },
        {
          inspect: async () => {
            effects++
            throw new Error("unexpected inspection")
          },
        },
        undefined,
      ),
  )
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/v1/skill-shares`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source_ref: "skill:one" }),
    })
    assert.equal(response.status, 503)
    assert.equal(effects, 0)
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
})
