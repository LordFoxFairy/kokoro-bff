import type { IncomingMessage, ServerResponse } from "node:http"

import type { BffConfig } from "../../config/runtime.js"
import type { RequestContext } from "../../domain/request-context.js"
import {
  zGetPublishedPersonalSkillPath,
  zListMcpServersQuery,
  zListVisibleSkillCatalogQuery,
  zListVisibleSkillPoolQuery,
  zListVisibleSkillsQuery,
} from "../../generated/platform-http/zod.gen.js"
import { PlatformProjectionHttpClient, type ProjectionOperation } from "../../infrastructure/clients/platform/projection-http.js"
import { queryOf } from "../request.js"
import { send } from "../response.js"

const clients = new WeakMap<BffConfig, PlatformProjectionHttpClient>()
const skillQueryKeys = new Set(["query", "tags", "scope_kind", "limit", "cursor"])
const mcpQueryKeys = new Set(["provider_key", "limit", "cursor"])

function operationFor(path: string[], method: string): ProjectionOperation | null {
  if (method !== "GET") return null
  if (path.length === 1 && path[0] === "skills") return "skills"
  if (path.length === 2 && path[0] === "skills" && path[1] === "pool") return "pool"
  if (path.length === 2 && path[0] === "skills" && path[1] === "catalog") return "catalog"
  if (path.length === 2 && path[0] === "skills" && !["quota", "drafts", "github"].includes(path[1] ?? "")) return "skill"
  if (path.length === 2 && path[0] === "mcp" && path[1] === "servers") return "mcp"
  return null
}

function parseQuery(request: IncomingMessage, operation: ProjectionOperation): Record<string, unknown> | null {
  const incoming = queryOf(request)
  if (operation === "skill") return incoming.size === 0 ? {} : null
  const allowed = operation === "mcp" ? mcpQueryKeys : skillQueryKeys
  const query: Record<string, unknown> = {}
  for (const key of new Set(incoming.keys())) {
    if (!allowed.has(key)) return null
    const values = incoming.getAll(key)
    if (key !== "tags" && values.length !== 1) return null
    const normalized = values.map((value) => value.trim())
    if (normalized.some((value) => value.length === 0)) return null
    if (key === "tags") {
      if (normalized.some((value) => value.includes(","))) return null
      query.tags = normalized
    } else if (key === "limit") {
      if (!/^[1-9][0-9]*$/u.test(normalized[0] ?? "")) return null
      query.limit = Number(normalized[0])
    } else query[key] = normalized[0]
  }
  const schema =
    operation === "skills"
      ? zListVisibleSkillsQuery
      : operation === "pool"
        ? zListVisibleSkillPoolQuery
        : operation === "catalog"
          ? zListVisibleSkillCatalogQuery
          : zListMcpServersQuery
  const checked = schema.safeParse(query)
  return checked.success ? checked.data : null
}

function strictError(response: ServerResponse, status: number, code: string, message: string, retryable = false): void {
  send(response, status, { error: { code, message, retryable } })
}

export async function livePlatformProjectionRead(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  context: RequestContext,
  path: string[],
): Promise<boolean> {
  const operation = operationFor(path, request.method || "GET")
  if (operation === null) return false
  response.setHeader("x-request-id", context.requestId)
  if (
    (request.headers["content-length"] !== undefined && request.headers["content-length"] !== "0") ||
    request.headers["transfer-encoding"] !== undefined ||
    request.headers["idempotency-key"] !== undefined
  ) {
    strictError(
      response,
      400,
      operation === "skill" ? "invalid_skill_request" : "invalid_query_parameter",
      "Read requests must not contain a body or idempotency key",
    )
    return true
  }
  const query = parseQuery(request, operation)
  if (query === null) {
    strictError(response, 400, operation === "skill" ? "invalid_skill_request" : "invalid_query_parameter", "Read query is invalid")
    return true
  }
  const skillId = operation === "skill" ? path[1] : undefined
  if (operation === "skill" && !zGetPublishedPersonalSkillPath.safeParse({ skill_id: skillId }).success) {
    strictError(response, 400, "invalid_skill_request", "Skill ID is invalid")
    return true
  }
  const projection = config.platformProjection
  if (projection?.baseUrl === null || projection?.credentialFile === null || config.iamBaseUrl === null || projection === undefined) {
    strictError(response, 503, "skill_dependency_unavailable", "Skill projection is unavailable", true)
    return true
  }
  let client = clients.get(config)
  if (client === undefined) {
    client = new PlatformProjectionHttpClient(projection.baseUrl, config.iamBaseUrl, projection.credentialFile, projection.timeoutMs)
    clients.set(config, client)
  }
  const controller = new AbortController()
  const abort = (): void => controller.abort()
  request.once("aborted", abort)
  response.once("close", abort)
  let result
  try {
    result = await client.read(
      operation,
      context.identity.namespace,
      context.identity.userId,
      context.requestId,
      { query, ...(skillId === undefined ? {} : { skillId }) },
      controller.signal,
    )
  } catch {
    if (!response.destroyed) strictError(response, 503, "skill_dependency_unavailable", "Skill projection is unavailable", true)
    return true
  } finally {
    request.removeListener("aborted", abort)
    response.removeListener("close", abort)
  }
  if (response.destroyed) return true
  if (result.ok) send(response, 200, { data: result.data })
  else strictError(response, result.status, result.code, result.status === 404 ? "Skill was not found" : "Skill projection is unavailable", result.retryable)
  return true
}
