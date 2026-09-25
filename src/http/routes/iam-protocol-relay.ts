import { randomUUID } from "node:crypto"
import type { IncomingMessage, ServerResponse } from "node:http"
import { isDeepStrictEqual } from "node:util"
import { z } from "zod"

import type { BffConfig } from "../../config/runtime.js"
import { failure } from "../../contracts/index.js"
import type { ApiErrorResponse } from "../../generated/iam-http/types.gen.js"
import {
  zAcceptTenantInvitationResponse,
  zApiErrorResponse,
  zGetTenantInvitationContextResponse,
  zRejectTenantInvitationResponse,
} from "../../generated/iam-http/zod.gen.js"
import { send } from "../response.js"
import {
  IAM_RELAY_POLICY,
  fixedTenantSetActiveBody,
  iamInvitationRelayRoute,
  iamRelayCookieName,
  iamRelayRoute,
  isCanonicalInvitationUuid,
} from "./iam-protocol-relay.policy.js"
import { requestIamRelay, type IamRelayUpstream } from "./iam-protocol-relay.transport.js"

const LOGOUT_CSP = "default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"

type IamErrorCode = ApiErrorResponse["error"]["code"]

const INVITATION_ERROR_MESSAGES: Readonly<Record<IamErrorCode, string>> = {
  INVALID_ARGUMENT: "Invitation request was invalid",
  UNAUTHENTICATED: "Authentication is required",
  PERMISSION_DENIED: "Invitation request was not permitted",
  NOT_FOUND: "Invitation was not found",
  TENANT_NOT_FOUND: "Invitation was not found",
  MEMBER_NOT_FOUND: "Invitation was not found",
  ROLE_NOT_FOUND: "An invitation role was not found",
  ROLE_NAME_CONFLICT: "Invitation request conflicted with current role state",
  ROLE_IN_USE: "Invitation request conflicted with current role state",
  INVITATION_NOT_FOUND: "Invitation was not found",
  INVITATION_EXPIRED: "Invitation has expired",
  INVITATION_CONFLICT: "Invitation state changed",
  CONFLICT: "Invitation state changed",
  TENANT_DISABLED: "Tenant is unavailable",
  LAST_OWNER: "Invitation request was rejected",
  VERSION_MISMATCH: "Invitation state changed",
  PRECONDITION_REQUIRED: "Invitation state changed",
  PAYLOAD_TOO_LARGE: "Invitation request was invalid",
  RATE_LIMITED: "Too many invitation requests",
  DEPENDENCY_UNAVAILABLE: "Invitation service is unavailable",
  INTERNAL: "Invitation service is unavailable",
}

const SIGN_UP_SUCCESS_SCHEMA = z.strictObject({
  token: z.null().optional(),
  user: z.strictObject({
    id: z.string().min(1),
    email: z.email(),
    name: z.string(),
    image: z.url().nullable().optional(),
    emailVerified: z.literal(false),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
  }),
})
const SIGN_UP_REQUIRED_MESSAGE_ERROR_SCHEMA = z.strictObject({ message: z.string() })
const SIGN_UP_OPTIONAL_MESSAGE_ERROR_SCHEMA = z.strictObject({ message: z.string().optional() })

function rawHeader(request: IncomingMessage, name: string): string | null {
  const values: string[] = []
  for (let i = 0; i < request.rawHeaders.length; i += 2) {
    if (request.rawHeaders[i]?.toLowerCase() === name) values.push(request.rawHeaders[i + 1] ?? "")
  }
  return values.length === 1 ? (values[0] ?? null) : null
}

function hasRawHeader(request: IncomingMessage, name: string): boolean {
  for (let i = 0; i < request.rawHeaders.length; i += 2) if (request.rawHeaders[i]?.toLowerCase() === name) return true
  return false
}

function headerBytes(request: IncomingMessage): number {
  let bytes = 2
  for (const value of request.rawHeaders) bytes += Buffer.byteLength(value) + 4
  return bytes
}

function controlledRequestId(request: IncomingMessage): string {
  const raw = rawHeader(request, "x-request-id")
  return raw !== null && /^[A-Za-z0-9._:-]{1,128}$/u.test(raw) ? raw : randomUUID()
}

