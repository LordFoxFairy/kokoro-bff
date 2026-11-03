import type { IncomingMessage, ServerResponse } from "node:http"
import type { BffConfig } from "../../config/runtime.js"
import type { RequestContext } from "../../domain/request-context.js"
import { nativeSessionCookie } from "../../auth/user-admission.js"
import { failure } from "../../contracts/index.js"
import { requestIamAccountSessions } from "../../infrastructure/clients/iam-account-sessions.js"
import { parseAccountSessionInput } from "../account-session-input.js"
import { send } from "../response.js"

/** Already-admitted Product request; IAM remains the only session mutation owner. */
export async function accountSessionsRoute(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  context: RequestContext,
  path: readonly string[],
): Promise<void> {
  const deadlineAt = performance.now() + Math.min(config.upstreamTimeoutMs, 5000)
  response.setHeader("x-request-id", context.requestId)
  const input = parseAccountSessionInput(request, path)
  if (input === null) {
    send(response, 400, failure("account_session_input_invalid", "Account session input is invalid", context.requestId))
    return
  }
  const abort = new AbortController()
  const onAbort = () => abort.abort()
  const onClose = () => {
    if (!response.writableEnded) abort.abort()
  }
  request.once("aborted", onAbort)
  response.once("close", onClose)
  if (request.aborted || response.destroyed) abort.abort()
  try {
    const cookie = nativeSessionCookie(request)
    const origin = config.iamWebOrigin ?? config.iamRelay?.webOrigin
    if (cookie === null || origin === undefined || origin === null) {
      send(response, 503, failure("account_sessions_unavailable", "account_sessions_unavailable", context.requestId))
      return
    }
    const ownerAuth = { cookie, origin, credentialFile: config.iamAccountSessionsServiceCredentialFile, tenantId: context.identity.namespace }
    const result = await requestIamAccountSessions({
      ...input,
      baseUrl: config.iamBaseUrl,
      ...ownerAuth,
      requestId: context.requestId,
      signal: abort.signal,
      deadlineAt,
      maxResponseBytes: config.upstreamMaxResponseBytes,
    })
    if (response.destroyed || abort.signal.aborted) return
    if (!result.ok) {
      send(response, result.status, failure(result.code, result.code, context.requestId), result.retryAfter)
      return
    }
    send(response, 200, { data: result.data, meta: { request_id: context.requestId, ...(input.kind === "list" ? { next_cursor: result.nextCursor } : {}) } })
  } finally {
    request.removeListener("aborted", onAbort)
    response.removeListener("close", onClose)
  }
}
