import "reflect-metadata"
import assert from "node:assert/strict"
import test from "node:test"
import { Test } from "@nestjs/testing"
import {
  APP_SKILL_BINDING_CLIENT,
  BFF_CONFIG,
  BFF_DATABASE,
  PROJECT_LOOKUP,
  SESSION_ADMISSION,
  SKILL_INSTALLATION_CLIENT,
  SKILL_LIST_ADMISSION,
  SKILL_PRODUCT_CLIENT,
  SKILL_SPECIFICATION_SOURCE,
} from "../dist/common/tokens.js"
import { DEFAULT_AGUI_CONFIG } from "../dist/config/runtime.js"
import { BFF_NEST_APPLICATION_OPTIONS } from "../dist/main.js"
import { SkillsModule } from "../dist/modules/skills/skills.module.js"

async function listenSkills(config, configure, unexpectedStorage = () => assert.fail("Skill HTTP fixture must not touch BFF storage")) {
  const builder = Test.createTestingModule({ imports: [SkillsModule] })
    .overrideProvider(BFF_CONFIG)
    .useValue(config)
    .overrideProvider(BFF_DATABASE)
    .useValue({ pool: { query: unexpectedStorage, connect: unexpectedStorage }, redis: {}, ready: unexpectedStorage })
  const module = await configure(builder).compile()
  const app = module.createNestApplication({ ...BFF_NEST_APPLICATION_OPTIONS, logger: false })
  const close = async () => {
    app.getHttpServer().closeAllConnections()
    await app.close()
  }
  try {
    await app.listen(0, config.host)
    return { base: await app.getUrl(), close }
  } catch (error) {
    await close()
    throw error
  }
}

const key = { kind: "user_api_key", tenant_id: "tenant", user_id: "human", key_id: "key" }
const appPrincipal = { kind: "oauth_app", tenant_id: "tenant", user_id: "human", client_id: "client", app_id: "app", trusted: false }
async function fixture({ verify, read, session } = {}) {
  const calls = []
  const config = {
    host: "127.0.0.1",
    port: 0,
    mode: "live",
    domain: "bff.test",
    tenantId: "tenant",
    iamWebOrigin: "https://web.example.test",
    iamBaseUrl: null,
    sharedSecret: "fixture-secret",
    upstreamSecret: null,
    upstreamTimeoutMs: 1000,
    upstreamMaxResponseBytes: 1048576,
    schedulerServiceToken: null,
    schedulerTargetUrl: null,
    agentEnabled: false,
    postgresUrl: null,
    redisUrl: null,
    agUi: DEFAULT_AGUI_CONFIG,
    upstreams: { system: null, capability: null, scheduler: null, agents: null, billing: null, music: null },
  }
  const dependencies = {
    skillListAdmission: {
      verify: async (input) => {
        calls.push({ kind: "verify", input })
        return verify ? verify(input, calls) : { ok: true, principal: key }
      },
    },
    sessionAdmission: {
      verify: async () => {
        calls.push({ kind: "session" })
        return session ?? { ok: false, status: 401, code: "session_invalid" }
      },
    },
    skillSpecificationSource: {
      async readPublicList(input, context, signal, deadline) {
        calls.push({ kind: "read", input, context, signal, deadline })
        return read ? read(input, context, signal, deadline) : []
      },
      async read() {
        calls.push({ kind: "website" })
        return { userAddedSkills: [], officialSkills: [] }
      },
    },
  }
  const { base, close } = await listenSkills(config, (builder) =>
    builder
      .overrideProvider(SKILL_LIST_ADMISSION)
      .useValue(dependencies.skillListAdmission)
      .overrideProvider(SESSION_ADMISSION)
      .useValue(dependencies.sessionAdmission)
      .overrideProvider(SKILL_SPECIFICATION_SOURCE)
      .useValue(dependencies.skillSpecificationSource),
  )
  return {
    calls,
    request: async (path = "/v1/skill.list", extra = {}) => {
      const response = await fetch(`${base}${path}`, {
        headers: {
          "x-kokoro-service": "web-bff",
          "x-kokoro-internal-secret": "fixture-secret",
          authorization: "Bearer opaque-credential",
          "x-request-id": "public-test",
          ...extra.headers,
          origin: "https://web.example.test",
        },
        ...extra,
      })
      return { status: response.status, body: await response.json() }
    },
    close,
  }
}

