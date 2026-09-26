import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { test } from "node:test"

import * as relayPolicy from "../dist/http/routes/iam-protocol-relay.policy.js"
import * as iamSdk from "../dist/generated/iam-http/sdk.gen.js"
import * as iamZod from "../dist/generated/iam-http/zod.gen.js"
import { loadConfig } from "../dist/config/runtime.js"

const { IAM_RELAY_POLICY, iamRelayCookieName, iamRelayRoute } = relayPolicy

test("published browser-private policy is a deterministic read-only projection of runtime policy", async () => {
  const bytes = await readFile(new URL("../contract/iam-relay-policy.json", import.meta.url))
  const published = JSON.parse(bytes.toString("utf8")) as unknown
  assert.deepEqual(published, IAM_RELAY_POLICY)
  assert.equal(createHash("sha256").update(bytes).digest("hex"), "ed476b63205c0eaf59106dc618c138df6110ef6240ce2be50b417fea8ec800e4")
  const oldProjection = {
    ...IAM_RELAY_POLICY,
    iamOwnerCommit: "5c9cecf714c87234bbc9558665b23e09afa6e9f6",
    iamOpenapiVersion: "0.4.0",
    iamOpenapiSha256: "05ff7ff712ce06571ca5e092fdaf234b9ee4d1b4978c54e0d54d2b50fe51dde2",
  }
  assert.equal(
    createHash("sha256")
      .update(`${JSON.stringify(oldProjection, null, 2)}\n`)
      .digest("hex"),
    "7bb829c988908804d0c3cac0cb023a6c247af6b0b4a55e8baf90b39d795f7118",
    "relay semantics must remain byte-identical after restoring previous owner provenance",
  )
  assert.equal(IAM_RELAY_POLICY.version, "2.1.0")
  assert.equal(IAM_RELAY_POLICY.iamOpenapiVersion, "0.5.0")
  assert.equal(IAM_RELAY_POLICY.iamOwnerCommit, "b720b6dc095b883237682102ca0a87ed6451a968")
  assert.equal(IAM_RELAY_POLICY.iamAllowlistSha256, "f63dacfa8a7bcec3c56efb8ffb762a3f8bd82bb380eff40a1462db1e77d61ead")
  assert.equal(
    (IAM_RELAY_POLICY as unknown as { iamOpenapiSha256?: string }).iamOpenapiSha256,
    "cddfec4cd3439d98f399254911232c447582a97e9b1d4c109139e68baaf030b9",
  )
  assert.deepEqual((IAM_RELAY_POLICY.routes as Record<string, readonly string[]>)["/sign-up/email"], ["POST"])
  assert.equal(
    Object.keys(IAM_RELAY_POLICY.routes).some((route) => route.includes("execution-authorizations")),
    false,
  )
  assert.deepEqual((IAM_RELAY_POLICY as unknown as { invitationRoutes?: unknown }).invitationRoutes, [
    {
      template: "/v1/tenants/{tenant_id}/invitations/{invitation_id}/context",
      methods: ["GET"],
      operationId: "getTenantInvitationContext",
      owner: "kokoro-iam",
      visibility: "browser-private",
      stability: "stable",
      idempotency: "none",
    },
    {
      template: "/v1/tenants/{tenant_id}/invitations/{invitation_id}/accept",
      methods: ["POST"],
      operationId: "acceptTenantInvitation",
      owner: "kokoro-iam",
      visibility: "browser-private",
      stability: "stable",
      idempotency: "none",
    },
    {
      template: "/v1/tenants/{tenant_id}/invitations/{invitation_id}/reject",
      methods: ["POST"],
      operationId: "rejectTenantInvitation",
      owner: "kokoro-iam",
      visibility: "browser-private",
      stability: "stable",
      idempotency: "none",
    },
  ])
  assert.deepEqual((IAM_RELAY_POLICY as unknown as { invitationLocation?: unknown }).invitationLocation, {
    sourceRoute: "/verify-email",
    path: "/iam/interactions/invitation",
    queryParameter: "id",
    valueFormat: "canonical-lowercase-uuid",
    errorQueryParameter: "error",
    allowedErrorCodes: ["TOKEN_EXPIRED", "INVALID_TOKEN", "USER_NOT_FOUND", "INVALID_USER"],
  })
})

test("vendored IAM 0.5.0 contract and generated-client manifest pin the execution owner bytes", async () => {
  const ownerCommit = "b720b6dc095b883237682102ca0a87ed6451a968"
  const expectedDigest = "cddfec4cd3439d98f399254911232c447582a97e9b1d4c109139e68baaf030b9"
  const vendor = await readFile(new URL(`../contract/vendor/kokoro-iam/${ownerCommit}/iam.internal.v1.json`, import.meta.url)).catch(() => null)
  assert.notEqual(vendor, null)
  assert.equal(createHash("sha256").update(vendor!).digest("hex"), expectedDigest)
  const oldVendor = await readFile(
    new URL("../contract/vendor/kokoro-iam/5c9cecf714c87234bbc9558665b23e09afa6e9f6/iam.internal.v1.json", import.meta.url),
  ).catch(() => null)
  assert.equal(oldVendor, null, "old owner vendor path must be removed")
  const contract = JSON.parse(vendor!.toString("utf8")) as { info?: { version?: string } }
  assert.equal(contract.info?.version, "0.5.0")
  const manifest = JSON.parse(await readFile(new URL("../contract/dependencies/iam-http.json", import.meta.url), "utf8")) as {
    owner?: { repository_commit?: string; contract_version?: string; contract_sha256?: string }
  }
  assert.deepEqual(manifest.owner, {
    repository_path: "apps/kokoro-iam",
    repository_commit: ownerCommit,
    contract_version: "0.5.0",
    contract_path: "contract/openapi/iam.internal.v1.json",
    contract_sha256: expectedDigest,
  })
})

