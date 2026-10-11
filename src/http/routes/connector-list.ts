import type { IncomingMessage, ServerResponse } from "node:http"
import { authorizeMcpAction, authorizeUserRequest } from "../../auth/user-admission.js"
import type { BffServerComposition } from "../../bootstrap/runtime.js"
import type { BffConfig } from "../../config/runtime.js"
import type { AdmittedUserRequestContext } from "../../domain/request-context.js"
import { mcpRequestRemaining } from "../mcp-request-budget.js"
import { send } from "../response.js"
import { ConnectorListProjectionError, parseConnectorListPage, parseProviderListPage, projectConnectorList } from "./connector-list-projection.js"

const maxPages = 100

export function isConnectorListRequest(path: readonly string[], method: string): boolean {
  return method === "GET" && path.length === 1 && path[0] === "connector.list"
}

export function connectorListFailure(response: ServerResponse, status: number, requestId: string, code: string, message: string): void {
  if (!response.destroyed && !response.writableEnded) {
    response.setHeader("cache-control", "no-store")
    response.setHeader("x-request-id", requestId)
    send(response, status, { ok: false, request_id: requestId, error: { code, message } })
  }
}

type Page = Readonly<{ items: readonly unknown[]; next_cursor: string | null }>

async function readAll(
  read: NonNullable<BffServerComposition["mcpPersonalClient"]>["read"],
  operation: "connectors" | "providers",
  input: Readonly<{ requestId: string; tenant: string; subject: string }>,
  signal: AbortSignal,
  deadlineAt: number,
): Promise<readonly unknown[]> {
  const values: unknown[] = []
  const cursors = new Set<string>()
  let cursor: string | undefined
  for (let pageNumber = 0; pageNumber < maxPages; pageNumber += 1) {
    signal.throwIfAborted()
    if (mcpRequestRemainingFrom(deadlineAt) <= 0) throw new Error("connector_deadline")
    const raw = await read(
      operation,
      { ...input, limit: 100, ...(cursor === undefined ? {} : { cursor }), ...(operation === "connectors" ? { status: "active" } : {}) },
      signal,
      deadlineAt,
    )
    const page: Page = operation === "connectors" ? parseConnectorListPage(raw) : parseProviderListPage(raw)
    values.push(...page.items)
    if (page.next_cursor === null) return values
    if (cursors.has(page.next_cursor)) throw new ConnectorListProjectionError()
    cursors.add(page.next_cursor)
    cursor = page.next_cursor
  }
  throw new ConnectorListProjectionError()
}

function mcpRequestRemainingFrom(deadlineAt: number): number {
  return Math.max(0, Math.floor(deadlineAt - performance.now()))
}

export async function connectorListRoute(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  composition: BffServerComposition,
  context: AdmittedUserRequestContext,
): Promise<void> {
  const requestId = context.requestId
  const url = new URL(request.url ?? "", "http://bff.invalid")
  if (
    url.pathname !== "/v1/connector.list" ||
    url.search ||
    url.hash ||
    ["content-length", "transfer-encoding", "idempotency-key"].some((key) => request.headers[key] !== undefined)
  ) {
    connectorListFailure(response, 400, requestId, "InvalidArgument", "Connector list request is invalid")
    return
  }
  const client = composition.mcpPersonalClient
  if (client === null) {
    connectorListFailure(response, 503, requestId, "Unavailable", "Connector list dependency is unavailable")
    return
  }
  const controller = new AbortController()
  const abort = (): void => controller.abort()
  request.once("aborted", abort)
  response.once("close", abort)
  const remaining = mcpRequestRemaining(request)
  const deadlineAt = performance.now() + remaining
  const timer = setTimeout(() => controller.abort(), remaining)
  const input = {
    requestId,
    tenant: context.identity.namespace,
    subject: context.identity.userId,
  }
  try {
    const [connectors, providers] = await Promise.all([
      readAll(client.read.bind(client), "connectors", input, controller.signal, deadlineAt),
      readAll(client.read.bind(client), "providers", input, controller.signal, deadlineAt),
    ])
    controller.signal.throwIfAborted()
    const current = await authorizeUserRequest(request, config, composition.sessionAdmission, requestId, controller.signal)
    if (!current.ok) {
      connectorListFailure(
        response,
        current.status,
        requestId,
        current.status === 401 ? "Unauthenticated" : current.status === 403 ? "PermissionDenied" : "Unavailable",
        "Connector list access is unavailable",
      )
      return
    }
    if (current.context.identity.namespace !== input.tenant || current.context.identity.userId !== input.subject) {
      connectorListFailure(response, 403, requestId, "PermissionDenied", "Connector list access is unavailable")
      return
    }
    const action = await authorizeMcpAction(composition.mcpAuthorization, current, "read", controller.signal)
    if (!action.ok) {
      connectorListFailure(
        response,
        action.status,
        requestId,
        action.status === 401 ? "Unauthenticated" : action.status === 403 ? "PermissionDenied" : "Unavailable",
        "Connector list access is unavailable",
      )
      return
    }
    if (controller.signal.aborted || mcpRequestRemainingFrom(deadlineAt) <= 0) throw new Error("connector_deadline")
    send(response, 200, { ok: true, request_id: requestId, data: projectConnectorList(connectors, providers) })
  } catch (error) {
    if (!request.aborted && !response.destroyed && !response.writableEnded) {
      if (error instanceof ConnectorListProjectionError)
        connectorListFailure(response, 502, requestId, "connector_response_invalid", "Connector list dependency returned an invalid response")
      else connectorListFailure(response, 503, requestId, "Unavailable", "Connector list dependency is unavailable")
    }
  } finally {
    clearTimeout(timer)
    request.removeListener("aborted", abort)
    response.removeListener("close", abort)
  }
}
