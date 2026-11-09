import type { IncomingMessage, ServerResponse } from "node:http"
import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import { authorizeUserRequest } from "../../auth/user-admission.js"
import { failure, ok } from "../../contracts/index.js"
import { parseScheduledExecutionQuery } from "../../contracts/scheduled-executions.js"
import type { PostgresScheduledTaskExecutionReader } from "../../infrastructure/postgres/scheduled-task-execution-reader.js"
import type { ScheduledTaskReadService } from "../../application/scheduled-task-read-service.js"
import { pathOf, requestId } from "../request.js"
import { send } from "../response.js"
import { scheduledTaskReadRoute } from "./scheduled-task-read.js"

function scheduledTaskPath(request: IncomingMessage): string {
  return (request.url ?? "").split("?", 1)[0] ?? ""
}

export function isScheduledTaskReadRequest(request: IncomingMessage): boolean {
  if (request.method !== "GET") return false
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
  executions?: Pick<PostgresScheduledTaskExecutionReader, "read">,
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
    if (request.aborted || response.destroyed) abort.abort()
    abort.signal.throwIfAborted()
    const admitted = await authorizeUserRequest(request, config, admission, id, abort.signal, response)
    if (!admitted.ok) {
      send(response, admitted.status, failure(admitted.code, "BFF user admission failed", id), admitted.retryAfter)
      return true
    }
    abort.signal.throwIfAborted()
    const params = new URL(request.url ?? "/", "http://bff.local").searchParams
    const scope = { tenantId: admitted.context.identity.namespace, subjectId: admitted.context.identity.userId }
    if (scheduledTaskPath(request) === "/v1/scheduled-tasks/executions") {
      const query = parseScheduledExecutionQuery(params, scope)
      if (query === null) {
        send(response, 400, failure("invalid_scheduled_execution_query", "Invalid execution list query", id))
        return true
      }
      if (executions === undefined) throw Error("scheduled_execution_reader_unavailable")
      const page = await executions.read(scope, query, abort.signal)
      abort.signal.throwIfAborted()
      const fresh = await authorizeUserRequest(request, config, admission, id, abort.signal, response)
      abort.signal.throwIfAborted()
      if (!fresh.ok) send(response, fresh.status, failure(fresh.code, "BFF user admission failed", id), fresh.retryAfter)
      else if (fresh.context.identity.namespace !== scope.tenantId || fresh.context.identity.userId !== scope.subjectId)
        send(response, 403, failure("scheduled_execution_read_forbidden", "Execution list is unavailable", id))
      else {
        response.setHeader("cache-control", "no-store")
        send(response, 200, ok(page, id))
      }
      return true
    }
    const segments = pathOf(request).slice(1)
    const taskId = segments.length === 2 ? segments[1] : undefined
    const projectId = params.get("project_id")
    if (
      [...params.keys()].some((key) => key !== "project_id" || params.getAll(key).length !== 1) ||
      (projectId !== null && (taskId !== undefined || projectId.length === 0 || projectId.length > 191 || projectId.trim() !== projectId))
    ) {
      send(response, 400, failure("invalid_scheduled_task_query", "Invalid scheduled task list query", id))
      return true
    }
    await scheduledTaskReadRoute(
      request,
      response,
      admitted.context,
      reader,
      taskId,
      async (signal) => authorizeUserRequest(request, config, admission, id, signal, response),
      Math.max(0, deadlineAt - performance.now()),
      projectId ?? undefined,
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
