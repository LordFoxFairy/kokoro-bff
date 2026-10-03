import type { IncomingMessage } from "node:http"

import { queryOf } from "./request.js"

export type ChatProcessPageInput = { watermark: string; cursor: string | null; limit: number }

export function parseChatProcessPageInput(request: IncomingMessage): ChatProcessPageInput | null {
  const query = queryOf(request)
  if ([...query.keys()].some((key) => !["watermark", "cursor", "limit", "scope", "project_ref"].includes(key))) return null
  if (["watermark", "cursor", "limit"].some((key) => query.getAll(key).length > 1)) return null
  const watermark = query.get("watermark")
  if (watermark === null || watermark.trim() === "") return null
  const rawCursor = query.get("cursor")
  if (rawCursor !== null && rawCursor.trim() === "") return null
  const rawLimit = query.get("limit")
  const limit = rawLimit === null ? 100 : Number(rawLimit)
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) return null
  return { watermark, cursor: rawCursor, limit }
}
