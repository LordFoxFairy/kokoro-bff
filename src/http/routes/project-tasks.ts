import type { IncomingMessage, ServerResponse } from "node:http"

import { authorizeUserRequest } from "../../auth/user-admission.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import type { BffConfig } from "../../config/runtime.js"
import { failure, ok } from "../../contracts/index.js"
import { projectTaskIdPattern, projectTaskRevisionPattern, type ProjectTaskStatus } from "../../contracts/projects.js"
import type { ProjectTasks } from "../../infrastructure/postgres/project-tasks.js"
import { strictParseRawJson } from "../../infrastructure/raw-json.js"
import { readBodyBeforeDeadline } from "../request-body.js"
import { requestId } from "../request.js"
import { send } from "../response.js"

const PROJECT_ID = /^project_[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u
const TASK_PATH = /^\/v1\/projects\/([^/]+)\/tasks(?:\/([^/]+))?$/u
const KEY = /^[\x21-\x2B\x2D-\x7E]{1,128}$/u
const MAX_BODY_BYTES = 4096

type WriteMethod = "POST" | "PATCH" | "DELETE"
type TaskInput = { title?: string; status?: ProjectTaskStatus }
type WriteHeaders = { kind: "ok"; key: string; revision?: string } | { kind: "invalid" | "missing-key" | "missing-precondition" }

export function parseProjectTaskInput(method: "POST", raw: Buffer): { title: string } | null
export function parseProjectTaskInput(method: "PATCH", raw: Buffer): TaskInput | null
export function parseProjectTaskInput(method: "POST" | "PATCH", raw: Buffer): TaskInput | null {
  let decoded: unknown
  try {
    decoded = strictParseRawJson(raw)
  } catch {
    return null
  }
  if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) return null
  const body = decoded as Record<string, unknown>
  const keys = Object.keys(body)
  if (keys.length === 0 || keys.some((key) => key !== "title" && (method === "POST" || key !== "status"))) return null
  const result: TaskInput = {}
  if (Object.hasOwn(body, "title")) {
    if (typeof body.title !== "string" || [...body.title].length > 160 || /[\p{Cc}\p{Cs}]/u.test(body.title)) return null
    const title = body.title.trim()
    if (title.length === 0) return null
    result.title = title
  }
  if (Object.hasOwn(body, "status")) {
    if (body.status !== "todo" && body.status !== "in_progress" && body.status !== "done") return null
    result.status = body.status
  }
  return result
}

export function parseProjectTaskWriteHeaders(method: WriteMethod, raw: readonly string[]): WriteHeaders {
  const values = (name: string): string[] => {
    const result: string[] = []
    for (let index = 0; index < raw.length; index += 2) if (raw[index]?.toLowerCase() === name) result.push(raw[index + 1] ?? "")
    return result
  }
  const keys = values("idempotency-key")
  const key = keys[0]
  if (keys.length === 0) return { kind: "missing-key" }
  if (keys.length !== 1 || key === undefined || !KEY.test(key)) return { kind: "invalid" }
  const matches = values("if-match")
  const contentTypes = values("content-type")
  if (values("content-encoding").length !== 0 ||
    ["if-none-match", "if-modified-since", "if-unmodified-since", "if-range"].some((name) => values(name).length !== 0))
    return { kind: "invalid" }
  if (method === "DELETE") {
    const lengths = values("content-length")
    if (contentTypes.length !== 0 || values("transfer-encoding").length !== 0 ||
      lengths.length > 1 || (lengths[0] !== undefined && lengths[0] !== "0")) return { kind: "invalid" }
  } else if (contentTypes.length !== 1 || !/^application\/json(?:[ \t]*;[ \t]*charset=utf-8)?$/iu.test(contentTypes[0] ?? "")) {
    return { kind: "invalid" }
  }
  if (method === "POST") return matches.length === 0 ? { kind: "ok", key } : { kind: "invalid" }
  if (matches.length === 0) return { kind: "missing-precondition" }
  const tag = matches[0]
  if (matches.length !== 1 || !tag?.startsWith('"') || !tag.endsWith('"') || !projectTaskRevisionPattern.test(tag.slice(1, -1)))
    return { kind: "invalid" }
  return { kind: "ok", key, revision: tag.slice(1, -1) }
}

const taskErrors = {
  project_not_found: [404, "Project was not found"],
  project_task_not_found: [404, "Project task was not found"],
  idempotency_conflict: [409, "Idempotency key was used for different input"],
  project_task_limit_reached: [409, "Project task limit was reached"],
  project_task_precondition_failed: [412, "Project task revision is no longer current"],
} as const

