import assert from "node:assert/strict"
import test from "node:test"
import { Code, ConnectError } from "@connectrpc/connect"
import { DEFAULT_AGUI_CONFIG } from "../src/config/runtime.ts"
const fact = {
  binding_id: "binding",
  series_id: "series",
  skill_id: "exact",
  revision: "1",
  state_version: "1",
  source_status: "active",
  created_at: "2025-01-01T00:00:00.000Z",
  updated_at: "2025-01-01T00:00:00.000Z",
  removed_at: null,
  metadata: null,
}
async function fixture({ admin = false, operator = true, failure } = {}) {
  const calls = []
  const config = {
    host: "127.0.0.1",
    port: 0,
    mode: "live",
    domain: "bff.test",
    tenantId: "tenant",
    iamBaseUrl: null,
    iamWebOrigin: "https://web.example.test",
    sharedSecret: "fixture-secret",
    adminWebSharedSecret: "admin-secret",
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
    sessionAdmission: {
      verify: async () => {
        calls.push({ kind: "session" })
        return { ok: true, identity: { namespace: "tenant", userId: "operator" }, platformAdmin: admin }
      },
    },
    openAppManagementAdmission: {
      verify: async (input) => {
        calls.push({ kind: "operator", input })
        return operator
          ? { ok: true, registration: { allowed: true, tenant_id: "tenant", app_id: input.appId, client_id: "exact-managed-client" } }
          : { ok: false, status: 403, code: "open_app_management_forbidden" }
      },
    },
    appSkillBindingClient: {
      async list(context, page, signal, deadline) {
        calls.push({ kind: "list", context, page, signal, deadline })
        return { items: [fact], nextCursor: "opaque-cursor" }
      },
      async command(operation, context, input, signal, deadline) {
        calls.push({ kind: "command", operation, context, input, signal, deadline })
        if (failure) throw failure
        return {
          binding: { ...fact, skill_id: operation === "put" ? input.target : fact.skill_id, series_id: operation === "remove" ? input.target : fact.series_id },
          event_id: "event",
          replayed: false,
        }
      },
    },
  }
  await import("reflect-metadata")
  const { Test } = await import("@nestjs/testing")
  const { SkillsModule } = await import("../dist/modules/skills/skills.module.js")
  const { BFF_NEST_APPLICATION_OPTIONS } = await import("../dist/main.js")
  const { BFF_CONFIG, BFF_DATABASE, SESSION_ADMISSION, OPEN_APP_MANAGEMENT_ADMISSION, APP_SKILL_BINDING_CLIENT } = await import("../dist/common/tokens.js")
  const unexpectedStorage = () => {
    throw new Error("Skill HTTP fixture must not touch BFF storage")
  }
  const module = await Test.createTestingModule({ imports: [SkillsModule] })
    .overrideProvider(BFF_CONFIG)
    .useValue(config)
    .overrideProvider(BFF_DATABASE)
    .useValue({ pool: { query: unexpectedStorage, connect: unexpectedStorage }, redis: {}, ready: unexpectedStorage })
    .overrideProvider(SESSION_ADMISSION)
    .useValue(dependencies.sessionAdmission)
    .overrideProvider(OPEN_APP_MANAGEMENT_ADMISSION)
    .useValue(dependencies.openAppManagementAdmission)
    .overrideProvider(APP_SKILL_BINDING_CLIENT)
    .useValue(dependencies.appSkillBindingClient)
    .compile()
  const app = module.createNestApplication({ ...BFF_NEST_APPLICATION_OPTIONS, logger: false })
  await app.listen(0, "127.0.0.1")
  const base = await app.getUrl()
  return {
    calls,
    async request(method = "GET", body, suffix = "", service = "web-bff") {
      const response = await fetch(`${base}/v1/admin/open-apps/app/skill-bindings${suffix}`, {
        method,
        headers: {
          "x-kokoro-service": service,
          "x-kokoro-internal-secret": service === "web-bff" ? "fixture-secret" : "admin-secret",
          cookie: "kokoro-issuer.session_token=operator-session",
          origin: "https://web.example.test",
          "x-request-id": "binding-http",
          ...(body === undefined ? {} : { "content-type": "application/json", "idempotency-key": "original-key" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      return { status: response.status, body: await response.json() }
    },
    async close() {
      app.getHttpServer().closeAllConnections()
      await app.close()
    },
  }
}
test("App binding management admits current operator even without platform-admin, exact registration before owner, and dedicated admin adapter", async () => {
  const app = await fixture()
  try {
    const result = await app.request("GET", undefined, "?limit=2&cursor=original-cursor", "admin-web-bff")
    assert.equal(result.status, 200)
    assert.deepEqual(result.body.data, { bindings: [fact], next_cursor: "opaque-cursor" })
    assert.deepEqual(
      app.calls.map((c) => c.kind),
      ["session", "operator", "list"],
    )
    assert.equal(app.calls[1].input.subjectId, "operator")
    for (const key of ["token", "cookie", "origin"]) assert.equal(Object.hasOwn(app.calls[1].input, key), false)
    assert.equal(app.calls[1].input.tenantId, "tenant")
    assert.deepEqual(app.calls[2].context, { requestId: "binding-http", tenant: "tenant", subject: "operator", appId: "app" })
    assert.deepEqual(app.calls[2].page, { limit: 2, cursor: "original-cursor" })
  } finally {
    await app.close()
  }
})
test("platform-admin Session is not OAuth operator authority for App binding management", async () => {
  const app = await fixture({ admin: true, operator: false })
  try {
    assert.equal((await app.request()).status, 403)
    assert.deepEqual(
      app.calls.map((c) => c.kind),
      ["session", "operator"],
    )
  } finally {
    await app.close()
  }
})
test("App binding put/remove forward only exact target and explicit CAS, with stable original key identity", async () => {
  const app = await fixture()
  try {
    assert.equal((await app.request("POST", { skill_id: "exact", expected_binding_version: "0" })).status, 200)
    assert.equal((await app.request("POST", { skill_id: "different-exact", expected_binding_version: "1" })).status, 200)
    assert.equal((await app.request("DELETE", { expected_binding_version: "2" }, "/series")).status, 200)
    const commands = app.calls.filter((call) => call.kind === "command")
    assert.deepEqual(
      commands.map((call) => [call.operation, call.input]),
      [
        ["put", { target: "exact", expectedBindingVersion: "0" }],
        ["put", { target: "different-exact", expectedBindingVersion: "1" }],
        ["remove", { target: "series", expectedBindingVersion: "2" }],
      ],
    )
    assert.equal(commands[0].context.commandId, commands[1].context.commandId)
    assert.notEqual(commands[0].context.commandId, commands[2].context.commandId)
  } finally {
    await app.close()
  }
})
test("App binding rejects missing/negative/zero remove CAS, body identity/trusted, repeated/unknown query before owner", async () => {
  const app = await fixture()
  try {
    for (const body of [
      { skill_id: "exact" },
      { skill_id: "exact", expected_binding_version: 0 },
      { skill_id: "exact", expected_binding_version: "-1" },
      { skill_id: "exact", expected_binding_version: "0", app_id: "other" },
      { skill_id: "exact", expected_binding_version: "0", trusted: true },
    ])
      assert.equal((await app.request("POST", body)).status, 400)
    assert.equal((await app.request("DELETE", { expected_binding_version: "0" }, "/series")).status, 400)
    for (const suffix of ["?limit=2&limit=2", "?app_id=other", "?cursor=", "?limit=101"])
      assert.equal((await app.request("GET", undefined, suffix)).status, 400)
    assert.equal(app.calls.filter((c) => ["list", "command"].includes(c.kind)).length, 0)
  } finally {
    await app.close()
  }
})
test("App binding CAS/conflict/unknown errors stay bounded sanitized and never claim success", async () => {
  for (const [failure, status] of [
    [new ConnectError("private", Code.FailedPrecondition), 412],
    [new ConnectError("private", Code.AlreadyExists), 409],
    [new ConnectError("private", Code.Unavailable), 503],
  ]) {
    const app = await fixture({ failure })
    try {
      const result = await app.request("POST", { skill_id: "exact", expected_binding_version: "0" })
      assert.equal(result.status, status)
      assert.equal(JSON.stringify(result.body).includes("private"), false)
    } finally {
      await app.close()
    }
  }
})
