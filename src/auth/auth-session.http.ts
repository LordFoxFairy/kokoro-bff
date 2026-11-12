import type { IncomingMessage, ServerResponse } from "node:http"
import type { BffConfig } from "../config/runtime.js"
import type { SessionAdmission } from "./session-admission.types.js"
import { authenticateBrowserRequest, writeSessionCookies } from "./user-admission.js"
import { browserAuthSessionQuery, browserAuthSessionResponse, BROWSER_AUTH_SESSION_POLICY } from "./auth-session.contract.js"
import { requestId } from "../http/request.js"

const STATUS_RETIRED = Symbol("status observation retired")

/** One observation owns its wait, cancellation and listener lifetime, not the IAM operation. */
function statusScope(request: IncomingMessage, response: ServerResponse, durationMs: number) {
  const abort = new AbortController()
  const deadlineAt = performance.now() + durationMs
  let retired = false
  let disposed = false
  let disconnected = false
  let resolveRetirement!: (value: typeof STATUS_RETIRED) => void
  const retirement = new Promise<typeof STATUS_RETIRED>((resolve) => {
    resolveRetirement = resolve
  })
  const retire = (): void => {
    if (retired) return
    retired = true
    abort.abort()
    resolveRetirement(STATUS_RETIRED)
  }
  const canWrite = (): boolean => !disconnected && !request.aborted && !response.destroyed && !response.writableEnded
  const active = (): boolean => {
    if (!canWrite() || performance.now() >= deadlineAt) retire()
    return !retired && !disposed
  }
  const disconnect = (): void => {
    disconnected = true
    retire()
  }
  const closed = (): void => {
    if (!response.writableEnded) disconnect()
  }
  const timer = setTimeout(retire, durationMs)
  request.once("aborted", disconnect)
  response.once("close", closed)
  return {
    signal: abort.signal,
    active,
    canWrite,
    async wait<T>(work: () => Promise<T>): Promise<T | typeof STATUS_RETIRED> {
      if (!active()) return STATUS_RETIRED
      const result = await Promise.race([work(), retirement])
      return active() ? result : STATUS_RETIRED
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      clearTimeout(timer)
      request.removeListener("aborted", disconnect)
      response.removeListener("close", closed)
    },
  }
}

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
  const scope = statusScope(request, response, Math.min(config.upstreamTimeoutMs, 5000))
  const id = requestId(request)
  const fail = (status: number, code: string, retryAfter?: string): true => {
    if (!scope.canWrite()) return true
    const fault =
      BROWSER_AUTH_SESSION_POLICY.errors.find((value) => value.status === status && value.code === code) ??
      BROWSER_AUTH_SESSION_POLICY.errors.find((value) => value.code === "iam_admission_unavailable")!
    response.statusCode = fault.status
    if (retryAfter !== undefined) response.setHeader("retry-after", retryAfter)
    response.end(JSON.stringify({ error: { code: fault.code, message: fault.message, retryable: fault.retryable } }))
    return true
  }
  try {
    if (!scope.active()) return true
    response.setHeader("cache-control", "no-store")
    response.setHeader("x-request-id", id)
    response.setHeader("content-type", "application/json; charset=utf-8")
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
    const result = await scope.wait(() => authenticateBrowserRequest(request, config, admission, id, scope.signal, query.data.refresh))
    if (result === STATUS_RETIRED || !scope.active()) return fail(503, "iam_admission_unavailable")
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
    scope.dispose()
  }
}
