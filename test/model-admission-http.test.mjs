import assert from "node:assert/strict"
import { createServer, request as rawRequest } from "node:http"
import { mkdtemp, writeFile, rm, chmod } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test, afterEach } from "node:test"
import { createBffServer } from "../dist/bootstrap/server.js"
import { DEFAULT_AGUI_CONFIG } from "../dist/config/runtime.js"
const cleanups = []
afterEach(async () => {
  for (const clean of cleanups.splice(0).reverse()) await clean()
})
async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  cleanups.push(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections()
        server.close(resolve)
      }),
  )
  return `http://127.0.0.1:${server.address().port}`
}
const secret = "agent-model-budget-" + "a".repeat(40)
const wire = {
  run_id: "submitted-run",
  attempt_id: "22222222-2222-4222-8222-222222222222",
  request_ref: "attempt-request",
  attempt_binding_digest: "a".repeat(64),
  planned_digest: "b".repeat(64),
  final_request_digest: "c".repeat(64),
}
const receipt = {
  ...wire,
  admission_id: "33333333-3333-4333-8333-333333333333",
  hold_id: "44444444-4444-4444-8444-444444444444",
  budget_credits: "10",
  pricing_snapshot_digest: "d".repeat(64),
  status: "held",
  created_at: "2026-10-22T00:00:00.000Z",
  updated_at: "2026-10-22T00:00:00.000Z",
}
async function setup(options = {}) {
  const dir = await mkdtemp(join(tmpdir(), "kokoro-budget-"))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  const file = join(dir, "credential.json")
  const credentials = (overrides = {}) => ({
    version: 1,
    entries: [{ credential_id: "agent-budget", caller: "kokoro-agent", surface: "model_admission", tenant_id: "verified-tenant", secret, ...overrides }],
  })
  await writeFile(file, JSON.stringify(credentials()), { mode: 0o600 })
  const calls = [],
    sources = []
  const billing = await listen(
    createServer({ maxHeaderSize: 32768 }, async (req, res) => {
      const chunks = []
      for await (const c of req) chunks.push(c)
      calls.push({ url: req.url, headers: req.headers, body: JSON.parse(Buffer.concat(chunks).toString()) })
      res.writeHead(options.status ?? 201, { "content-type": "application/json", "cache-control": "no-store", "x-request-id": req.headers["x-request-id"] })
      if (options.peer) return options.peer(req, res)
      res.end(JSON.stringify(options.response ?? { data: receipt }))
    }),
  )
  const config = {
    host: "127.0.0.1",
    port: 0,
    mode: "live",
    domain: "dev.kokoro.localhost",
    tenantId: null,
    iamBaseUrl: null,
    sharedSecret: "browser-only-secret",
    upstreamSecret: "billing-internal-secret-0000000000001",
    billingServiceToken: "billing-service-token-000000000000001",
    billingOperatorProxySecret: null,
    upstreamTimeoutMs: 1000,
    upstreamMaxResponseBytes: 32768,
    schedulerServiceToken: null,
    schedulerTargetUrl: null,
    agentEnabled: false,
    postgresUrl: null,
    redisUrl: null,
    agUi: DEFAULT_AGUI_CONFIG,
    upstreams: { billing, scheduler: null, agents: null },
    agentModelAdmissionCredentialFile: file,
    ...options.config,
  }
  const base = await listen(
    createBffServer(config, {
      businessStore: {
        submittedAgentRuns: {
          readSubmittedAgentRun: async (input) => {
            sources.push(input)
            return options.source
              ? options.source(input)
              : { tenantId: "verified-tenant", userId: "original-user", runId: wire.run_id, conversationId: "original-conversation" }
          },
        },
        services: {},
      },
      sessionAdmission: {
        verify: async () => {
          throw Error("internal Agent must not use browser Session admission")
        },
      },
      readiness: async () => undefined,
    }),
  )
  const post = (body = wire, headers = {}, path = "/internal/v1/model-admissions") =>
    fetch(base + path, {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/json",
        "idempotency-key": "one-attempt-key",
        "x-billing-execution-proof": "short-lived-execution-proof",
        "x-request-id": "budget-request",
        ...headers,
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  return { base, file, credentials, calls, sources, post }
}
test("Agent budget ingress derives user and tenant from durable source, forwards exact command once, and admits a full-size proof", async () => {
  const t = await setup()
  const response = await t.post(wire, { "x-billing-execution-proof": "x".repeat(16384) })
  assert.equal(response.status, 201)
  assert.deepEqual(await response.json(), { data: receipt })
  assert.equal(response.headers.get("cache-control"), "no-store")
  assert.equal(response.headers.get("x-request-id"), "budget-request")
  assert.equal(t.sources.length, 1)
  assert.equal(t.sources[0].tenantId, "verified-tenant")
  assert.equal(t.sources[0].runId, wire.run_id)
  assert.equal(t.calls.length, 1)
  const call = t.calls[0]
  assert.deepEqual(call.body, wire)
  assert.equal(call.url, "/v1/internal/billing/admissions")
  assert.equal(call.headers["x-kokoro-service"], "web-bff")
  assert.equal(call.headers["x-kokoro-tenant-id"], "u1." + Buffer.from("verified-tenant").toString("base64url"))
  assert.equal(call.headers["x-kokoro-subject"], "u1." + Buffer.from("original-user").toString("base64url"))
  assert.equal(call.headers.authorization, "Bearer billing-service-token-000000000000001")
  assert.equal(call.headers["idempotency-key"], "one-attempt-key")
  assert.equal(call.headers["x-billing-execution-proof"], "x".repeat(16384))
  assert.equal(call.headers["x-kokoro-proxy-secret"], undefined)
})
test("Agent-only credential, closed body and canonical path reject before any Billing mutation", async () => {
  const t = await setup()
  for (const body of [
    { ...wire, tenant_id: "foreign" },
    { ...wire, user_id: "victim" },
    { ...wire, recovery: true },
    { ...wire, attempt_binding_digest: "bad" },
    '{"run_id":"one","run_id":"two"}',
  ])
    assert.equal((await t.post(body)).status, 400)
  for (const [headers, status] of [
    [{ authorization: "Bearer browser-only-secret" }, 403],
    [{ "x-billing-consumption-token": "retired" }, 400],
    [{ "idempotency-key": "bad key" }, 400],
    [{ "x-billing-execution-proof": "" }, 400],
    [{ "content-type": "text/plain" }, 400],
  ])
    assert.equal((await t.post(wire, headers)).status, status)
  assert.equal((await t.post(wire, {}, "/internal/v1/model-admissions?bypass=1")).status, 400)
  assert.equal(t.calls.length, 0)
  await writeFile(t.file, JSON.stringify(t.credentials({ caller: "kokoro-iam" })))
  assert.equal((await t.post()).status, 503)
  await writeFile(t.file, JSON.stringify(t.credentials({ surface: "project_execution_binding" })))
  assert.equal((await t.post()).status, 503)
  await writeFile(t.file, JSON.stringify(t.credentials()))
  await chmod(t.file, 0o644)
  assert.equal((await t.post()).status, 503)
  assert.equal(t.calls.length, 0)
})
test("missing or inconsistent source is hidden and missing config does not attempt Billing", async () => {
  for (const source of [
    () => null,
    () => ({ tenantId: "foreign", userId: "original-user", runId: wire.run_id, conversationId: "conversation" }),
    () => ({ tenantId: "verified-tenant", userId: "original-user", runId: "another-run", conversationId: "conversation" }),
  ]) {
    const t = await setup({ source })
    assert.equal((await t.post()).status, 404)
    assert.equal(t.calls.length, 0)
  }
  const t = await setup({ config: { agentModelAdmissionCredentialFile: null } })
  assert.equal((await t.post()).status, 503)
  assert.equal(t.calls.length, 0)
})
test("success must bind every attempt field and original held receipt; unknown extra fields are not stripped", async () => {
  for (const field of Object.keys(wire)) {
    const value = field === "attempt_id" ? "55555555-5555-4555-8555-555555555555" : field.endsWith("digest") ? "e".repeat(64) : "different"
    const t = await setup({ response: { data: { ...receipt, [field]: value } } })
    assert.equal((await t.post()).status, 502, field)
    assert.equal(t.calls.length, 1)
  }
  for (const data of [
    { ...receipt, status: "captured" },
    { ...receipt, updated_at: "2026-10-22T00:00:01.000Z" },
    { ...receipt, budget_credits: "0" },
    { ...receipt, secret: "must-not-leak" },
  ]) {
    const t = await setup({ response: { data } })
    const response = await t.post()
    assert.equal(response.status, 502)
    assert.ok(!JSON.stringify(await response.json()).includes("must-not-leak"))
    assert.equal(t.calls.length, 1)
  }
})
test("shared deadline stops a late source read before dispatch and bounds unfinished owner EOF without retry", async () => {
  let sourceDone = false
  const t = await setup({
    config: { upstreamTimeoutMs: 80 },
    source: async () => {
      await new Promise((resolve) => setTimeout(resolve, 160))
      sourceDone = true
      return { tenantId: "verified-tenant", userId: "original-user", runId: wire.run_id, conversationId: "conversation" }
    },
  })
  const start = performance.now()
  assert.equal((await t.post()).status, 503)
  assert.ok(performance.now() - start < 400)
  await new Promise((resolve) => setTimeout(resolve, 180))
  assert.equal(sourceDone, true)
  assert.equal(t.calls.length, 0)
  const stalled = await setup({
    config: { upstreamTimeoutMs: 80 },
    peer: (_req, res) => {
      res.write('{"data":')
    },
  })
  const s = performance.now()
  assert.equal((await stalled.post()).status, 503)
  assert.ok(performance.now() - s < 400)
  assert.equal(stalled.calls.length, 1)
})
test("stable business denials remain distinct from unknown or malformed owner results", async () => {
  for (const [status, code, expected] of [
    [422, "billing.insufficient_credit", "model_admission_insufficient_credit"],
    [422, "billing.price_unavailable", "model_admission_price_unavailable"],
    [422, "billing.invalid_state", "model_admission_ineligible"],
    [409, "billing.idempotency_conflict", "model_admission_conflict"],
    [403, "billing.forbidden", "model_admission_forbidden"],
  ]) {
    const t = await setup({ status, response: { error: { code, message: "private provider diagnostic", retryable: false } } })
    const r = await t.post()
    assert.equal(r.status, status)
    const b = await r.json()
    assert.equal(b.error.code, expected)
    assert.ok(!JSON.stringify(b).includes("private provider diagnostic"))
    assert.equal(t.calls.length, 1)
  }
})

test("credential rotation is fresh and ambiguous duplicate credential fields are rejected", async () => {
  const t = await setup()
  await writeFile(t.file, JSON.stringify(t.credentials({ secret: "new-agent-only-" + "b".repeat(40) })))
  assert.equal((await t.post()).status, 403)
  assert.equal((await t.post(wire, { authorization: "Bearer " + "new-agent-only-" + "b".repeat(40) })).status, 201)
  assert.equal(t.calls.length, 1)
  const bytes = JSON.stringify(t.credentials()).replace('"caller":"kokoro-agent"', '"caller":"kokoro-iam","caller":"kokoro-agent"')
  await writeFile(t.file, bytes)
  assert.equal((await t.post()).status, 503)
  assert.equal(t.calls.length, 1)
})

test("body bound accepts valid escaped code-point limits but rejects a BOM rather than normalizing it", async () => {
  const value = "😀".repeat(512),
    body = { ...wire, run_id: value, request_ref: value }
  const t = await setup({
    response: { data: { ...receipt, run_id: value, request_ref: value } },
    source: (input) => ({ tenantId: input.tenantId, userId: "original-user", runId: input.runId, conversationId: "conversation" }),
  })
  const escaped = JSON.stringify(body).replace(/[\u007f-\uffff]/g, (unit) => "\\u" + unit.charCodeAt(0).toString(16).padStart(4, "0"))
  assert.ok(Buffer.byteLength(escaped) > 8192)
  assert.equal((await t.post(escaped)).status, 201)
  const before = t.calls.length
  assert.equal((await t.post("\ufeff" + JSON.stringify(wire))).status, 400)
  assert.equal(t.calls.length, before)
})

test("raw duplicate proof headers are rejected and active caller disconnect prevents a late owner command", async () => {
  const t = await setup()
  const body = JSON.stringify(wire)
  const status = await new Promise((resolve, reject) => {
    const request = rawRequest(
      t.base + "/internal/v1/model-admissions",
      {
        method: "POST",
        headers: [
          "Host",
          new URL(t.base).host,
          "Authorization",
          `Bearer ${secret}`,
          "Content-Type",
          "application/json",
          "Content-Length",
          String(Buffer.byteLength(body)),
          "Idempotency-Key",
          "original-attempt-key",
          "x-billing-execution-proof",
          "first",
          "X-Billing-Execution-Proof",
          "second",
        ],
      },
      (response) => {
        response.resume()
        response.once("end", () => resolve(response.statusCode))
      },
    )
    request.once("error", reject)
    request.end(body)
  })
  assert.equal(status, 400)
  assert.equal(t.calls.length, 0)
  let sourceSignal, started
  const sourceStarted = new Promise((resolve) => {
    started = resolve
  })
  const disconnected = await setup({
    source: async (input) => {
      sourceSignal = input.signal
      started()
      await new Promise((resolve) => setTimeout(resolve, 100))
      return { tenantId: input.tenantId, userId: "original-user", runId: input.runId, conversationId: "conversation" }
    },
  })
  const request = rawRequest(disconnected.base + "/internal/v1/model-admissions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
      "idempotency-key": "original-attempt-key",
      "x-billing-execution-proof": "proof",
    },
  })
  request.on("error", () => undefined)
  request.end(body)
  await Promise.race([sourceStarted, new Promise((_, reject) => setTimeout(() => reject(Error("source did not start")), 500))])
  request.destroy()
  await new Promise((resolve) => setTimeout(resolve, 150))
  assert.equal(sourceSignal.aborted, true)
  assert.equal(disconnected.calls.length, 0)
})
