import assert from "node:assert/strict"
import { createServer, type Server } from "node:http"
import { afterEach, test } from "node:test"

import { loadConfig } from "../dist/config/runtime.js"
import { createLiveTestBffServer } from "./doubles/server.ts"

const servers: Server[] = []
const webOrigin = "http://web.example.test"
const webServiceHeaders = {
  "x-kokoro-service": "web-bff",
  "x-kokoro-internal-secret": "test-secret",
}

async function listen(server: Server): Promise<string> {
  servers.push(server)
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  if (address === null || typeof address === "string") throw new Error("server did not bind")
  return `http://127.0.0.1:${address.port}`
}

function bff(iamBaseUrl: string, tenantId?: string): Server {
  return createLiveTestBffServer(
    loadConfig({
      KOKORO_BFF_SHARED_SECRET: "test-secret",
      KOKORO_BFF_POSTGRES_URL: "postgresql://localhost/unused_bff_relay_fixture?schema=kokoro_bff",
      KOKORO_BFF_REDIS_URL: "redis://localhost:6379/8",
      KOKORO_IAM_BASE_URL: iamBaseUrl,
      KOKORO_IAM_WEB_ORIGIN: webOrigin,
      ...(tenantId === undefined ? {} : { KOKORO_TENANT_ID: tenantId }),
    }),
  )
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
})

test("native relay filters issuer credentials for permitted authentication interactions and closes raw Session reads", async () => {
  const calls: Array<{ url: string | undefined; cookie: string | undefined }> = []
  const iam = await listen(
    createServer((request, response) => {
      calls.push({ url: request.url, cookie: request.headers.cookie })
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" })
      response.end(JSON.stringify({ user: { email: "owner@example.test" } }))
    }),
  )
  const base = await listen(bff(iam))

  assert.equal((await fetch(`${base}/iam/oauth2/authorize`, { headers: webServiceHeaders })).status, 404)
  assert.equal((await fetch(`${base}/iam/get-session?disableCookieCache=true`, { headers: webServiceHeaders })).status, 404)
  const response = await fetch(`${base}/iam/verify-email?token=verification`, {
    headers: { ...webServiceHeaders, cookie: "authjs.session-token=private; kokoro-issuer.session_token=issuer-session" },
  })
  assert.equal(response.status, 200)
  assert.deepEqual(calls, [{ url: "/iam/verify-email?token=verification", cookie: "kokoro-issuer.session_token=issuer-session" }])
})

test("native set-active accepts only the fixed organization id body", async () => {
  const calls: Array<{ body: string; cookie: string | undefined }> = []
  const iam = await listen(
    createServer((request, response) => {
      const chunks: Buffer[] = []
      request.on("data", (chunk: Buffer) => chunks.push(chunk))
      request.on("end", () => {
        calls.push({ body: Buffer.concat(chunks).toString("utf8"), cookie: request.headers.cookie })
        response.writeHead(200, { "content-type": "application/json" })
        response.end("{}")
      })
    }),
  )
  const base = await listen(bff(iam, "tenant-fixed"))
  const headers = { ...webServiceHeaders, origin: webOrigin, cookie: "kokoro-issuer.session_token=issuer-session", "content-type": "application/json" }

  assert.equal(
    (await fetch(`${base}/iam/organization/set-active`, { method: "POST", headers, body: JSON.stringify({ organizationId: "tenant-other" }) })).status,
    403,
  )
  assert.equal(
    (await fetch(`${base}/iam/organization/set-active`, { method: "POST", headers, body: JSON.stringify({ organizationId: "tenant-fixed", extra: true }) }))
      .status,
    400,
  )
  assert.equal(
    (await fetch(`${base}/iam/organization/set-active`, { method: "POST", headers, body: JSON.stringify({ organizationId: "tenant-fixed" }) })).status,
    200,
  )
  assert.deepEqual(calls, [{ body: JSON.stringify({ organizationId: "tenant-fixed" }), cookie: "kokoro-issuer.session_token=issuer-session" }])
})

test("native relay rejects browser authorization headers before IAM I/O", async () => {
  let calls = 0
  const iam = await listen(
    createServer((_request, response) => {
      calls += 1
      response.writeHead(200)
      response.end("{}")
    }),
  )
  const base = await listen(bff(iam))
  const response = await fetch(`${base}/iam/verify-email?token=verification`, { headers: { ...webServiceHeaders, authorization: "Bearer forged" } })
  assert.equal(response.status, 403)
  assert.equal(calls, 0)
})

test("signup accepts the same required read-only User projection for normal and synthetic invitation registration", async () => {
  let body: unknown
  const calls: unknown[] = []
  const iam = await listen(
    createServer(async (request, response) => {
      const chunks = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      calls.push(JSON.parse(Buffer.concat(chunks).toString()))
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" })
      response.end(JSON.stringify(body))
    }),
  )
  const base = await listen(bff(iam))
  const signup = {
    callbackURL: `${webOrigin}/iam/interactions/invitation?id=11111111-1111-4111-8111-111111111111`,
    email: "person@example.test",
    name: "Person",
    password: "fixture-password-12345",
  }
  const post = (value = signup) =>
    fetch(base + "/iam/sign-up/email", {
      method: "POST",
      headers: { ...webServiceHeaders, origin: webOrigin, "content-type": "application/json" },
      body: JSON.stringify(value),
    })
  const user = {
    id: "11111111-1111-4111-8111-111111111111",
    email: signup.email,
    name: signup.name,
    image: null,
    emailVerified: false,
    platformAdmin: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }
  for (const id of [user.id, "22222222-2222-4222-8222-222222222222"]) {
    body = { token: null, user: { ...user, id } }
    const response = await post()
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), body)
  }
  assert.equal(calls.length, 2)
  for (const invalid of [
    { ...user, platformAdmin: undefined },
    { ...user, platformAdmin: "false" },
    { ...user, platformAdminVersion: 1 },
    { ...user, secret: "PRIVATE_USER_SECRET" },
  ]) {
    body = { token: null, user: invalid }
    const response = await post()
    assert.equal(response.status, 502)
    assert.doesNotMatch(await response.text(), /PRIVATE_USER_SECRET/)
  }
  const before = calls.length
  assert.equal((await post({ ...signup, platformAdmin: true } as typeof signup)).status, 400)
  assert.equal(calls.length, before, "client input cannot promote the returned read-only field")
})