function replyFailure(response: ServerResponse, id: string, status: number, code: string): void {
  if (response.destroyed || response.writableEnded) return
  response.setHeader("x-request-id", id)
  response.setHeader("referrer-policy", "no-referrer")
  send(response, status, failure(code, "IAM relay request was rejected", id))
}

function filteredCookie(raw: string | null, secure: boolean, route: string): string | null {
  if (raw === null || raw === "") return ""
  const names = new Set<string>()
  const kept: string[] = []
  for (const part of raw.split(";")) {
    const pair = part.trim()
    const separator = pair.indexOf("=")
    if (separator < 1 || /[\u0000-\u001f\u007f]/u.test(pair)) return null
    const name = pair.slice(0, separator)
    if (!iamRelayCookieName(name, secure)) continue
    if (names.has(name)) return null
    names.add(name)
    if (name.endsWith(".oauth_logout_confirmation") && route !== "/oauth2/end-session/confirm") continue
    kept.push(pair)
  }
  return kept.join("; ")
}

function validAuthorization(route: string, value: string | null): boolean {
  if (route === "/oauth2/token" || route === "/oauth2/revoke") return value !== null && /^Basic [A-Za-z0-9+/]+={0,2}$/u.test(value)
  if (route === "/oauth2/userinfo") return value !== null && /^Bearer [^\s,]+$/u.test(value)
  return value === null
}

function safeHeaderValue(value: string, max = 4096): boolean {
  return value.length <= max && /^[\x20-\x7e]*$/u.test(value)
}

function invitationInteractionLocation(value: string, webOrigin: string): boolean {
  const prefix = `${webOrigin}${IAM_RELAY_POLICY.invitationLocation.path}?id=`
  if (!value.startsWith(prefix)) return false
  const remainder = value.slice(prefix.length)
  const separator = remainder.indexOf("&")
  const invitationId = separator < 0 ? remainder : remainder.slice(0, separator)
  if (!isCanonicalInvitationUuid(invitationId)) return false
  if (separator < 0) return true
  const error = remainder.slice(separator + 1)
  const errorPrefix = `${IAM_RELAY_POLICY.invitationLocation.errorQueryParameter}=`
  return error.startsWith(errorPrefix) && (IAM_RELAY_POLICY.invitationLocation.allowedErrorCodes as readonly string[]).includes(error.slice(errorPrefix.length))
}

