import assert from "node:assert/strict"
import { createServer, request as rawRequest } from "node:http"
import { mkdtemp, writeFile, rm, chmod } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test, afterEach } from "node:test"
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
  evidence_event_id: "55555555-5555-4555-8555-555555555555",
  evidence_revision: "1",
  evidence_digest: "d".repeat(64),
}
const receipt = {
  ...wire,
  closure_ref: "33333333-3333-4333-8333-333333333333",
  status: "unreserved_closed",
  closed_at: "2026-11-15T00:00:00.000Z",
}

async function setup(options = {}) {
  const dir = await mkdtemp(join(tmpdir(), "kokoro-budget-unreserved-close-"))
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
    iamWebOrigin: "https://web.example.test",
  }
  const submittedAgentRuns = {
    readSubmittedAgentRun: async (input) => {
      sources.push(input)
      return options.source
        ? options.source(input)
        : { tenantId: "verified-tenant", userId: "original-user", runId: wire.run_id, conversationId: "original-conversation" }
    },
  }
  const sessionAdmission = {
    verify: async () => {
      throw Error("internal Agent must not use browser Session admission")
    },
  }
  await import("reflect-metadata")
  const { Test } = await import("@nestjs/testing")
  const { AgentRunsModule } = await import("../dist/modules/agent-runs/agent-runs.module.js")
  const { BFF_NEST_APPLICATION_OPTIONS } = await import("../dist/main.js")
  const { BFF_CONFIG, BFF_DATABASE, AGENT_RUNS_READER, SESSION_ADMISSION } = await import("../dist/common/tokens.js")
  const unexpectedStorage = () => {
    throw new Error("billing HTTP fixture must not touch BFF storage")
  }
  const module = await Test.createTestingModule({ imports: [AgentRunsModule] })
    .overrideProvider(BFF_CONFIG)
    .useValue(config)
    .overrideProvider(BFF_DATABASE)
    .useValue({ pool: { query: unexpectedStorage, connect: unexpectedStorage }, redis: {}, ready: unexpectedStorage })
    .overrideProvider(AGENT_RUNS_READER)
    .useValue(submittedAgentRuns)
    .overrideProvider(SESSION_ADMISSION)
    .useValue(sessionAdmission)
    .compile()
  const app = module.createNestApplication({ ...BFF_NEST_APPLICATION_OPTIONS, logger: false })
  cleanups.push(async () => {
    app.getHttpServer().closeAllConnections()
    await app.close()
  })
  await app.listen(0, "127.0.0.1")
  const base = await app.getUrl()
  const post = (body = wire, headers = {}, path = "/internal/v1/model-admissions/close-unreserved") =>
    fetch(base + path, {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/json",
        "idempotency-key": wire.request_ref,
        "x-request-id": "budget-request",
        ...headers,
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  return { base, file, credentials, calls, sources, post }
}

test("close-unreserved forwards only the original command and evidence under the durable submitter", async () => {
  const t = await setup()
  const response = await t.post()
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { data: receipt })
  assert.equal(response.headers.get("cache-control"), "no-store")
  assert.equal(response.headers.get("x-request-id"), "budget-request")
  assert.equal(t.sources.length, 1)
  assert.equal(t.sources[0].tenantId, "verified-tenant")
  assert.equal(t.sources[0].runId, wire.run_id)
  assert.equal(t.calls.length, 1)
  const call = t.calls[0]
  assert.equal(call.url, "/v1/internal/billing/admissions/close-unreserved")
  assert.deepEqual(call.body, wire)
  assert.equal(call.headers["idempotency-key"], wire.request_ref)
  assert.equal(call.headers["x-kokoro-tenant-id"], "u1." + Buffer.from("verified-tenant").toString("base64url"))
  assert.equal(call.headers["x-kokoro-subject"], "u1." + Buffer.from("original-user").toString("base64url"))
  assert.equal(call.headers.authorization, "Bearer billing-service-token-000000000000001")
  for (const name of ["cookie", "origin", "x-billing-execution-proof", "x-billing-consumption-token", "x-kokoro-proxy-secret"])
    assert.equal(call.headers[name], undefined)
})
test("close-unreserved rejects mismatched original key, extra authority, proof and duplicate JSON before lookup", async () => {
  const t = await setup()
  for (const body of [
    { ...wire, tenant_id: "foreign" },
    { ...wire, actor_id: "victim" },
    { ...wire, captured_credits: "0" },
    { ...wire, evidence_revision: "0" },
    { ...wire, evidence_digest: "bad" },
    JSON.stringify(wire).replace('"submitted-run"', '"submitted-run","run_id":"other"'),
  ])
    assert.equal((await t.post(body)).status, 400)
  for (const headers of [{ "idempotency-key": "other-original-key" }, { "x-billing-execution-proof": "" }, { "x-billing-consumption-token": "" }])
    assert.equal((await t.post(wire, headers)).status, 400)
  assert.equal((await t.post(wire, { authorization: "Bearer browser-only-secret" })).status, 403)
  for (const path of [
    "/internal/v1/model-admissions/close-unreserved?x=1",
    "/internal/v1/model-admissions/close-unreserved/",
    "/internal/v1/model-admissions/%63lose-unreserved",
  ])
    assert.equal((await t.post(wire, {}, path)).status, 400)
  assert.equal(t.sources.length, 0)
  assert.equal(t.calls.length, 0)
})
test("close-unreserved hides missing or cross-tenant submissions without an owner command", async () => {
  for (const source of [
    () => null,
    () => ({ tenantId: "foreign", userId: "original-user", runId: wire.run_id }),
    () => ({ tenantId: "verified-tenant", userId: "original-user", runId: "other-run" }),
  ]) {
    const t = await setup({ source })
    assert.equal((await t.post()).status, 404)
    assert.equal(t.calls.length, 0)
  }
})
test("close-unreserved verifies every echoed binding and rejects nonmonetary ACK drift without stripping fields", async () => {
  for (const field of Object.keys(wire)) {
    const value =
      field === "evidence_revision"
        ? "2"
        : field.endsWith("_id") && field !== "run_id"
          ? "66666666-6666-4666-8666-666666666666"
          : field.endsWith("digest")
            ? "e".repeat(64)
            : "other"
    const t = await setup({ response: { data: { ...receipt, [field]: value } } })
    assert.equal((await t.post()).status, 502, field)
    assert.equal(t.calls.length, 1)
  }
  for (const data of [
    { ...receipt, status: "released" },
    { ...receipt, closure_ref: "not-a-uuid" },
    { ...receipt, closed_at: "2026-11-15T00:00:00Z" },
    { ...receipt, closed_at: "2026-02-30T00:00:00.000Z" },
    { ...receipt, captured_credits: "0" },
    { ...receipt, secret: "private-owner-value" },
  ]) {
    const t = await setup({ response: { data } })
    const response = await t.post()
    assert.equal(response.status, 502)
    assert.ok(!JSON.stringify(await response.json()).includes("private-owner-value"))
  }
  const wrongStatus = await setup({ status: 201 })
  assert.equal((await wrongStatus.post()).status, 502)
})
test("close-unreserved unknown or existing-reservation denial is not retried or converted to settlement", async () => {
  for (const [status, code, retryable, expected] of [
    [409, "billing.idempotency_conflict", false, "model_admission_conflict"],
    [422, "billing.invalid_state", false, "model_admission_ineligible"],
    [503, "billing.dependency_unavailable", true, "model_admission_unavailable"],
  ]) {
    const t = await setup({ status, response: { error: { code, message: "private diagnostic", retryable } } })
    const response = await t.post()
    assert.equal(response.status, status)
    const body = await response.json()
    assert.equal(body.error.code, expected)
    assert.ok(!JSON.stringify(body).includes("private diagnostic"))
    assert.equal(t.calls.length, 1)
    assert.equal(t.calls[0].url, "/v1/internal/billing/admissions/close-unreserved")
  }
})
test("close-unreserved shares the finite lookup and owner EOF deadline without late dispatch", async () => {
  const t = await setup({
    config: { upstreamTimeoutMs: 70 },
    source: async (input) => {
      await new Promise((resolve) => setTimeout(resolve, 140))
      return { tenantId: input.tenantId, userId: "original-user", runId: input.runId }
    },
  })
  assert.equal((await t.post()).status, 503)
  await new Promise((resolve) => setTimeout(resolve, 150))
  assert.equal(t.calls.length, 0)
  const stalled = await setup({ config: { upstreamTimeoutMs: 70 }, peer: (_request, response) => response.write('{"data":') })
  assert.equal((await stalled.post()).status, 503)
  assert.equal(stalled.calls.length, 1)
})
test("close-unreserved disconnected caller aborts a pending submitter lookup before owner dispatch", async () => {
  let signal, started
  const sourceStarted = new Promise((resolve) => {
    started = resolve
  })
  const t = await setup({
    source: async (input) => {
      signal = input.signal
      started()
      await new Promise((resolve) => setTimeout(resolve, 100))
      return { tenantId: input.tenantId, userId: "original-user", runId: input.runId }
    },
  })
  const request = rawRequest(t.base + "/internal/v1/model-admissions/close-unreserved", {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
      "idempotency-key": wire.request_ref,
    },
  })
  request.on("error", () => undefined)
  request.end(JSON.stringify(wire))
  await Promise.race([sourceStarted, new Promise((_, reject) => setTimeout(() => reject(Error("source not started")), 500))])
  request.destroy()
  await new Promise((resolve) => setTimeout(resolve, 150))
  assert.equal(signal.aborted, true)
  assert.equal(t.calls.length, 0)
})
