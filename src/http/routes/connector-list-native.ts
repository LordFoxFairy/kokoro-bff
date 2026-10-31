import type { IncomingMessage, ServerResponse } from "node:http"
import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import type { McpAuthorizationClient } from "../../auth/mcp-authorization.client.js"
import type { McpPersonalConnectClient } from "../../infrastructure/clients/platform/mcp-personal-connect.js"
import { connectorListRoute, isConnectorListRequest, type ConnectorListProvider } from "./connector-list.js"
import { authorizeMcpAction, authorizeUserRequest } from "../../auth/user-admission.js"
import { pathOf, requestId } from "../request.js"
import { connectorListFailure } from "./connector-list.js"

export async function handleConnectorListRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  admission: SessionAdmission,
  mcpPersonalClient: Pick<McpPersonalConnectClient, "read"> | null,
  mcpAuthorization: Pick<McpAuthorizationClient, "check">,
): Promise<boolean> {
  let path: string[]
  try { path = pathOf(request).slice(1) } catch { return false }
  if (!isConnectorListRequest(path, request.method ?? "GET")) return false
  const id = requestId(request)
  response.setHeader("x-request-id", id)
  const signal = AbortSignal.timeout(10_000)
  const current = await authorizeUserRequest(request, config, admission, id, signal)
  if (!current.ok) {
    connectorListFailure(response, current.status, id, current.status === 401 ? "Unauthenticated" : current.status === 403 ? "PermissionDenied" : "Unavailable", "Connector list access is unavailable")
    return true
  }
  const action = await authorizeMcpAction(mcpAuthorization, current, "read", signal)
  if (!action.ok) {
    connectorListFailure(response, action.status, id, action.status === 401 ? "Unauthenticated" : action.status === 403 ? "PermissionDenied" : "Unavailable", "Connector list access is unavailable")
    return true
  }
  const provider: ConnectorListProvider = { mcpPersonalClient, sessionAdmission: admission, mcpAuthorization }
  await connectorListRoute(request, response, config, provider, current.context)
  return true
}
