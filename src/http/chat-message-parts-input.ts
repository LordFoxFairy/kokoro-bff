import type { IncomingMessage } from "node:http"
import { queryOf } from "./request.js"

export type ChatMessagePartsInput =
  { ok: true; scope: "all" | "direct"; cursor: string | null; limit: number } | { ok: false; code: "invalid_scope" | "invalid_cursor" | "invalid_request" }

export function parseChatMessagePartsInput(request: IncomingMessage): ChatMessagePartsInput {
  const query = queryOf(request)
  if ([...query.keys()].some((key) => !["cursor", "limit", "scope", "project_ref"].includes(key))) return { ok: false, code: "invalid_request" }
  if (["cursor", "limit", "scope", "project_ref"].some((key) => query.getAll(key).length > 1)) return { ok: false, code: "invalid_request" }
  const rawScope = query.get("scope")?.trim()
  if (rawScope && rawScope !== "direct") return { ok: false, code: "invalid_scope" }
  const scope = rawScope === "direct" ? "direct" : "all"
  if (scope === "direct" && query.get("project_ref")?.trim()) return { ok: false, code: "invalid_scope" }
  const cursor = query.get("cursor")
  if (cursor !== null && !cursor.trim()) return { ok: false, code: "invalid_cursor" }
  const rawLimit = query.get("limit")
  if (rawLimit !== null && !/^(?:[1-9]|[12][0-9]|3[0-2])$/u.test(rawLimit)) return { ok: false, code: "invalid_request" }
  return { ok: true, scope, cursor, limit: rawLimit === null ? 16 : Number(rawLimit) }
}
