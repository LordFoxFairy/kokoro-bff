import type { IncomingMessage, ServerResponse } from "node:http"
import { Code, ConnectError } from "@connectrpc/connect"
import { z } from "zod"
import type { BffConfig } from "../../config/runtime.js"
import type { BffServerComposition } from "../../bootstrap/runtime.js"
import { authorizeUserRequest, authorizeMcpAction, type UserAdmissionResult } from "../../auth/user-admission.js"
import { mcpServerIconId } from "../../application/mcp-server-icon.contract.js"
import { mcpIconBindingSchema } from "../../infrastructure/clients/platform/mcp-icon.js"
import { mcpPersonalFault } from "../../infrastructure/clients/platform/mcp-personal-response.js"
import { readMcpIconBytes, mcpIconTransfer } from "../../infrastructure/clients/storage/mcp-icon-transfer.js"
import { mcpRequestRemaining } from "../mcp-request-budget.js"
import { send } from "../response.js"

const currentIcon = z.object({ server: z.object({ server_id: mcpServerIconId, icon: mcpIconBindingSchema.optional() }) })
function binding(value: unknown, id: string) {
  const parsed = currentIcon.parse(value).server
  if (parsed.server_id !== id) throw new Error("mcp_personal_response_invalid")
  if (!parsed.icon) throw new ConnectError("MCP icon not found", Code.NotFound)
  return parsed.icon
}
function identity(icon: z.infer<typeof mcpIconBindingSchema>): string {
  return JSON.stringify([icon.intent_id, icon.content_sha256, icon.size_bytes, icon.mime_type, icon.width, icon.height])
}

export async function mcpServerIconRoute(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  composition: BffServerComposition,
  initial: Extract<UserAdmissionResult, { ok: true }>,
  serverId: string,
): Promise<void> {
  const fail = (status: number, code: string, retryable = false, retryAfter?: string): void => {
    if (!response.destroyed && !response.writableEnded)
      send(response, status, { error: { code, message: "Personal MCP request failed", retryable } }, retryAfter)
  }
  if (
    !mcpServerIconId.safeParse(serverId).success ||
    request.url !== `/browser/v1/mcp/servers/${encodeURIComponent(serverId)}/icon` ||
    ["content-length", "transfer-encoding", "idempotency-key"].some((key) => request.headers[key] !== undefined)
  ) {
    fail(400, "invalid_mcp_personal_request")
    return
  }
  const controller = new AbortController()
  const remaining = mcpRequestRemaining(request),
    deadlineAt = performance.now() + remaining
  const abort = (): void => {
    if (!response.writableEnded) controller.abort()
  }
  const timer = setTimeout(abort, remaining)
  request.once("aborted", abort)
  response.once("close", abort)
  const within = <T>(work: Promise<T>): Promise<T> =>
    new Promise((resolve, reject) => {
      const canceled = (): void => reject(new Error("mcp_personal_deadline"))
      controller.signal.addEventListener("abort", canceled, { once: true })
      void work.then(resolve, reject).finally(() => controller.signal.removeEventListener("abort", canceled))
      if (controller.signal.aborted) canceled()
    })
  const input = { requestId: initial.context.requestId, tenant: initial.context.identity.namespace, subject: initial.context.identity.userId, id: serverId }
  try {
    controller.signal.throwIfAborted()
    const action = await within(authorizeMcpAction(composition.mcpAuthorization, initial, "read", controller.signal))
    if (!action.ok) {
      fail(action.status, action.code, action.status === 429 || action.status === 503, action.retryAfter)
      return
    }
    const client = composition.mcpPersonalClient
    const origin = config.storageObjectOrigin ?? config.storage?.objectOrigin
    if (!client?.server || !origin) throw new ConnectError("MCP icon dependency unavailable", Code.Unavailable)
    const icon = binding(await within(client.server("server", input, controller.signal, deadlineAt)), serverId)
    const bytes = await within(readMcpIconBytes(icon, origin, controller.signal))
    controller.signal.throwIfAborted()
    const fresh = binding(await within(client.server("server", input, controller.signal, deadlineAt)), serverId)
    if (identity(icon) !== identity(fresh)) throw new ConnectError("MCP icon changed", Code.NotFound)
    mcpIconTransfer(fresh, origin)
    const admitted = await within(authorizeUserRequest(request, config, composition.sessionAdmission, input.requestId, controller.signal))
    if (!admitted.ok) {
      fail(admitted.status, admitted.code, admitted.status === 429 || admitted.status === 503, admitted.retryAfter)
      return
    }
    if (admitted.context.identity.namespace !== input.tenant || admitted.context.identity.userId !== input.subject)
      throw new ConnectError("MCP icon not found", Code.NotFound)
    const freshAction = await within(authorizeMcpAction(composition.mcpAuthorization, admitted, "read", controller.signal))
    if (!freshAction.ok) {
      fail(freshAction.status, freshAction.code, freshAction.status === 429 || freshAction.status === 503, freshAction.retryAfter)
      return
    }
    controller.signal.throwIfAborted()
    if (mcpRequestRemaining(request) <= 0) throw new Error("mcp_personal_deadline")
    mcpIconTransfer(fresh, origin)
    if (!response.destroyed && !response.writableEnded) {
      response.writeHead(200, {
        "content-type": icon.mime_type,
        "content-length": bytes.length,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
      })
      response.end(bytes)
    }
  } catch (error) {
    const fault = mcpPersonalFault(controller.signal.aborted ? new ConnectError("MCP icon unavailable", Code.Unavailable) : error)
    fail(fault.status, fault.code, fault.retryable)
  } finally {
    controller.abort()
    clearTimeout(timer)
    request.removeListener("aborted", abort)
    response.removeListener("close", abort)
  }
}
