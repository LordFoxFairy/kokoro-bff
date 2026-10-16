import { Code, ConnectError } from "@connectrpc/connect"
import type { IncomingMessage, ServerResponse } from "node:http"

import type { BffServerComposition } from "../../bootstrap/runtime.js"
import type { BffConfig } from "../../config/runtime.js"
import { authorizeMcpCatalogAction, authorizeUserRequest } from "../../auth/user-admission.js"
import { mcpRequestRemaining } from "../mcp-request-budget.js"
import { send } from "../response.js"
import { parseMcpProviderAdminMutation, type McpProviderAdminMutation } from "../mcp-provider-admin-input.js"
import type { McpProviderAdminInput, McpProviderAdminOperation } from "../../infrastructure/clients/platform/mcp-provider-admin-connect.js"

const KEY = /^[a-z0-9][a-z0-9._-]{0,63}$/u
const CURSOR = /^[A-Za-z0-9_-]{1,2048}$/u
const COMMAND = /^[\x21-\x7e]{1,191}$/u
const contentType = /^application\/json(?:;\s*charset=utf-8)?$/iu

export function mcpProviderAdminOperation(path: string[], method: string): McpProviderAdminOperation | null {
  if (path[0] !== "admin" || path[1] !== "mcp" || path[2] !== "providers") return null
  if (path.length === 3 && method === "GET") return "list"
  if (path.length === 3 && method === "POST") return "create"
  if (path.length === 4 && method === "GET") return "get"
  if (path.length === 4 && method === "PATCH") return "update"
  if (path.length === 4 && method === "DELETE") return "remove"
  if (path.length === 5 && path[4] === "enabled" && method === "PUT") return "enabled"
  return null
}

function fail(response: ServerResponse, status: number, code: string, retryable = false): void {
  if (!response.destroyed && !response.writableEnded) send(response, status, { error: { code, message: "MCP provider administration failed", retryable } })
}
function ownerFault(error: unknown, operation: McpProviderAdminOperation): { status: number; code: string; retryable: boolean } | null {
  if (!(error instanceof ConnectError)) return null
  const mutation = operation === "create" || operation === "update" || operation === "enabled" || operation === "remove"
  if (error.code === Code.InvalidArgument) return { status: 400, code: "invalid_mcp_provider_admin_request", retryable: false }
  if (error.code === Code.NotFound && ["get", "update", "enabled", "remove"].includes(operation))
    return { status: 404, code: "mcp_provider_admin_not_found", retryable: false }
  if (error.code === Code.AlreadyExists && mutation) return { status: 409, code: "mcp_provider_admin_conflict", retryable: false }
  if (error.code === Code.Aborted && mutation) return { status: 409, code: "mcp_provider_admin_command_in_progress", retryable: true }
  if (error.code === Code.FailedPrecondition && mutation) return { status: 412, code: "mcp_provider_admin_precondition_failed", retryable: false }
  return null
}
async function readBody(request: IncomingMessage, signal: AbortSignal): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const raw of request) {
    signal.throwIfAborted()
    const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw)
    size += chunk.byteLength
    if (size > 128 * 1024) throw new Error("mcp_provider_admin_body_too_large")
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}
function commandId(request: IncomingMessage): string | null {
  const values = request.rawHeaders.filter((_, index) => index % 2 === 0 && request.rawHeaders[index]?.toLowerCase() === "idempotency-key")
  const value = request.headers["idempotency-key"]
  return values.length === 1 && typeof value === "string" && COMMAND.test(value) ? value : null
}

