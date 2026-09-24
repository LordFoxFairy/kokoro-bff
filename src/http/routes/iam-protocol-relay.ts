import { randomUUID } from "node:crypto"
import type { IncomingMessage, ServerResponse } from "node:http"

import type { BffConfig } from "../../config/runtime.js"
import { failure } from "../../contracts/index.js"
import { send } from "../response.js"
import { IAM_RELAY_POLICY, iamRelayCookieName, iamRelayRoute, type IamRelayRoute } from "./iam-protocol-relay.policy.js"
import { requestIamRelay, type IamRelayUpstream } from "./iam-protocol-relay.transport.js"

const LOGOUT_CSP = "default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"

function rawHeader(request: IncomingMessage, name: string): string | null {
  const values: string[] = []
  for (let i = 0; i < request.rawHeaders.length; i += 2) {
    if (request.rawHeaders[i]?.toLowerCase() === name) values.push(request.rawHeaders[i + 1] ?? "")
  }
  return values.length === 1 ? (values[0] ?? null) : null
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
  send(response, status, failure(code, "IAM relay request was rejected", id))
}

function filteredCookie(raw: string | null, secure: boolean, route: IamRelayRoute): string | null {
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

function validAuthorization(route: IamRelayRoute, value: string | null): boolean {
  if (route === "/oauth2/token" || route === "/oauth2/revoke") return value !== null && /^Basic [A-Za-z0-9+/]+={0,2}$/u.test(value)
  if (route === "/oauth2/userinfo") return value !== null && /^Bearer [^\s,]+$/u.test(value)
  return value === null
}

function safeHeaderValue(value: string, max = 4096): boolean {
  return value.length <= max && /^[\x20-\x7e]*$/u.test(value)
}

function allowedLocation(value: string, config: NonNullable<BffConfig["iamRelay"]>): boolean {
  if (!safeHeaderValue(value, 8192) || value.startsWith("//") || value.includes("\\") || value.includes("#")) return false
  if (!value.startsWith("/") && !/^https?:\/\//u.test(value)) return false
  const rawQuery = value.includes("?") ? value.slice(value.indexOf("?")) : ""
  if (Buffer.byteLength(rawQuery) > IAM_RELAY_POLICY.maxQueryBytes || /%(?![0-9a-fA-F]{2})/u.test(rawQuery)) return false
  try {
    const url = new URL(value, config.webOrigin)
    if (url.origin !== config.webOrigin || url.username !== "" || url.password !== "" || url.hash !== "" || url.pathname.includes("%")) return false
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

function responseHeaders(upstream: IamRelayUpstream, config: NonNullable<BffConfig["iamRelay"]>): Record<string, string | string[]> | null {
  if (!Number.isInteger(upstream.status) || upstream.status < 200 || upstream.status > 599) return null
  const headers: Record<string, string | string[]> = {}
  for (const name of IAM_RELAY_POLICY.responseHeaders) {
    const value = upstream.headers.get(name)
    if (value === null) continue
    if (!safeHeaderValue(value)) return null
    if (name === "location" && !allowedLocation(value, config)) return null
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
  const route = iamRelayRoute(request.url ?? "", request.method ?? "")
  if (route === null) {
    replyFailure(response, id, 404, "iam_relay_route_not_found")
    return
  }
  if (headerBytes(request) > IAM_RELAY_POLICY.maxHeaderBytes) {
    replyFailure(response, id, 413, "iam_relay_request_too_large")
    return
  }
  const authorization = rawHeader(request, "authorization")
  if (!validAuthorization(route.path, authorization)) {
    replyFailure(response, id, 403, "iam_relay_credential_rejected")
    return
  }
  const cookie = filteredCookie(rawHeader(request, "cookie"), config.iamRelay.secureCookies, route.path)
  if (cookie === null) {
    replyFailure(response, id, 400, "iam_relay_cookie_invalid")
    return
  }
  if ((route.path === "/oauth2/token" || route.path === "/oauth2/revoke" || route.path === "/oauth2/userinfo") && cookie !== "") {
    replyFailure(response, id, 403, "iam_relay_cookie_rejected")
    return
  }
  const origin = rawHeader(request, "origin")
  const browserMutation = request.method === "POST" && route.path !== "/oauth2/token" && route.path !== "/oauth2/revoke"
  if (browserMutation && origin !== config.iamRelay.webOrigin) {
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
    if (route.path === "/oauth2/end-session" && request.method === "GET") headers.set("sec-fetch-mode", "navigate")
    headers.set("x-request-id", id)
    const upstream = await requestIamRelay({
      baseUrl: config.iamBaseUrl,
      rawTarget: `/iam${route.path}${route.query}`,
      method: request.method ?? "GET",
      headers,
      body,
      timeoutMs: Math.max(1, deadline - Date.now()),
      maxResponseBytes: config.upstreamMaxResponseBytes,
      signal: abort.signal,
      browserNavigation: route.path === "/oauth2/end-session" && request.method === "GET",
    })
    if (abort.signal.aborted) {
      if (abort.signal.reason === "deadline") {
        response.shouldKeepAlive = false
        replyFailure(response, id, 503, "iam_relay_unavailable")
      }
      return
    }
    if (response.destroyed) return
    const outgoing = responseHeaders(upstream, config.iamRelay)
    if (outgoing === null) {
      replyFailure(response, id, 502, "iam_relay_response_invalid")
      return
    }
    response.writeHead(upstream.status, {
      ...outgoing,
      "x-request-id": id,
      "content-length": upstream.body.length,
    })
    response.end(upstream.body)
  } catch {
    if (abort.signal.reason === "deadline") response.shouldKeepAlive = false
    replyFailure(response, id, 503, "iam_relay_unavailable")
  } finally {
    clearTimeout(timer)
    request.removeListener("aborted", onAborted)
    response.removeListener("close", onClosed)
  }
}
