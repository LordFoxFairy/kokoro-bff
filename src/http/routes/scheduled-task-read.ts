import type { IncomingMessage, ServerResponse } from "node:http"
import type { RequestContext } from "../../domain/request-context.js"
import type { UserAdmissionResult } from "../../auth/user-admission.js"
import type { ScheduledTaskReadService } from "../../application/scheduled-task-read-service.js"
import { scheduledTaskDetails } from "../../application/scheduled/mappers.js"
import { failure, ok } from "../../contracts/index.js"
import { send } from "../response.js"

/** Current GET lifetime is independent of the already-completed initial admission. */
export async function scheduledTaskReadRoute(
  request: IncomingMessage,
  response: ServerResponse,
  context: RequestContext,
  reader: ScheduledTaskReadService | null,
  taskId: string | undefined,
  readmit: (signal: AbortSignal) => Promise<UserAdmissionResult>,
  timeoutMs: number,
): Promise<void> {
  const controller = new AbortController()
  const abort = (): void => controller.abort()
  request.once("aborted", abort)
  response.once("close", abort)
  const deadline = performance.now() + Math.min(5000, timeoutMs)
  const check = (): void => {
    if (performance.now() >= deadline) controller.abort()
    controller.signal.throwIfAborted()
  }
  const timer = setTimeout(abort, Math.max(0, deadline - performance.now()))
  let denied: Extract<UserAdmissionResult, { ok: false }> | undefined
  response.setHeader("cache-control", "no-store")
  try {
    if (request.aborted || response.destroyed) controller.abort()
    check()
    if (reader === null) throw Error("scheduler_current_unavailable")
    const views = await reader.read({ tenantId: context.identity.namespace, subjectId: context.identity.userId }, context.requestId, controller.signal, {
      ...(taskId === undefined ? {} : { taskId }),
      deadline,
      revalidate: async () => {
        const fresh = await readmit(controller.signal)
        check()
        if (!fresh.ok) denied = fresh
        else if (fresh.context.identity.namespace !== context.identity.namespace || fresh.context.identity.userId !== context.identity.userId)
          denied = { ok: false, status: 403, code: "scheduled_task_read_forbidden" }
        if (denied !== undefined) throw Error("scheduled_task_read_forbidden")
      },
    })
    check()
    const tasks = views.map(scheduledTaskDetails)
    check()
    if (taskId !== undefined && tasks.length === 0) send(response, 404, failure("scheduled_task_not_found", "Scheduled task was not found", context.requestId))
    else send(response, 200, ok(taskId === undefined ? { tasks } : { task: tasks[0] }, context.requestId))
  } catch {
    if (!response.destroyed && !response.writableEnded)
      send(
        response,
        denied?.status ?? 503,
        failure(
          denied?.code ?? (reader === null ? "business_store_not_configured" : "scheduler_current_unavailable"),
          "Scheduled task current state is unavailable",
          context.requestId,
        ),
        denied?.retryAfter,
      )
  } finally {
    clearTimeout(timer)
    request.removeListener("aborted", abort)
    response.removeListener("close", abort)
  }
}
