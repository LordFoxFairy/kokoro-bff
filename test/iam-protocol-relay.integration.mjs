import assert from "node:assert/strict"
import { test } from "node:test"

import { loadConfig } from "../dist/config/runtime.js"
import { createBffServer } from "../dist/bootstrap/server.js"

const ownerBase = process.env.KOKORO_TEST_IAM_BASE_URL
if (!ownerBase || !/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/u.test(ownerBase)) {
  throw new Error("KOKORO_TEST_IAM_BASE_URL must be a test-owned loopback IAM HTTP origin")
}

const webOrigin = process.env.KOKORO_TEST_IAM_WEB_ORIGIN ?? "https://iam.example.test"
const tenantId = process.env.KOKORO_TEST_TENANT_ID
const credentialFile = process.env.KOKORO_BFF_IAM_USER_CONTEXT_SERVICE_CREDENTIAL_FILE
if (!tenantId || !credentialFile) throw new Error("A fixture-owned Product tenant and canonical BFF IAM user-context credential file are required")
const serviceHeaders = { "x-kokoro-service": "web-bff", "x-kokoro-internal-secret": "test-secret" }

test("BFF preserves native sign-in, safe session status and sign-out over real owner HTTP", async () => {
  const config = loadConfig({
    KOKORO_BFF_SHARED_SECRET: "test-secret",
    KOKORO_BFF_POSTGRES_URL: "postgresql://localhost/unused_bff_relay_fixture?schema=kokoro_bff",
    KOKORO_BFF_REDIS_URL: "redis://localhost:6379/8",
    KOKORO_IAM_BASE_URL: ownerBase,
    KOKORO_IAM_WEB_ORIGIN: webOrigin,
    KOKORO_TENANT_ID: tenantId,
    KOKORO_BFF_IAM_USER_CONTEXT_SERVICE_CREDENTIAL_FILE: credentialFile,
    NODE_ENV: "test",
  })
  const server = createBffServer(config, { businessStore: null, readiness: async () => undefined })
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  if (address === null || typeof address === "string") throw new Error("BFF did not bind")
  const base = `http://127.0.0.1:${address.port}`
  try {
    const signedIn = await fetch(`${base}/iam/sign-in/email`, {
      method: "POST",
      headers: { ...serviceHeaders, origin: webOrigin, "content-type": "application/json" },
      body: JSON.stringify({ email: "owner@example.test", password: "Test-only-password-928384!" }),
      redirect: "manual",
    })
    assert.equal(signedIn.status, 200)
    const issuerCookies = signedIn.headers.getSetCookie()
    assert.ok(issuerCookies.some((value) => value.startsWith("kokoro-issuer.session_token=")))
    assert.ok(issuerCookies.every((value) => !value.startsWith("authjs.")))
    const cookie = issuerCookies.map((value) => value.split(";", 1)[0]).join("; ")

    assert.equal((await fetch(`${base}/iam/get-session?disableCookieCache=true`, { headers: { ...serviceHeaders, origin: webOrigin, cookie } })).status, 404)
    const active = await fetch(`${base}/iam/organization/set-active`, {
      method: "POST",
      headers: { ...serviceHeaders, origin: webOrigin, cookie, "content-type": "application/json" },
      body: JSON.stringify({ organizationId: tenantId }),
    })
    assert.equal(active.status, 200)
    const session = await fetch(`${base}/browser/v1/auth/session?refresh=false`, { headers: { ...serviceHeaders, origin: webOrigin, cookie } })
    assert.equal(session.status, 200)
    const status = await session.json()
    assert.equal(status.data.authenticated, true)
    assert.equal(status.data.tenant_id, tenantId)
    assert.deepEqual(Object.keys(status.data).sort(), ["authenticated", "expires_at", "subject", "tenant_id"])
    assert.equal(session.headers.get("cache-control"), "no-store")
    assert.equal(session.headers.get("set-auth-jwt"), null)

    const signedOut = await fetch(`${base}/iam/sign-out`, {
      method: "POST",
      headers: { ...serviceHeaders, origin: webOrigin, cookie },
      redirect: "manual",
    })
    assert.equal(signedOut.status, 200)
    const deletedIssuerCookies = signedOut.headers.getSetCookie().filter((value) => value.startsWith("kokoro-issuer.session_token="))
    assert.equal(deletedIssuerCookies.length, 1)
    assert.equal(deletedIssuerCookies[0].split(";", 1)[0] === "kokoro-issuer.session_token=", true)
    assert.equal(/(?:^|;)\s*Max-Age=0(?:;|$)/iu.test(deletedIssuerCookies[0]), true)
    assert.equal(signedOut.headers.has("set-auth-jwt"), false)

    const revoked = await fetch(`${base}/browser/v1/auth/session?refresh=false`, { headers: { ...serviceHeaders, origin: webOrigin, cookie } })
    assert.equal(revoked.status, 200)
    assert.deepEqual(await revoked.json(), { data: { authenticated: false } })
    assert.equal(revoked.headers.get("cache-control"), "no-store")
    assert.equal(revoked.headers.has("set-auth-jwt"), false)
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
})
