import { mcpRequestRemaining } from "../mcp-request-budget.js"
import { skillRequestRemaining } from "./skill-drafts.js"
import { IamPublisherProfileClient } from "../../infrastructure/clients/iam-publisher-profile.js"
import type { IncomingMessage, ServerResponse } from "node:http"

import type { BffConfig } from "../../config/runtime.js"
import type { RequestContext } from "../../domain/request-context.js"
import {
  zGetPublishedPersonalSkillPath,
  zListMcpServersQuery,
  zListSelfMcpConnectionsQuery,
  zListVisibleSkillCatalogQuery,
  zListVisibleSkillPoolQuery,
  zListVisibleSkillsQuery,
} from "../../generated/platform-http/zod.gen.js"
import { PlatformProjectionHttpClient, type ProjectionOperation } from "../../infrastructure/clients/platform/projection-http.js"
import { queryOf } from "../request.js"
import { send } from "../response.js"

const clients = new WeakMap<BffConfig, PlatformProjectionHttpClient>()
const skillQueryKeys = new Set(["query", "tags", "scope_kind", "limit", "cursor", "category_key", "source_kind"])
const connectionQueryKeys = new Set(["connection_id", "provider_key", "limit", "cursor"])
const mcpQueryKeys = new Set(["provider_key", "limit", "cursor"])

function operationFor(path: string[], method: string): ProjectionOperation | null {
  if (method !== "GET") return null
  if (path.length === 1 && path[0] === "skills") return "skills"
  if (path.length === 2 && path[0] === "skills" && path[1] === "pool") return "pool"
  if (path.length === 2 && path[0] === "skills" && path[1] === "catalog") return "catalog"
  if (path.length === 2 && path[0] === "skills" && !["quota", "drafts", "github"].includes(path[1] ?? "")) return "skill"
  if (path.length === 2 && path[0] === "mcp" && path[1] === "servers") return "mcp"
  if (path.length === 2 && path[0] === "mcp" && path[1] === "connections") return "mcpConnections"
  return null
}

function parseQuery(request: IncomingMessage, operation: ProjectionOperation): Record<string, unknown> | null {
  const incoming = queryOf(request)
  if (operation === "skill") return incoming.size === 0 ? {} : null
  const allowed = operation === "mcpConnections" ? connectionQueryKeys : operation === "mcp" ? mcpQueryKeys : skillQueryKeys
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
    operation === "mcpConnections"
      ? zListSelfMcpConnectionsQuery
      : operation === "skills"
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
  const dependencyCode = operation === "mcpConnections" ? "mcp_connection_dependency_unavailable" : "skill_dependency_unavailable"
  const dependencyMessage = operation === "mcpConnections" ? "MCP connection projection is unavailable" : "Skill projection is unavailable"
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
    strictError(response, 503, dependencyCode, dependencyMessage, true)
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
  const timer = setTimeout(
    () => controller.abort(new Error("skill_read_deadline")),
    operation === "mcp" || operation === "mcpConnections" ? mcpRequestRemaining(request) : skillRequestRemaining(request),
  )
  try {
    if ((operation === "mcp" || operation === "mcpConnections") && mcpRequestRemaining(request) <= 0) throw new Error("mcp_read_deadline")
    const result = await client.read(
      operation,
      context.identity.namespace,
      context.identity.userId,
      context.requestId,
      { query, ...(skillId === undefined ? {} : { skillId }) },
      controller.signal,
    )
    if (
      controller.signal.aborted ||
      response.destroyed ||
      response.writableEnded ||
      ((operation === "mcp" || operation === "mcpConnections") && mcpRequestRemaining(request) <= 0)
    ) {
      if ((operation === "mcp" || operation === "mcpConnections") && !request.aborted && !response.destroyed && !response.writableEnded)
        strictError(response, 503, dependencyCode, dependencyMessage, true)
      return true
    }
    if (result.ok) {
      const token = /^Bearer ([^\s,]+)$/iu.exec(request.headers.authorization ?? "")?.[1]
      const data =
        operation === "mcp" || operation === "mcpConnections"
          ? result.data
          : await new IamPublisherProfileClient(config.iamBaseUrl ?? "", 5000).enrich(
              context.identity.namespace,
              token ?? "",
              context.requestId,
              result.data,
              controller.signal,
            )
      if (!controller.signal.aborted && !response.destroyed && !response.writableEnded) send(response, 200, { data })
    } else
      strictError(
        response,
        result.status,
        result.code,
        result.status === 404 ? "Skill was not found" : result.status === 400 ? "Read query is invalid" : dependencyMessage,
        result.retryable,
      )
  } catch {
    if (!request.aborted && !response.destroyed && !response.writableEnded) strictError(response, 503, dependencyCode, dependencyMessage, true)
  } finally {
    clearTimeout(timer)
    request.removeListener("aborted", abort)
    response.removeListener("close", abort)
  }
  return true
}
