import { Code, ConnectError } from "@connectrpc/connect"
import type { IncomingMessage, ServerResponse } from "node:http"
import type { BffConfig } from "../../config/runtime.js"
import type { BffServerComposition } from "../../bootstrap/runtime.js"
import { authorizeMcpCatalogAction, authorizeUserRequest } from "../../auth/user-admission.js"
import type { McpPackageAdminInput } from "../../infrastructure/clients/platform/mcp-package-admin-input.js"
import { parseMcpPackageHttpInput, readMcpPackageBody } from "../mcp-package-admin-input.js"
import { mcpRequestRemaining } from "../mcp-request-budget.js"
import { send } from "../response.js"
export function mcpPackageAdminOperation(path: string[], method: string): McpPackageAdminInput["kind"] | null {
  if (path[0] !== "admin" || path[1] !== "mcp" || path[2] !== "packages") return null
  if (path.length === 5 && method === "POST") return path[4] === "uploads" ? "begin" : path[4] === "publish" ? "publish" : null
  if (path[4] !== "uploads") return null
  if (path.length === 6 && method === "GET") return "status"
  if (path.length === 7 && method === "POST") return path[6] === "complete" ? "complete" : path[6] === "abort" ? "abort" : null
  return null
}
function fail(response: ServerResponse, status: number, code: string, retryable = false) {
  if (!response.destroyed && !response.writableEnded) send(response, status, { error: { code, message: "MCP package administration failed", retryable } })
}
function fault(error: unknown): { status: number; code: string; retryable: boolean } {
  if (error instanceof ConnectError) {
    const reason = error.metadata.get("x-kokoro-error-code")
    if (reason === "package_limit_exceeded" && [Code.ResourceExhausted, Code.FailedPrecondition].includes(error.code))
      return { status: 413, code: "mcp_package_limit_exceeded", retryable: false }
    if (error.code === Code.InvalidArgument) return { status: 400, code: "invalid_mcp_package_admin_request", retryable: false }
    if (error.code === Code.NotFound) return { status: 404, code: "mcp_package_not_found", retryable: false }
    if (error.code === Code.AlreadyExists) return { status: 409, code: "mcp_package_command_conflict", retryable: false }
    if (error.code === Code.Aborted) return { status: 409, code: "mcp_package_command_in_progress", retryable: true }
    if (error.code === Code.FailedPrecondition) return { status: 412, code: "mcp_package_precondition_failed", retryable: false }
    if ([Code.DataLoss, Code.ResourceExhausted, Code.Internal].includes(error.code))
      return { status: 502, code: "mcp_package_response_invalid", retryable: false }
  }
  return { status: 503, code: "mcp_package_dependency_unavailable", retryable: true }
}
export async function mcpPackageAdminRoute(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  composition: BffServerComposition,
  requestId: string,
  path: string[],
) {
  const kind = mcpPackageAdminOperation(path, request.method ?? "GET")!
  const url = new URL(request.url ?? "", "http://bff.invalid")
  const mutation = kind !== "status",
    length = request.headers["content-length"]
  const keys = request.rawHeaders.flatMap((name, index) =>
    index % 2 === 0 && name.toLowerCase() === "idempotency-key" ? [request.rawHeaders[index + 1] ?? ""] : [],
  )
  const key = keys.length === 1 && /^[\x21-\x7e]{1,191}$/u.test(keys[0]!) ? keys[0] : undefined
  if (
    url.pathname !== `/v1/${path.map(encodeURIComponent).join("/")}` ||
    url.search ||
    url.hash ||
    (mutation
      ? key === undefined ||
        request.headers["transfer-encoding"] !== undefined ||
        !/^application\/json(?:;\s*charset=utf-8)?$/iu.test(String(request.headers["content-type"] ?? "")) ||
        typeof length !== "string" ||
        !/^(?:0|[1-9][0-9]*)$/u.test(length) ||
        Number(length) > 32768
      : ["content-type", "content-length", "transfer-encoding", "idempotency-key"].some((name) => request.headers[name] !== undefined))
  ) {
    fail(response, 400, "invalid_mcp_package_admin_request")
    return
  }
  const controller = new AbortController(),
    abort = () => controller.abort()
  const timer = setTimeout(abort, mcpRequestRemaining(request))
  timer.unref()
  request.once("aborted", abort)
  response.once("close", abort)
  try {
    const raw = mutation ? await readMcpPackageBody(request, controller.signal) : Buffer.alloc(0)
    if (mutation && Number(length) !== raw.byteLength) throw new ConnectError("Invalid body length", Code.InvalidArgument)
    const current = await authorizeUserRequest(request, config, composition.sessionAdmission, requestId, controller.signal)
    controller.signal.throwIfAborted()
    if (!current.ok) {
      fail(response, current.status, current.code, current.status === 429 || current.status === 503)
      return
    }
    if (!current.context.platformAdmin) {
      fail(response, 403, "session_forbidden")
      return
    }
    const allowed = await authorizeMcpCatalogAction(composition.mcpAuthorization, current, controller.signal)
    if (!allowed.ok) {
      fail(response, allowed.status, allowed.code, allowed.status === 429 || allowed.status === 503)
      return
    }
    const identity = { tenantId: current.context.identity.namespace, subjectId: current.context.identity.userId, requestId }
    const input = parseMcpPackageHttpInput(
      identity,
      kind,
      path[3]!,
      kind === "status" || kind === "complete" || kind === "abort" ? path[5] : undefined,
      mutation ? key : undefined,
      raw,
    )
    const client = composition.mcpPackageAdminClient
    if (client === null) {
      fail(response, 503, "mcp_package_dependency_unavailable", true)
      return
    }
    const result = await client.execute(identity, input, controller.signal, performance.now() + mcpRequestRemaining(request))
    controller.signal.throwIfAborted()
    if (mcpRequestRemaining(request) <= 0) throw new ConnectError("Deadline", Code.DeadlineExceeded)
    if (result.kind !== kind) throw new ConnectError("MCP package binding invalid", Code.DataLoss)
    switch (result.kind) {
      case "complete":
      case "status":
        send(response, 200, { data: result.upload })
        break
      case "begin":
        send(response, 200, { data: { package_id: result.package_id, upload_id: result.upload_id, transfer_reference: result.transfer_reference } })
        break
      case "abort":
        send(response, 200, { data: { upload_id: result.upload_id, state: result.state } })
        break
      case "publish":
        send(response, 200, { data: { package_version_id: result.package_version_id, server_id: result.server_id, replayed: result.replayed } })
        break
    }
  } catch (error) {
    if (!request.complete && !response.headersSent) response.setHeader("connection", "close")
    const mapped = fault(error)
    fail(response, mapped.status, mapped.code, mapped.retryable)
  } finally {
    clearTimeout(timer)
    request.removeListener("aborted", abort)
    response.removeListener("close", abort)
  }
}
