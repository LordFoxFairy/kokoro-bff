import { randomUUID } from "node:crypto"
import { z } from "zod"
import { zUser, zSession } from "../generated/iam-auth/zod.gen.js"
import { createIamHttpClient } from "../infrastructure/clients/iam-http-transport.js"
import { checkAuthorization } from "../generated/iam-http/sdk.gen.js"
import { iamUserContextHeaders } from "./iam-user-context.js"
import { zApiErrorResponse, zCheckAuthorizationResponse } from "../generated/iam-http/zod.gen.js"
import { strictParseRawJson } from "../infrastructure/raw-json.js"
import type { SessionAdmission, SessionAdmissionInput, SessionAdmissionResult } from "./session-admission.types.js"
import { SessionAdmissionTransport } from "./session-admission.transport.js"

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u
const responseSchema = z
  .strictObject({
    user: zUser.omit({ platformAdminVersion: true }).extend({ image: zUser.shape.image.nullable() }).strict(),
    session: zSession
      .extend({
        ipAddress: zSession.shape.ipAddress.nullable(),
        userAgent: zSession.shape.userAgent.nullable(),
        activeOrganizationId: zSession.shape.activeOrganizationId.nullable(),
      })
      .strict(),
  })
  .nullable()
const membershipSchema = zCheckAuthorizationResponse.extend({ data: zCheckAuthorizationResponse.shape.data.strict() }).strict()
const nativeRateLimitSchema = z.strictObject({ message: z.string().min(1) })
export type SessionAdmissionClientOptions = Readonly<{
  baseUrl: string | null
  credentialFile?: string | null | undefined
  webOrigin?: string | null | undefined
  tenantId?: string | null | undefined
  timeoutMs: number
  maxResponseBytes: number
}>
const unavailable = (): SessionAdmissionResult => ({ ok: false, status: 503, code: "iam_admission_unavailable" })
function safeCookies(headers: Headers, origin: string): string[] {
  const secure = new URL(origin).protocol === "https:"
  return headers.getSetCookie().filter((cookie) => {
    if (/[\r\n\x00]/u.test(cookie)) return false
    const [pair, ...attributes] = cookie.split(";").map((value) => value.trim())
    if (!/^(?:__Secure-)?kokoro-issuer\.(?:session_token|session_data|dont_remember)=[^;\r\n]*$/u.test(pair ?? "")) return false
    const names = attributes.map((value) => value.split("=", 1)[0]?.toLowerCase())
    if (new Set(names).size !== names.length || names.includes("domain")) return false
    if (!names.includes("httponly") || (secure && !names.includes("secure"))) return false
    if (!attributes.some((value) => /^path=\/$/iu.test(value))) return false
    return attributes.every((value) => /^(?:HttpOnly|Secure|Path=\/|SameSite=(?:Lax|Strict|None)|Max-Age=-?\d+|Expires=[\x20-\x7e]+)$/iu.test(value))
  })
}
function limited(headers: Headers): Extract<SessionAdmissionResult, { ok: false }> {
  const after = headers.get("retry-after")
  return {
    ok: false,
    status: 429,
    code: "session_rate_limited",
    ...(after !== null && /^[1-9][0-9]{0,4}$/u.test(after) && Number(after) <= 86400 ? { retryAfter: after } : {}),
  }
}

