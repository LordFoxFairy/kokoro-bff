import { z } from "zod"

/** The only browser status representation; no framework Session or credential crosses it. */
export const browserAuthSessionData = z.discriminatedUnion("authenticated", [
  z.strictObject({ authenticated: z.literal(false) }),
  z.strictObject({
    authenticated: z.literal(true),
    subject: z.string().min(1),
    tenant_id: z.string().min(1),
    expires_at: z.iso.datetime(),
  }),
])
export const browserAuthSessionResponse = z.strictObject({ data: browserAuthSessionData })
export const browserAuthSessionPublicQuery = z.strictObject({ refresh: z.boolean().default(true) })
export const browserAuthSessionQuery = z
  .strictObject({
    refresh: z
      .enum(["true", "false"])
      .transform((value) => value === "true")
      .optional(),
  })
  .transform((value) => browserAuthSessionPublicQuery.parse(value))
export const BROWSER_AUTH_SESSION_POLICY = {
  profile: "browser-auth-session",
  version: "1.0.0",
  path: "/browser/v1/auth/session",
  operation_id: "getBrowserAuthSession",
  refresh_default: browserAuthSessionPublicQuery.parse({}).refresh,
  refresh_false: { disableCookieCache: true, disableRefresh: true },
  automatic_retries: false,
  errors: [
    { status: 400, code: "auth_session_request_invalid", message: "Authentication status request is invalid", retryable: false },
    { status: 403, code: "service_auth_failed", message: "Trusted browser service is required", retryable: false },
    { status: 403, code: "product_tenant_forbidden", message: "Product tenant is not permitted", retryable: false },
    { status: 403, code: "session_forbidden", message: "Current Product qualification is required", retryable: false },
    { status: 429, code: "session_rate_limited", message: "Authentication service is rate limited", retryable: true },
    { status: 503, code: "product_tenant_not_configured", message: "Product tenant is not configured", retryable: true },
    { status: 503, code: "iam_admission_unavailable", message: "Authentication service is unavailable", retryable: true },
  ],
} as const
export function browserAuthSessionError(status: number) {
  return z.union(
    BROWSER_AUTH_SESSION_POLICY.errors
      .filter((fault) => fault.status === status)
      .map((fault) =>
        z.strictObject({ error: z.strictObject({ code: z.literal(fault.code), message: z.literal(fault.message), retryable: z.literal(fault.retryable) }) }),
      ),
  )
}
