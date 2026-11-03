import type { IncomingMessage, ServerResponse } from "node:http"
import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import { authorizeUserRequest } from "../../auth/user-admission.js"
import { failure } from "../../contracts/index.js"
import { pathOf, requestId } from "../request.js"
import { send } from "../response.js"
import { messageFeedbackRoute, MessageFeedbackAdmissionError, type MessageFeedbackProvider } from "./message-feedback.js"

export function isMessageFeedbackRequest(request: IncomingMessage): boolean {
  const path = (request.url ?? "").split("?", 1)[0] ?? ""
  return /^\/v1\/sessions\/[^/]+\/messages\/[^/]+\/feedback$/u.test(path)
}

/** Chat-owned message feedback adapter with one bounded admission/read/write/re-admission budget. */
export async function handleMessageFeedbackRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  admission: SessionAdmission,
  provider: MessageFeedbackProvider | null,
): Promise<boolean> {
  if (!isMessageFeedbackRequest(request)) return false
  const id = requestId(request)
  response.setHeader("x-request-id", id)
  const abort = new AbortController()
  const deadlineAt = performance.now() + Math.min(config.upstreamTimeoutMs, 10_000)
  const timer = setTimeout(() => abort.abort(), Math.max(0, deadlineAt - performance.now()))
  const onAborted = (): void => abort.abort()
  const onClosed = (): void => {
    if (!response.writableEnded) abort.abort()
  }
  request.once("aborted", onAborted)
  response.once("close", onClosed)
  try {
    const admitted = await authorizeUserRequest(request, config, admission, id, abort.signal, response)
    if (!admitted.ok) {
      send(response, admitted.status, failure(admitted.code, "BFF user admission failed", id), admitted.retryAfter)
      return true
    }
    await messageFeedbackRoute(request, response, admitted.context, pathOf(request).slice(1), provider, deadlineAt, async (signal) => {
      const fresh = await authorizeUserRequest(request, config, admission, id, signal, response)
      if (!fresh.ok) throw new MessageFeedbackAdmissionError(fresh.status, fresh.code, fresh.retryAfter)
      if (fresh.context.identity.namespace !== admitted.context.identity.namespace || fresh.context.identity.userId !== admitted.context.identity.userId)
        throw new MessageFeedbackAdmissionError(404, "message_not_found")
    })
    return true
  } catch {
    if (!response.headersSent && !response.writableEnded && !response.destroyed)
      send(response, 503, failure("message_feedback_unavailable", "Message feedback request failed", id))
    return true
  } finally {
    clearTimeout(timer)
    request.removeListener("aborted", onAborted)
    response.removeListener("close", onClosed)
  }
}
