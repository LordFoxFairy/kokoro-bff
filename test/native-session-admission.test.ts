import { createServer, type IncomingMessage, type Server } from "node:http"
import { mkdtemp, chmod, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, test } from "node:test"
import assert from "node:assert/strict"
import { SessionAdmissionClient } from "../dist/auth/session-admission.client.js"
import { nativeSessionCookie } from "../dist/auth/user-admission.js"

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
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
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
