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
const admissionId = "a3333333-3333-4333-8333-333333333333"
const endpoint = `/internal/v1/model-admissions/${admissionId}/settle`
const wire = { run_id: "submitted-run", evidence_event_id: "66666666-6666-4666-8666-666666666666", evidence_revision: "1", evidence_digest: "a".repeat(64) }
const receipt = {
  ...wire,
  admission_id: admissionId,
  attempt_id: "22222222-2222-4222-8222-222222222222",
  status: "captured",
  reason: null,
  captured_credits: "1",
  released_credits: "9",
  usage_event_id: "77777777-7777-4777-8777-777777777777",
  settlement_id: "88888888-8888-4888-8888-888888888888",
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
      res.writeHead(options.status ?? 200, { "content-type": "application/json", "cache-control": "no-store", "x-request-id": req.headers["x-request-id"] })
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
  const post = (body = wire, headers = {}, path = endpoint) =>
    fetch(base + path, {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/json",
        "idempotency-key": "one-attempt-key",
        "x-request-id": "budget-request",
        ...headers,
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  return { base, file, credentials, calls, sources, post }
}
test("settlement derives original payer without Session or proof and forwards only the sealed command once", async () => {
  const t = await setup()
  const response = await t.post(wire, { "x-kokoro-subject": "victim", "x-kokoro-tenant-id": "foreign" })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { data: receipt })
  assert.equal(response.headers.get("cache-control"), "no-store")
  assert.equal(t.sources.length, 1)
  assert.equal(t.sources[0].tenantId, "verified-tenant")
  assert.equal(t.calls.length, 1)
  const call = t.calls[0]
  assert.equal(call.url, `/v1/internal/billing/admissions/${admissionId}/settle`)
  assert.deepEqual(call.body, wire)
  assert.equal(call.headers["x-kokoro-subject"], "u1." + Buffer.from("original-user").toString("base64url"))
  assert.equal(call.headers["x-kokoro-tenant-id"], "u1." + Buffer.from("verified-tenant").toString("base64url"))
  assert.equal(call.headers["x-billing-execution-proof"], undefined)
  assert.equal(call.headers["x-billing-consumption-token"], undefined)
  assert.equal(call.headers["idempotency-key"], "one-attempt-key")
})
test("settlement preserves original pending and released ACKs and unchanged retry identity", async () => {
  for (const status of ["pending_reconciliation", "released"]) {
    const data = {
      ...receipt,
      status,
      reason: status === "released" ? null : "unknown_usage_or_outcome",
      captured_credits: "0",
      released_credits: status === "released" ? "10" : "0",
      usage_event_id: null,
      settlement_id: null,
    }
    const t = await setup({ response: { data } })
    for (let i = 0; i < 2; i++) {
      const response = await t.post()
      assert.equal(response.status, 200)
      assert.deepEqual(await response.json(), { data })
    }
    assert.equal(t.calls.length, 2)
    assert.deepEqual(t.calls[0].body, t.calls[1].body)
    assert.equal(t.calls[0].headers["idempotency-key"], t.calls[1].headers["idempotency-key"])
  }
})
test("settlement forbids caller identity, amounts, raw evidence, both proof headers and noncanonical aliases before sending", async () => {
  const t = await setup()
  for (const body of [
    { ...wire, user_id: "victim" },
    { ...wire, captured_credits: "1" },
    { ...wire, usage: {} },
    { ...wire, evidence_revision: "9223372036854775808" },
    '{"run_id":"one","run_id":"two"}',
    "\ufeff" + JSON.stringify(wire),
  ])
    assert.equal((await t.post(body)).status, 400)
  for (const headers of [
    { "x-billing-execution-proof": "forbidden" },
    { "x-billing-consumption-token": "retired" },
    { "content-type": "text/plain" },
    { "idempotency-key": "bad key" },
  ])
    assert.equal((await t.post(wire, headers)).status, 400)
  for (const path of [
    endpoint + "?alias=1",
    endpoint + "/",
    endpoint.replace(admissionId, admissionId.toUpperCase()),
    endpoint.replace("/settle", "/%73ettle"),
  ])
    assert.ok([400, 404].includes((await t.post(wire, {}, path)).status), path)
  assert.equal(t.calls.length, 0)
})
test("missing and inconsistent durable sources never become a Billing command", async () => {
  for (const source of [
    () => null,
    () => ({ tenantId: "foreign", runId: wire.run_id, userId: "victim" }),
    () => ({ tenantId: "verified-tenant", runId: "other", userId: "victim" }),
  ]) {
    const t = await setup({ source })
    assert.equal((await t.post()).status, 404)
    assert.equal(t.calls.length, 0)
  }
  const t = await setup({ config: { agentModelAdmissionCredentialFile: null } })
  assert.equal((await t.post()).status, 503)
  assert.equal(t.calls.length, 0)
})
test("every known receipt binding and whole-credit value is checked; private evidence is never stripped to success", async () => {
  for (const field of ["admission_id", ...Object.keys(wire)]) {
    const value = field.endsWith("digest")
      ? "f".repeat(64)
      : field.endsWith("id")
        ? "99999999-9999-4999-8999-999999999999"
        : field === "evidence_revision"
          ? "2"
          : "other"
    const t = await setup({ response: { data: { ...receipt, [field]: value } } })
    const r = await t.post()
    assert.equal(r.status, 502, field)
    assert.equal(t.calls.length, 1)
  }
  for (const data of [
    { ...receipt, captured_credits: "9223372036855" },
    { ...receipt, raw_evidence: "private-never-return" },
    { ...receipt, updated_at: "2026-02-30T00:00:00.000Z" },
    { ...receipt, reason: "unknown_usage_or_outcome" },
    { ...receipt, settlement_id: null },
  ]) {
    const t = await setup({ response: { data } })
    const r = await t.post()
    assert.equal(r.status, 502)
    assert.ok(!JSON.stringify(await r.json()).includes("private-never-return"))
    assert.equal(t.calls.length, 1)
  }
})
test("shared settlement deadline rejects late source before send and bounds stalled owner EOF without retry", async () => {
  const t = await setup({
    config: { upstreamTimeoutMs: 50 },
    source: async () => {
      await new Promise((r) => setTimeout(r, 120))
      return { tenantId: "verified-tenant", userId: "original-user", runId: wire.run_id }
    },
  })
  assert.equal((await t.post()).status, 503)
  await new Promise((r) => setTimeout(r, 140))
  assert.equal(t.calls.length, 0)
  const stalled = await setup({ config: { upstreamTimeoutMs: 60 }, peer: (_req, res) => res.write('{"data":') })
  assert.equal((await stalled.post()).status, 503)
  assert.equal(stalled.calls.length, 1)
})
test("physical duplicate settlement headers fail after an identical TCP framing succeeds", async () => {
  const t = await setup(),
    text = JSON.stringify(wire)
  const raw = (duplicates = []) =>
    new Promise((resolve, reject) => {
      const req = rawRequest(
        t.base + endpoint,
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
            String(Buffer.byteLength(text)),
            "Idempotency-Key",
            "one-physical-key",
            ...duplicates,
          ],
        },
        (res) => {
          res.resume()
          res.once("end", () => resolve(res.statusCode))
        },
      )
      req.setTimeout(2000, () => req.destroy(Error("physical settlement request timed out")))
      req.once("error", reject)
      req.end(text)
    })
  assert.equal(await raw(), 200)
  assert.equal(t.calls.length, 1)
  for (const duplicates of [
    ["AUTHORIZATION", `Bearer ${secret}`],
    ["IDEMPOTENCY-KEY", "other-key"],
    ["CONTENT-TYPE", "application/json"],
    ["X-Billing-Execution-Proof", "one", "x-billing-execution-proof", "two"],
  ])
    assert.ok([400, 403].includes(await raw(duplicates)))
  assert.equal(t.calls.length, 1)
})
