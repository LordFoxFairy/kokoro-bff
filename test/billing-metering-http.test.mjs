import assert from "node:assert/strict"
import { createServer, request as nodeRequest } from "node:http"
import { afterEach, test } from "node:test"
import { createBffServer } from "../dist/bootstrap/server.js"
import { DEFAULT_AGUI_CONFIG } from "../dist/config/runtime.js"
const servers = []
async function listen(server) {
  servers.push(server)
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  assert.ok(address && typeof address !== "string")
  return `http://127.0.0.1:${address.port}`
}
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise((resolve) => {
          server.closeAllConnections()
          server.close(resolve)
        }),
    ),
  )
})
const browser = {
  "x-kokoro-service": "admin-web-bff",
  "x-kokoro-internal-secret": "admin-browser-secret",
  authorization: "Bearer current-admin-session",
  "x-kokoro-request-id": "metering-request-1",
}
const key = "original-pricing-key"
const bodyHeaders = { ...browser, "content-type": "application/json", "idempotency-key": key }
const common = { effective_from: "2026-01-01T00:00:00.000Z", source_ref: "QA synthetic, not supplier price", verified_at: "2026-01-01T00:00:00.000Z" }
const rate = {
  ...common,
  rates: [
    {
      model_revision: { id: "22222222-2222-4222-8222-222222222222", content_digest: "b".repeat(64) },
      provider_ref: "provider",
      environment: "test",
      pricing_account_ref: "account",
      model_ref: "model",
      model_version: "1",
      bucket: "input_total",
      unit: "token",
      applicability: { kind: "all" },
      currency_code: "USD",
      minor_per_unit: { numerator: "1", denominator: "1000" },
    },
  ],
}
const policy = {
  ...common,
  currency_code: "USD",
  multiplier: { numerator: "7", denominator: "5" },
  credit_micros_per_minor: { numerator: "1000000", denominator: "1" },
  max_attempt_credits: "10",
}
const command = (configuration) => ({ publication_id: "11111111-1111-4111-8111-111111111111", reason: "QA configuration acceptance", configuration })
const receipt = (kind) => ({ kind, revision: "1", content_digest: "a".repeat(64), published_at: common.verified_at, effective_from: common.effective_from })
const root = "/v1/admin/billing/metering"
function reply(response, status, data, headers = {}) {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", "x-request-id": "metering-request-1", ...headers })
  response.end(typeof data === "string" ? data : JSON.stringify(data))
}
async function setup(options = {}) {
  const ownerCalls = [],
    admissions = []
  const billing = await listen(
    createServer(async (request, response) => {
      const chunks = []
      for await (const chunk of request) chunks.push(chunk)
      const raw = Buffer.concat(chunks)
      ownerCalls.push({ url: request.url, method: request.method, headers: request.headers, body: raw.length ? JSON.parse(raw.toString()) : null })
      if (options.billing) return options.billing(request, response, ownerCalls.length)
      reply(response, request.method === "GET" ? 200 : 201, {
        data: request.method === "GET" ? { rate_revision: null, policy_revision: null } : receipt(request.url.includes("rate-revisions") ? "rate" : "policy"),
      })
    }),
  )
  const config = {
    host: "127.0.0.1",
    port: 0,
    mode: "live",
    domain: "dev.kokoro.localhost",
    tenantId: "tenant-current",
    iamBaseUrl: "http://127.0.0.1:1",
    sharedSecret: "product-browser-secret",
    adminWebSharedSecret: "admin-browser-secret",
    upstreamSecret: "billing-internal-secret-0000000000001",
    billingServiceToken: "billing-service-token-000000000000001",
    billingOperatorProxySecret: "billing-operator-secret-00000000000001",
    upstreamTimeoutMs: 1000,
    upstreamMaxResponseBytes: 1048576,
    schedulerServiceToken: null,
    schedulerTargetUrl: null,
    agentEnabled: false,
    postgresUrl: null,
    redisUrl: null,
    agUi: DEFAULT_AGUI_CONFIG,
    upstreams: { billing },
    platformProjection: { baseUrl: null, credentialFile: null, timeoutMs: 1000 },
    skillDraft: { enabled: false, platformBaseUrl: null, credentialFile: null, timeoutMs: 1000 },
    ...options.config,
  }
  const base = await listen(
    createBffServer(config, {
      businessStore: null,
      readiness: async () => undefined,
      sessionAdmission: {
        verify: async (input) => {
          admissions.push(input)
          return (
            options.admission?.(input, admissions.length) ?? {
              ok: true,
              identity: { namespace: "tenant-current", userId: "operator-current" },
              platformAdmin: true,
            }
          )
        },
      },
    }),
  )
  return { base, config, ownerCalls, admissions }
}
for (const [kind, configuration] of [
  ["rate", rate],
  ["policy", policy],
])
  test(`current administrator publishes ${kind} once with trusted u1 identity, unchanged command and bound receipt`, async () => {
    const state = await setup(),
      input = command(configuration)
    const response = await fetch(state.base + root + `/${kind}-revisions`, { method: "POST", headers: bodyHeaders, body: JSON.stringify(input) })
    assert.equal(response.status, 201)
    assert.deepEqual(await response.json(), { data: receipt(kind), meta: { request_id: "metering-request-1" } })
    assert.equal(response.headers.get("cache-control"), "no-store")
    assert.equal(response.headers.get("x-request-id"), "metering-request-1")
    assert.equal(state.ownerCalls.length, 1)
    assert.deepEqual(state.ownerCalls[0].body, input)
    assert.equal(state.ownerCalls[0].headers["idempotency-key"], key)
    assert.equal(state.ownerCalls[0].headers["x-kokoro-tenant-id"], "u1." + Buffer.from("tenant-current").toString("base64url"))
    assert.equal(state.ownerCalls[0].headers["x-kokoro-subject"], "u1." + Buffer.from("operator-current").toString("base64url"))
    assert.equal(state.ownerCalls[0].headers.authorization, `Bearer ${state.config.billingServiceToken}`)
    assert.equal(state.admissions.length, 2)
  })
