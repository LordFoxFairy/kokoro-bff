import type { IncomingMessage, ServerResponse } from "node:http"
import type { BffConfig } from "../../config/runtime.js"
import type { BffServerComposition } from "../../bootstrap/runtime.js"
import { authorizeUserRequest, authorizeMcpAction, type UserAdmissionResult } from "../../auth/user-admission.js"
import {
  mcpPersonalFault,
  validateMcpPersonalPublic,
  validateMcpPersonalCommand,
  type McpPersonalOperation,
  type McpPersonalInput,
} from "../../infrastructure/clients/platform/mcp-personal-response.js"
import { parseMcpPersonalCommand } from "../mcp-personal-command-input.js"
import { parseMcpPersonalAuthorization } from "../mcp-personal-authorization-input.js"
import type { McpPersonalCommandOperation, McpPersonalCommandInput } from "../../infrastructure/clients/platform/mcp-personal-command-binding.js"
import type {
  McpPersonalAuthorizationInput,
  McpPersonalAuthorizationOperation,
} from "../../infrastructure/clients/platform/mcp-personal-authorization-binding.js"
import type {
  McpPersonalServerInput,
  McpPersonalServerMutation,
  McpPersonalServerOperation,
} from "../../infrastructure/clients/platform/mcp-personal-server-binding.js"
import { mcpPersonalServerFault } from "../../infrastructure/clients/platform/mcp-personal-server-response.js"
import { parseMcpPersonalServer } from "../mcp-personal-server-input.js"
import { mcpRequestRemaining } from "../mcp-request-budget.js"
import { send } from "../response.js"

