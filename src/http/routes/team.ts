import type { IncomingMessage, ServerResponse } from "node:http"

import type { BffConfig } from "../../config/runtime.js"
import { failure } from "../../contracts/index.js"
import type { RequestContext } from "../../domain/request-context.js"
import { readIamTeamPage, type TeamReadKind } from "../../infrastructure/clients/iam-team.js"
import { queryOf } from "../request.js"
import { send } from "../response.js"

const TEAM_KINDS = new Set<TeamReadKind>(["members", "invitations", "roles"])

function parseQuery(request: IncomingMessage): { limit: number; cursor: string | null } | null {
  const query = queryOf(request)
  if ([...query.keys()].some((key) => key !== "limit" && key !== "cursor")) return null
  if (query.getAll("limit").length > 1 || query.getAll("cursor").length > 1) return null
  const rawLimit = query.get("limit")
  const limit = rawLimit === null ? 25 : Number(rawLimit)
  if (rawLimit !== null && (!/^[1-9][0-9]{0,2}$/u.test(rawLimit) || !Number.isSafeInteger(limit) || limit > 100)) return null
  const cursor = query.get("cursor")
  if (cursor !== null && (cursor.length < 1 || cursor.length > 2048)) return null
  return { limit, cursor }
}

export async function liveTeamRead(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  context: RequestContext,
  token: string,
  businessPath: readonly string[],
): Promise<void> {
  response.setHeader("x-request-id", context.requestId)
  const kind = businessPath[1]
  if (businessPath.length !== 2 || request.method !== "GET" || !TEAM_KINDS.has(kind as TeamReadKind)) {
    send(response, 404, failure("team_route_not_found", "Team route was not found", context.requestId))
    return
  }
  const query = parseQuery(request)
  if (query === null) {
    send(response, 400, failure("team_query_invalid", "Team page query is invalid", context.requestId))
    return
  }
  const abort = new AbortController()
  const onAbort = (): void => abort.abort()
  const onClose = (): void => {
    if (!response.writableEnded) abort.abort()
  }
  request.once("aborted", onAbort)
  response.once("close", onClose)
  try {
    const result = await readIamTeamPage({
      baseUrl: config.iamBaseUrl,
      tenantId: context.identity.namespace,
      token,
      kind: kind as TeamReadKind,
      ...query,
      requestId: context.requestId,
      signal: abort.signal,
      timeoutMs: config.upstreamTimeoutMs,
      maxResponseBytes: config.upstreamMaxResponseBytes,
    })
    if (response.destroyed) return
    if (!result.ok) {
      send(response, result.status, failure(result.code, "Team read is unavailable", context.requestId), result.retryAfter)
      return
    }
    send(response, 200, { data: result.data, meta: { request_id: context.requestId, next_cursor: result.nextCursor } })
  } finally {
    request.removeListener("aborted", onAbort)
    response.removeListener("close", onClose)
  }
}
