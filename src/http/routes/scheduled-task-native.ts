import type { IncomingMessage, ServerResponse } from "node:http"
import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import { authorizeUserRequest } from "../../auth/user-admission.js"
import { failure } from "../../contracts/index.js"
import type { ScheduledTaskReadService } from "../../application/scheduled-task-read-service.js"
import { pathOf, requestId } from "../request.js"
import { send } from "../response.js"
import { scheduledTaskReadRoute } from "./scheduled-task-read.js"

function scheduledTaskPath(request: IncomingMessage): string {
  return (request.url ?? "").split("?", 1)[0] ?? ""
}

export function isScheduledTaskReadRequest(request: IncomingMessage): boolean {
  const path = scheduledTaskPath(request)
  return path === "/v1/scheduled-tasks" || /^\/v1\/scheduled-tasks\/[^/]+$/u.test(path)
}

/** Scheduled-task current-state adapter; reads remain owner-scoped and re-admitted before ACK. */
export async function handleScheduledTaskReadRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  admission: SessionAdmission,
  reader: ScheduledTaskReadService | null,
): Promise<boolean> {
  if (!isScheduledTaskReadRequest(request)) return false
  const id = requestId(request)
  response.setHeader("x-request-id", id)
  const abort = new AbortController()
  const deadlineAt = performance.now() + Math.min(config.upstreamTimeoutMs, 5_000)
  const timer = setTimeout(() => abort.abort(), Math.max(0, deadlineAt - performance.now()))
  const onAborted = (): void => abort.abort()
  const onClosed = (): void => {
    if (!response.writableEnded) abort.abort()
  }
  request.once("aborted", onAborted)
  response.once("close", onClosed)
  try {
    const admitted = await authorizeUserRequest(request, config, admission, id, abort.signal)
    if (!admitted.ok) {
      send(response, admitted.status, failure(admitted.code, "BFF user admission failed", id), admitted.retryAfter)
      return true
    }
    const segments = pathOf(request).slice(1)
    const taskId = segments.length === 2 ? segments[1] : undefined
    await scheduledTaskReadRoute(
      request,
      response,
      admitted.context,
      reader,
      taskId,
      async (signal) => authorizeUserRequest(request, config, admission, id, signal),
      Math.max(0, deadlineAt - performance.now()),
    )
    return true
  } catch {
    if (!response.headersSent && !response.writableEnded && !response.destroyed)
      send(response, 503, failure("scheduler_current_unavailable", "Scheduled task current state is unavailable", id))
    return true
  } finally {
    clearTimeout(timer)
    request.removeListener("aborted", onAborted)
    response.removeListener("close", onClosed)
  }
}
