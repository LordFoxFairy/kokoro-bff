import type { IncomingMessage, ServerResponse } from "node:http"
import type { BffConfig } from "../../config/runtime.js"
import type { BffServerComposition } from "../../bootstrap/runtime.js"
import type { AdmittedUserRequestContext } from "../../domain/request-context.js"
import { authorizeUserRequest, authorizeMcpAction } from "../../auth/user-admission.js"
import {
  mcpPersonalFault,
  validateMcpPersonalPublic,
  type McpPersonalOperation,
  type McpPersonalInput,
} from "../../infrastructure/clients/platform/mcp-personal-response.js"
import { mcpRequestRemaining } from "../mcp-request-budget.js"
import { send } from "../response.js"

export function mcpPersonalOperation(path: string[], method: string): McpPersonalOperation | null {
  if (method !== "GET" || path[0] !== "self" || path[1] !== "mcp") return null
  if (path.length === 3 && path[2] === "connectors") return "connectors"
  if (path.length === 4 && path[2] === "connectors") return "connector"
  if (path.length === 5 && path[2] === "connectors" && path[4] === "connections") return "connections"
  if (path.length === 4 && path[2] === "connections") return "connection"
  return null
}
export async function mcpPersonalReadRoute(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  composition: BffServerComposition,
  context: AdmittedUserRequestContext,
  path: string[],
): Promise<void> {
  const operation = mcpPersonalOperation(path, request.method ?? "GET")!
  const fail = (status: number, code: string, retryable = false, retryAfter?: string): void => {
    if (!response.destroyed && !response.writableEnded) send(response, status, { error: { code, message: "Personal MCP read failed", retryable } }, retryAfter)
  }
  const input: McpPersonalInput = { requestId: context.requestId, tenant: context.identity.namespace, subject: context.identity.userId }
  const url = new URL(request.url ?? "", "http://bff.invalid")
  const query = url.searchParams
  const allowed = operation === "connectors" ? ["status", "limit", "cursor"] : operation === "connections" ? ["limit", "cursor"] : []
  const invalid = (): void => fail(400, "invalid_mcp_personal_request")
  if (
    ["content-length", "transfer-encoding", "idempotency-key"].some((key) => request.headers[key] !== undefined) ||
    url.pathname !== `/v1/${path.map(encodeURIComponent).join("/")}` ||
    url.hash ||
    [...query.keys()].some((key) => !allowed.includes(key) || query.getAll(key).length !== 1)
  ) {
    invalid()
    return
  }
  if (operation !== "connectors") {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(path[3] ?? "")) {
      invalid()
      return
    }
    input.id = path[3]!
  }
  if (query.has("limit")) {
    if (!/^(?:[1-9]|[1-9][0-9]|100)$/u.test(query.get("limit")!)) {
      invalid()
      return
    }
    input.limit = Number(query.get("limit"))
  }
  if (query.has("cursor")) {
    const value = query.get("cursor")!
    if (!/^[A-Za-z0-9_-]{1,2048}$/u.test(value)) {
      invalid()
      return
    }
    input.cursor = value
  }
  if (query.has("status")) {
    const value = query.get("status")!
    if (value !== "pending" && value !== "active" && value !== "error" && value !== "revoked") {
      invalid()
      return
    }
    input.status = value
  }
  const client = composition.mcpPersonalClient
  if (client === null) {
    fail(503, "mcp_personal_dependency_unavailable", true)
    return
  }
  const controller = new AbortController()
  const abort = (): void => {
    if (!response.writableEnded) controller.abort()
  }
  request.once("aborted", abort)
  response.once("close", abort)
  const remaining = mcpRequestRemaining(request)
  const deadlineAt = performance.now() + remaining
  const timer = setTimeout(() => controller.abort(), remaining)
  const within = <T>(work: Promise<T>): Promise<T> =>
    new Promise((resolve, reject) => {
      const aborted = (): void => reject(new Error("mcp_personal_deadline"))
      controller.signal.addEventListener("abort", aborted, { once: true })
      void work.then(resolve, reject).finally(() => controller.signal.removeEventListener("abort", aborted))
      if (controller.signal.aborted) aborted()
    })
  try {
    controller.signal.throwIfAborted()
    const result = await within(client.read(operation, input, controller.signal, deadlineAt))
    controller.signal.throwIfAborted()
    const data = validateMcpPersonalPublic(operation, result, input)
    const admitted = await within(authorizeUserRequest(request, config, composition.sessionAdmission, context.requestId, controller.signal))
    if (!admitted.ok) {
      fail(admitted.status, admitted.code, admitted.status === 429 || admitted.status === 503, admitted.retryAfter)
      return
    }
    if (admitted.context.identity.namespace !== input.tenant || admitted.context.identity.userId !== input.subject) {
      fail(404, "mcp_personal_not_found")
      return
    }
    const action = await within(authorizeMcpAction(composition.mcpAuthorization, admitted, "read", controller.signal))
    if (!action.ok) {
      fail(action.status, action.code, action.status === 429 || action.status === 503)
      return
    }
    controller.signal.throwIfAborted()
    if (mcpRequestRemaining(request) <= 0) throw new Error("mcp_personal_deadline")
    if (!response.destroyed && !response.writableEnded) send(response, 200, { data })
  } catch (error) {
    if (!request.aborted && !response.destroyed && !response.writableEnded) {
      const fault = controller.signal.aborted
        ? { status: 503, code: "mcp_personal_dependency_unavailable", retryable: true }
        : mcpPersonalFault(error, input.cursor !== undefined)
      fail(fault.status, fault.code, fault.retryable)
    }
  } finally {
    clearTimeout(timer)
    request.removeListener("aborted", abort)
    response.removeListener("close", abort)
  }
}
