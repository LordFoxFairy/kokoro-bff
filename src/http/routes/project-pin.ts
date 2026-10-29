import type { IncomingMessage, ServerResponse } from "node:http"
import type { RequestContext } from "../../domain/request-context.js"
import type { BffBusinessStore } from "../../application/ports/bff-business-store.js"
import { projectPinId, projectPinInstant } from "../../domain/project/pin.js"
import { parseProjectPinInput, parseProjectPinQuery, encodeProjectPinCursor } from "../project-pin-input.js"
import { readBodyBeforeDeadline, rawHeaderCount } from "../request-body.js"
import { send } from "../response.js"
import { failure } from "../../contracts/index.js"

export class ProjectPinAdmissionError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly retryAfter?: string,
  ) {
    super("Project pin admission failed")
  }
}
export async function projectPinRoute(
  request: IncomingMessage,
  response: ServerResponse,
  context: RequestContext,
  path: readonly string[],
  store: BffBusinessStore | null,
  deadlineAt: number,
  currentAdmission: (signal: AbortSignal) => Promise<void>,
): Promise<void> {
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), Math.max(0, deadlineAt - performance.now()))
  const abort = () => {
    if (!response.writableEnded) controller.abort()
  }
  request.once("aborted", abort)
  response.once("close", abort)
  if (request.aborted || response.destroyed) controller.abort()
  const within = <T>(start: () => Promise<T>): Promise<T> =>
    new Promise((resolve, reject) => {
      const stop = () => reject(new Error("project_pin_unavailable"))
      controller.signal.addEventListener("abort", stop, { once: true })
      if (controller.signal.aborted) {
        stop()
        controller.signal.removeEventListener("abort", stop)
        return
      }
      void Promise.resolve()
        .then(() => {
          controller.signal.throwIfAborted()
          return start()
        })
        .then(resolve, reject)
        .finally(() => controller.signal.removeEventListener("abort", stop))
    })
  const fail = (status: number, code: string, retryAfter?: string) => {
    if (!response.destroyed && !response.writableEnded) send(response, status, failure(code, "Project pin request failed", context.requestId), retryAfter)
  }
  const invalid = (): never => {
    throw new Error("project_pin_request_invalid")
  }
  try {
    response.setHeader("x-request-id", context.requestId)
    const url = new URL(request.url ?? "", "http://bff.invalid"),
      scope = { tenantId: context.identity.namespace, subjectId: context.identity.userId }
    const list = path.length === 2 && path[0] === "self" && path[1] === "project-pins"
    const projectId = list ? null : path[1]
    if (!list && (!projectPinId(projectId) || path.length !== 3 || path[0] !== "projects" || path[2] !== "pin")) invalid()
    const expected = list ? "/v1/self/project-pins" : `/v1/projects/${encodeURIComponent(projectId!)}/pin`
    if (url.pathname !== expected || url.hash) invalid()
    if (request.method !== (list ? "GET" : "PUT")) {
      response.setHeader("allow", list ? "GET" : "PUT")
      fail(405, "method_not_allowed")
      return
    }
    if (["idempotency-key", "if-match", "transfer-encoding"].some((key) => request.headers[key] !== undefined)) invalid()
    const query = list ? parseProjectPinQuery(url.searchParams, scope) : null
    let isPinned = false
    if (list) {
      if (["content-type", "content-length"].some((key) => request.headers[key] !== undefined)) invalid()
    } else {
      const length = request.headers["content-length"]
      if (
        url.search ||
        rawHeaderCount(request, "content-type") !== 1 ||
        !/^application\/json(?:;\s*charset=utf-8)?$/iu.test(String(request.headers["content-type"])) ||
        rawHeaderCount(request, "content-length") !== 1 ||
        typeof length !== "string" ||
        !/^[1-9][0-9]{0,3}$/u.test(length) ||
        Number(length) > 1024
      )
        invalid()
      const bytes = await within(() => readBodyBeforeDeadline(request, controller.signal, 1024))
      if (bytes.byteLength !== Number(length)) invalid()
      isPinned = parseProjectPinInput(bytes)
    }
    await within(() => currentAdmission(controller.signal))
    if (!store) throw new Error("project_pin_unavailable")
    let data: unknown
    if (query) {
      const result = await within(() => store.services.projects.listPins({ ...scope, ...query, signal: controller.signal, deadlineAt }))
      if (result === null) {
        fail(404, "project_not_found")
        return
      }
      if (result.items.length > query.limit) throw new Error("project_pin_unavailable")
      const seen = new Set<string>()
      const items = result.items.map((item) => {
        const pinnedAt = item.pinnedAt instanceof Date ? item.pinnedAt.toISOString() : ""
        if (
          !projectPinId(item.projectId) ||
          !projectPinInstant(pinnedAt) ||
          seen.has(item.projectId) ||
          (query.projectId !== null && item.projectId !== query.projectId)
        )
          throw new Error("project_pin_unavailable")
        seen.add(item.projectId)
        return { project_id: item.projectId, pinned_at: pinnedAt }
      })
      const position = result.nextPosition,
        last = items.at(-1)
      if (position && (!last || query.projectId !== null || position.projectId !== last.project_id || position.pinnedAt !== last.pinned_at))
        throw new Error("project_pin_unavailable")
      data = { items, next_cursor: position ? encodeProjectPinCursor(position, scope, query.limit) : null }
    } else {
      const result = await within(() => store.services.projects.setPin({ ...scope, projectId: projectId!, isPinned, signal: controller.signal, deadlineAt }))
      if (result === null) {
        fail(404, "project_not_found")
        return
      }
      const pinnedAt = result.pinnedAt instanceof Date ? result.pinnedAt.toISOString() : null
      if (result.projectId !== projectId || result.isPinned !== isPinned || (isPinned ? !projectPinInstant(pinnedAt) : result.pinnedAt !== null))
        throw new Error("project_pin_unavailable")
      data = { project_id: result.projectId, is_pinned: result.isPinned, pinned_at: pinnedAt }
    }
    await within(() => currentAdmission(controller.signal))
    controller.signal.throwIfAborted()
    if (Buffer.byteLength(JSON.stringify({ data })) > 65536) throw new Error("project_pin_unavailable")
    if (!response.destroyed && !response.writableEnded) send(response, 200, { data })
  } catch (error) {
    if (error instanceof ProjectPinAdmissionError) fail(error.status, error.code, error.retryAfter)
    else if (error instanceof Error && error.message === "project_pin_request_invalid") fail(400, "project_pin_request_invalid")
    else fail(503, "project_pin_unavailable")
  } finally {
    clearTimeout(timer)
    request.removeListener("aborted", abort)
    response.removeListener("close", abort)
  }
}
