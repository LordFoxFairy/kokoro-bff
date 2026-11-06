import type { IncomingMessage, ServerResponse } from "node:http"
import type { BffConfig } from "../config/runtime.js"
import type { SessionAdmission } from "./session-admission.types.js"
import { authenticateBrowserRequest, writeSessionCookies } from "./user-admission.js"
import { browserAuthSessionQuery, browserAuthSessionResponse, BROWSER_AUTH_SESSION_POLICY } from "./auth-session.contract.js"
import { requestId } from "../http/request.js"

export function isBrowserAuthSessionRequest(request: IncomingMessage): boolean {
  return (request.url ?? "").split("?", 1)[0] === BROWSER_AUTH_SESSION_POLICY.path
}
export async function handleBrowserAuthSessionRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  admission: SessionAdmission,
): Promise<boolean> {
  if (!isBrowserAuthSessionRequest(request)) return false
  const id = requestId(request)
  response.setHeader("cache-control", "no-store")
  response.setHeader("x-request-id", id)
  response.setHeader("content-type", "application/json; charset=utf-8")
  const fail = (status: number, code: string, retryAfter?: string): true => {
    const fault =
      BROWSER_AUTH_SESSION_POLICY.errors.find((value) => value.status === status && value.code === code) ??
      BROWSER_AUTH_SESSION_POLICY.errors.find((value) => value.code === "iam_admission_unavailable")!
    response.statusCode = fault.status
    if (retryAfter !== undefined) response.setHeader("retry-after", retryAfter)
    response.end(JSON.stringify({ error: { code: fault.code, message: fault.message, retryable: fault.retryable } }))
    return true
  }
  const url = new URL(request.url ?? "", "http://bff.invalid")
  if (
    request.method !== "GET" ||
    request.headers["transfer-encoding"] !== undefined ||
    (request.headers["content-length"] !== undefined && request.headers["content-length"] !== "0") ||
    url.searchParams.getAll("refresh").length > 1
  )
    return fail(400, "auth_session_request_invalid")
  const query = browserAuthSessionQuery.safeParse(Object.fromEntries(url.searchParams))
  if (!query.success) return fail(400, "auth_session_request_invalid")
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), Math.min(config.upstreamTimeoutMs, 5000))
  const cancel = (): void => {
    if (!response.writableEnded) abort.abort()
  }
  request.once("aborted", cancel)
  response.once("close", cancel)
  try {
    const result = await authenticateBrowserRequest(request, config, admission, id, abort.signal, query.data.refresh)
    abort.signal.throwIfAborted()
    writeSessionCookies(response, result.setCookies)
    if (!result.ok && result.status !== 401) return fail(result.status, result.code, result.retryAfter)
    const data = result.ok
      ? { authenticated: true, subject: result.identity.userId, tenant_id: result.identity.namespace, expires_at: result.expiresAt }
      : { authenticated: false }
    const output = browserAuthSessionResponse.safeParse({ data })
    if (!output.success) return fail(503, "iam_admission_unavailable")
    response.statusCode = 200
    response.end(JSON.stringify(output.data))
    return true
  } catch {
    return fail(503, "iam_admission_unavailable")
  } finally {
    clearTimeout(timer)
    request.removeListener("aborted", cancel)
    response.removeListener("close", cancel)
  }
}
