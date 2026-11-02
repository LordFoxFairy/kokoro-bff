import { createServer, type IncomingMessage, type Server } from "node:http"
import { mkdtemp, chmod, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, test } from "node:test"
import assert from "node:assert/strict"
import { SessionAdmissionClient } from "../dist/auth/session-admission.client.js"
import { nativeSessionCookie } from "../dist/auth/user-admission.js"
import { loadConfig } from "../dist/config/runtime.js"
import { ProjectService } from "../dist/application/project-service.js"
import { ProjectMutationMiddleware } from "../dist/modules/projects/project-mutation.middleware.js"
import type { ProjectRepository } from "../src/application/projects/project-repository.js"
import type { IdempotencyRepository } from "../src/application/ports/idempotency-repository.js"

const servers: Server[] = []
const directories: string[] = []

async function listen(server: Server): Promise<string> {
  servers.push(server)
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  assert.ok(address && typeof address !== "string")
  return `http://127.0.0.1:${address.port}`
}

async function credentialFile(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "kokoro-bff-native-session-"))
  directories.push(directory)
  const path = join(directory, "session-admission.json")
  await writeFile(
    path,
    JSON.stringify({
      version: 1,
      entries: [{ credential_id: "native-primary", caller: "kokoro-bff", surface: "session_admission", tenant_id: "tenant-1", secret: "s".repeat(48) }],
    }),
    { mode: 0o600 },
  )
  await chmod(path, 0o600)
  return path
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections()
          server.close(() => resolve())
        }),
    ),
  )
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

const request = (cookie: string, origin = "https://web.example.test"): IncomingMessage =>
  ({
    rawHeaders: ["cookie", cookie, "origin", origin],
    headers: { cookie, origin },
  }) as IncomingMessage

test("native session admission sends direct service credential plus allowlisted cookie and origin", async () => {
  const calls: Array<{ authorization: string; cookie: string; origin: string; body: string }> = []
  const baseUrl = await listen(
    createServer((request, response) => {
      const chunks: Buffer[] = []
      request.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
      request.on("end", () => {
        calls.push({
          authorization: request.headers.authorization ?? "",
          cookie: request.headers.cookie ?? "",
          origin: request.headers.origin ?? "",
          body: Buffer.concat(chunks).toString("utf8"),
        })
        response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store", "x-request-id": "iam-native-1" })
        response.end(
          JSON.stringify({
            data: {
              subject_id: "user-1",
              tenant_id: "tenant-1",
              session_id: "session-1",
              permissions: ["tenant.read"],
              session_expires_at: "2030-01-01T00:00:00.000Z",
            },
            meta: { request_id: "iam-native-1", contract_version: "1.0.0" },
          }),
        )
      })
    }),
  )
  const client = new SessionAdmissionClient({
    baseUrl,
    credentialFile: await credentialFile(),
    webOrigin: "https://web.example.test",
    tenantId: "tenant-1",
    timeoutMs: 1000,
    maxResponseBytes: 65_536,
  })
  const result = await client.verifyNative({
    cookie: "kokoro-issuer.session_token=session; kokoro-issuer.session_data=data",
    origin: "https://web.example.test",
    requestId: "request-1",
    signal: new AbortController().signal,
  })
  assert.deepEqual(result, { ok: true, identity: { namespace: "tenant-1", userId: "user-1" }, platformAdmin: false })
  assert.deepEqual(calls, [
    {
      authorization: `Bearer ${"s".repeat(48)}`,
      cookie: "kokoro-issuer.session_token=session; kokoro-issuer.session_data=data",
      origin: "https://web.example.test",
      body: "",
    },
  ])
})

test("native cookie projection rejects Product, duplicate, and malformed cookie headers", () => {
  assert.equal(nativeSessionCookie(request("kokoro-issuer.session_token=session; authjs.session-token=product")), null)
  assert.equal(nativeSessionCookie(request("kokoro-issuer.session_token=one; kokoro-issuer.session_token=two")), null)
  assert.equal(nativeSessionCookie(request("kokoro-issuer.session_token")), null)
  assert.equal(nativeSessionCookie(request("kokoro-issuer.session_token=session")), "kokoro-issuer.session_token=session")
})