test("public list consumes only IAM's explicit principal and verifies the same key again before disclosure", async () => {
  const fixtureApp = await fixture()
  try {
    const result = await fixtureApp.request()
    assert.equal(result.status, 200)
    assert.deepEqual(
      fixtureApp.calls.map((c) => c.kind),
      ["verify", "read", "verify"],
    )
    const context = fixtureApp.calls[1].context
    assert.deepEqual(context.principal, key)
    assert.equal(Object.isFrozen(context.principal), true)
    assert.equal(context.publicBearer, "opaque-credential")
    assert.equal(Object.hasOwn(context, "humanBearer"), false)
    assert.equal(JSON.stringify(result.body).includes("opaque-credential"), false)
  } finally {
    await fixtureApp.close()
  }
})

test("ordinary registered App with project_id is400 before project/install/binding reads", async () => {
  const fixtureApp = await fixture({ verify: async () => ({ ok: true, principal: appPrincipal }) })
  try {
    assert.equal((await fixtureApp.request("/v1/skill.list?project_id=project")).status, 400)
    assert.deepEqual(
      fixtureApp.calls.map((c) => c.kind),
      ["verify"],
    )
  } finally {
    await fixtureApp.close()
  }
})

test("fresh principal change, trust downgrade or revocation never discloses the already-read list", async () => {
  for (const fresh of [
    { ok: true, principal: { ...appPrincipal, trusted: false } },
    { ok: true, principal: { ...appPrincipal, trusted: true, app_id: "other" } },
    { ok: false, status: 403, code: "skill_list_identity_forbidden" },
  ]) {
    let count = 0
    const fixtureApp = await fixture({ verify: async () => (++count === 1 ? { ok: true, principal: { ...appPrincipal, trusted: true } } : fresh) })
    try {
      const result = await fixtureApp.request()
      assert.equal(result.status, 403)
      assert.equal(result.body.ok, false)
      assert.equal(Object.hasOwn(result.body, "data"), false)
      assert.equal(count, 2)
    } finally {
      await fixtureApp.close()
    }
  }
})

test("IAM public denial and cross-tenant identity never fall back to valid Session admission", async () => {
  for (const rejected of [
    { ok: false, status: 401, code: "skill_list_identity_invalid" },
    { ok: true, principal: { ...key, tenant_id: "other" } },
  ]) {
    const fixtureApp = await fixture({
      verify: async () => rejected,
      session: { ok: true, identity: { namespace: "tenant", userId: "human" }, platformAdmin: true },
    })
    try {
      assert.equal((await fixtureApp.request()).status, rejected.ok ? 403 : 401)
      assert.deepEqual(
        fixtureApp.calls.map((c) => c.kind),
        ["verify"],
      )
    } finally {
      await fixtureApp.close()
    }
  }
})

test("website RPC still requires original Session and never consumes public key admission", async () => {
  const fixtureApp = await fixture()
  try {
    assert.equal(
      (
        await fixtureApp.request("/skill.v1.SkillOptionalService/ListSkills", {
          method: "POST",
          body: "{}",
          headers: {
            "content-type": "application/json",
            "x-kokoro-service": "web-bff",
            "x-kokoro-internal-secret": "fixture-secret",
            authorization: "Bearer opaque-credential",
            origin: "https://web.example.test",
          },
        })
      ).status,
      401,
    )
    assert.deepEqual(
      fixtureApp.calls.map((c) => c.kind),
      [],
    )
  } finally {
    await fixtureApp.close()
  }
})