test("latest published configurations are honestly nullable, not inferred free pricing or a command result", async () => {
  const state = await setup()
  const response = await fetch(state.base + root + "/pricing", { headers: browser })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { data: { rate_revision: null, policy_revision: null }, meta: { request_id: "metering-request-1" } })
  assert.equal(state.ownerCalls.length, 1)
  assert.equal(state.ownerCalls[0].method, "GET")
  assert.equal(state.ownerCalls[0].body, null)
  assert.equal(state.admissions.length, 2)
})
test("ordinary users never reach any owner metering operation", async () => {
  const state = await setup({ admission: () => ({ ok: true, identity: { namespace: "tenant-current", userId: "member" }, platformAdmin: false }) })
  for (const path of ["rate-revisions", "policy-revisions", "pricing"]) {
    const response = await fetch(state.base + root + "/" + path, {
      method: path === "pricing" ? "GET" : "POST",
      headers: path === "pricing" ? browser : bodyHeaders,
      ...(path === "pricing" ? {} : { body: JSON.stringify(command(policy)) }),
    })
    assert.equal(response.status, 403)
    await response.text()
  }
  assert.equal(state.ownerCalls.length, 0)
})
test("revoked authority during body admission is rechecked before dispatch", async () => {
  const state = await setup({
    admission: (_input, ordinal) => ({ ok: true, identity: { namespace: "tenant-current", userId: "operator-current" }, platformAdmin: ordinal === 1 }),
  })
  const response = await fetch(state.base + root + "/policy-revisions", { method: "POST", headers: bodyHeaders, body: JSON.stringify(command(policy)) })
  assert.equal(response.status, 403)
  await response.text()
  assert.equal(state.ownerCalls.length, 0)
})

for (const path of ["pricing?x=1", "rate-revisions?tenant=other", "policy-revisions?x="])
  test(`rejects query variants with no owner call: ${path}`, async () => {
    const state = await setup(),
      read = path.startsWith("pricing")
    const result = await fetch(state.base + root + "/" + path, {
      method: read ? "GET" : "POST",
      headers: read ? browser : bodyHeaders,
      ...(read ? {} : { body: JSON.stringify(command(policy)) }),
    })
    assert.equal(result.status, 400)
    await result.text()
    assert.equal(state.ownerCalls.length, 0)
  })
for (const extra of [{ tenant_id: "other" }, { actor_id: "other" }, { role: "billing.admin" }, { publication_id: "bad" }, { reason: "  " }])
  test(`rejects forged or invalid command fields ${Object.keys(extra)[0]}`, async () => {
    const state = await setup()
    const result = await fetch(state.base + root + "/policy-revisions", {
      method: "POST",
      headers: bodyHeaders,
      body: JSON.stringify({ ...command(policy), ...extra }),
    })
    assert.equal(result.status, 400)
    await result.text()
    assert.equal(state.ownerCalls.length, 0)
  })
for (const configuration of [
  { ...policy, max_attempt_credits: "0" },
  { ...policy, max_attempt_credits: "9223372036855" },
  { ...policy, max_attempt_credits: 10 },
  { ...policy, source_ref: "x\u0000y" },
  { ...policy, verified_at: "2026-02-30T00:00:00.000Z" },
])
  test(`rejects invalid exact pricing input ${JSON.stringify(configuration).slice(-55)}`, async () => {
    const state = await setup()
    const result = await fetch(state.base + root + "/policy-revisions", { method: "POST", headers: bodyHeaders, body: JSON.stringify(command(configuration)) })
    assert.equal(result.status, 400)
    await result.text()
    assert.equal(state.ownerCalls.length, 0)
  })
