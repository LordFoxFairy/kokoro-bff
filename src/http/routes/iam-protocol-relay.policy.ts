/** BFF-owned browser-private relay policy; IAM owns the endpoint schemas. */
export const IAM_RELAY_POLICY = {
  version: "2.1.0",
  iamOwnerCommit: "b720b6dc095b883237682102ca0a87ed6451a968",
  iamAllowlistSha256: "f63dacfa8a7bcec3c56efb8ffb762a3f8bd82bb380eff40a1462db1e77d61ead",
  iamSnapshotSha256: "b2eac1919e16fdc30a40bee0f3c4300b641bd8f674214aea7731bf10299559e1",
  iamOpenapiPath: "contract/openapi/iam.internal.v1.json",
  iamOpenapiVersion: "0.5.0",
  iamOpenapiSha256: "cddfec4cd3439d98f399254911232c447582a97e9b1d4c109139e68baaf030b9",
  routes: {
    "/.well-known/openid-configuration": ["GET"],
    "/.well-known/oauth-authorization-server": ["GET"],
    "/jwks": ["GET"],
    "/oauth2/authorize": ["GET", "POST"],
    "/oauth2/token": ["POST"],
    "/oauth2/userinfo": ["GET"],
    "/oauth2/revoke": ["POST"],
    "/oauth2/end-session": ["GET", "POST"],
    "/oauth2/end-session/confirm": ["POST"],
    "/sign-up/email": ["POST"],
    "/sign-in/email": ["POST"],
    "/verify-email": ["GET"],
    "/sign-out": ["POST"],
    "/get-session": ["GET"],
    "/organization/set-active": ["POST"],
    "/oauth2/consent": ["POST"],
    "/oauth2/continue": ["POST"],
  },
  invitationRoutes: [
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
  ],
  invitationSignUp: {
    route: "/sign-up/email",
    method: "POST",
    bodyFields: ["callbackURL", "email", "name", "password"],
    callbackPath: "/iam/interactions/invitation",
    callbackQueryParameter: "id",
  },
  invitationLocation: {
    sourceRoute: "/verify-email",
    path: "/iam/interactions/invitation",
    queryParameter: "id",
    valueFormat: "canonical-lowercase-uuid",
    errorQueryParameter: "error",
    allowedErrorCodes: ["TOKEN_EXPIRED", "INVALID_TOKEN", "USER_NOT_FOUND", "INVALID_USER"],
  },
  requestHeaders: ["accept", "content-type", "origin", "cookie", "authorization", "x-request-id"],
  responseHeaders: ["content-type", "cache-control", "location", "retry-after", "content-security-policy", "x-content-type-options", "pragma", "x-request-id"],
  cookieNames: ["session_token", "session_data", "dont_remember", "session_token.oauth_logout_confirmation"],
  cookieNamePrefixes: ["kokoro-issuer.", "__Secure-kokoro-issuer."],
  cookiePaths: { default: "/iam", logoutConfirmation: "/iam/oauth2/end-session/confirm" },
  webInteractionPaths: ["/auth/sign-in", "/auth/select-tenant", "/auth/consent"],
  maxQueryBytes: 8192,
  maxRequestBodyBytes: 65536,
  maxHeaderBytes: 16384,
  maxResponseBytes: 1048576,
  maxDurationMs: 5000,
} as const

export type IamRelayRoute = keyof typeof IAM_RELAY_POLICY.routes
export type IamInvitationRelayAction = "context" | "accept" | "reject"
export type IamInvitationRelayRoute = Readonly<{
  path: string
  tenantId: string
  invitationId: string
  action: IamInvitationRelayAction
}>

const CANONICAL_INVITATION_UUID =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/u

export function isCanonicalInvitationUuid(value: string): boolean {
  return CANONICAL_INVITATION_UUID.test(value)
}

export function iamInvitationRelayRoute(rawTarget: string, method: string): IamInvitationRelayRoute | null {
  if (
    !rawTarget.startsWith("/iam/v1/tenants/") ||
    rawTarget.includes("?") ||
    rawTarget.includes("#") ||
    rawTarget.includes("%") ||
    rawTarget.includes("\\") ||
    rawTarget.includes("//") ||
    /[\u0000-\u001f\u007f]/u.test(rawTarget) ||
    rawTarget.endsWith("/")
  )
    return null
  const segments = rawTarget.slice("/iam/".length).split("/")
  if (segments.some((segment) => segment === "." || segment === "..")) return null
  if (segments.length !== 6 || segments[0] !== "v1" || segments[1] !== "tenants" || segments[3] !== "invitations") return null
  const tenantId = segments[2] ?? ""
  const invitationId = segments[4] ?? ""
  const action = segments[5]
  if (tenantId.length === 0 || Buffer.byteLength(tenantId) > 128 || !isCanonicalInvitationUuid(invitationId)) return null
  if (action !== "context" && action !== "accept" && action !== "reject") return null
  if ((action === "context" ? "GET" : "POST") !== method) return null
  return {
    path: rawTarget.slice("/iam".length),
    tenantId,
    invitationId,
    action,
  }
}

export function iamRelayRoute(rawTarget: string, method: string): { path: IamRelayRoute; query: string } | null {
  if (!rawTarget.startsWith("/iam/") || rawTarget.startsWith("//") || rawTarget.includes("#") || /[\\\u0000-\u001f\u007f]/u.test(rawTarget)) return null
  const question = rawTarget.indexOf("?")
  const path = question < 0 ? rawTarget : rawTarget.slice(0, question)
  const query = question < 0 ? "" : rawTarget.slice(question)
  if (Buffer.byteLength(query) > IAM_RELAY_POLICY.maxQueryBytes || /%(?![0-9a-fA-F]{2})/u.test(query)) return null
  if (path.includes("%") || path.includes("//") || path.includes("/./") || path.includes("/../") || path.endsWith("/")) return null
  const relative = path.slice("/iam".length) as IamRelayRoute
  const methods = IAM_RELAY_POLICY.routes[relative] as readonly string[] | undefined
  return methods?.includes(method) ? { path: relative, query } : null
}

export function iamRelayCookieName(name: string, secure: boolean): boolean {
  const prefix = IAM_RELAY_POLICY.cookieNamePrefixes[secure ? 1 : 0]
  if (!name.startsWith(prefix)) return false
  const suffix = name.slice(prefix.length)
  return (IAM_RELAY_POLICY.cookieNames as readonly string[]).includes(suffix)
}

/** Structural admission only: the IAM owner verifies the continuation signature. */
export function fixedTenantSetActiveBody(body: Buffer, tenantId: string): "valid" | "tenant_mismatch" | "invalid" {
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)) as unknown
  } catch {
    return "invalid"
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "invalid"
  const fields = value as Record<string, unknown>
  if (Object.keys(fields).sort().join(",") !== "oauth_query,organizationId") return "invalid"
  if (typeof fields.organizationId !== "string" || fields.organizationId.length === 0 || typeof fields.oauth_query !== "string") return "invalid"
  const query = fields.oauth_query
  if (
    query.length === 0 ||
    Buffer.byteLength(query) > IAM_RELAY_POLICY.maxQueryBytes ||
    /[?#\\\u0000-\u001f\u007f]/u.test(query) ||
    /%(?![0-9a-fA-F]{2})/u.test(query)
  )
    return "invalid"
  for (const pair of query.split("&")) if (pair.indexOf("=") < 1) return "invalid"
  const signatures = new URLSearchParams(query).getAll("sig")
  if (signatures.length !== 1 || signatures[0] === "") return "invalid"
  return fields.organizationId === tenantId ? "valid" : "tenant_mismatch"
}