test("native session admission rejects an origin mismatch before IAM I/O", async () => {
  let calls = 0
  const baseUrl = await listen(
    createServer((_request, response) => {
      calls += 1
      response.writeHead(500).end()
    }),
  )
  const client = new SessionAdmissionClient({
    baseUrl,
    credentialFile: await credentialFile(),
    webOrigin: "https://web.example.test",
    tenantId: "tenant-1",
    timeoutMs: 1000,
    maxResponseBytes: 65_536,
  })
  await assert.deepEqual(
    await client.verifyNative({
      cookie: "kokoro-issuer.session_token=session",
      origin: "https://evil.example.test",
      requestId: "request-1",
      signal: new AbortController().signal,
    }),
    { ok: false, status: 403, code: "session_forbidden" },
  )
  assert.equal(calls, 0)
})

test("production project middleware rejects native transport failures before project creation or receipt claim", { timeout: 10_000 }, async (t) => {
  let mode: "disconnect" | "timeout" | "success" = "disconnect"
  const iamRequests: string[] = []
  const baseUrl = await listen(
    createServer((request, response) => {
      iamRequests.push(request.url ?? "")
      if (mode === "disconnect") {
        request.socket.destroy()
        return
      }
      if (mode === "timeout") return
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store", "x-request-id": "iam-native-1" })
      response.end(
        JSON.stringify({
          data: {
            subject_id: "user-1",
            tenant_id: "tenant-1",
            session_id: "session-1",
            permissions: ["tenant.read"],
            session_expires_at: "2030-01-01T00:00:00.000Z",
          },
          meta: { request_id: "iam-native-1", contract_version: "1.0.0" },
        }),
      )
    }),
  )
  const config = loadConfig({
    KOKORO_BFF_SHARED_SECRET: "native-middleware-test-only",
    KOKORO_BFF_POSTGRES_URL: "postgresql://localhost/unused_native_fixture?schema=kokoro_bff",
    KOKORO_BFF_REDIS_URL: "redis://localhost:6379/8",
    KOKORO_IAM_BASE_URL: baseUrl,
    KOKORO_IAM_WEB_ORIGIN: "https://web.example.test",
    KOKORO_BFF_IAM_SESSION_ADMISSION_CREDENTIAL_FILE: await credentialFile(),
    KOKORO_TENANT_ID: "tenant-1",
    KOKORO_UPSTREAM_TIMEOUT_MS: "200",
  })
  const client = new SessionAdmissionClient({
    baseUrl: config.iamBaseUrl,
    credentialFile: config.iamSessionAdmissionCredentialFile,
    webOrigin: config.iamWebOrigin,
    tenantId: config.tenantId,
    timeoutMs: config.upstreamTimeoutMs,
    maxResponseBytes: config.upstreamMaxResponseBytes,
  })
  const legacyVerify = t.mock.method(client, "verify")
  const project = {
    id: "project-native",
    name: "Native admission control",
    slug: "native-admission-control",
    description: "",
    created_at: "2026-11-01T00:00:00.000Z",
    updated_at: "2026-11-01T00:00:00.000Z",
  }
  const createProject = t.mock.fn<ProjectRepository["createProject"]>(async () => project)
  const repository: Pick<ProjectRepository, "createProject"> = { createProject }
  // This HTTP test reaches only create; the real service still invokes its repository.
  const projects = new ProjectService(repository as ProjectRepository)
  const create = t.mock.method(projects, "create")
  const receipts = {
    getReceipt: async () => assert.fail("Project creation must claim, not read, a receipt"),
    claimReceipt: t.mock.fn<IdempotencyRepository["claimReceipt"]>(async () => ({ claimed: true, receipt: null })),
    putReceipt: t.mock.fn<IdempotencyRepository["putReceipt"]>(async () => undefined),
    compareAndSetReceipt: async () => assert.fail("Project creation does not replace a receipt"),
    releaseReceipt: async () => assert.fail("Rejected admission must not acquire a receipt to release"),
  } satisfies IdempotencyRepository
  const middleware = new ProjectMutationMiddleware(config, client, projects, receipts)
  const next = t.mock.fn()
  const bffUrl = await listen(
    createServer((request, response) => {
      middleware.use(request, response, () => {
        next()
        response.writeHead(404).end()
      })
    }),
  )
  const sendMutation = () =>
    fetch(`${bffUrl}/v1/projects`, {
      method: "POST",
      headers: {
        "x-kokoro-service": "web-bff",
        "x-kokoro-internal-secret": "native-middleware-test-only",
        cookie: "kokoro-issuer.session_token=session",
        origin: "https://web.example.test",
        authorization: "Bearer must-not-fallback",
        "content-type": "application/json",
        "idempotency-key": `native-${mode}`,
      },
      body: JSON.stringify({ name: project.name }),
      signal: AbortSignal.timeout(3000),
    })
  for (const failureMode of ["disconnect", "timeout"] as const) {
    mode = failureMode
    const attemptsBefore = iamRequests.length
    const started = performance.now()
    const response = await sendMutation()
    assert.equal(response.status, 503, failureMode)
    const body = (await response.json()) as { error: { code: string } }
    assert.equal(body.error.code, "iam_admission_unavailable", failureMode)
    // The 200 ms transport budget has scheduling room, but not the outer 3 s watchdog.
    assert.ok(performance.now() - started < 2000, failureMode)
    assert.equal(iamRequests.length, attemptsBefore + 1, failureMode)
    assert.equal(iamRequests.at(-1), "/internal/v1/native-session-admission/verify")
    assert.equal(legacyVerify.mock.callCount(), 0)
    assert.equal(create.mock.callCount(), 0)
    assert.equal(createProject.mock.callCount(), 0)
    assert.equal(receipts.claimReceipt.mock.callCount(), 0)
    assert.equal(receipts.putReceipt.mock.callCount(), 0)
    assert.equal(next.mock.callCount(), 0)
  }
  // A successful request through the same middleware proves the side-effect observers are live.
  mode = "success"
  const response = await sendMutation()
  assert.equal(response.status, 200)
  assert.deepEqual(((await response.json()) as { data: { project: typeof project } }).data.project, project)
  assert.deepEqual(iamRequests, Array(3).fill("/internal/v1/native-session-admission/verify"))
  assert.equal(legacyVerify.mock.callCount(), 0)
  assert.equal(create.mock.callCount(), 1)
  assert.equal(createProject.mock.callCount(), 1)
  const createArguments = [{ tenantId: "tenant-1", subjectId: "user-1" }, project.name, ""]
  assert.deepEqual(create.mock.calls[0]!.arguments, createArguments)
  assert.deepEqual(createProject.mock.calls[0]!.arguments, createArguments)
  assert.equal(receipts.claimReceipt.mock.callCount(), 1)
  assert.equal(receipts.putReceipt.mock.callCount(), 1)
  assert.equal(next.mock.callCount(), 0)
})