test("rejects nested decoded duplicate names and over-depth JSON before recursive parsing", async () => {
  const state = await setup()
  for (const body of [
    JSON.stringify(command(policy)).replace('"max_attempt_credits":"10"', '"max_attempt_credits":"10","max_attempt_\\u0063redits":"20"'),
    "[".repeat(13) + "null" + "]".repeat(13),
  ]) {
    const result = await fetch(state.base + root + "/policy-revisions", { method: "POST", headers: bodyHeaders, body })
    assert.equal(result.status, 400)
    await result.text()
  }
  assert.equal(state.ownerCalls.length, 0)
})
test("preserves a legitimate 64-row Unicode configuration above the old 16KiB limit and reads the full future snapshot", async () => {
  const configuration = {
    ...common,
    source_ref: "👍".repeat(255),
    rates: Array.from({ length: 64 }, (_, index) => ({
      ...rate.rates[0],
      provider_ref: "👍".repeat(255),
      pricing_account_ref: "a".repeat(255),
      model_ref: `model-${index}` + "m".repeat(240),
      environment: "e".repeat(255),
    })),
  }
  const input = { ...command(configuration), reason: "👍".repeat(500) }
  assert.ok(Buffer.byteLength(JSON.stringify(input)) > 65536)
  const future = { ...policy, effective_from: "2030-01-01T00:00:00.000Z", max_attempt_credits: "9223372036854" }
  const snapshot = {
    rate_revision: { revision: "9223372036854775807", content_digest: "b".repeat(64), published_at: common.verified_at, configuration },
    policy_revision: { revision: "1", content_digest: "c".repeat(64), published_at: common.verified_at, configuration: future },
  }
  const state = await setup({
    billing: (request, response) => reply(response, request.method === "GET" ? 200 : 201, { data: request.method === "GET" ? snapshot : receipt("rate") }),
  })
  const posted = await fetch(state.base + root + "/rate-revisions", { method: "POST", headers: bodyHeaders, body: JSON.stringify(input) })
  assert.equal(posted.status, 201)
  await posted.text()
  assert.deepEqual(state.ownerCalls[0].body, input)
  const read = await fetch(state.base + root + "/pricing", { headers: browser })
  assert.equal(read.status, 200)
  assert.deepEqual((await read.json()).data, snapshot)
})
for (const [label, data, headers] of [
  ["wrong operation", { data: receipt("rate") }, {}],
  ["wrong frozen effective time", { data: { ...receipt("policy"), effective_from: "2027-01-01T00:00:00.000Z" } }, {}],
  ["unknown field", { data: { ...receipt("policy"), debug: true } }, {}],
  ["overflow revision", { data: { ...receipt("policy"), revision: "9223372036854775808" } }, {}],
  ["wrong request ID", { data: receipt("policy") }, { "x-request-id": "other" }],
  ["missing no-store", { data: receipt("policy") }, { "cache-control": "public" }],
  ["duplicate decoded receipt key", JSON.stringify({ data: receipt("policy") }).replace('"revision":"1"', '"revision":"1","revis\\u0069on":"2"'), {}],
])
  test(`rejects a nonbinding owner acknowledgement: ${label}`, async () => {
    const state = await setup({ billing: (_request, response) => reply(response, 201, data, headers) })
    const result = await fetch(state.base + root + "/policy-revisions", { method: "POST", headers: bodyHeaders, body: JSON.stringify(command(policy)) })
    assert.equal(result.status, 502)
    await result.text()
    assert.equal(state.ownerCalls.length, 1)
  })
for (const [status, code, retryable, expected] of [
  [400, "billing.invalid_request", false, 400],
  [403, "billing.forbidden", false, 403],
  [409, "billing.idempotency_conflict", false, 409],
  [500, "billing.internal_error", false, 503],
  [503, "billing.dependency_unavailable", true, 503],
])
  test(`maps the exact owner error ${status} without resending or leaking details`, async () => {
    const state = await setup({ billing: (_request, response) => reply(response, status, { error: { code, message: "Private fixture detail", retryable } }) })
    const result = await fetch(state.base + root + "/policy-revisions", { method: "POST", headers: bodyHeaders, body: JSON.stringify(command(policy)) })
    assert.equal(result.status, expected)
    assert.doesNotMatch(await result.text(), /Private fixture/)
    assert.equal(state.ownerCalls.length, 1)
  })