export function mcpPersonalOperation(
  path: string[],
  method: string,
): McpPersonalOperation | McpPersonalCommandOperation | McpPersonalAuthorizationOperation | McpPersonalServerOperation | null {
  if (path[0] !== "mcp") return null
  if (path[1] === "connectors") {
    if (path.length === 2 && method === "POST") return "create"
    if (path.length === 3 && method === "PATCH") return "update"
    if (path.length === 3 && method === "DELETE") return "remove"
    if (path.length === 4 && path[3] === "enabled" && method === "PUT") return "enabled"
    if (path.length === 4 && path[3] === "authorization" && method === "POST") return "begin"
    if (path.length === 5 && path[3] === "authorization" && path[4] === "reconnect" && method === "POST") return "reconnect"
  }
  if (path.length === 3 && path[1] === "authorization" && path[2] === "callback" && method === "POST") return "complete"
  if (path.length === 2 && path[1] === "connections" && method === "POST") return "createConnection"
  if (path.length === 2 && path[1] === "servers" && method === "POST") return "registerServer"
  if (path.length === 3 && path[1] === "servers" && method === "PATCH") return "updateServer"
  if (path.length === 3 && path[1] === "servers" && method === "DELETE") return "deleteServer"
  if (path.length === 4 && path[1] === "servers" && path[3] === "prepare" && method === "POST") return "prepareServer"
  if (method !== "GET") return null
  if (path.length === 2 && path[1] === "providers") return "providers"
  if (path.length === 3 && path[1] === "providers") return "provider"
  if (path.length === 2 && path[1] === "connectors") return "connectors"
  if (path.length === 3 && path[1] === "connectors") return "connector"
  if (path.length === 4 && path[1] === "connectors" && path[3] === "connections") return "connections"
  if (path.length === 3 && path[1] === "connections") return "connection"
  if (path.length === 3 && path[1] === "servers") return "server"
  return null
}
export async function mcpPersonalRoute(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  composition: BffServerComposition,
  initialAdmission: Extract<UserAdmissionResult, { ok: true }>,
  path: string[],
): Promise<void> {
  const context = initialAdmission.context
  const operation = mcpPersonalOperation(path, request.method ?? "GET")!
  const authorization = ["begin", "reconnect", "complete", "createConnection"].includes(operation)
  const serverOperation = ["registerServer", "server", "prepareServer", "updateServer", "deleteServer"].includes(operation)
  const mutation = [
    "create",
    "update",
    "enabled",
    "remove",
    "begin",
    "reconnect",
    "complete",
    "createConnection",
    "registerServer",
    "prepareServer",
    "updateServer",
    "deleteServer",
  ].includes(operation)
  const fail = (status: number, code: string, retryable = false, retryAfter?: string): void => {
    if (!response.destroyed && !response.writableEnded)
      send(response, status, { error: { code, message: "Personal MCP request failed", retryable } }, retryAfter)
  }
  const input: McpPersonalInput = { requestId: context.requestId, tenant: context.identity.namespace, subject: context.identity.userId }
  const url = new URL(request.url ?? "", "http://bff.invalid")
  const query = url.searchParams
  const allowed =
    operation === "connectors"
      ? ["status", "limit", "cursor"]
      : operation === "connections"
        ? ["limit", "cursor"]
        : operation === "providers"
          ? ["query", "directory_type", "category_key", "limit", "cursor"]
          : []
  const invalid = (): void => fail(400, "invalid_mcp_personal_request")
  if (
    (mutation
      ? request.headers["transfer-encoding"] !== undefined || query.size > 0
      : ["content-length", "transfer-encoding", "idempotency-key"].some((key) => request.headers[key] !== undefined)) ||
    url.pathname !== `/browser/v1/${path.map(encodeURIComponent).join("/")}` ||
    url.hash ||
    [...query.keys()].some((key) => !allowed.includes(key) || query.getAll(key).length !== 1)
  ) {
    invalid()
    return
  }
  if (authorization && (operation === "begin" || operation === "reconnect")) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}(?![\s\S])/u.test(path[2] ?? "")) {
      invalid()
      return
    }
    input.id = path[2]!
  } else if (!authorization && !["connectors", "providers", "create", "registerServer"].includes(operation)) {
    if (!(operation === "provider" ? /^[a-z0-9][a-z0-9._-]{0,63}(?![\s\S])/u : /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}(?![\s\S])/u).test(path[2] ?? "")) {
      invalid()
      return
    }
    input.id = path[2]!
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
  if (query.has("query")) {
    const value = query.get("query")!
    if (!value || value.trim() !== value || [...value].length > 1000 || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) {
      invalid()
      return
    }
    input.query = value
  }
  if (query.has("directory_type")) {
    const value = query.get("directory_type")!
    if (value !== "app" && value !== "data_source") {
      invalid()
      return
    }
    input.directoryType = value
  }
  if (query.has("category_key")) {
    const value = query.get("category_key")!
    if (!["efficiency", "creation", "business", "development", "finance", "travel", "health"].includes(value)) {
      invalid()
      return
    }
    input.categoryKey = value as NonNullable<McpPersonalInput["categoryKey"]>
  }
  const client = composition.mcpPersonalClient
  if (
    client === null ||
    (authorization && !client.authorization) ||
    (serverOperation && !client.server) ||
    (!authorization && !serverOperation && mutation && !client.command)
  ) {
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
    let commandInput: McpPersonalCommandInput | undefined
    let authorizationInput: McpPersonalAuthorizationInput | undefined
    let serverInput: McpPersonalServerInput | undefined
    if (mutation) {
      const key = request.headers["idempotency-key"]
      const keyCount = request.rawHeaders.filter((_, index) => index % 2 === 0 && request.rawHeaders[index]!.toLowerCase() === "idempotency-key").length
      const commandMutation = !authorization || operation === "createConnection"
      if (
        (commandMutation && (typeof key !== "string" || keyCount !== 1 || !/^[\x21-\x7e]{1,191}(?![\s\S])/u.test(key))) ||
        (!commandMutation && key !== undefined) ||
        !/^application\/json(?:;\s*charset=utf-8)?$/iu.test(String(request.headers["content-type"] ?? ""))
      )
        throw new Error("invalid_mcp_personal_request")
      const length = request.headers["content-length"]
      if (length !== undefined && (typeof length !== "string" || !/^(0|[1-9][0-9]*)(?![\s\S])/u.test(length))) throw new Error("invalid_mcp_personal_request")
      if (length !== undefined && Number(length) > 65_536) throw new Error("mcp_personal_body_too_large")
      const iterator = request[Symbol.asyncIterator]()
      const chunks: Buffer[] = []
      let size = 0
      try {
        for (;;) {
          const next = await within(iterator.next())
          controller.signal.throwIfAborted()
          if (next.done) break
          const chunk = Buffer.isBuffer(next.value) ? next.value : Buffer.from(next.value)
          size += chunk.length
          if (size > 65_536) throw new Error("mcp_personal_body_too_large")
          chunks.push(chunk)
        }
      } finally {
        if (controller.signal.aborted) request.destroy()
      }
      if (length !== undefined && Number(length) !== size) throw new Error("invalid_mcp_personal_request")
      if (serverOperation) {
        serverInput = { ...input, ...parseMcpPersonalServer(operation as McpPersonalServerMutation, Buffer.concat(chunks)), commandId: key as string }
      } else if (authorization) {
        const fields = parseMcpPersonalAuthorization(operation as McpPersonalAuthorizationOperation, Buffer.concat(chunks))
        authorizationInput = {
          ...input,
          ...fields,
          ...(fields.connectorId === undefined ? {} : { id: fields.connectorId }),
          ...(commandMutation ? { commandId: key as string } : {}),
        }
      } else commandInput = { ...input, ...parseMcpPersonalCommand(operation as McpPersonalCommandOperation, Buffer.concat(chunks)), commandId: key as string }
    }
    const result = await within(
      authorization
        ? client.authorization!(operation as McpPersonalAuthorizationOperation, authorizationInput!, controller.signal, deadlineAt)
        : serverOperation
          ? client.server!(operation as McpPersonalServerOperation, serverInput ?? input, controller.signal, deadlineAt)
          : mutation
            ? client.command!(operation as McpPersonalCommandOperation, commandInput!, controller.signal, deadlineAt)
            : client.read(operation as McpPersonalOperation, input, controller.signal, deadlineAt),
    )
    controller.signal.throwIfAborted()
    const data = authorization
      ? result
      : serverOperation
        ? result
        : mutation
          ? validateMcpPersonalCommand(operation as McpPersonalCommandOperation, result, commandInput!)
          : validateMcpPersonalPublic(operation as McpPersonalOperation, result, input)
    const [sessionOutcome, actionOutcome] = await within(
      Promise.allSettled([
        mutation
          ? authorizeUserRequest(request, config, composition.sessionAdmission, context.requestId, controller.signal)
          : Promise.resolve(initialAdmission),
        authorizeMcpAction(composition.mcpAuthorization, initialAdmission, mutation ? "manage" : "read", controller.signal),
      ]),
    )
    if (sessionOutcome.status === "rejected") {
      fail(503, "mcp_personal_dependency_unavailable", true)
      return
    }
    const admitted = sessionOutcome.value
    if (!admitted.ok) {
      fail(admitted.status, admitted.code, admitted.status === 429 || admitted.status === 503, admitted.retryAfter)
      return
    }
    if (admitted.context.identity.namespace !== input.tenant || admitted.context.identity.userId !== input.subject) {
      fail(404, "mcp_personal_not_found")
      return
    }
    if (actionOutcome.status === "rejected") {
      fail(503, "mcp_personal_dependency_unavailable", true)
      return
    }
    const action = actionOutcome.value
    if (!action.ok) {
      fail(action.status, action.code, action.status === 429 || action.status === 503)
      return
    }
    controller.signal.throwIfAborted()
    if (mcpRequestRemaining(request) <= 0) throw new Error("mcp_personal_deadline")
    if (!response.destroyed && !response.writableEnded)
      send(response, operation === "create" || operation === "createConnection" || operation === "registerServer" ? 201 : 200, { data })
  } catch (error) {
    if (!request.aborted && !response.destroyed && !response.writableEnded) {
      const fault = controller.signal.aborted
        ? { status: 503, code: "mcp_personal_dependency_unavailable", retryable: true }
        : serverOperation
          ? (mcpPersonalServerFault(error) ?? mcpPersonalFault(error, false, mutation))
          : mcpPersonalFault(error, input.cursor !== undefined, mutation)
      fail(fault.status, fault.code, fault.retryable)
    }
  } finally {
    controller.abort()
    clearTimeout(timer)
    request.removeListener("aborted", abort)
    response.removeListener("close", abort)
  }
}