function allowedLocation(value: string, config: NonNullable<BffConfig["iamRelay"]>, sourceRoute: string): boolean {
  if (!safeHeaderValue(value, 8192) || value.startsWith("//") || value.includes("\\") || value.includes("#")) return false
  if (!value.startsWith("/") && !/^https?:\/\//u.test(value)) return false
  const rawQuery = value.includes("?") ? value.slice(value.indexOf("?")) : ""
  if (Buffer.byteLength(rawQuery) > IAM_RELAY_POLICY.maxQueryBytes || /%(?![0-9a-fA-F]{2})/u.test(rawQuery)) return false
  try {
    const url = new URL(value, config.webOrigin)
    if (url.origin !== config.webOrigin || url.username !== "" || url.password !== "" || url.hash !== "" || url.pathname.includes("%")) return false
    if (sourceRoute === IAM_RELAY_POLICY.invitationLocation.sourceRoute && invitationInteractionLocation(value, config.webOrigin)) return true
    if ((IAM_RELAY_POLICY.webInteractionPaths as readonly string[]).includes(url.pathname)) return true
    if (url.pathname === new URL(config.callbackUri).pathname || url.pathname === new URL(config.postLogoutUri).pathname) return true
    if (!url.pathname.startsWith("/iam/")) return false
    return iamRelayRoute(`${url.pathname}${url.search}`, "GET") !== null
  } catch {
    return false
  }
}

function validSetCookie(value: string, config: NonNullable<BffConfig["iamRelay"]>): boolean {
  if (!safeHeaderValue(value, 8192)) return false
  const parts = value.split(";").map((part) => part.trim())
  const equal = parts[0]?.indexOf("=") ?? -1
  if (equal < 1) return false
  const name = parts[0]?.slice(0, equal) ?? ""
  if (!iamRelayCookieName(name, config.secureCookies)) return false
  const attributes = new Map<string, string>()
  for (const part of parts.slice(1)) {
    const index = part.indexOf("=")
    const key = (index < 0 ? part : part.slice(0, index)).toLowerCase()
    if (attributes.has(key)) return false
    attributes.set(key, index < 0 ? "" : part.slice(index + 1))
  }
  const expectedPath = name.endsWith(".oauth_logout_confirmation") ? IAM_RELAY_POLICY.cookiePaths.logoutConfirmation : IAM_RELAY_POLICY.cookiePaths.default
  return (
    attributes.get("path") === expectedPath &&
    attributes.has("httponly") &&
    attributes.get("samesite")?.toLowerCase() === "lax" &&
    !attributes.has("domain") &&
    (!config.secureCookies || attributes.has("secure"))
  )
}

function responseHeaders(
  upstream: IamRelayUpstream,
  config: NonNullable<BffConfig["iamRelay"]>,
  sourceRoute: string,
): Record<string, string | string[]> | null {
  if (!Number.isInteger(upstream.status) || upstream.status < 200 || upstream.status > 599) return null
  const headers: Record<string, string | string[]> = {}
  for (const name of IAM_RELAY_POLICY.responseHeaders) {
    const value = upstream.headers.get(name)
    if (value === null) continue
    if (!safeHeaderValue(value)) return null
    if (name === "location" && !allowedLocation(value, config, sourceRoute)) return null
    if (name === "retry-after" && (upstream.status !== 429 || !/^[1-9][0-9]{0,4}$/u.test(value) || Number(value) > 86400)) return null
    if (name === "content-security-policy" && value !== LOGOUT_CSP) return null
    if (name === "x-content-type-options" && value.toLowerCase() !== "nosniff") return null
    if (name === "pragma" && value.toLowerCase() !== "no-cache") return null
    headers[name] = value
  }
  if (upstream.status >= 300 && upstream.status < 400 && upstream.status !== 304 && headers.location === undefined) return null
  if (upstream.setCookies.some((value) => !validSetCookie(value, config))) return null
  if (upstream.setCookies.length > 0) headers["set-cookie"] = [...upstream.setCookies]
  return headers
}

async function readRequestBody(request: IncomingMessage, signal: AbortSignal): Promise<Buffer | null> {
  if (signal.aborted) return null
  return new Promise<Buffer | null>((resolve) => {
    const chunks: Buffer[] = []
    let bytes = 0
    const finish = (body: Buffer | null): void => {
      request.removeListener("data", onData)
      request.removeListener("end", onEnd)
      request.removeListener("error", onError)
      signal.removeEventListener("abort", onAbort)
      if (body === null) request.pause()
      resolve(body)
    }
    const onData = (value: Buffer): void => {
      bytes += value.length
      if (bytes > IAM_RELAY_POLICY.maxRequestBodyBytes) finish(null)
      else chunks.push(value)
    }
    const onEnd = (): void => finish(Buffer.concat(chunks))
    const onError = (): void => finish(null)
    const onAbort = (): void => finish(null)
    request.on("data", onData)
    request.once("end", onEnd)
    request.once("error", onError)
    signal.addEventListener("abort", onAbort, { once: true })
    if (signal.aborted) onAbort()
  })
}

function validInvitationSignUpBody(body: Buffer, webOrigin: string): boolean {
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)) as unknown
  } catch {
    return false
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false
  const fields = value as Record<string, unknown>
  if (Object.keys(fields).sort().join(",") !== "callbackURL,email,name,password") return false
  if (
    typeof fields.callbackURL !== "string" ||
    typeof fields.email !== "string" ||
    typeof fields.name !== "string" ||
    typeof fields.password !== "string" ||
    fields.email.length === 0 ||
    fields.name.length === 0 ||
    fields.password.length === 0
  )
    return false
  const prefix = `${webOrigin}${IAM_RELAY_POLICY.invitationSignUp.callbackPath}?${IAM_RELAY_POLICY.invitationSignUp.callbackQueryParameter}=`
  return fields.callbackURL.startsWith(prefix) && isCanonicalInvitationUuid(fields.callbackURL.slice(prefix.length))
}

function jsonBody(body: Buffer): unknown | null {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)) as unknown
  } catch {
    return null
  }
}

function jsonContentType(headers: Headers): boolean {
  const value = headers.get("content-type")
  return value !== null && /^application\/json(?:;\s*charset=utf-8)?$/iu.test(value)
}