/** The project owner admits and handles all four operations of the same task resource. */
export async function handleProjectTaskRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  admission: SessionAdmission,
  tasks: ProjectTasks,
): Promise<boolean> {
  const url = request.url ?? ""
  const path = url.split("?", 1)[0] ?? ""
  const match = TASK_PATH.exec(path)
  const method = request.method
  const projectId = match?.[1]
  const taskSegment = match?.[2]
  if (method !== "GET" && method !== "POST" && method !== "PATCH" && method !== "DELETE") return false
  if (projectId === undefined ||
    (taskSegment === undefined ? method !== "GET" && method !== "POST" : method !== "PATCH" && method !== "DELETE")) return false
  const id = requestId(request)
  response.setHeader("x-request-id", id)
  const fail = (status: number, code: string, message: string, retryAfter?: string): void => {
    if (!response.destroyed && !response.writableEnded) send(response, status, failure(code, message, id), retryAfter)
  }
  const invalid = (): void => fail(400, "invalid_project_task_request", "Project task request is invalid")
  const deadlineAt = performance.now() + Math.min(config.upstreamTimeoutMs, 10_000)
  const abort = new AbortController()
  const cancel = (): void => {
    if (!response.writableEnded) abort.abort()
  }
  const timer = setTimeout(cancel, Math.max(0, deadlineAt - performance.now()))
  request.once("aborted", cancel)
  response.once("close", cancel)
  if (request.aborted || response.destroyed) cancel()
  try {
    let taskId: string | undefined
    if (taskSegment !== undefined) {
      try { taskId = decodeURIComponent(taskSegment) }
      catch { invalid(); return true }
    }
    if (method !== "GET" && (path !== url || !PROJECT_ID.test(projectId) || (taskId !== undefined && !projectTaskIdPattern.test(taskId)))) {
      invalid()
      return true
    }
    const headers = method === "GET" ? null : parseProjectTaskWriteHeaders(method, request.rawHeaders)
    if (headers !== null && headers.kind !== "ok") {
      if (headers.kind === "missing-precondition") fail(428, "project_task_precondition_required", "One strong If-Match is required")
      else if (headers.kind === "missing-key") fail(400, "idempotency_key_required", "One Idempotency-Key is required")
      else invalid()
      return true
    }
    abort.signal.throwIfAborted()
    const admitted = await authorizeUserRequest(request, config, admission, id, abort.signal, response)
    abort.signal.throwIfAborted()
    if (!admitted.ok) {
      fail(admitted.status, admitted.code, "BFF user admission failed", admitted.retryAfter)
      return true
    }
    const scope = { tenantId: admitted.context.identity.namespace, subjectId: admitted.context.identity.userId }
    if (headers === null) {
      const listed = await tasks.list(scope, projectId, deadlineAt, abort.signal)
      abort.signal.throwIfAborted()
      if (listed === null) fail(404, "project_not_found", taskErrors.project_not_found[1])
      else if (!response.destroyed && !response.writableEnded) send(response, 200, ok({ tasks: listed }, id))
      return true
    }
    let command: Parameters<ProjectTasks["write"]>[3]
    if (method === "DELETE" && taskId !== undefined && headers.revision !== undefined) {
      command = { method, taskId, revision: headers.revision }
    } else if (method === "POST" || method === "PATCH") {
      let raw: Buffer
      try {
        raw = await readBodyBeforeDeadline(request, abort.signal, MAX_BODY_BYTES)
      } catch (error) {
        if (error instanceof Error && error.message === "request body too large") {
          if (!response.destroyed && !response.writableEnded) response.setHeader("connection", "close")
          fail(413, "payload_too_large", "Project task request body is too large")
          return true
        }
        throw error
      }
      if (method === "POST") {
        const input = parseProjectTaskInput(method, raw)
        if (input === null) {
          invalid()
          return true
        }
        command = { method, ...input }
      } else {
        const input = parseProjectTaskInput(method, raw)
        if (input === null || taskId === undefined || headers.revision === undefined) {
          invalid()
          return true
        }
        command = { method, taskId, revision: headers.revision, ...input }
      }
    } else {
      invalid()
      return true
    }
    const result = await tasks.write(scope, projectId, headers.key, command, deadlineAt, abort.signal)
    abort.signal.throwIfAborted()
    if (response.destroyed || response.writableEnded) return true
    if (result.kind !== "success") {
      const [status, message] = taskErrors[result.kind]
      fail(status, result.kind, message)
    } else if (result.status === 204) {
      response.writeHead(204, { "cache-control": "no-store" })
      response.end()
    } else {
      if (result.status === 201) response.setHeader("location", `/v1/projects/${projectId}/tasks/${result.data.id}`)
      send(response, result.status, ok(result.data, id))
    }
  } catch {
    fail(503, "business_store_unavailable", "The BFF business store is unavailable")
  } finally {
    clearTimeout(timer)
    request.removeListener("aborted", cancel)
    response.removeListener("close", cancel)
  }
  return true
}
