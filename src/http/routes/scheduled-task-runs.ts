import { strictParseRawJson } from "../../infrastructure/raw-json.js"
import type { IncomingMessage, ServerResponse } from "node:http"
import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import { authorizeUserRequest, type UserAdmissionResult } from "../../auth/user-admission.js"
import type { ScheduledTaskRunsReader } from "../../application/scheduled-task-runs.types.js"
import { listScheduledTaskRuns } from "../../application/scheduled-task-runs-service.js"
import { parseScheduledRunsInput, decodeScheduledRunsCursor, encodeScheduledRunsCursor } from "../scheduled-task-runs-input.js"
import { send } from "../response.js"

export async function scheduledTaskRunsRoute(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  admission: SessionAdmission,
  reader: ScheduledTaskRunsReader | undefined,
  requestId: string,
): Promise<void> {
  const deadlineAt = performance.now() + Math.min(config.upstreamTimeoutMs, 5000),
    controller = new AbortController()
  let reject!: (reason: Error) => void
  const interrupted = new Promise<never>((_, fail) => {
    reject = fail
  })
  const stop = () => {
    controller.abort()
    reject(new Error("SCHEDULED_RUNS_RETIRED"))
  }
  const close = () => {
    if (!response.writableEnded) stop()
  }
  const timer = setTimeout(stop, Math.max(0, deadlineAt - performance.now()))
  request.once("aborted", stop)
  response.once("close", close)
  response.setHeader("cache-control", "no-store")
  response.setHeader("x-request-id", requestId)
  const active = () => {
    if (controller.signal.aborted || request.aborted || response.destroyed || performance.now() >= deadlineAt) throw new Error("SCHEDULED_RUNS_RETIRED")
  }
  const fail = (status: number, code: string, retryAfter?: string) => {
    if (!response.destroyed && !response.writableEnded)
      send(response, status, { error: { code, message: code, retryable: status === 429 || status === 503 } }, retryAfter)
  }
  const admitted = async (): Promise<Extract<UserAdmissionResult, { ok: true }>> => {
    active()
    const result = await Promise.race([authorizeUserRequest(request, config, admission, requestId, controller.signal), interrupted])
    active()
    if (result.ok) return result
    const allowed: Record<number, readonly string[]> = {
      401: ["session_authentication_required", "session_invalid"],
      403: ["service_auth_failed", "session_forbidden", "product_tenant_forbidden"],
      429: ["session_rate_limited"],
      503: ["product_tenant_not_configured", "iam_admission_unavailable"],
    }
    const valid =
      allowed[result.status]?.includes(result.code) &&
      (result.status !== 429 || (typeof result.retryAfter === "string" && /^[1-9][0-9]{0,4}$/u.test(result.retryAfter)))
    fail(valid ? result.status : 503, valid ? result.code : "scheduled_task_runs_unavailable", valid && result.status === 429 ? result.retryAfter : undefined)
    throw new Error("SCHEDULED_RUNS_ADMISSION")
  }
  try {
    active()
    const input = parseScheduledRunsInput(request)
    const empty = new Promise<void>((resolve, rejectBody) => {
      const data = () => {
        cleanup()
        request.resume()
        rejectBody(new Error("SCHEDULED_RUNS_INPUT"))
      }
      const end = () => {
        cleanup()
        resolve()
      }
      const error = () => {
        cleanup()
        rejectBody(new Error("SCHEDULED_RUNS_RETIRED"))
      }
      const cleanup = () => {
        request.removeListener("data", data)
        request.removeListener("end", end)
        request.removeListener("error", error)
        controller.signal.removeEventListener("abort", error)
      }
      request.on("data", data)
      request.once("end", end)
      request.once("error", error)
      controller.signal.addEventListener("abort", error, { once: true })
      request.resume()
      if (request.readableEnded) end()
    })
    await Promise.race([empty, interrupted])
    active()
    const first = await admitted(),
      identity = first.context.identity
    const scope = { tenantId: identity.namespace, subjectId: identity.userId, taskId: input.taskId, limit: input.limit }
    const position = decodeScheduledRunsCursor(input.cursor, scope)
    if (!reader) throw new Error("SCHEDULED_RUNS_UNAVAILABLE")
    const page = await Promise.race([
      listScheduledTaskRuns(
        reader,
        { ...scope, position, deadlineAt, signal: controller.signal },
        async () => {
          const current = await admitted()
          if (current.context.identity.namespace !== identity.namespace || current.context.identity.userId !== identity.userId)
            throw new Error("SCHEDULED_RUNS_CHANGED")
        },
        strictParseRawJson,
      ),
      interrupted,
    ])
    active()
    if (page === null) {
      fail(404, "scheduled_task_not_found")
      return
    }
    const body = { data: { items: page.items, next_cursor: page.nextPosition === null ? null : encodeScheduledRunsCursor(page.nextPosition, scope) } }
    if (Buffer.byteLength(JSON.stringify(body)) > 1048576) throw new Error("SCHEDULED_RUNS_INVALID")
    active()
    send(response, 200, body)
  } catch (error) {
    fail(
      error instanceof Error && error.message === "SCHEDULED_RUNS_INPUT" ? 400 : 503,
      error instanceof Error && error.message === "SCHEDULED_RUNS_INPUT" ? "scheduled_task_runs_input_invalid" : "scheduled_task_runs_unavailable",
    )
  } finally {
    clearTimeout(timer)
    request.removeListener("aborted", stop)
    response.removeListener("close", close)
  }
}