function exactSchema(schema: { safeParse(value: unknown): { success: boolean; data?: unknown } }, value: unknown): boolean {
  const parsed = schema.safeParse(value)
  return parsed.success && isDeepStrictEqual(parsed.data, value)
}

function invitationResponseBody(upstream: IamRelayUpstream, action: "context" | "accept" | "reject"): Buffer | null {
  const statuses = new Set([200, 400, 401, 403, 404, 409, 429, 500, 503])
  if (!statuses.has(upstream.status) || !jsonContentType(upstream.headers) || upstream.headers.has("location") || upstream.setCookies.length !== 0) return null
  const value = jsonBody(upstream.body)
  if (value === null) return null
  if (upstream.status !== 200) {
    const parsed = zApiErrorResponse.safeParse(value)
    if (!parsed.success || !isDeepStrictEqual(parsed.data, value) || parsed.data.error.details.length !== 0) return null
    return Buffer.from(
      JSON.stringify({
        error: {
          code: parsed.data.error.code,
          message: INVITATION_ERROR_MESSAGES[parsed.data.error.code],
          retryable: parsed.data.error.retryable,
          details: [],
        },
      }),
    )
  }
  const schema =
    action === "context" ? zGetTenantInvitationContextResponse : action === "accept" ? zAcceptTenantInvitationResponse : zRejectTenantInvitationResponse
  return exactSchema(schema, value) ? upstream.body : null
}

function signUpErrorProjection(status: number): { code: string; message: string; requiredMessage: boolean } | null {
  switch (status) {
    case 400:
      return { code: "IAM_SIGN_UP_INVALID", message: "Invitation sign-up request was invalid", requiredMessage: true }
    case 401:
      return { code: "IAM_SIGN_UP_UNAUTHENTICATED", message: "Invitation sign-up authentication is required", requiredMessage: true }
    case 403:
      return { code: "IAM_SIGN_UP_FORBIDDEN", message: "Invitation sign-up was not permitted", requiredMessage: false }
    case 404:
      return { code: "IAM_SIGN_UP_NOT_FOUND", message: "Invitation sign-up endpoint was not found", requiredMessage: false }
    case 422:
      return { code: "IAM_SIGN_UP_REJECTED", message: "Invitation sign-up was rejected", requiredMessage: false }
    case 429:
      return { code: "IAM_SIGN_UP_RATE_LIMITED", message: "Too many invitation sign-up requests", requiredMessage: false }
    case 500:
      return { code: "IAM_SIGN_UP_UNAVAILABLE", message: "Invitation sign-up service is unavailable", requiredMessage: false }
    default:
      return null
  }
}

function signUpResponseBody(upstream: IamRelayUpstream): Buffer | null {
  if (
    ![200, 400, 401, 403, 404, 422, 429, 500].includes(upstream.status) ||
    !jsonContentType(upstream.headers) ||
    upstream.headers.has("location") ||
    upstream.setCookies.length !== 0
  )
    return null
  const value = jsonBody(upstream.body)
  if (value === null) return null
  if (upstream.status !== 200) {
    const projection = signUpErrorProjection(upstream.status)
    if (projection === null) return null
    const schema = projection.requiredMessage ? SIGN_UP_REQUIRED_MESSAGE_ERROR_SCHEMA : SIGN_UP_OPTIONAL_MESSAGE_ERROR_SCHEMA
    if (!exactSchema(schema, value)) return null
    return Buffer.from(JSON.stringify({ code: projection.code, message: projection.message }))
  }
  return exactSchema(SIGN_UP_SUCCESS_SCHEMA, value) ? upstream.body : null
}