/** Sole native authentication edge. It discards framework secrets before ordinary business policy. */
export class SessionAdmissionClient implements SessionAdmission {
  private readonly transport: SessionAdmissionTransport | null
  private readonly membership: ReturnType<typeof createIamHttpClient> | null
  private readonly credentialFile: string | null
  private readonly webOrigin: string | null
  private readonly tenantId: string | null
  public constructor(options: SessionAdmissionClientOptions) {
    this.credentialFile = options.credentialFile ?? null
    this.membership = options.baseUrl === null ? null : createIamHttpClient({ ...options, baseUrl: options.baseUrl })
    this.webOrigin = options.webOrigin ?? null
    this.tenantId = options.tenantId ?? null
    this.transport = options.baseUrl === null ? null : new SessionAdmissionTransport({ ...options, baseUrl: options.baseUrl })
  }
  public async verify(input: SessionAdmissionInput): Promise<SessionAdmissionResult> {
    if (this.transport === null || this.membership === null || this.webOrigin === null || this.tenantId === null) return unavailable()
    if (input.origin !== this.webOrigin) return { ok: false, status: 403, code: "session_forbidden" }
    const requestId = REQUEST_ID_PATTERN.test(input.requestId) ? input.requestId : randomUUID()
    let setCookies: readonly string[] = []
    const dependencyUnavailable = (): SessionAdmissionResult => ({
      ok: false,
      status: 503,
      code: "iam_admission_unavailable",
      ...(setCookies.length ? { setCookies } : {}),
    })
    try {
      input.signal.throwIfAborted()
      const response = await this.transport.requestSession({ ...input, requestId })
      input.signal.throwIfAborted()
      const mediaType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase()
      const rateLimit = response.status === 429 ? limited(response.headers) : null
      // Better Auth's native limiter returns JSON as text/plain; IAM ingress exposes its delay as Retry-After.
      if (mediaType !== "application/json" && (mediaType !== "text/plain" || rateLimit?.retryAfter === undefined)) return dependencyUnavailable()
      const raw = strictParseRawJson(response.body)
      if (mediaType === "text/plain" && !nativeRateLimitSchema.safeParse(raw).success) return dependencyUnavailable()
      setCookies = safeCookies(response.headers, this.webOrigin)
      if (response.status === 401) {
        // Better Auth's human authentication failure, not a private service credential response.
        if (!z.strictObject({ message: z.string(), code: z.string().optional() }).safeParse(raw).success) return dependencyUnavailable()
        return { ok: false, status: 401, code: "session_invalid", setCookies }
      }
      if (rateLimit !== null) return { ...rateLimit, setCookies }
      if (response.status !== 200) return dependencyUnavailable()
      const parsed = responseSchema.safeParse(raw)
      if (!parsed.success) return dependencyUnavailable()
      if (parsed.data === null) return { ok: false, status: 401, code: "session_invalid", setCookies }
      const { user, session } = parsed.data
      if (!user.id || session.userId !== user.id || !session.id || !session.token || !Number.isFinite(Date.parse(session.expiresAt)))
        return dependencyUnavailable()
      if (Date.parse(session.expiresAt) <= Date.now()) return { ok: false, status: 401, code: "session_invalid", setCookies }
      if (session.activeOrganizationId !== this.tenantId) return { ok: false, status: 403, code: "product_tenant_forbidden", setCookies }
      // The framework authenticates the session; the existing IAM business operation owns current core membership.
      const qualified = await checkAuthorization({
        client: this.membership,
        body: { resource: "tenant", action: "read" },
        headers: {
          ...(await iamUserContextHeaders({
            tenantId: this.tenantId,
            subjectId: user.id,
            requestId,
            signal: input.signal,
            credentialFile: this.credentialFile,
          })),
          accept: "application/json",
          "x-request-id": requestId,
        },
        signal: input.signal,
        responseValidator: async (raw) => membershipSchema.parse(raw),
      })
      const checked = qualified.response
      if (checked === undefined) return dependencyUnavailable()
      input.signal.throwIfAborted()
      if (
        checked.headers.get("x-request-id") !== requestId ||
        !checked.headers
          .get("cache-control")
          ?.split(",")
          .some((value) => value.trim().toLowerCase() === "no-store") ||
        checked.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json"
      )
        return dependencyUnavailable()
      const decision: unknown = checked.status === 200 ? qualified.data : qualified.error
      if (checked.status !== 200) {
        const error = zApiErrorResponse.safeParse(decision)
        if (!error.success) return dependencyUnavailable()
        if (checked.status === 429 && error.data.error.code === "RATE_LIMITED") return { ...limited(checked.headers), setCookies }
        if (checked.status === 403 && error.data.error.code === "PERMISSION_DENIED") return { ok: false, status: 403, code: "session_forbidden", setCookies }
        return dependencyUnavailable()
      }
      const member = membershipSchema.safeParse(decision)
      if (
        !member.success ||
        member.data.data.tenant_id !== this.tenantId ||
        member.data.data.subject_id !== user.id ||
        member.data.data.decision_source !== "current_membership"
      )
        return dependencyUnavailable()
      if (!member.data.data.allowed) return { ok: false, status: 403, code: "session_forbidden", setCookies }
      return {
        ok: true,
        identity: { namespace: this.tenantId, userId: user.id },
        platformAdmin: user.platformAdmin,
        expiresAt: new Date(session.expiresAt).toISOString(),
        setCookies,
      }
    } catch {
      return dependencyUnavailable()
    }
  }
}
