import type { IncomingMessage } from "node:http"
import { strictParseRawJson } from "../infrastructure/raw-json.js"
import { validRunOrder } from "../application/scheduled-task-run-projector.js"
import type { RunPosition } from "../application/scheduled-task-runs.types.js"

const invalid = (): never => {
  throw new Error("SCHEDULED_RUNS_INPUT")
}
const sort = "occurrence_order_key:C:desc,dispatch_id:C:desc"
export type RunsCursorScope = Readonly<{ tenantId: string; subjectId: string; taskId: string | null; limit: number }>
/** Only candidate detection is lenient. Every alias is rejected by the exact parser below. */
export function isScheduledTaskRunsCandidate(request: IncomingMessage): boolean {
  if (request.method !== "GET") return false
  const raw = (request.url ?? "").split("?")[0]!
  let decoded = raw
  for (let pass = 0; pass < 3; pass++) {
    if (/(?:^|\/)scheduled-task-runs(?:\/|$)/u.test(decoded)) return true
    try {
      decoded = decodeURIComponent(decoded)
    } catch {
      return false
    }
  }
  return false
}
export function parseScheduledRunsInput(request: IncomingMessage): { taskId: string | null; limit: number; cursor: string | null } {
  const raw = request.url ?? "",
    parts = raw.split("?")
  if (request.method !== "GET" || parts.length > 2 || parts[0] !== "/v1/scheduled-task-runs" || raw.includes("#")) return invalid()
  const seen = new Set<string>()
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    const key = request.rawHeaders[index]!.toLowerCase()
    if (seen.has(key)) return invalid()
    seen.add(key)
  }
  if (
    request.headers["transfer-encoding"] !== undefined ||
    request.headers["content-encoding"] !== undefined ||
    request.headers["idempotency-key"] !== undefined ||
    (request.headers["content-length"] !== undefined && request.headers["content-length"] !== "0")
  )
    return invalid()
  const values = new Map<string, string>()
  for (const pair of parts[1] === undefined ? [] : parts[1].split("&")) {
    const match = /^([^=]+)=([^=]*)$/u.exec(pair)
    if (!match) return invalid()
    let key: string, value: string
    try {
      key = decodeURIComponent(match[1]!.replace(/\+/gu, " "))
      value = decodeURIComponent(match[2]!.replace(/\+/gu, " "))
    } catch {
      return invalid()
    }
    if (!["task_id", "limit", "cursor"].includes(key) || values.has(key)) return invalid()
    values.set(key, value)
  }
  const limitText = values.get("limit") ?? "20"
  if (!/^(?:[1-9][0-9]?|100)$/u.test(limitText)) return invalid()
  const taskId = values.get("task_id") ?? null,
    cursor = values.get("cursor") ?? null
  if (
    (taskId !== null && (taskId.length === 0 || Array.from(taskId).length > 255 || Buffer.from(taskId).toString("utf8") !== taskId)) ||
    (cursor !== null && (cursor.length === 0 || cursor.length > 2048))
  )
    return invalid()
  return { taskId, limit: Number(limitText), cursor }
}
export function encodeScheduledRunsCursor(position: RunPosition, scope: RunsCursorScope): string {
  const value = `str1_${Buffer.from(JSON.stringify({ ...scope, sort, ...position })).toString("base64url")}`
  if (value.length > 2048) throw new Error("SCHEDULED_RUNS_INVALID")
  return value
}
export function decodeScheduledRunsCursor(value: string | null, scope: RunsCursorScope): RunPosition | null {
  if (value === null) return null
  if (!/^str1_[A-Za-z0-9_-]+$/u.test(value) || value.length > 2048) return invalid()
  const encoded = value.slice(5),
    bytes = Buffer.from(encoded, "base64url")
  if (bytes.toString("base64url") !== encoded || bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) return invalid()
  let raw: unknown
  try {
    raw = strictParseRawJson(bytes)
  } catch {
    return invalid()
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return invalid()
  const r = raw as Record<string, unknown>
  if (
    Object.keys(r).sort().join() !== "dispatchId,limit,orderKey,sort,subjectId,taskId,tenantId" ||
    r.sort !== sort ||
    r.tenantId !== scope.tenantId ||
    r.subjectId !== scope.subjectId ||
    r.taskId !== scope.taskId ||
    r.limit !== scope.limit ||
    !validRunOrder(r.orderKey) ||
    typeof r.dispatchId !== "string" ||
    r.dispatchId.length === 0 ||
    r.dispatchId.length > 1024 ||
    Buffer.from(r.dispatchId).toString("utf8") !== r.dispatchId
  )
    return invalid()
  return { orderKey: r.orderKey, dispatchId: r.dispatchId }
}