/** Native IAM protocol exception; never enters user admission or BFF business stores. */
export async function iamProtocolRelay(request: IncomingMessage, response: ServerResponse, config: BffConfig): Promise<void> {
  const id = controlledRequestId(request)
  if (config.sharedSecret === null || config.iamBaseUrl === null || config.iamRelay === undefined) {
    replyFailure(response, id, 503, "iam_relay_unavailable")
    return
  }
  if (rawHeader(request, "x-kokoro-service") !== "web-bff" || rawHeader(request, "x-kokoro-internal-secret") !== config.sharedSecret) {
    replyFailure(response, id, 403, "service_auth_failed")
    return
  }
  const staticRoute = iamRelayRoute(request.url ?? "", request.method ?? "")
  const invitationRoute = iamInvitationRelayRoute(request.url ?? "", request.method ?? "")
  if (staticRoute === null && invitationRoute === null) {
    replyFailure(response, id, 404, "iam_relay_route_not_found")
    return
  }
  const routePath = staticRoute?.path ?? invitationRoute!.path
  const routeQuery = staticRoute?.query ?? ""
  const invitationAction = invitationRoute?.action ?? null
  const signUp = staticRoute?.path === IAM_RELAY_POLICY.invitationSignUp.route
  if ((staticRoute?.path === "/organization/set-active" || invitationRoute !== null) && config.tenantId === null) {
    replyFailure(response, id, 503, "product_tenant_not_configured")
    return
  }
  if (invitationRoute !== null && invitationRoute.tenantId !== config.tenantId) {
    replyFailure(response, id, 403, "product_tenant_forbidden")
    return
  }
  if (headerBytes(request) > IAM_RELAY_POLICY.maxHeaderBytes) {
    replyFailure(response, id, 413, "iam_relay_request_too_large")
    return
  }
  const authorization = rawHeader(request, "authorization")
  if (!validAuthorization(routePath, authorization) || (authorization === null && hasRawHeader(request, "authorization"))) {
    replyFailure(response, id, 403, "iam_relay_credential_rejected")
    return
  }
  if ((signUp || invitationRoute !== null) && hasRawHeader(request, "idempotency-key")) {
    replyFailure(response, id, 400, "iam_relay_header_invalid")
    return
  }
  const cookie = filteredCookie(rawHeader(request, "cookie"), config.iamRelay.secureCookies, routePath)
  if (cookie === null) {
    replyFailure(response, id, 400, "iam_relay_cookie_invalid")
    return
  }
  if (staticRoute?.path === "/organization/set-active" || invitationRoute !== null) {
    const sessionCookie = `${config.iamRelay.secureCookies ? "__Secure-" : ""}kokoro-issuer.session_token=`
    const session = cookie
      .split("; ")
      .find((part) => part.startsWith(sessionCookie))
      ?.slice(sessionCookie.length)
    if (session === undefined || session.length === 0 || /\s/u.test(session)) {
      replyFailure(response, id, 403, "iam_relay_credential_rejected")
      return
    }
  }
  if (signUp && cookie !== "") {
    replyFailure(response, id, 403, "iam_relay_cookie_rejected")
    return
  }
  if ((staticRoute?.path === "/oauth2/token" || staticRoute?.path === "/oauth2/revoke" || staticRoute?.path === "/oauth2/userinfo") && cookie !== "") {
    replyFailure(response, id, 403, "iam_relay_cookie_rejected")
    return
  }
  const origin = rawHeader(request, "origin")
  const browserMutation = request.method === "POST" && staticRoute?.path !== "/oauth2/token" && staticRoute?.path !== "/oauth2/revoke"
  if ((browserMutation || invitationRoute !== null) && origin !== config.iamRelay.webOrigin) {
    replyFailure(response, id, 403, "iam_relay_origin_rejected")
    return
  }
  if (!browserMutation && origin !== null && origin !== config.iamRelay.webOrigin) {
    replyFailure(response, id, 403, "iam_relay_origin_rejected")
    return
  }
  const abort = new AbortController()
  const budgetMs = Math.min(config.upstreamTimeoutMs, IAM_RELAY_POLICY.maxDurationMs)
  const deadline = Date.now() + budgetMs
  const timer = setTimeout(() => abort.abort("deadline"), budgetMs)
  const onAborted = (): void => abort.abort()
  const onClosed = (): void => {
    if (!response.writableEnded) abort.abort()
  }
  request.once("aborted", onAborted)
  response.once("close", onClosed)
  try {
    const body = await readRequestBody(request, abort.signal)
    if (abort.signal.aborted) {
      if (abort.signal.reason === "deadline") {
        response.shouldKeepAlive = false
        replyFailure(response, id, 503, "iam_relay_unavailable")
      }
      return
    }
    if (body === null) {
      response.shouldKeepAlive = false
      replyFailure(response, id, 413, "iam_relay_request_too_large")
      return
    }
    if (request.method === "GET" && body.length > 0) {
      replyFailure(response, id, 400, "iam_relay_body_rejected")
      return
    }
    if (staticRoute?.path === "/organization/set-active") {
      if (routeQuery !== "" || rawHeader(request, "content-type") !== "application/json") {
        replyFailure(response, id, 400, "iam_relay_body_rejected")
        return
      }
      const admission = fixedTenantSetActiveBody(body, config.tenantId!)
      if (admission !== "valid") {
        replyFailure(
          response,
          id,
          admission === "tenant_mismatch" ? 403 : 400,
          admission === "tenant_mismatch" ? "product_tenant_forbidden" : "iam_relay_body_rejected",
        )
        return
      }
    }
    if (signUp) {
      if (routeQuery !== "" || rawHeader(request, "content-type") !== "application/json" || !validInvitationSignUpBody(body, config.iamRelay.webOrigin)) {
        replyFailure(response, id, 400, "iam_relay_body_rejected")
        return
      }
    }
    if (invitationAction !== null && body.length !== 0) {
      replyFailure(response, id, 400, "iam_relay_body_rejected")
      return
    }
    const headers = new Headers()
    for (const name of ["accept", "content-type"] as const) {
      const value = rawHeader(request, name)
      if (value !== null) {
        if (!safeHeaderValue(value, 256)) {
          replyFailure(response, id, 400, "iam_relay_header_invalid")
          return
        }
        headers.set(name, value)
      }
    }
    if (origin !== null) headers.set("origin", origin)
    if (cookie !== "") headers.set("cookie", cookie)
    if (authorization !== null) headers.set("authorization", authorization)
    // Node fetch defaults to cors; IAM's native logout confirmation requires a navigation.
    // Synthesize this only after the fixed route/method admission, never from inbound headers.
    if (staticRoute?.path === "/oauth2/end-session" && request.method === "GET") headers.set("sec-fetch-mode", "navigate")
    headers.set("x-request-id", id)
    const upstream = await requestIamRelay({
      baseUrl: config.iamBaseUrl,
      rawTarget: `/iam${routePath}${routeQuery}`,
      method: request.method ?? "GET",
      headers,
      body,
      timeoutMs: Math.max(1, deadline - Date.now()),
      maxResponseBytes: config.upstreamMaxResponseBytes,
      signal: abort.signal,
      browserNavigation: staticRoute?.path === "/oauth2/end-session" && request.method === "GET",
    })
    if (abort.signal.aborted) {
      if (abort.signal.reason === "deadline") {
        response.shouldKeepAlive = false
        replyFailure(response, id, 503, "iam_relay_unavailable")
      }
      return
    }
    if (response.destroyed) return
    let outgoingBody = upstream.body
    if (invitationAction !== null) {
      const validated = invitationResponseBody(upstream, invitationAction)
      if (validated === null) {
        replyFailure(response, id, 502, "iam_relay_response_invalid")
        return
      }
      outgoingBody = validated
    }
    if (signUp) {
      const validated = signUpResponseBody(upstream)
      if (validated === null) {
        replyFailure(response, id, 502, "iam_relay_response_invalid")
        return
      }
      outgoingBody = validated
    }
    if (outgoingBody.length > config.upstreamMaxResponseBytes) {
      replyFailure(response, id, 502, "iam_relay_response_invalid")
      return
    }
    const outgoing = responseHeaders(upstream, config.iamRelay, routePath)
    if (outgoing === null) {
      replyFailure(response, id, 502, "iam_relay_response_invalid")
      return
    }
    if (staticRoute?.path === "/verify-email" || signUp || invitationRoute !== null) {
      outgoing["cache-control"] = "no-store"
      outgoing["referrer-policy"] = "no-referrer"
    }
    response.writeHead(upstream.status, {
      ...outgoing,
      "x-request-id": id,
      "content-length": outgoingBody.length,
    })
    response.end(outgoingBody)
  } catch {
    if (abort.signal.reason === "deadline") response.shouldKeepAlive = false
    replyFailure(response, id, 503, "iam_relay_unavailable")
  } finally {
    clearTimeout(timer)
    request.removeListener("aborted", onAborted)
    response.removeListener("close", onClosed)
  }
}
