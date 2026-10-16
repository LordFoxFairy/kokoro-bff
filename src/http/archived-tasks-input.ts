import type { IncomingMessage } from "node:http"
import type { ArchivedTaskItem, ArchivedTasksPosition, ArchiveState } from "../application/ports/chat-repository.js"
import { strictParseRawJson } from "../infrastructure/raw-json.js"

const invalid = (): never => {
  throw new Error("ARCHIVE_INPUT_INVALID")
}
export function archiveInstant(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  )
}
export function parseArchiveInput(
  request: IncomingMessage,
):
  | Readonly<{ kind: "list"; limit: number; cursor: string | null }>
  | Readonly<{ kind: "state" | "archive" | "restore"; conversationId: string; key: string | null }> {
  const raw = request.url ?? ""
  if (raw.includes("#") || raw.split("?").length > 2) invalid()
  const [path, query = ""] = raw.split("?")
  const single = (name: string) => {
    const count = request.rawHeaders.filter((_, i) => i % 2 === 0 && request.rawHeaders[i]!.toLowerCase() === name).length
    if (count > 1) invalid()
    const value = request.headers[name]
    if (Array.isArray(value)) invalid()
    return value
  }
  for (const name of ["content-type", "content-length", "content-encoding", "transfer-encoding", "idempotency-key"]) single(name)
  if (request.method === "GET") {
    if (
      request.headers["transfer-encoding"] !== undefined ||
      request.headers["content-encoding"] !== undefined ||
      request.headers["idempotency-key"] !== undefined ||
      (request.headers["content-length"] !== undefined && request.headers["content-length"] !== "0")
    )
      invalid()
  }
  if (path === "/v1/account/archived-tasks") {
    if (request.method !== "GET") invalid()
    try {
      for (const component of query.split("&")) for (const part of component.split("=")) decodeURIComponent(part.replaceAll("+", " "))
    } catch {
      invalid()
    }
    const params = new URLSearchParams(query)
    for (const key of params.keys()) if (!["limit", "cursor"].includes(key) || params.getAll(key).length !== 1) invalid()
    const value = params.get("limit"),
      cursor = params.get("cursor")
    if (value !== null && (!/^[1-9]\d{0,2}$/u.test(value) || Number(value) > 100)) invalid()
    if (cursor !== null && (!cursor || cursor.length > 2048)) invalid()
    return { kind: "list", limit: value === null ? 20 : Number(value), cursor }
  }
  const match = /^\/v1\/sessions\/([^/]+)\/(archive|restore)$/u.exec(path ?? "")
  if (!match || raw.includes("?")) invalid()
  let id = ""
  try {
    id = decodeURIComponent(match![1]!)
    if (!id || encodeURIComponent(id) !== match![1]) invalid()
  } catch {
    invalid()
  }
  if (request.method === "GET" && match![2] === "archive") return { kind: "state", conversationId: id, key: null }
  if (request.method !== "POST") invalid()
  const key = single("idempotency-key")
  if (typeof key !== "string" || !/^[\x21-\x2B\x2D-\x7E]{1,128}$/u.test(key)) invalid()
  return { kind: match![2] as "archive" | "restore", conversationId: id, key: key as string }
}
export function parseArchiveBody(bytes: Uint8Array): void {
  if (
    Buffer.from(bytes)
      .subarray(0, 3)
      .equals(Buffer.from([0xef, 0xbb, 0xbf]))
  )
    invalid()
  let value: unknown
  try {
    value = strictParseRawJson(bytes)
  } catch {
    invalid()
  }
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 0) invalid()
}
export function decodeArchivedCursor(
  cursor: string | null,
  identity: Readonly<{ tenantId: string; subjectId: string; limit: number }>,
): ArchivedTasksPosition | null {
  if (cursor === null) return null
  if (!cursor.startsWith("arc1_") || cursor.length > 2048) invalid()
  const raw = cursor.slice(5),
    bytes = Buffer.from(raw, "base64url")
  if (!raw || bytes.toString("base64url") !== raw || bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) invalid()
  let parsed: unknown
  try {
    parsed = strictParseRawJson(bytes)
  } catch {
    invalid()
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) invalid()
  const value = parsed as Record<string, unknown>
  if (
    Object.keys(value).sort().join(",") !== "archivedAt,kind,limit,sessionId,subjectId,tenantId" ||
    value.kind !== "archived_tasks" ||
    value.tenantId !== identity.tenantId ||
    value.subjectId !== identity.subjectId ||
    value.limit !== identity.limit ||
    !archiveInstant(value.archivedAt) ||
    typeof value.sessionId !== "string" ||
    !value.sessionId
  )
    invalid()
  return { archivedAt: value.archivedAt as string, sessionId: value.sessionId as string }
}
export function encodeArchivedCursor(position: ArchivedTasksPosition, identity: Readonly<{ tenantId: string; subjectId: string; limit: number }>): string {
  const cursor = `arc1_${Buffer.from(JSON.stringify({ kind: "archived_tasks", ...identity, ...position })).toString("base64url")}`
  decodeArchivedCursor(cursor, identity)
  return cursor
}
export function archiveStateValid(value: unknown, conversationId: string): value is ArchiveState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  return (
    Object.keys(row).sort().join(",") === "archived_at,session_id" &&
    row.session_id === conversationId &&
    (row.archived_at === null || archiveInstant(row.archived_at))
  )
}
export function archivedItemsValid(items: readonly ArchivedTaskItem[], limit: number): boolean {
  if (!Array.isArray(items) || items.length > limit) return false
  let previous: ArchivedTaskItem | undefined
  const seen = new Set<string>()
  for (const item of items) {
    if (
      !item ||
      Object.keys(item).sort().join(",") !== "archived_at,project_ref,session_id,title" ||
      typeof item.session_id !== "string" ||
      !item.session_id ||
      typeof item.title !== "string" ||
      (item.project_ref !== null && typeof item.project_ref !== "string") ||
      !archiveInstant(item.archived_at) ||
      seen.has(item.session_id)
    )
      return false
    if (
      previous &&
      (item.archived_at > previous.archived_at ||
        (item.archived_at === previous.archived_at && Buffer.compare(Buffer.from(item.session_id), Buffer.from(previous.session_id)) <= 0))
    )
      return false
    seen.add(item.session_id)
    previous = item
  }
  return true
}
