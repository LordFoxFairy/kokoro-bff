import assert from "node:assert/strict"
import test from "node:test"
import { createBffServer } from "../src/bootstrap/server.ts"
import { DEFAULT_AGUI_CONFIG } from "../src/config/runtime.ts"

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
  const server = createBffServer(config, {
    businessStore: null,
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
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  return {
    calls,
    request: async (path = "/v1/skill.list", extra = {}) => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
        headers: {
          "x-kokoro-service": "web-bff",
          "x-kokoro-internal-secret": "fixture-secret",
          authorization: "Bearer opaque-credential",
          "x-request-id": "public-test",
          ...extra.headers,
        },
        ...extra,
      })
      return { status: response.status, body: await response.json() }
    },
    close: async () => {
      server.closeAllConnections()
      await server.shutdown()
    },
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
          },
        })
      ).status,
      401,
    )
    assert.deepEqual(
      fixtureApp.calls.map((c) => c.kind),
      ["session"],
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
      ["session"],
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
