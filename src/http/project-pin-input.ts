import { projectPinId, projectPinInstant, type ProjectPinPosition } from "../domain/project/pin.js"
import { strictParseRawJson } from "../infrastructure/raw-json.js"
import type { ProjectOwnerScope } from "../application/ports/project-repository.js"

const invalid = (): never => {
  throw new Error("project_pin_request_invalid")
}
export function parseProjectPinInput(bytes: Buffer): boolean {
  let value: unknown
  try {
    value = strictParseRawJson(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
  } catch {
    return invalid()
  }
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).join(",") !== "is_pinned" ||
    typeof Reflect.get(value, "is_pinned") !== "boolean"
  )
    return invalid()
  return Reflect.get(value, "is_pinned") as boolean
}
export function parseProjectPinQuery(
  query: URLSearchParams,
  scope: ProjectOwnerScope,
): { projectId: string | null; limit: number; position: ProjectPinPosition | null } {
  for (const key of query.keys()) if (!["project_id", "limit", "cursor"].includes(key) || query.getAll(key).length !== 1) invalid()
  const projectId = query.get("project_id")
  if (projectId !== null) {
    if (!projectPinId(projectId) || query.has("limit") || query.has("cursor")) invalid()
    return { projectId, limit: 1, position: null }
  }
  const rawLimit = query.get("limit")
  if (rawLimit !== null && !/^(?:[1-9][0-9]?|100)$/u.test(rawLimit)) invalid()
  const limit = rawLimit === null ? 50 : Number(rawLimit),
    cursor = query.get("cursor")
  if (cursor === null) return { projectId: null, limit, position: null }
  if (!cursor.startsWith("pp1_") || Buffer.byteLength(cursor) > 2048) invalid()
  const encoded = cursor.slice(4),
    bytes = Buffer.from(encoded, "base64url")
  if (!encoded || bytes.toString("base64url") !== encoded || bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) invalid()
  let raw: unknown
  try {
    raw = strictParseRawJson(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
  } catch {
    return invalid()
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return invalid()
  const r = raw as Record<string, unknown>
  if (
    Object.keys(r).sort().join(",") !== "kind,limit,pinnedAt,projectId,subjectId,tenantId" ||
    r.kind !== "project_pin" ||
    r.tenantId !== scope.tenantId ||
    r.subjectId !== scope.subjectId ||
    r.limit !== limit ||
    !projectPinId(r.projectId) ||
    !projectPinInstant(r.pinnedAt)
  )
    return invalid()
  return { projectId: null, limit, position: { projectId: r.projectId, pinnedAt: r.pinnedAt } }
}
export function encodeProjectPinCursor(position: ProjectPinPosition, scope: ProjectOwnerScope, limit: number): string {
  const cursor = `pp1_${Buffer.from(JSON.stringify({ kind: "project_pin", ...scope, limit, ...position })).toString("base64url")}`
  parseProjectPinQuery(new URLSearchParams({ cursor, limit: String(limit) }), scope)
  return cursor
}
