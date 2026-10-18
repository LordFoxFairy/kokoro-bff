import assert from "node:assert/strict"
import test from "node:test"
import { request as httpRequest } from "node:http"
import { Code, ConnectError } from "@connectrpc/connect"
import { createBffServer } from "../src/bootstrap/server.js"
import { DEFAULT_AGUI_CONFIG } from "../src/config/runtime.js"
import { startMcpRequestBudget } from "../src/http/mcp-request-budget.js"
const headers = { "x-kokoro-service": "admin-web-bff", "x-kokoro-internal-secret": "admin-test-secret", authorization: "Bearer admin-session" }
const packageId = "package-1",
  uploadId = "upload-1",
  base = `/v1/admin/mcp/packages/${packageId}`
const source = { content_sha256: "a".repeat(64), size_bytes: "104", upload_source_version_id: "source-1" }
const status = { upload_id: uploadId, state: "completed", ...source, asset_id: "asset-1", scan_state: "pending" }
const commands = [
  ["POST", `${base}/uploads`, { filename: "fixture.zip", content_sha256: source.content_sha256, size_bytes: "104" }, "begin"],
  ["POST", `${base}/uploads/${uploadId}/complete`, source, "complete"],
  ["POST", `${base}/uploads/${uploadId}/abort`, { reason: "cancelled" }, "abort"],
  ["GET", `${base}/uploads/${uploadId}`, undefined, "status"],
  ["POST", `${base}/publish`, { ...source, upload_id: uploadId, asset_id: "asset-1", provider_key: "fixture" }, "publish"],
] as const
async function fixture(t: import("node:test").TestContext, budget?: number) {
  const state = { admin: true, allowed: true, fault: null as ConnectError | null, waiting: false, cancelled: false },
    calls: any[] = []
  const server = createBffServer(
    {
      host: "127.0.0.1",
      port: 0,
      mode: "live",
      domain: "dev.kokoro.localhost",
      sharedSecret: "test-secret",
      adminWebSharedSecret: "admin-test-secret",
      tenantId: "tenant-one",
      iamBaseUrl: null,
      iamServiceToken: null,
      iamAdmissionTimeoutMs: 5000,
      iamAdmissionMaxResponseBytes: 65536,
      browserCredentials: { "admin-web-bff": "admin-test-secret" },
      upstreamSecret: "upstream-secret",
      upstreamTimeoutMs: 5000,
      upstreamMaxResponseBytes: 1048576,
      schedulerServiceToken: null,
      schedulerTargetUrl: null,
      agentEnabled: false,
      postgresUrl: null,
      redisUrl: null,
      agUi: DEFAULT_AGUI_CONFIG,
      upstreams: { system: null, platform: null, scheduler: null, agents: null, billing: null, music: null },
      platformProjection: { baseUrl: null, credentialFile: null, timeoutMs: 5000 },
      skillDraft: { platformBaseUrl: null, credentialFile: null, timeoutMs: 5000 },
    },
    {
      businessStore: null,
      readiness: async () => undefined,
      sessionAdmission: { verify: async () => ({ ok: true, identity: { namespace: "tenant-one", userId: "admin-one" }, platformAdmin: state.admin }) },
      mcpAuthorization: {
        check: async (input) => {
          assert.equal(input.resource, "mcp_catalog")
          assert.equal(input.action, "manage")
          return state.allowed ? { ok: true } : { ok: false, status: 403, code: "session_forbidden" }
        },
      },
      mcpPackageAdminClient: {
        execute: async (identity: any, input: any, signal: AbortSignal, deadline: number) => {
          calls.push({ identity, input, deadline })
          if (state.waiting)
            await new Promise<void>((resolve) => {
              signal.addEventListener(
                "abort",
                () => {
                  state.cancelled = true
                  resolve()
                },
                { once: true },
              )
            })
          if (state.fault) throw state.fault
          if (input.kind === "begin")
            return {
              kind: "begin",
              package_id: packageId,
              upload_id: uploadId,
              transfer_reference: { url: "https://object.fixture/upload", method: "PUT", required_headers: {}, expires_at: "2099-01-01T00:00:00.000Z" },
            }
          if (input.kind === "complete" || input.kind === "status") return { kind: input.kind, upload: status }
          if (input.kind === "abort") return { kind: "abort", upload_id: uploadId, state: "aborted" }
          return {
            kind: "publish",
            package_version_id: "11111111-1111-4111-8111-111111111111",
            server_id: "22222222-2222-4222-8222-222222222222",
            replayed: true,
          }
        },
      },
    } as any,
  )
  if (budget !== undefined) server.prependListener("request", (req) => startMcpRequestBudget(req, budget))
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  assert.ok(address && typeof address !== "string")
  t.after(async () => {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })
  const origin = `http://127.0.0.1:${address.port}`
  const send = (method: string, path: string, body?: unknown) =>
    fetch(origin + path, {
      method,
      headers: { ...headers, ...(body === undefined ? {} : { "content-type": "application/json", "idempotency-key": "command-1" }) },
      ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
    })
  return { state, calls, origin, send }
}
test("admin package HTTP maps five operations with trusted identity and original command semantics", async (t) => {
  const f = await fixture(t)
  for (const [method, path, body, kind] of commands) {
    const response = await f.send(method, path, body)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get("cache-control"), "no-store")
    assert.ok(response.headers.get("x-request-id"))
    const result = (await response.json()) as any
    assert.equal("kind" in result.data, false)
    assert.equal(f.calls.at(-1).identity.tenantId, "tenant-one")
    assert.equal(f.calls.at(-1).identity.subjectId, "admin-one")
    assert.equal(f.calls.at(-1).input.kind, kind)
    assert.equal(f.calls.at(-1).input.packageId, packageId)
    if (kind !== "status") assert.equal(f.calls.at(-1).input.commandId, "command-1")
  }
  assert.equal(f.calls.length, 5)
})
test("admin package HTTP rechecks current human platform role and catalog action before every owner request", async (t) => {
  const f = await fixture(t)
  f.state.admin = false
  assert.equal((await f.send("GET", `${base}/uploads/${uploadId}`)).status, 403)
  f.state.admin = true
  f.state.allowed = false
  assert.equal((await f.send("POST", `${base}/publish`, commands[4][2])).status, 403)
  assert.equal(f.calls.length, 0)
  f.state.allowed = true
  assert.equal((await f.send("GET", `${base}/uploads/${uploadId}`)).status, 200)
})
test("admin package HTTP rejects duplicate or forged bodies, invalid exact sources and query/header ambiguity", async (t) => {
  const f = await fixture(t)
  for (const body of [
    '{"filename":"x.zip","filename":"y.zip","size_bytes":"104","content_sha256":"' + source.content_sha256 + '"}',
    { ...commands[0][2], tenant_id: "forged" },
    { ...commands[0][2], size_bytes: "33554433" },
    { ...commands[0][2], filename: "../x.zip" },
    { ...commands[4][2], command: "exec" },
  ]) {
    assert.equal((await f.send("POST", `${base}/uploads`, body)).status, 400)
  }
  assert.equal((await f.send("GET", `${base}/uploads/${uploadId}?tenant_id=forged`)).status, 400)
  assert.equal((await fetch(f.origin + `${base}/uploads/${uploadId}`, { headers: { ...headers, "idempotency-key": "not-for-read" } })).status, 400)
  assert.equal(f.calls.length, 0)
})
test("admin package HTTP preserves safe owner error meaning, body deadlines and cancellation without late success", async (t) => {
  const f = await fixture(t)
  for (const [code, reason, http] of [
    [Code.FailedPrecondition, "package_limit_exceeded", 413],
    [Code.ResourceExhausted, "package_limit_exceeded", 413],
    [Code.AlreadyExists, "command_receipt_identity_conflict", 409],
    [Code.Aborted, "command_receipt_in_progress", 409],
    [Code.DataLoss, "private", 502],
    [Code.Unavailable, "private", 503],
  ] as const) {
    f.state.fault = new ConnectError("private URL secret", code, { "x-kokoro-error-code": reason })
    const response = await f.send("POST", `${base}/publish`, commands[4][2])
    assert.equal(response.status, http)
    assert.doesNotMatch(await response.text(), /private|secret/u)
  }
  const slow = await fixture(t, 60)
  const result = await new Promise<number>((resolve, reject) => {
    const request = httpRequest(
      slow.origin + `${base}/uploads`,
      { method: "POST", headers: { ...headers, "content-type": "application/json", "content-length": "100", "idempotency-key": "slow" } },
      (response) => {
        response.resume()
        response.on("end", () => {
          resolve(response.statusCode!)
          request.destroy()
        })
      },
    )
    request.on("error", (error) => {
      if (error.message !== "socket hang up") reject(error)
    })
    request.flushHeaders()
  })
  assert.equal(result, 503)
  assert.equal(slow.calls.length, 0)
  const canceled = await fixture(t, 60)
  canceled.state.waiting = true
  assert.equal((await canceled.send("GET", `${base}/uploads/${uploadId}`)).status, 503)
  assert.equal(canceled.state.cancelled, true)
})
