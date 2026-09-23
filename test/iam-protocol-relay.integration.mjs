import assert from "node:assert/strict"
import { test } from "node:test"

import { loadConfig } from "../dist/config/runtime.js"
import { createLiveTestBffServer } from "./doubles/server.ts"

const ownerBase = process.env.KOKORO_TEST_IAM_BASE_URL
if (!ownerBase || !/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/u.test(ownerBase)) {
  throw new Error("KOKORO_TEST_IAM_BASE_URL must be a test-owned loopback IAM HTTP origin")
}

const webOrigin = "https://iam.example.test"
const serviceHeaders = { "x-kokoro-service": "web-bff", "x-kokoro-internal-secret": "test-secret" }

test("BFF preserves real IAM discovery, sign-in cookie and issuer Session over HTTP", async () => {
  const config = loadConfig({
    KOKORO_BFF_SHARED_SECRET: "test-secret",
    KOKORO_BFF_POSTGRES_URL: "postgresql://localhost/unused_bff_relay_fixture?schema=kokoro_bff",
    KOKORO_BFF_REDIS_URL: "redis://localhost:6379/8",
    KOKORO_IAM_BASE_URL: ownerBase,
    KOKORO_IAM_ISSUER_URL: `${webOrigin}/iam`,
    KOKORO_IAM_WEB_ORIGIN: webOrigin,
    KOKORO_IAM_WEB_CALLBACK_URI: `${webOrigin}/api/auth/callback/kokoro-iam`,
    KOKORO_IAM_WEB_POST_LOGOUT_URI: `${webOrigin}/auth/sign-in`,
    NODE_ENV: "test",
  })
  const server = createLiveTestBffServer(config)
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  if (address === null || typeof address === "string") throw new Error("BFF did not bind")
  const base = `http://127.0.0.1:${address.port}`
  try {
    const discovery = await fetch(`${base}/iam/.well-known/openid-configuration`, { headers: serviceHeaders })
    assert.equal(discovery.status, 200)
    const metadata = await discovery.json()
    assert.equal(metadata.issuer, `${webOrigin}/iam`)

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
    const session = await fetch(`${base}/iam/get-session`, { headers: { ...serviceHeaders, cookie: `authjs.session-token=never-forward; ${cookie}` } })
    assert.equal(session.status, 200)
    assert.equal((await session.json()).user.email, "owner@example.test")

    const authorize = await fetch(
      `${base}/iam/oauth2/authorize?client_id=unknown-client&response_type=code&scope=openid&redirect_uri=${encodeURIComponent(`${webOrigin}/api/auth/callback/kokoro-iam`)}&code_challenge=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG&code_challenge_method=S256&state=state-1&resource=${encodeURIComponent("https://kokoro.dev/resources/iam-internal")}`,
      { headers: { ...serviceHeaders, cookie }, redirect: "manual" },
    )
    assert.equal(authorize.status, 200)
    assert.match(authorize.headers.get("content-type") ?? "", /application\/json/u)

    const token = await fetch(`${base}/iam/oauth2/token`, {
      method: "POST",
      headers: { ...serviceHeaders, authorization: "Basic dW5rbm93bjpiYWQ=", "content-type": "application/x-www-form-urlencoded" },
      body: "grant_type=refresh_token&refresh_token=invalid&resource=https%3A%2F%2Fkokoro.dev%2Fresources%2Fiam-internal",
    })
    assert.ok(token.status === 400 || token.status === 401)
    assert.notEqual(token.headers.get("content-type"), null)
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
})
