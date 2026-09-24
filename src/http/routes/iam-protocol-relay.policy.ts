/** BFF-owned browser-private relay policy; IAM owns the endpoint schemas. */
export const IAM_RELAY_POLICY = {
  version: "1.1.0",
  iamOwnerCommit: "b363554d07e5b6e182160b42ae1402330e55d9db",
  iamAllowlistSha256: "f63dacfa8a7bcec3c56efb8ffb762a3f8bd82bb380eff40a1462db1e77d61ead",
  iamSnapshotSha256: "b2eac1919e16fdc30a40bee0f3c4300b641bd8f674214aea7731bf10299559e1",
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
    "/sign-in/email": ["POST"],
    "/verify-email": ["GET"],
    "/sign-out": ["POST"],
    "/get-session": ["GET"],
    "/organization/list": ["GET"],
    "/organization/set-active": ["POST"],
    "/oauth2/consent": ["POST"],
    "/oauth2/continue": ["POST"],
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