test("generated IAM client exposes only the three browser-private invitation operations added by 0.4.0", () => {
  const sdk = iamSdk as unknown as Record<string, unknown>
  const zod = iamZod as unknown as Record<string, unknown>
  for (const operation of ["getTenantInvitationContext", "acceptTenantInvitation", "rejectTenantInvitation"]) {
    assert.equal(typeof sdk[operation], "function", operation)
  }
  for (const schema of ["zGetTenantInvitationContextResponse", "zAcceptTenantInvitationResponse", "zRejectTenantInvitationResponse"]) {
    assert.equal(typeof zod[schema], "object", schema)
  }
})

test("execution authorization stays outside the BFF generated client and browser-private relay", () => {
  assert.equal((iamSdk as Record<string, unknown>).verifyExecutionAuthorization, undefined)
  assert.equal((iamZod as Record<string, unknown>).zVerifyExecutionAuthorizationBody, undefined)
  assert.equal((IAM_RELAY_POLICY as { routes: Record<string, unknown> }).routes["/internal/v1/execution-authorizations/verify"], undefined)
})

test("invitation matcher accepts only the three exact owner routes with canonical IDs", () => {
  const match = (relayPolicy as unknown as { iamInvitationRelayRoute?: (target: string, method: string) => unknown }).iamInvitationRelayRoute
  const tenant = "tenant-fixed"
  const invitation = "123e4567-e89b-42d3-a456-426614174000"
  assert.deepEqual(match?.(`/iam/v1/tenants/${tenant}/invitations/${invitation}/context`, "GET"), {
    path: `/v1/tenants/${tenant}/invitations/${invitation}/context`,
    tenantId: tenant,
    invitationId: invitation,
    action: "context",
  })
  assert.deepEqual(match?.(`/iam/v1/tenants/${tenant}/invitations/${invitation}/accept`, "POST"), {
    path: `/v1/tenants/${tenant}/invitations/${invitation}/accept`,
    tenantId: tenant,
    invitationId: invitation,
    action: "accept",
  })
  assert.deepEqual(match?.(`/iam/v1/tenants/${tenant}/invitations/${invitation}/reject`, "POST"), {
    path: `/v1/tenants/${tenant}/invitations/${invitation}/reject`,
    tenantId: tenant,
    invitationId: invitation,
    action: "reject",
  })
  for (const [target, method] of [
    [`/iam/v1/tenants/${tenant}/invitations/${invitation}/context`, "POST"],
    [`/iam/v1/tenants/${tenant}/invitations/${invitation.toUpperCase()}/context`, "GET"],
    [`/iam/v1/tenants/${tenant}/invitations/${invitation}/accept?next=x`, "POST"],
    [`/iam/v1/tenants/${tenant}/invitations/${invitation}/accept/`, "POST"],
    [`/iam/v1/tenants/${tenant}/invitations/${invitation}/resend`, "POST"],
    [`/iam/v1/tenants/${tenant}/invitations/%31${invitation.slice(1)}/context`, "GET"],
    [`/iam/v1/tenants/./invitations/${invitation}/context`, "GET"],
    [`/iam/v1/tenants/../invitations/${invitation}/context`, "GET"],
    [`/iam/v1/tenants/${tenant}/./${invitation}/context`, "GET"],
    [`/iam/v1/tenants/${tenant}/invitations/${invitation}/context/.`, "GET"],
    [`/iam/v1/tenants/${tenant}/invitations/${invitation}/context/..`, "GET"],
    [`/iam/v1/tenants/${tenant}/invitations/123e4567-e89b-02d3-a456-426614174000/context`, "GET"],
    [`/iam/v1/tenants/${tenant}/invitations/123e4567-e89b-42d3-7456-426614174000/context`, "GET"],
  ] as const) {
    assert.equal(match?.(target, method) ?? null, null, target)
  }
  for (const special of ["00000000-0000-0000-0000-000000000000", "ffffffff-ffff-ffff-ffff-ffffffffffff"]) {
    assert.equal((match?.(`/iam/v1/tenants/${tenant}/invitations/${special}/context`, "GET") as { invitationId?: string } | null)?.invitationId, special)
  }
})

test("relay route matrix is exact and never treats aliases as owner paths", () => {
  assert.equal(iamRelayRoute("/iam/organization/list", "GET"), null)
  assert.equal(iamRelayRoute("/iam/organization/set-active", "POST")?.path, "/organization/set-active")
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
