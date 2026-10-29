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
  const dir = await mkdtemp(join(tmpdir(), "kokoro-budget-recovery-"))
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
  const post = (body = wire, headers = {}, path = "/internal/v1/model-admissions/recover") =>
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

test("recover reads the original held receipt using only the durable submitter, never a new proof or reserve", async () => {
  const t = await setup()
  const r = await t.post()
  assert.equal(r.status, 200)
  assert.deepEqual(await r.json(), { data: receipt })
  assert.equal(r.headers.get("cache-control"), "no-store")
  assert.equal(r.headers.get("x-request-id"), "budget-request")
  assert.equal(t.sources.length, 1)
  assert.equal(t.sources[0].tenantId, "verified-tenant")
  assert.equal(t.sources[0].runId, wire.run_id)
  assert.equal(t.calls.length, 1)
  const c = t.calls[0]
  assert.equal(c.url, "/v1/internal/billing/admissions/recover")
  assert.deepEqual(c.body, wire)
  assert.equal(c.headers["idempotency-key"], "one-attempt-key")
  assert.equal(c.headers["x-kokoro-service"], "web-bff")
  assert.equal(c.headers.authorization, "Bearer billing-service-token-000000000000001")
  assert.equal(c.headers["x-kokoro-tenant-id"], "u1." + Buffer.from("verified-tenant").toString("base64url"))
  assert.equal(c.headers["x-kokoro-subject"], "u1." + Buffer.from("original-user").toString("base64url"))
  for (const name of ["x-billing-execution-proof", "x-billing-consumption-token", "x-kokoro-proxy-secret"]) assert.equal(c.headers[name], undefined)
})
test("a recovery miss and an unknown owner result never fall back to create or retry", async () => {
  for (const [status, code, retryable, expected] of [
    [404, "billing.not_found", false, "model_admission_not_found"],
    [409, "billing.idempotency_conflict", false, "model_admission_conflict"],
    [503, "billing.dependency_unavailable", true, "model_admission_unavailable"],
  ]) {
    const t = await setup({ status, response: { error: { code, message: "private diagnostic", retryable } } })
    const r = await t.post()
    assert.equal(r.status, status)
    const b = await r.json()
    assert.equal(b.error.code, expected)
    assert.ok(!JSON.stringify(b).includes("private diagnostic"))
    assert.equal(t.calls.length, 1)
    assert.equal(t.calls[0].url, "/v1/internal/billing/admissions/recover")
    assert.deepEqual(t.calls[0].body, wire)
  }
})
test("recovery rejects identity, money, proof, duplicate JSON and noncanonical paths before any owner read", async () => {
  const t = await setup()
  for (const b of [
    { ...wire, user_id: "victim" },
    { ...wire, tenant_id: "foreign" },
    { ...wire, budget_credits: "100" },
    { ...wire, recovery: true },
    { ...wire, planned_digest: "bad" },
    JSON.stringify(wire).replace('"submitted-run"', '"submitted-run","run_id":"other"'),
    "\ufeff" + JSON.stringify(wire),
  ])
    assert.equal((await t.post(b)).status, 400)
  for (const h of [
    { "x-billing-execution-proof": "proof" },
    { "x-billing-execution-proof": "" },
    { "x-billing-consumption-token": "retired" },
    { "idempotency-key": "bad key" },
    { "content-type": "text/plain" },
  ])
    assert.equal((await t.post(wire, h)).status, 400)
  assert.equal((await t.post(wire, { authorization: "Bearer browser-only-secret" })).status, 403)
  for (const path of ["/internal/v1/model-admissions/recover?bypass=1", "/internal/v1/model-admissions/recover/", "/internal/v1/model-admissions/%72ecover"])
    assert.equal((await t.post(wire, {}, path)).status, 400)
  assert.equal(t.calls.length, 0)
  assert.equal(t.sources.length, 0)
})
test("missing or inconsistent submitted source is hidden and credential rotation remains fresh", async () => {
  for (const source of [
    () => null,
    () => ({ tenantId: "foreign", userId: "original-user", runId: wire.run_id }),
    () => ({ tenantId: "verified-tenant", userId: "original-user", runId: "foreign-run" }),
  ]) {
    const t = await setup({ source })
    assert.equal((await t.post()).status, 404)
    assert.equal(t.calls.length, 0)
  }
  const disabled = await setup({ config: { agentModelAdmissionCredentialFile: null } })
  assert.equal((await disabled.post()).status, 503)
  assert.equal(disabled.calls.length, 0)
  const t = await setup()
  await writeFile(t.file, JSON.stringify(t.credentials({ secret: "rotated-" + "b".repeat(40) })))
  assert.equal((await t.post()).status, 403)
  assert.equal((await t.post(wire, { authorization: "Bearer rotated-" + "b".repeat(40) })).status, 200)
  await writeFile(t.file, JSON.stringify(t.credentials({ caller: "kokoro-iam" })))
  assert.equal((await t.post()).status, 503)
  await writeFile(t.file, JSON.stringify(t.credentials()))
  await chmod(t.file, 0o644)
  assert.equal((await t.post()).status, 503)
  assert.equal(t.calls.length, 1)
})
test("recovery ACK must preserve all original facts, whole budget and creation time without stripping extras", async () => {
  for (const field of Object.keys(wire)) {
    const value = field === "attempt_id" ? "55555555-5555-4555-8555-555555555555" : field.endsWith("digest") ? "e".repeat(64) : "different"
    const t = await setup({ response: { data: { ...receipt, [field]: value } } })
    assert.equal((await t.post()).status, 502, field)
    assert.equal(t.calls.length, 1)
  }
  for (const data of [
    { ...receipt, status: "captured" },
    { ...receipt, updated_at: "2026-10-22T00:00:01.000Z" },
    { ...receipt, created_at: "2026-10-22T00:00:00Z", updated_at: "2026-10-22T00:00:00Z" },
    { ...receipt, budget_credits: "0" },
    { ...receipt, budget_credits: "1.0" },
    { ...receipt, secret: "never-leak" },
  ]) {
    const t = await setup({ response: { data } })
    const r = await t.post()
    assert.equal(r.status, 502)
    assert.ok(!JSON.stringify(await r.json()).includes("never-leak"))
    assert.equal(t.calls.length, 1)
  }
  const wrongStatus = await setup({ status: 201 })
  assert.equal((await wrongStatus.post()).status, 502)
  assert.equal(wrongStatus.calls.length, 1)
})
test("recovery shares one deadline across source and owner EOF, no late dispatch or retry", async () => {
  let sourceDone = false
  const t = await setup({
    config: { upstreamTimeoutMs: 80 },
    source: async (input) => {
      await new Promise((r) => setTimeout(r, 160))
      sourceDone = true
      return { tenantId: input.tenantId, userId: "original-user", runId: input.runId }
    },
  })
  const start = performance.now()
  assert.equal((await t.post()).status, 503)
  assert.ok(performance.now() - start < 400)
  await new Promise((r) => setTimeout(r, 180))
  assert.equal(sourceDone, true)
  assert.equal(t.calls.length, 0)
  const stalled = await setup({ config: { upstreamTimeoutMs: 80 }, peer: (_req, res) => res.write('{"data":') })
  const s = performance.now()
  assert.equal((await stalled.post()).status, 503)
  assert.ok(performance.now() - s < 400)
  assert.equal(stalled.calls.length, 1)
})
test("recovery raw-header positive control then duplicate command/proof rejection reaches no extra peer", async () => {
  const t = await setup()
  const body = JSON.stringify(wire)
  const raw = async (extra) =>
    new Promise((resolve, reject) => {
      const q = rawRequest(
        t.base + "/internal/v1/model-admissions/recover",
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
            "raw-original-key",
            ...extra,
          ],
        },
        (r) => {
          r.resume()
          r.once("end", () => resolve(r.statusCode))
        },
      )
      q.once("error", reject)
      q.end(body)
    })
  assert.equal(await raw([]), 200)
  assert.equal(t.calls.length, 1)
  for (const extra of [
    ["Idempotency-Key", "other-key"],
    ["x-billing-execution-proof", "first", "X-Billing-Execution-Proof", "second"],
    ["x-billing-consumption-token", ""],
  ])
    assert.equal(await raw(extra), 400)
  assert.equal(t.calls.length, 1)
})
test("a disconnected recovery caller cannot dispatch after a late durable source lookup", async () => {
  let sourceSignal, started
  const sourceStarted = new Promise((r) => {
    started = r
  })
  const t = await setup({
    source: async (input) => {
      sourceSignal = input.signal
      started()
      await new Promise((r) => setTimeout(r, 100))
      return { tenantId: input.tenantId, userId: "original-user", runId: input.runId }
    },
  })
  const q = rawRequest(t.base + "/internal/v1/model-admissions/recover", {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
      "idempotency-key": "original-key",
    },
  })
  q.on("error", () => undefined)
  q.end(JSON.stringify(wire))
  await Promise.race([sourceStarted, new Promise((_, reject) => setTimeout(() => reject(Error("source did not start")), 500))])
  q.destroy()
  await new Promise((r) => setTimeout(r, 150))
  assert.equal(sourceSignal.aborted, true)
  assert.equal(t.calls.length, 0)
})
