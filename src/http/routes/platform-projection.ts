import { isDeepStrictEqual } from "node:util"
import { authorizePublicSkillList } from "../../auth/public-skill-list-admission.js"
import { ConnectError, Code } from "@connectrpc/connect"
import { authorizeUserRequest } from "../../auth/user-admission.js"
import type { BffServerComposition } from "../../bootstrap/runtime.js"
import type { SkillSpecificationOperation } from "../../application/skill-specification.types.js"
import { strictParseRawJson } from "../../infrastructure/raw-json.js"
import {
  publicSkillListSchema,
  publicSkillQuerySchema,
  websiteEmptyRequestSchema,
  websiteHubRequestSchema,
  websiteHubResponseSchema,
  websiteListResponseSchema,
  websiteSkillRequestSchema,
  websiteSkillSchema,
} from "../skill-specification-schema.js"
import { startSkillRequestBudget, readSkillBody } from "./skill-drafts.js"
import { mcpRequestRemaining } from "../mcp-request-budget.js"
import { skillRequestRemaining } from "./skill-drafts.js"
import type { IncomingMessage, ServerResponse } from "node:http"

import type { BffConfig } from "../../config/runtime.js"
import type { RequestContext } from "../../domain/request-context.js"
import { zListMcpServersQuery, zListSelfMcpConnectionsQuery } from "../../generated/platform-http/zod.gen.js"
import { PlatformProjectionHttpClient, type ProjectionOperation } from "../../infrastructure/clients/platform/projection-http.js"
import { queryOf } from "../request.js"
import { send } from "../response.js"

const clients = new WeakMap<BffConfig, PlatformProjectionHttpClient>()
const connectionQueryKeys = new Set(["connection_id", "provider_key", "limit", "cursor"])
const mcpQueryKeys = new Set(["provider_key", "limit", "cursor"])

function operationFor(path: string[], method: string): ProjectionOperation | null {
  if (method !== "GET") return null
  if (path.length === 2 && path[0] === "mcp" && path[1] === "servers") return "mcp"
  if (path.length === 2 && path[0] === "mcp" && path[1] === "connections") return "mcpConnections"
  return null
}