test("public identity remains inside the existing service envelope and no neighbouring route gains key admission", async () => {
  const fixtureApp = await fixture()
  try {
    assert.equal((await fixtureApp.request("/v1/skill.list", { headers: { authorization: "Bearer opaque-credential" } })).status, 403)
    assert.deepEqual(fixtureApp.calls, [])
    assert.equal((await fixtureApp.request("/v1/self/skills")).status, 401)
    assert.deepEqual(
      fixtureApp.calls.map((c) => c.kind),
      [],
    )
  } finally {
    await fixtureApp.close()
  }
})

test("public cancellation stops the owner read and never starts the final IAM disclosure check", async () => {
  let started
  const reading = new Promise((resolve) => {
    started = resolve
  })
  let ownerSignal
  const fixtureApp = await fixture({
    read: async (_input, _context, signal) => {
      ownerSignal = signal
      started()
      await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }))
      return []
    },
  })
  try {
    const controller = new AbortController()
    const pending = fixtureApp.request("/v1/skill.list", { signal: controller.signal })
    await reading
    controller.abort()
    await assert.rejects(pending, { name: "AbortError" })
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(ownerSignal.aborted, true)
    assert.deepEqual(
      fixtureApp.calls.map((c) => c.kind),
      ["verify", "read"],
    )
  } finally {
    await fixtureApp.close()
  }
})

const tenant = "fixture-tenant"
const subject = "fixture-subject"
const appId = "fixture-app"
const requestId = "public-list-c3"
const ownerKey = { kind: "user_api_key", tenant_id: tenant, user_id: subject, key_id: "fixture-key" }
const ordinary = { kind: "oauth_app", tenant_id: tenant, user_id: subject, client_id: "fixture-client", app_id: appId, trusted: false }
const trusted = { ...ordinary, trusted: true }
const binding = {
  binding_id: "fixture-binding-record",
  series_id: "fixture-bound-series",
  skill_id: "fixture-bound-version",
  revision: "2",
  state_version: "1",
  source_status: "active",
  created_at: "2026-01-01T00:00:00.500Z",
  updated_at: "2026-01-02T00:00:00.999Z",
  removed_at: null,
  metadata: {
    name: "Fixture bound skill",
    summary: "Fixture app-private description",
    created_at: "2026-01-01T00:00:00.500Z",
    updated_at: "2026-01-02T00:00:00.999Z",
    product: { source_kind: "third_party" },
  },
}
const boundRow = {
  id: "fixture-bound-series",
  name: "Fixture bound skill",
  description: "Fixture app-private description",
  owner_type: "app",
  created_at: 1767225600,
  updated_at: 1767312000,
}

