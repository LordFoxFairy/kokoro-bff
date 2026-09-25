import type { IncomingMessage, ServerResponse } from "node:http"
import { isDeepStrictEqual } from "node:util"

import type { BffConfig } from "../../config/runtime.js"
import { failure } from "../../contracts/index.js"
import type { RequestContext } from "../../domain/request-context.js"
import { zCreateTenantInvitationBody, zReplaceTenantMemberRolesBody } from "../../generated/iam-http/zod.gen.js"
import { readIamTeamPage, writeIamTeam, type TeamReadKind, type TeamWriteKind } from "../../infrastructure/clients/iam-team.js"
import { queryOf, readBody, requestContentType } from "../request.js"
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

function writeRoute(method: string | undefined, path: readonly string[]): { kind: TeamWriteKind; resourceId: string | null } | null {
  if (method === "POST" && path.length === 2 && path[1] === "invitations") return { kind: "create-invitation", resourceId: null }
  if (method === "POST" && path.length === 4 && path[1] === "invitations" && path[3] === "resend")
    return { kind: "resend-invitation", resourceId: path[2] ?? null }
  if (method === "DELETE" && path.length === 3 && path[1] === "invitations") return { kind: "cancel-invitation", resourceId: path[2] ?? null }
  if (method === "PUT" && path.length === 4 && path[1] === "members" && path[3] === "roles") return { kind: "replace-roles", resourceId: path[2] ?? null }
  if (method === "DELETE" && path.length === 3 && path[1] === "members" && path[2] === "me") return { kind: "leave", resourceId: null }
  if (method === "DELETE" && path.length === 3 && path[1] === "members") return { kind: "remove-member", resourceId: path[2] ?? null }
  return null
}

export async function liveTeamWrite(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  context: RequestContext,
  token: string,
  businessPath: readonly string[],
): Promise<void> {
  response.setHeader("x-request-id", context.requestId)
  const route = writeRoute(request.method, businessPath)
  if (route === null) {
    send(response, 404, failure("team_route_not_found", "Team route was not found", context.requestId))
    return
  }
  if (
    queryOf(request).size !== 0 ||
    (route.resourceId !== null && !/^[A-Za-z0-9_-]{1,256}$/u.test(route.resourceId)) ||
    request.headers["idempotency-key"] !== undefined
  ) {
    send(response, 400, failure("team_input_invalid", "Team mutation input is invalid", context.requestId))
    return
  }
  const bodyRequired = route.kind === "create-invitation" || route.kind === "replace-roles"
  let body: Record<string, unknown> | null = null
  try {
    const bytes = await readBody(request)
    if (bodyRequired) {
      if (requestContentType(request).split(";", 1)[0]?.trim() !== "application/json" || bytes.byteLength === 0) throw new Error("invalid body")
      const raw: unknown = JSON.parse(bytes.toString("utf8"))
      const schema = route.kind === "create-invitation" ? zCreateTenantInvitationBody : zReplaceTenantMemberRolesBody
      const parsed = schema.safeParse(raw)
      if (!parsed.success || !isDeepStrictEqual(raw, parsed.data)) throw new Error("invalid body")
      body = parsed.data
    } else if (bytes.byteLength !== 0) throw new Error("unexpected body")
  } catch {
    send(response, 400, failure("team_input_invalid", "Team mutation input is invalid", context.requestId))
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
    const result = await writeIamTeam({
      baseUrl: config.iamBaseUrl,
      tenantId: context.identity.namespace,
      token,
      kind: route.kind,
      resourceId: route.resourceId,
      body,
      requestId: context.requestId,
      signal: abort.signal,
      timeoutMs: config.upstreamTimeoutMs,
      maxResponseBytes: config.upstreamMaxResponseBytes,
    })
    if (response.destroyed) return
    if (!result.ok) {
      send(response, result.status, failure(result.code, "Team mutation failed", context.requestId), result.retryAfter)
      return
    }
    send(response, 200, { data: result.data, meta: { request_id: context.requestId } })
  } finally {
    request.removeListener("aborted", onAbort)
    response.removeListener("close", onClose)
  }
}