test("native session admission preserves the owner's required, closed and versioned success fields", async () => {
  const success = {
    data: {
      subject_id: "user-1",
      tenant_id: "tenant-1",
      session_id: "session-1",
      permissions: ["platform.admin"],
      session_expires_at: "2030-01-01T05:30:00+05:30",
    },
    meta: { request_id: "iam-native-1", contract_version: "1.0.0" },
  }
  let body: unknown = success
  const baseUrl = await listen(
    createServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store", "x-request-id": "iam-native-1" })
      response.end(JSON.stringify(body))
    }),
  )
  const client = new SessionAdmissionClient({
    baseUrl,
    credentialFile: await credentialFile(),
    webOrigin: "https://web.example.test",
    tenantId: "tenant-1",
    timeoutMs: 1000,
    maxResponseBytes: 65_536,
  })
  const verify = () =>
    client.verifyNative({
      cookie: "kokoro-issuer.session_token=session",
      origin: "https://web.example.test",
      requestId: "request-1",
      signal: new AbortController().signal,
    })
  assert.deepEqual(await verify(), { ok: true, identity: { namespace: "tenant-1", userId: "user-1" }, platformAdmin: true })

  const invalid: Array<[string, unknown]> = [
    ["missing data", { meta: success.meta }],
    ["missing meta", { data: success.data }],
    ["extra envelope field", { ...success, extra: true }],
    ["extra data field", { ...success, data: { ...success.data, extra: true } }],
    ["extra meta field", { ...success, meta: { ...success.meta, extra: true } }],
    ["unknown contract version", { ...success, meta: { ...success.meta, contract_version: "2.0.0" } }],
    ["empty permission", { ...success, data: { ...success.data, permissions: [""] } }],
    ["invalid calendar date", { ...success, data: { ...success.data, session_expires_at: "2030-02-29T00:00:00Z" } }],
    ["missing timezone", { ...success, data: { ...success.data, session_expires_at: "2030-01-01T00:00:00" } }],
  ]
  for (const section of ["data", "meta"] as const) {
    for (const field of Object.keys(success[section])) {
      const incomplete: Record<string, unknown> = { ...success[section] }
      delete incomplete[field]
      invalid.push([`missing ${section}.${field}`, { ...success, [section]: incomplete }])
    }
  }
  for (const [label, payload] of invalid) {
    body = payload
    assert.deepEqual(await verify(), { ok: false, status: 503, code: "iam_admission_unavailable" }, label)
  }
})

