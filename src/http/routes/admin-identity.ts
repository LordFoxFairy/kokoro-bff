import type { IncomingMessage, ServerResponse } from "node:http"

import type { BffConfig } from "../../config/runtime.js"
import { failure } from "../../contracts/index.js"
import type { AdmittedUserRequestContext } from "../../domain/request-context.js"
import { readIamTeamPage, type TeamReadKind } from "../../infrastructure/clients/iam-team.js"
import { readIamAuditEvents } from "../../infrastructure/clients/iam-audit-events.js"
import { queryOf } from "../request.js"
import { send } from "../response.js"

const IDENTITY_KINDS = new Set<TeamReadKind>(["members", "invitations", "roles"])

function pageQuery(request: IncomingMessage): Readonly<{ limit: number; cursor: string | null }> | null {
  const query = queryOf(request)
  if ([...query.keys()].some((key) => key !== "limit" && key !== "cursor")) return null
  if (query.getAll("limit").length > 1 || query.getAll("cursor").length > 1) return null
  const rawLimit = query.get("limit")
  const limit = rawLimit === null ? 25 : Number(rawLimit)
  if (rawLimit !== null && (!/^[1-9][0-9]{0,2}$/u.test(rawLimit) || !Number.isSafeInteger(limit) || limit > 100)) return null
  const cursor = query.get("cursor")
  return cursor === null || (cursor.length >= 1 && cursor.length <= 2048) ? { limit, cursor } : null
}

export async function liveAdminIdentityRead(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  context: AdmittedUserRequestContext,
  businessPath: readonly string[],
  signal: AbortSignal,
  deadlineAt: number,
): Promise<void> {
  response.setHeader("x-request-id", context.requestId)
  const kind = businessPath[2]
  if (
    request.method !== "GET" ||
    businessPath.length !== 3 ||
    businessPath[0] !== "admin" ||
    businessPath[1] !== "identity" ||
    (kind !== "audit-events" && !IDENTITY_KINDS.has(kind as TeamReadKind))
  ) {
    send(response, 404, failure("admin_identity_route_not_found", "Administrator identity route was not found", context.requestId))
    return
  }
  if (context.platformAdmin !== true) {
    send(response, 403, failure("admin_identity_forbidden", "Current administrator qualification is required", context.requestId))
    return
  }
  if (
    kind === "audit-events" &&
    (new URL(request.url ?? "/", "http://bff.local").pathname !== "/v1/admin/identity/audit-events" ||
      ["content-length", "transfer-encoding", "content-type", "idempotency-key"].some((name) => request.headers[name] !== undefined))
  ) {
    send(response, 400, failure("admin_identity_query_invalid", "Administrator identity page query is invalid", context.requestId))
    return
  }
  const page = pageQuery(request)
  if (page === null) {
    send(response, 400, failure("admin_identity_query_invalid", "Administrator identity page query is invalid", context.requestId))
    return
  }
  signal.throwIfAborted()
  if (kind === "audit-events") {
    const result = await readIamAuditEvents({
      baseUrl: config.iamBaseUrl,
      credentialFile: config.iamUserContextServiceCredentialFile,
      tenantId: context.identity.namespace,
      subjectId: context.identity.userId,
      requestId: context.requestId,
      ...page,
      signal,
      timeoutMs: Math.min(config.upstreamTimeoutMs, deadlineAt - performance.now()),
      maxResponseBytes: config.upstreamMaxResponseBytes,
    })
    signal.throwIfAborted()
    if (response.destroyed || response.writableEnded) return
    if (!result.ok) send(response, result.status, failure(result.code, "Administrator identity read is unavailable", context.requestId), result.retryAfter)
    else send(response, 200, { data: result.data, meta: { request_id: context.requestId } })
    return
  }
  const result = await readIamTeamPage({
    baseUrl: config.iamBaseUrl,
    tenantId: context.identity.namespace,
    credentialFile: config.iamUserContextServiceCredentialFile,
    subjectId: context.identity.userId,
    kind: kind as TeamReadKind,
    ...page,
    requestId: context.requestId,
    signal,
    timeoutMs: Math.min(config.upstreamTimeoutMs, deadlineAt - performance.now()),
    maxResponseBytes: config.upstreamMaxResponseBytes,
  })
  signal.throwIfAborted()
  if (response.destroyed || response.writableEnded) return
  if (!result.ok) {
    send(response, result.status, failure(result.code, "Administrator identity read is unavailable", context.requestId), result.retryAfter)
    return
  }
  send(response, 200, { data: result.data, meta: { request_id: context.requestId, next_cursor: result.nextCursor } })
}
