import type { IncomingMessage, ServerResponse } from "node:http"
import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import type { McpAuthorizationClient } from "../../auth/mcp-authorization.client.js"
import type { McpPackageAdminConnectClient } from "../../infrastructure/clients/platform/mcp-package-admin-connect.js"
import type { McpProviderAdminConnectClient } from "../../infrastructure/clients/platform/mcp-provider-admin-connect.js"
import { pathOf, requestId } from "../request.js"
import { mcpPackageAdminOperation, mcpPackageAdminRoute, type McpPackageAdminProvider } from "./mcp-package-admin.js"
import { mcpProviderAdminOperation, mcpProviderAdminRoute, type McpProviderAdminProvider } from "./mcp-provider-admin.js"

export async function handleMcpAdminRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  admission: SessionAdmission,
  authorization: Pick<McpAuthorizationClient, "check">,
  providerClient: Pick<McpProviderAdminConnectClient, "execute"> | null,
  packageClient: Pick<McpPackageAdminConnectClient, "execute"> | null,
): Promise<boolean> {
  let path: string[]
  try {
    path = pathOf(request).slice(1)
  } catch {
    return false
  }
  const method = request.method ?? "GET"
  const providerOperation = mcpProviderAdminOperation(path, method)
  const packageOperation = mcpPackageAdminOperation(path, method)
  if (providerOperation === null && packageOperation === null) return false
  const id = requestId(request)
  response.setHeader("x-request-id", id)
  if (providerOperation !== null) {
    const provider: McpProviderAdminProvider = { sessionAdmission: admission, mcpAuthorization: authorization, mcpProviderAdminClient: providerClient }
    await mcpProviderAdminRoute(request, response, config, provider, id, path)
  } else {
    const provider: McpPackageAdminProvider = { sessionAdmission: admission, mcpAuthorization: authorization, mcpPackageAdminClient: packageClient }
    await mcpPackageAdminRoute(request, response, config, provider, id, path)
  }
  return true
}
