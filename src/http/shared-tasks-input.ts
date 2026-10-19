import type { IncomingMessage } from "node:http"
import { strictParseRawJson } from "../infrastructure/raw-json.js"
import type { SharedTaskItem, SharedTasksPage, SharedTasksPosition } from "../application/ports/chat-repository.js"

const invalid = (): never => {
  throw new Error("SHARED_TASKS_INPUT_INVALID")
}
export function sharedTasksInstant(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  )
}
export function parseSharedTasksInput(request: IncomingMessage): { limit: number; cursor: string | null } {
  if (
    request.method !== "GET" ||
    request.headers["transfer-encoding"] !== undefined ||
    request.headers["content-encoding"] !== undefined ||
    request.headers["idempotency-key"] !== undefined ||
    (request.headers["content-length"] !== undefined && request.headers["content-length"] !== "0")
  )
    invalid()
  const raw = request.url ?? ""
  const [path, query = ""] = raw.split("?")
  if (path !== "/v1/account/shared-tasks" || raw.includes("#") || raw.split("?").length > 2) invalid()
  // Decode the raw query before URLSearchParams can replace malformed UTF-8.
  try {
    for (const component of query.split("&")) for (const part of component.split("=")) decodeURIComponent(part.replaceAll("+", " "))
  } catch {
    invalid()
  }
  const params = new URLSearchParams(query)
  for (const key of params.keys()) if (!["limit", "cursor"].includes(key) || params.getAll(key).length !== 1) invalid()
  const rawLimit = params.get("limit")
  if (rawLimit !== null && (!/^[1-9]\d{0,2}$/u.test(rawLimit) || Number(rawLimit) > 100)) invalid()
  const cursor = params.get("cursor")
  if (cursor !== null && (!cursor || cursor.length > 2048)) invalid()
  return { limit: rawLimit === null ? 20 : Number(rawLimit), cursor }
}
export function decodeSharedTasksCursor(cursor: string | null, tenantId: string, subjectId: string, limit: number): SharedTasksPosition | null {
  if (cursor === null) return null
  if (!cursor.startsWith("sht1_") || cursor.length > 2048) invalid()
  const encoded = cursor.slice(5)
  const bytes = Buffer.from(encoded, "base64url")
  if (!encoded || bytes.toString("base64url") !== encoded || bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) invalid()
  let value: unknown
  try {
    value = strictParseRawJson(bytes)
  } catch {
    invalid()
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid()
  const row = value as Record<string, unknown>
  if (
    Object.keys(row).sort().join(",") !== "kind,limit,sessionId,sharedAt,subjectId,tenantId" ||
    row.kind !== "shared_tasks" ||
    row.tenantId !== tenantId ||
    row.subjectId !== subjectId ||
    row.limit !== limit ||
    !sharedTasksInstant(row.sharedAt) ||
    typeof row.sessionId !== "string" ||
    !row.sessionId
  )
    invalid()
  return { sharedAt: row.sharedAt as string, sessionId: row.sessionId as string }
}
export function encodeSharedTasksCursor(position: SharedTasksPosition, tenantId: string, subjectId: string, limit: number): string {
  const cursor = `sht1_${Buffer.from(JSON.stringify({ kind: "shared_tasks", tenantId, subjectId, limit, ...position })).toString("base64url")}`
  decodeSharedTasksCursor(cursor, tenantId, subjectId, limit)
  return cursor
}
export function sharedTasksPageValid(page: SharedTasksPage, limit: number): boolean {
  if (
    !page ||
    Object.keys(page).sort().join(",") !== "items,next_cursor" ||
    !Array.isArray(page.items) ||
    page.items.length > limit ||
    (page.next_cursor !== null && (typeof page.next_cursor !== "string" || !page.next_cursor || page.next_cursor.length > 2048 || !page.items.length))
  )
    return false
  const seen = new Set<string>()
  let previous: SharedTaskItem | undefined
  for (const item of page.items) {
    if (
      !item ||
      Object.keys(item).sort().join(",") !== "expires_at,session_id,shared_at,title" ||
      typeof item.session_id !== "string" ||
      !item.session_id ||
      typeof item.title !== "string" ||
      !sharedTasksInstant(item.shared_at) ||
      (item.expires_at !== null && (!sharedTasksInstant(item.expires_at) || item.expires_at <= item.shared_at)) ||
      seen.has(item.session_id)
    )
      return false
    if (
      previous &&
      (item.shared_at > previous.shared_at ||
        (item.shared_at === previous.shared_at && Buffer.compare(Buffer.from(item.session_id), Buffer.from(previous.session_id)) <= 0))
    )
      return false
    seen.add(item.session_id)
    previous = item
  }
  return true
}