function parseQuery(request: IncomingMessage, operation: ProjectionOperation): Record<string, unknown> | null {
  const incoming = queryOf(request)
  const allowed = operation === "mcpConnections" ? connectionQueryKeys : mcpQueryKeys
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
  const schema = operation === "mcpConnections" ? zListSelfMcpConnectionsQuery : zListMcpServersQuery
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
  const projection = config.platformProjection
  if (projection?.baseUrl === null || projection?.credentialFile === null || projection === undefined) {
    strictError(response, 503, dependencyCode, dependencyMessage, true)
    return true
  }
  let client = clients.get(config)
  if (client === undefined) {
    client = new PlatformProjectionHttpClient(projection.baseUrl, projection.credentialFile, projection.timeoutMs)
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
    const result = await client.read(operation, context.identity.namespace, context.identity.userId, context.requestId, { query }, controller.signal)
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
      const data = result.data
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

/** The specification representations are independent of the retired flattened catalog representation. */
export async function skillSpecificationReadRoute(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  composition: BffServerComposition,
  requestId: string,
  pathname: string,
): Promise<boolean> {
  const paths = new Map<string, SkillSpecificationOperation>([
    ["/v1/skill.list", "skill.list"],
    ["/skill.v1.SkillOptionalService/ListSkills", "ListSkills"],
    ["/skill.v1.SkillOptionalService/ListHubSkills", "ListHubSkills"],
    ["/skill.v1.SkillOptionalService/GetSkill", "GetSkill"],
    ["/skill.v1.SkillService/DownloadSkill", "DownloadSkill"],
  ])
  const operation = paths.get(pathname)
  if (operation === undefined) return false
  const publicList = operation === "skill.list"
  const error = (status: number, code: string, message: string): void => {
    send(response, status, publicList ? { ok: false, request_id: requestId, error: { code, message } } : { error: { code, message } })
  }
  if (request.method !== (publicList ? "GET" : "POST")) {
    response.setHeader("allow", publicList ? "GET" : "POST")
    error(405, "MethodNotAllowed", "Request method is invalid")
    return true
  }
  const deadlineAt = startSkillRequestBudget(request)
  const controller = new AbortController()
  const abort = (): void => controller.abort()
  request.once("aborted", abort)
  response.once("close", abort)
  const timer = setTimeout(abort, Math.max(0, skillRequestRemaining(request)))
  const within = <T>(work: Promise<T>): Promise<T> => {
    if (controller.signal.aborted) return Promise.reject(new Error("skill_read_deadline"))
    return new Promise<T>((resolve, reject) => {
      const cancelled = (): void => reject(new Error("skill_read_deadline"))
      controller.signal.addEventListener("abort", cancelled, { once: true })
      work.then(resolve, reject).finally(() => controller.signal.removeEventListener("abort", cancelled))
    })
  }
  try {
    let input: Record<string, unknown>
    const query = queryOf(request)
    if (request.headers["idempotency-key"] !== undefined) throw new Error("skill_spec_input_invalid")
    if (publicList) {
      if (request.headers["transfer-encoding"] !== undefined || (request.headers["content-length"] !== undefined && request.headers["content-length"] !== "0"))
        throw new Error("skill_spec_input_invalid")
      const values: Record<string, string> = {}
      for (const key of new Set(query.keys())) {
        if (query.getAll(key).length !== 1) throw new Error("skill_spec_input_invalid")
        values[key] = query.get(key) ?? ""
      }
      const parsed = publicSkillQuerySchema.safeParse(values)
      if (!parsed.success) throw new Error("skill_spec_input_invalid")
      input = parsed.data
    } else {
      if (query.size > 0 || !/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(request.headers["content-type"] ?? ""))
        throw new Error("skill_spec_input_invalid")
      let raw: unknown
      try {
        raw = strictParseRawJson(await within(readSkillBody(request)))
      } catch (cause) {
        if (controller.signal.aborted || (cause instanceof Error && cause.message === "request_body_too_large")) throw cause
        throw new Error("skill_spec_input_invalid")
      }
      const schema =
        operation === "ListSkills" ? websiteEmptyRequestSchema : operation === "ListHubSkills" ? websiteHubRequestSchema : websiteSkillRequestSchema
      const parsed = schema.safeParse(raw)
      if (!parsed.success) throw new Error("skill_spec_input_invalid")
      input = parsed.data
    }
    if (publicList) {
      const admission = await within(authorizePublicSkillList(request, config, composition.skillListAdmission, requestId, controller.signal))
      if (!admission.ok) {
        if (admission.retryAfter !== undefined) response.setHeader("retry-after", admission.retryAfter)
        error(admission.status, admission.code, "Current Skill list identity is required")
        return true
      }
      if (admission.context.principal.kind === "oauth_app" && !admission.context.principal.trusted && input.project_id !== undefined)
        throw new Error("skill_spec_input_invalid")
      const source = composition.skillSpecificationSource
      if (source === null) throw new Error("skill_dependency_unavailable")
      const result = await within(source.readPublicList(input, admission.context, controller.signal, deadlineAt))
      const parsed = publicSkillListSchema.safeParse(result)
      if (!parsed.success) throw new Error("skill_response_invalid")
      const fresh = await within(authorizePublicSkillList(request, config, composition.skillListAdmission, requestId, controller.signal))
      if (!fresh.ok) {
        if (fresh.retryAfter !== undefined) response.setHeader("retry-after", fresh.retryAfter)
        error(fresh.status, fresh.code, "Current Skill list identity is required")
        return true
      }
      if (!isDeepStrictEqual(admission.context.principal, fresh.context.principal)) {
        error(403, "skill_list_identity_changed", "Skill list identity changed during the request")
        return true
      }
      if (controller.signal.aborted || skillRequestRemaining(request) <= 0) throw new Error("skill_read_deadline")
      if (!response.destroyed && !response.writableEnded) send(response, 200, { ok: true, request_id: requestId, data: parsed.data })
      return true
    }
    const admission = await within(authorizeUserRequest(request, config, composition.sessionAdmission, requestId, controller.signal))
    if (!admission.ok) {
      if (admission.retryAfter !== undefined) response.setHeader("retry-after", admission.retryAfter)
      error(admission.status, admission.code, "Current user admission is required")
      return true
    }
    const source = composition.skillSpecificationSource
    if (source === null) throw new Error("skill_dependency_unavailable")
    const context = Object.freeze({ ...admission.context, identity: Object.freeze({ ...admission.context.identity }), humanBearer: admission.bearerToken })
    let payload: unknown
    if (operation === "GetSkill" || operation === "DownloadSkill") {
      const prepared = await within(source.prepareDownload(operation, input.skillId as string, context, controller.signal, deadlineAt))
      if (typeof prepared !== "object" || prepared === null || typeof prepared.binding !== "object" || prepared.binding === null)
        throw new Error("skill_response_invalid")
      const skill = websiteSkillSchema.safeParse(prepared.skill)
      const binding = prepared.binding
      if (
        !skill.success ||
        skill.data.id !== input.skillId ||
        binding.qualifier.kind !== "catalog_current" ||
        binding.qualifier.seriesId !== input.skillId ||
        binding.tenantId !== admission.context.identity.namespace ||
        binding.subjectId !== admission.context.identity.userId
      )
        throw new Error("skill_response_invalid")
      if (controller.signal.aborted || skillRequestRemaining(request) <= 0) throw new Error("skill_read_deadline")
      const handle = composition.skillDownloadHandles.issue(binding)
      payload = {
        skill: skill.data,
        downloadInfo: { downloadUrl: `/api/skill-downloads/${handle.handle}`, filename: binding.filename, expiresAt: new Date(handle.expiresAt).toISOString() },
      }
    } else {
      const result = await within(source.read(operation, input, context, controller.signal, deadlineAt))
      const schema = operation === "ListSkills" ? websiteListResponseSchema : websiteHubResponseSchema
      const parsed = schema.safeParse(result)
      if (!parsed.success) throw new Error("skill_response_invalid")
      payload = parsed.data
    }
    if (!controller.signal.aborted && skillRequestRemaining(request) > 0 && !response.destroyed && !response.writableEnded) send(response, 200, payload)
    else throw new Error("skill_read_deadline")
  } catch (cause) {
    if (!request.aborted && !response.destroyed && !response.writableEnded) {
      const code = cause instanceof Error ? cause.message : ""
      if (cause instanceof ConnectError && [Code.PermissionDenied, Code.Unauthenticated, Code.NotFound, Code.InvalidArgument].includes(cause.code)) {
        const status = cause.code === Code.PermissionDenied ? 403 : cause.code === Code.Unauthenticated ? 401 : cause.code === Code.NotFound ? 404 : 400
        error(
          status,
          status === 403 ? "PermissionDenied" : status === 401 ? "Unauthenticated" : status === 404 ? "NotFound" : "InvalidArgument",
          status === 400 ? "Read input is invalid" : "Skill is not available",
        )
      } else if (code === "request_body_too_large") error(413, "PayloadTooLarge", "Read body exceeds the request limit")
      else if (code === "skill_spec_input_invalid") error(400, "InvalidArgument", "Read input is invalid")
      else if (code === "skill_response_invalid") error(502, "InvalidResponse", "Skills dependency response is invalid")
      else if (code === "skill_download_expired") error(410, "Gone", "Download qualification has expired")
      else error(503, "Unavailable", "Skills dependency is unavailable")
    }
  } finally {
    clearTimeout(timer)
    request.removeListener("aborted", abort)
    response.removeListener("close", abort)
  }
  return true
}
