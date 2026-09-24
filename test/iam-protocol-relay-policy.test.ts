import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { test } from "node:test"

import { IAM_RELAY_POLICY, iamRelayCookieName, iamRelayRoute } from "../dist/http/routes/iam-protocol-relay.policy.js"
import { loadConfig } from "../dist/config/runtime.js"

test("published browser-private policy is a deterministic read-only projection of runtime policy", async () => {
  const published = JSON.parse(await readFile(new URL("../contract/iam-relay-policy.json", import.meta.url), "utf8")) as unknown
  assert.deepEqual(published, IAM_RELAY_POLICY)
  assert.equal(IAM_RELAY_POLICY.version, "1.1.0")
  assert.equal(IAM_RELAY_POLICY.iamOwnerCommit, "e36da9ecf8d62a364182949817431a8e2329d50a")
  assert.equal(IAM_RELAY_POLICY.iamAllowlistSha256, "f63dacfa8a7bcec3c56efb8ffb762a3f8bd82bb380eff40a1462db1e77d61ead")
})

test("relay route matrix is exact and never treats aliases as owner paths", () => {
  const verificationQuery = "?token=opaque%2B%2F%3D&callbackURL=http%3A%2F%2Fweb.example.test%2Fauth%2Fsign-in&x=one&x=two"
  assert.deepEqual(iamRelayRoute(`/iam/verify-email${verificationQuery}`, "GET"), {
    path: "/verify-email",
    query: verificationQuery,
  })
  assert.equal(iamRelayRoute("/iam/verify-email", "POST"), null)
  assert.equal(iamRelayRoute("/iam/%76erify-email?token=opaque", "GET"), null)
  assert.deepEqual(iamRelayRoute("/iam/oauth2/authorize?client_id=a&ba_param=scope&ba_param=state", "GET"), {
    path: "/oauth2/authorize",
    query: "?client_id=a&ba_param=scope&ba_param=state",
  })
  for (const path of [
    "/iam/oauth2/authorize/",
    "/iam/oauth2/%61uthorize",
    "/iam//oauth2/authorize",
    "/iam/oauth2/../authorize",
    "/iam/internal/v1/users",
    "/iam/oauth2/register",
  ]) {
    assert.equal(iamRelayRoute(path, "GET"), null, path)
  }
  assert.equal(iamRelayRoute("/iam/oauth2/token", "GET"), null)
  assert.equal(iamRelayRoute("/iam/oauth2/token", "POST")?.path, "/oauth2/token")
})

test("only the locked issuer cookie names pass in their deployment mode", () => {
  assert.equal(iamRelayCookieName("kokoro-issuer.session_token", false), true)
  assert.equal(iamRelayCookieName("__Secure-kokoro-issuer.session_token", true), true)
  assert.equal(iamRelayCookieName("kokoro-issuer.session_token", true), false)
  assert.equal(iamRelayCookieName("kokoro-issuer.evil", false), false)
  assert.equal(iamRelayCookieName("authjs.session-token", false), false)
})

test("relay URL configuration rejects partial settings and callback authority aliases", () => {
  const base = {
    KOKORO_BFF_SHARED_SECRET: "test-secret",
    KOKORO_BFF_POSTGRES_URL: "postgresql://localhost/unused?schema=kokoro_bff",
    KOKORO_BFF_REDIS_URL: "redis://localhost:6379/8",
    KOKORO_IAM_ISSUER_URL: "https://web.example.test/iam",
    KOKORO_IAM_WEB_ORIGIN: "https://web.example.test",
    KOKORO_IAM_WEB_CALLBACK_URI: "https://web.example.test/api/auth/callback/kokoro-iam",
    KOKORO_IAM_WEB_POST_LOGOUT_URI: "https://web.example.test/auth/sign-in",
  }
  assert.equal(loadConfig(base).iamRelay?.callbackUri, base.KOKORO_IAM_WEB_CALLBACK_URI)
  assert.throws(() => loadConfig({ ...base, KOKORO_IAM_WEB_CALLBACK_URI: undefined }), /IAM relay requires/u)
  assert.throws(
    () =>
      loadConfig({
        ...base,
        KOKORO_IAM_WEB_CALLBACK_URI: "https://user:pass@web.example.test/api/auth/callback/kokoro-iam",
      }),
    /IAM relay URLs/u,
  )
  assert.throws(
    () =>
      loadConfig({
        ...base,
        KOKORO_IAM_WEB_CALLBACK_URI: "https://web.example.test/api/auth/callback/kokoro-iam?next=evil",
      }),
    /IAM relay URLs/u,
  )
  assert.throws(
    () =>
      loadConfig({
        ...base,
        KOKORO_IAM_ISSUER_URL: "https://other.example.test/iam",
      }),
    /IAM relay URLs/u,
  )
})