export async function mcpProviderAdminRoute(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  composition: BffServerComposition,
  requestId: string,
  path: string[],
): Promise<void> {
  const operation = mcpProviderAdminOperation(path, request.method ?? "GET")!
  const mutation = operation === "create" || operation === "update" || operation === "enabled" || operation === "remove"
  const url = new URL(request.url ?? "", "http://bff.invalid")
  const allowedQuery = operation === "list" ? ["query", "enabled", "limit", "cursor"] : []
  if (
    url.pathname !== `/v1/${path.map(encodeURIComponent).join("/")}` ||
    url.hash ||
    [...url.searchParams.keys()].some((name) => !allowedQuery.includes(name) || url.searchParams.getAll(name).length !== 1) ||
    (!mutation && ["content-length", "content-type", "transfer-encoding", "idempotency-key"].some((name) => request.headers[name] !== undefined)) ||
    (path.length > 3 && !KEY.test(path[3] ?? ""))
  ) {
    fail(response, 400, "invalid_mcp_provider_admin_request")
    return
  }
  if (mutation && (request.headers["transfer-encoding"] !== undefined || !contentType.test(String(request.headers["content-type"] ?? "")))) {
    fail(response, 400, "invalid_mcp_provider_admin_request")
    return
  }
  const length = request.headers["content-length"]
  if (mutation && (typeof length !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(length) || Number(length) > 128 * 1024 || commandId(request) === null)) {
    fail(response, 400, "invalid_mcp_provider_admin_request")
    return
  }
  const controller = new AbortController()
  const abort = (): void => controller.abort()
  request.once("aborted", abort)
  response.once("close", abort)
  const remaining = mcpRequestRemaining(request)
  const timer = setTimeout(abort, remaining)
  try {
    const query = url.searchParams
    const input: McpProviderAdminInput = {
      requestId,
      tenantId: "",
      subjectId: "",
      ...(path.length > 3 ? { providerKey: path[3]! } : {}),
      ...(query.has("query") ? { query: query.get("query")! } : {}),
      ...(query.has("limit") ? { limit: Number(query.get("limit")) } : {}),
      ...(query.has("cursor") ? { cursor: query.get("cursor")! } : {}),
      ...(query.has("enabled") ? { enabled: query.get("enabled") === "true" } : {}),
    }
    if (
      (input.query !== undefined && (!input.query || input.query.trim() !== input.query || [...input.query].length > 1000)) ||
      (query.has("limit") && !/^(?:[1-9]|[1-9][0-9]|100)$/u.test(query.get("limit")!)) ||
      (input.cursor !== undefined && !CURSOR.test(input.cursor)) ||
      (query.has("enabled") && !["true", "false"].includes(query.get("enabled")!))
    ) {
      fail(response, 400, "invalid_mcp_provider_admin_request")
      return
    }
    let mutationInput: McpProviderAdminMutation | undefined
    if (mutation) {
      const raw = await readBody(request, controller.signal)
      if (Number(length) !== raw.byteLength) throw new Error("invalid_mcp_provider_admin_request")
      mutationInput = parseMcpProviderAdminMutation(operation, raw)
      Object.assign(input, {
        commandId: commandId(request)!,
        ...("provider" in mutationInput ? { provider: mutationInput.provider as Record<string, unknown> } : {}),
        ...("enabled" in mutationInput ? { enabled: mutationInput.enabled } : {}),
        ...("expectedStateVersion" in mutationInput ? { expectedStateVersion: mutationInput.expectedStateVersion } : {}),
      })
      if (operation === "create") input.providerKey = (mutationInput as Extract<McpProviderAdminMutation, { kind: "create" }>).provider.provider_key
      if (operation === "update" && input.providerKey !== (mutationInput as Extract<McpProviderAdminMutation, { kind: "update" }>).provider.provider_key) {
        fail(response, 400, "mcp_provider_key_immutable")
        return
      }
    }
    const current = await authorizeUserRequest(request, config, composition.sessionAdmission, requestId, controller.signal)
    if (!current.ok) {
      fail(response, current.status, current.code, current.status === 429 || current.status === 503)
      return
    }
    const allowed = await authorizeMcpCatalogAction(composition.mcpAuthorization, current, controller.signal)
    if (!allowed.ok) {
      fail(response, allowed.status, allowed.code, allowed.status === 429 || allowed.status === 503)
      return
    }
    const client = composition.mcpProviderAdminClient
    if (client === null) {
      fail(response, 503, "mcp_provider_admin_dependency_unavailable", true)
      return
    }
    const result = await client.execute(
      operation,
      { ...input, tenantId: current.context.identity.namespace, subjectId: current.context.identity.userId },
      controller.signal,
      performance.now() + mcpRequestRemaining(request),
    )
    controller.signal.throwIfAborted()
    send(response, operation === "create" ? 201 : 200, { data: result })
  } catch (error) {
    const owner = ownerFault(error, operation)
    const code = error instanceof Error ? error.message : "mcp_provider_admin_dependency_unavailable"
    if (owner !== null) fail(response, owner.status, owner.code, owner.retryable)
    else if (!(error instanceof ConnectError) && (code === "invalid_mcp_provider_admin_request" || code === "mcp_provider_admin_body_too_large"))
      fail(response, 400, code)
    else fail(response, 503, "mcp_provider_admin_dependency_unavailable", true)
  } finally {
    clearTimeout(timer)
    request.removeListener("aborted", abort)
    response.removeListener("close", abort)
  }
}
