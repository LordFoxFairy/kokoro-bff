import type { IncomingMessage } from "node:http"

/** Raw browser intent, before any parsed query loses duplicate keys. */
export function parseAccountSessionInput(
  request: IncomingMessage,
  path: readonly string[],
): Readonly<{ kind: "list"; limit: number; cursor: string | null }> | Readonly<{ kind: "revoke"; sessionId: string }> | null {
  if (request.headers["transfer-encoding"] !== undefined || (request.headers["content-length"] !== undefined && request.headers["content-length"] !== "0"))
    return null
  const url = new URL(request.url ?? "/", "http://localhost")
  if (path[0] !== "account" || path[1] !== "sessions") return null
  if (request.method === "GET" && path.length === 2) {
    if ([...url.searchParams.keys()].some((key) => key !== "limit" && key !== "cursor")) return null
    if (url.searchParams.getAll("limit").length > 1 || url.searchParams.getAll("cursor").length > 1) return null
    const raw = url.searchParams.get("limit")
    const limit = raw === null ? 25 : Number(raw)
    if (raw !== null && (!/^[1-9][0-9]{0,2}$/u.test(raw) || !Number.isSafeInteger(limit) || limit > 100)) return null
    const cursor = url.searchParams.get("cursor")
    if (cursor !== null && (cursor.length === 0 || cursor.length > 2048)) return null
    return { kind: "list", limit, cursor }
  }
  if (request.method === "DELETE" && path.length === 3) {
    if ((request.url ?? "").includes("?") || request.headers["idempotency-key"] !== undefined) return null
    const sessionId = path[2]!
    if (sessionId.length < 1 || sessionId.length > 255) return null
    return { kind: "revoke", sessionId }
  }
  return null
}
