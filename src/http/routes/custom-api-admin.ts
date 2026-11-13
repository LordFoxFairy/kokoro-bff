import { Code, ConnectError } from "@connectrpc/connect"
import type { IncomingMessage, ServerResponse } from "node:http"
import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import { authorizeUserRequest } from "../../auth/user-admission.js"
import type { CustomApiAdminConnectClient } from "../../infrastructure/clients/platform/custom-api-admin-connect.js"
import { PLATFORM_COMMAND_RECEIPT_ERRORS } from "../../generated/platform-connect/command-receipt-errors.js"
import { customApiAdminTarget, parseCustomApiAdminHead, parseCustomApiAdminInput, readCustomApiAdminBody } from "../custom-api-admin-input.js"
import { mcpRequestRemaining, startMcpRequestBudget } from "../mcp-request-budget.js"
import { pathOf, requestId } from "../request.js"
import { send } from "../response.js"

type Fault = Readonly<{ status: number; code: string; retryable: boolean }>
function fault(error: unknown): Fault {
  const invalid = { status: 502, code: "custom_api_admin_response_invalid", retryable: false }
  if (!(error instanceof ConnectError)) return { status: 503, code: "custom_api_admin_dependency_unavailable", retryable: true }
  const marker = error.metadata.get("x-kokoro-error-code")
  if (marker !== null) {
    const receipt = Object.entries(PLATFORM_COMMAND_RECEIPT_ERRORS).find(([, item]) => item.error_code === marker)
    if (!receipt || receipt[1].rpc_code !== error.code || error.details.length !== 0) return invalid
    const policy = {
      in_progress: { status: 409, code: "custom_api_admin_command_in_progress", retryable: true },
      outcome_unknown: { status: 503, code: "custom_api_admin_command_outcome_unknown", retryable: false },
      replay_expired: { status: 412, code: "custom_api_admin_command_replay_expired", retryable: false },
      identity_conflict: { status: 409, code: "custom_api_admin_conflict", retryable: false },
      ownership_lost: { status: 409, code: "custom_api_admin_command_ownership_lost", retryable: false },
      invalid,
    } as const
    return policy[receipt[0] as keyof typeof policy]
  }
  if (error.code === Code.InvalidArgument) return { status: 400, code: "invalid_custom_api_admin_request", retryable: false }
  if (error.code === Code.NotFound) return { status: 404, code: "custom_api_admin_not_found", retryable: false }
  if (error.code === Code.AlreadyExists) return { status: 409, code: "custom_api_admin_conflict", retryable: false }
  if (error.code === Code.Aborted) return { status: 409, code: "custom_api_admin_command_in_progress", retryable: true }
  if (error.code === Code.FailedPrecondition) return { status: 412, code: "custom_api_admin_precondition_failed", retryable: false }
  if ([Code.DataLoss, Code.ResourceExhausted, Code.Internal].includes(error.code)) return invalid
  return { status: 503, code: "custom_api_admin_dependency_unavailable", retryable: true }
}
export async function handleCustomApiAdminRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  admission: SessionAdmission,
  client: Pick<CustomApiAdminConnectClient, "execute"> | null,
): Promise<boolean> {
  let path: string[]
  try {
    path = pathOf(request)
  } catch {
    return false
  }
  const target = customApiAdminTarget(path, request.method ?? "GET")
  if (!target) return false
  const id = requestId(request)
  response.setHeader("x-request-id", id)
  response.setHeader("cache-control", "no-store")
  startMcpRequestBudget(request)
  const fail = (status: number, code: string, retryable = false, retryAfter?: string) => {
    if (!response.destroyed && !response.writableEnded && !response.headersSent)
      send(response, status, { error: { code, message: "Custom API administration failed", retryable } }, retryAfter)
  }
  const controller = new AbortController(),
    abort = () => controller.abort()
  const timer = setTimeout(abort, mcpRequestRemaining(request))
  timer.unref()
  request.once("aborted", abort)
  response.once("close", abort)
  const active = () => {
    if (controller.signal.aborted || mcpRequestRemaining(request) <= 0)
      throw new ConnectError("Custom API administration deadline or cancellation", Code.DeadlineExceeded)
  }
  try {
    const head = parseCustomApiAdminHead(request, target, path)
    const raw = head.mutation ? await readCustomApiAdminBody(request, controller.signal) : Buffer.alloc(0)
    const input = parseCustomApiAdminInput(target, head, raw)
    active()
    const current = await authorizeUserRequest(request, config, admission, id, controller.signal, response)
    active()
    if (!current.ok) {
      fail(current.status, current.code, current.status === 429 || current.status === 503, current.retryAfter)
      return true
    }
    if (current.context.platformAdmin !== true) {
      fail(403, "session_forbidden")
      return true
    }
    if (!client) {
      fail(503, "custom_api_admin_dependency_unavailable", true)
      return true
    }
    const result = await client.execute(
      { tenantId: current.context.identity.namespace, subjectId: current.context.identity.userId, requestId: id },
      input,
      controller.signal,
      performance.now() + mcpRequestRemaining(request),
    )
    active()
    if (result.kind !== input.kind) throw new ConnectError("Custom API administration binding invalid", Code.DataLoss)
    if (result.kind === "get") send(response, 200, { data: result.profile })
    else if (result.kind === "list" || result.kind === "audit") send(response, 200, { data: { items: result.items, next_cursor: result.next_cursor } })
    else send(response, 200, { data: result.ack })
  } catch (error) {
    if (!request.complete && !response.headersSent) response.setHeader("connection", "close")
    const mapped = fault(error)
    fail(mapped.status, mapped.code, mapped.retryable)
  } finally {
    clearTimeout(timer)
    request.off("aborted", abort)
    response.off("close", abort)
  }
  return true
}