async function ownerFixture(t, principal, fresh = { ok: true, principal }) {
  const calls = []
  const unexpected = () => {
    calls.push(["unexpected"])
    throw new Error("unexpected public skill.list dependency")
  }
  const config = {
    host: "127.0.0.1",
    port: 0,
    mode: "live",
    domain: "bff.test",
    tenantId: tenant,
    iamWebOrigin: "https://web.example.test",
    iamBaseUrl: "http://127.0.0.1:9",
    sharedSecret: "fixture-secret",
    upstreamSecret: null,
    upstreamTimeoutMs: 1000,
    upstreamMaxResponseBytes: 1048576,
    schedulerServiceToken: null,
    schedulerTargetUrl: null,
    agentEnabled: false,
    postgresUrl: null,
    redisUrl: null,
    agUi: DEFAULT_AGUI_CONFIG,
    upstreams: {},
    platformProjection: { baseUrl: "http://127.0.0.1:9", credentialFile: "/not-used-projection-fixture", timeoutMs: 1000 },
  }
  let verified = false
  const { base, close } = await listenSkills(
    config,
    (builder) =>
      builder
        .overrideProvider(PROJECT_LOOKUP)
        .useValue({
          find: async (scope, id) => {
            calls.push(["project", scope.tenantId, scope.subjectId, id])
            return ["project-slug", "project-id"].includes(id) ? { id: "project-id" } : null
          },
        })
        .overrideProvider(APP_SKILL_BINDING_CLIENT)
        .useValue({
          list: async (context, page) => {
            calls.push(["app-bindings", context.tenant, context.subject, context.appId, page])
            return { items: [binding] }
          },
          command: unexpected,
        })
        .overrideProvider(SKILL_INSTALLATION_CLIENT)
        .useValue({
          list: async ({ tenant, subject, projectRef }) => {
            calls.push(["installations", tenant, subject, projectRef ?? null])
            return { installations: [] }
          },
        })
        .overrideProvider(SKILL_PRODUCT_CLIENT)
        .useValue({ current: unexpected, download: unexpected, revision: unexpected })
        .overrideProvider(SKILL_LIST_ADMISSION)
        .useValue({
          verify: async () => {
            calls.push(["verify"])
            if (verified) return fresh
            verified = true
            return { ok: true, principal }
          },
        })
        .overrideProvider(SESSION_ADMISSION)
        .useValue({ verify: unexpected }),
    unexpected,
  )
  t.after(close)
  return {
    calls,
    async list(query = "") {
      const response = await fetch(base + "/v1/skill.list" + query, {
        headers: {
          "x-kokoro-service": "web-bff",
          "x-kokoro-internal-secret": "fixture-secret",
          authorization: "Bearer fixture-public-token",
          "x-request-id": requestId,
        },
        signal: AbortSignal.timeout(3000),
      })
      const text = await response.text()
      return { status: response.status, body: JSON.parse(text), text }
    },
  }
}

const admitted = ["verify"]
const projectLookup = ["project", tenant, subject, "project-slug"]
const personalInstallations = ["installations", tenant, subject, null]
const projectInstallations = ["installations", tenant, subject, "project-id"]
const projectRecheck = ["project", tenant, subject, "project-id"]
const appBindings = ["app-bindings", tenant, subject, appId, { limit: 100 }]

test("SkillsModule public project list resolves the slug, reads canonical project installs and rechecks that project", async (t) => {
  for (const [name, principal, appReads, data] of [
    ["API key", ownerKey, [], []],
    ["trusted Open App", trusted, [appBindings], [boundRow]],
  ]) {
    await t.test(name, async (t) => {
      const f = await ownerFixture(t, principal)
      const { status, body } = await f.list("?project_id=project-slug")
      assert.equal(status, 200, JSON.stringify(body))
      assert.deepEqual(body, { ok: true, request_id: requestId, data })
      assert.deepEqual(f.calls, [admitted, projectLookup, ...appReads, personalInstallations, projectInstallations, projectRecheck, admitted])
    })
  }
})

test("SkillsModule public ordinary Open App discloses its active binding, not user or project installations", async (t) => {
  const f = await ownerFixture(t, ordinary)
  const { status, body } = await f.list()
  assert.equal(status, 200, JSON.stringify(body))
  assert.deepEqual(body, { ok: true, request_id: requestId, data: [boundRow] })
  assert.deepEqual(f.calls, [admitted, appBindings, admitted])
})

test("SkillsModule public list withholds an already-read binding when fresh IAM admission is revoked", async (t) => {
  const f = await ownerFixture(t, trusted, { ok: false, status: 403, code: "skill_list_identity_forbidden" })
  const { status, body, text } = await f.list()
  assert.equal(status, 403, JSON.stringify(body))
  assert.equal(body.ok, false)
  assert.equal(body.request_id, requestId)
  assert.equal(body.error.code, "skill_list_identity_forbidden")
  assert.equal(Object.hasOwn(body, "data"), false)
  for (const value of [binding.binding_id, binding.skill_id, boundRow.id, boundRow.name, boundRow.description]) {
    assert.equal(text.includes(value), false)
  }
  assert.deepEqual(f.calls, [admitted, appBindings, personalInstallations, admitted])
})