test("initial admission, final recheck and owner EOF share the same bounded deadline", async () => {
  for (const phase of ["initial", "recheck", "eof"]) {
    const state = await setup({
      config: { upstreamTimeoutMs: 40 },
      admission: (_input, ordinal) =>
        (phase === "initial" && ordinal === 1) || (phase === "recheck" && ordinal === 2)
          ? new Promise((resolve) =>
              setTimeout(() => resolve({ ok: true, identity: { namespace: "tenant-current", userId: "operator-current" }, platformAdmin: true }), 100),
            )
          : undefined,
      billing: (_request, response) => {
        response.writeHead(201, { "content-type": "application/json", "cache-control": "no-store", "x-request-id": "metering-request-1" })
        response.write(JSON.stringify({ data: receipt("policy") }))
        setTimeout(() => response.end(), 100)
      },
    })
    const response = await fetch(state.base + root + "/policy-revisions", { method: "POST", headers: bodyHeaders, body: JSON.stringify(command(policy)) })
    assert.equal(response.status, 503)
    await response.text()
    await new Promise((resolve) => setTimeout(resolve, 110))
    assert.equal(state.ownerCalls.length, phase === "eof" ? 1 : 0)
  }
})
test("missing or shared owner operator credentials never fall back to a user bearer", async () => {
  for (const proxy of [null, "billing-internal-secret-0000000000001", "billing-service-token-000000000000001"]) {
    const state = await setup({ config: { billingOperatorProxySecret: proxy } }),
      result = await fetch(state.base + root + "/pricing", { headers: browser })
    assert.equal(result.status, 503)
    await result.text()
    assert.equal(state.ownerCalls.length, 0)
  }
})

for (const name of ["content-type", "idempotency-key", "if-match", "if-none-match"])
  test(`GET is bodyless and command-header-free: ${name}`, async () => {
    const state = await setup()
    const result = await fetch(state.base + root + "/pricing", {
      headers: { ...browser, [name]: name === "content-type" ? "application/json" : "some-command" },
    })
    assert.equal(result.status, 400)
    await result.text()
    assert.equal(state.ownerCalls.length, 0)
  })
test("GET rejects even explicit zero-length framing", async () => {
  const state = await setup()
  const result = await new Promise((resolve, reject) => {
    const request = nodeRequest(state.base + root + "/pricing", { method: "GET", headers: { ...browser, "content-length": "0" } }, (response) => {
      response.resume()
      response.once("end", () => resolve(response.statusCode))
    })
    request.once("error", reject)
    request.end()
  })
  assert.equal(result, 400)
  assert.equal(state.ownerCalls.length, 0)
})
test("a slow chunked command body cannot outlive admission's original deadline or dispatch later", async () => {
  const state = await setup({ config: { upstreamTimeoutMs: 35 } }),
    body = JSON.stringify(command(policy))
  const result = await new Promise((resolve, reject) => {
    const request = nodeRequest(state.base + root + "/policy-revisions", { method: "POST", headers: bodyHeaders }, (response) => {
      response.resume()
      response.once("end", () => resolve(response.statusCode))
    })
    request.once("error", reject)
    request.write(body.slice(0, 8))
    setTimeout(() => request.end(body.slice(8)), 90)
  })
  assert.equal(result, 503)
  await new Promise((resolve) => setTimeout(resolve, 100))
  assert.equal(state.ownerCalls.length, 0)
})
for (const identity of [
  { namespace: "other", userId: "operator-current" },
  { namespace: "tenant-current", userId: "other" },
])
  test(`changed authenticated identity does not inherit the administrator intent: ${identity.namespace}/${identity.userId}`, async () => {
    const state = await setup({
      admission: (_input, ordinal) => ({
        ok: true,
        identity: ordinal === 1 ? { namespace: "tenant-current", userId: "operator-current" } : identity,
        platformAdmin: true,
      }),
    })
    const result = await fetch(state.base + root + "/policy-revisions", { method: "POST", headers: bodyHeaders, body: JSON.stringify(command(policy)) })
    assert.equal(result.status, 403)
    await result.text()
    assert.equal(state.ownerCalls.length, 0)
  })
test("the existing stricter global response cap remains effective for Metering", async () => {
  const state = await setup({ config: { upstreamMaxResponseBytes: 128 } }),
    result = await fetch(state.base + root + "/pricing", { headers: browser })
  assert.equal(result.status, 502)
  await result.text()
  assert.equal(state.ownerCalls.length, 1)
})

test("unbound or extra technical model identity is rejected before dispatch, not silently stripped", async () => {
  const state = await setup()
  const { model_revision, ...unbound } = rate.rates[0]
  for (const row of [unbound, { ...rate.rates[0], model_revision: { ...model_revision, extra: "not allowed" } }]) {
    const response = await fetch(state.base + root + "/rate-revisions", {
      method: "POST",
      headers: bodyHeaders,
      body: JSON.stringify(command({ ...rate, rates: [row] })),
    })
    assert.equal(response.status, 400)
  }
  assert.equal(state.ownerCalls.length, 0)
})
