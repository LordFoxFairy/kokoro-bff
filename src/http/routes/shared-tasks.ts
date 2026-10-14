import type { IncomingMessage, ServerResponse } from "node:http"
import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import type { ChatApplicationService } from "../../application/chat-service.js"
import { authorizeUserRequest } from "../../auth/user-admission.js"
import { parseSharedTasksInput, decodeSharedTasksCursor, encodeSharedTasksCursor, sharedTasksPageValid } from "../shared-tasks-input.js"
import { send } from "../response.js"

export async function sharedTasksRoute(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  admission: SessionAdmission,
  chat: ChatApplicationService | undefined,
  requestId: string,
): Promise<void> {
  const deadlineAt = performance.now() + Math.min(config.upstreamTimeoutMs, 10000)
  const controller = new AbortController()
  let reject!: (error: Error) => void
  const interruption = new Promise<never>((_, fail) => {
    reject = fail
  })
  const stop = () => {
    controller.abort()
    reject(new Error("shared_tasks_retired"))
  }
  const timer = setTimeout(stop, Math.max(0, deadlineAt - performance.now()))
  const close = () => {
    if (!response.writableEnded) stop()
  }
  response.once("close", close)
  request.once("aborted", stop)
  response.setHeader("x-request-id", requestId)
  response.setHeader("cache-control", "no-store")
  const active = () => {
    if (controller.signal.aborted || request.aborted || response.destroyed || performance.now() >= deadlineAt) throw new Error("shared_tasks_retired")
  }
  const fail = (status: number, code: string, retryAfter?: string) => {
    if (!response.destroyed && !response.writableEnded)
      send(response, status, { error: { code, message: code, retryable: status === 429 || status === 503 } }, status === 429 ? retryAfter : undefined)
  }
  try {
    active()
    const input = parseSharedTasksInput(request)
    const admitted = await Promise.race([authorizeUserRequest(request, config, admission, requestId, controller.signal), interruption])
    active()
    if (!admitted.ok) {
      const allowed: Record<number, readonly string[]> = {
        401: ["session_authentication_required", "session_invalid"],
        403: ["service_auth_failed", "session_forbidden", "product_tenant_forbidden"],
        429: ["session_rate_limited"],
        503: ["product_tenant_not_configured", "iam_admission_unavailable"],
      }
      if (allowed[admitted.status]?.includes(admitted.code)) fail(admitted.status, admitted.code, admitted.retryAfter)
      else fail(503, "shared_tasks_unavailable")
      return
    }
    const { namespace: tenantId, userId: subjectId } = admitted.context.identity
    const position = decodeSharedTasksCursor(input.cursor, tenantId, subjectId, input.limit)
    active()
    if (!chat) {
      fail(503, "shared_tasks_unavailable")
      return
    }
    const result = await Promise.race([chat.listOwnedSharedTasks(tenantId, subjectId, input.limit, position, controller.signal, deadlineAt), interruption])
    active()
    let nextCursor: string | null = null
    try {
      if (result.nextPosition !== null) nextCursor = encodeSharedTasksCursor(result.nextPosition, tenantId, subjectId, input.limit)
    } catch {
      throw new Error("shared_tasks_output_invalid")
    }
    const page = { items: result.items, next_cursor: nextCursor }
    if (!sharedTasksPageValid(page, input.limit)) throw new Error("shared_tasks_output_invalid")
    const last = page.items.at(-1)
    if (result.nextPosition !== null && (!last || result.nextPosition.sharedAt !== last.shared_at || result.nextPosition.sessionId !== last.session_id))
      throw new Error("shared_tasks_output_invalid")
    const body = { data: page }
    if (Buffer.byteLength(JSON.stringify(body)) > 1048576) throw new Error("shared_tasks_output_invalid")
    active()
    send(response, 200, body)
  } catch (error) {
    fail(
      error instanceof Error && error.message === "SHARED_TASKS_INPUT_INVALID" ? 400 : 503,
      error instanceof Error && error.message === "SHARED_TASKS_INPUT_INVALID" ? "shared_tasks_input_invalid" : "shared_tasks_unavailable",
    )
  } finally {
    controller.abort()
    clearTimeout(timer)
    response.removeListener("close", close)
    request.removeListener("aborted", stop)
  }
}