test("native session admission accepts owner error codes but fails closed on malformed envelopes", async () => {
  const error = { code: "native_session_invalid", message: "owner-only diagnostic", retryable: false, details: [] }
  let status = 401
  let body: unknown = { error }
  const baseUrl = await listen(
    createServer((_request, response) => {
      response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", "x-request-id": "iam-native-1", "retry-after": "60" })
      response.end(JSON.stringify(body))
    }),
  )
  const client = new SessionAdmissionClient({
    baseUrl,
    credentialFile: await credentialFile(),
    webOrigin: "https://web.example.test",
    tenantId: "tenant-1",
    timeoutMs: 1000,
    maxResponseBytes: 65_536,
  })
  const verify = () =>
    client.verifyNative({
      cookie: "kokoro-issuer.session_token=session",
      origin: "https://web.example.test",
      requestId: "request-1",
      signal: new AbortController().signal,
    })
  for (const [ownerStatus, ownerCode, expectedStatus, expectedCode] of [
    [401, "native_session_invalid", 401, "session_invalid"],
    [401, "UNAUTHENTICATED", 401, "session_invalid"],
    [403, "native_session_origin_forbidden", 403, "session_forbidden"],
    [429, "native_session_rate_limited", 429, "session_rate_limited"],
    [503, "native_session_service_unavailable", 503, "iam_admission_unavailable"],
    [504, "native_session_deadline_exceeded", 503, "iam_admission_unavailable"],
  ] as const) {
    status = ownerStatus
    body = { error: { ...error, code: ownerCode } }
    assert.deepEqual(await verify(), { ok: false, status: expectedStatus, code: expectedCode, ...(ownerStatus === 429 ? { retryAfter: "60" } : {}) })
  }
  status = 401
  const invalid: Array<[string, unknown]> = [
    ["unknown error code", { error: { ...error, code: "future_native_session_error" } }],
    ["extra envelope field", { error, extra: true }],
    ["extra error field", { error: { ...error, extra: true } }],
    ["empty message", { error: { ...error, message: "" } }],
    ["wrong retryable type", { error: { ...error, retryable: "false" } }],
    ["wrong details type", { error: { ...error, details: {} } }],
  ]
  for (const field of Object.keys(error)) {
    const incomplete: Record<string, unknown> = { ...error }
    delete incomplete[field]
    invalid.push([`missing error.${field}`, { error: incomplete }])
  }
  for (const [label, payload] of invalid) {
    body = payload
    assert.deepEqual(await verify(), { ok: false, status: 503, code: "iam_admission_unavailable" }, label)
  }
})
