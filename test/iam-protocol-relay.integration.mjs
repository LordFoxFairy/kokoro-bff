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

test("BFF preserves native sign-in, session and sign-out over HTTP", async () => {
  const config = loadConfig({
    KOKORO_BFF_SHARED_SECRET: "test-secret",
    KOKORO_BFF_POSTGRES_URL: "postgresql://localhost/unused_bff_relay_fixture?schema=kokoro_bff",
    KOKORO_BFF_REDIS_URL: "redis://localhost:6379/8",
    KOKORO_IAM_BASE_URL: ownerBase,
    KOKORO_IAM_WEB_ORIGIN: webOrigin,
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

    const session = await fetch(`${base}/iam/get-session`, {
      headers: { ...serviceHeaders, cookie: `authjs.session-token=never-forward; ${cookie}` },
    })
    assert.equal(session.status, 200)
    assert.equal((await session.json()).user.email, "owner@example.test")

    const signedOut = await fetch(`${base}/iam/sign-out`, {
      method: "POST",
      headers: { ...serviceHeaders, origin: webOrigin, cookie },
      redirect: "manual",
    })
    assert.ok([200, 204, 401, 303, 307].includes(signedOut.status))
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
})
