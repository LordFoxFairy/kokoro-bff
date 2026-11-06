import { Code, ConnectError } from "@connectrpc/connect"
import type { IncomingMessage, ServerResponse } from "node:http"
import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import type { McpAuthorizationClient } from "../../auth/mcp-authorization.client.js"
import { authorizeMcpAction, authorizeUserRequest } from "../../auth/user-admission.js"
import type { ProjectLookup } from "../../application/projects/types.js"
import type { McpProjectPublicationClient } from "../../infrastructure/clients/platform/mcp-project-publication.js"
import { pathOf, requestId } from "../request.js"
import { mcpProjectPublicationOperation, mcpProjectPublicationRoute } from "./mcp-project-publication.js"
import { startMcpRequestBudget } from "../mcp-request-budget.js"

export type McpProjectPublicationProvider = Readonly<{
  sessionAdmission: SessionAdmission
  mcpAuthorization: Pick<McpAuthorizationClient, "check">
  project: ProjectLookup | null
  client: Pick<McpProjectPublicationClient, "execute"> | null
}>

function accessError(status: number, message: string): ConnectError {
  return new ConnectError(message, status >= 500 ? Code.Unavailable : Code.PermissionDenied)
}

export async function handleMcpProjectPublicationRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  provider: McpProjectPublicationProvider,
): Promise<boolean> {
  let allPath: string[]
  try {
    allPath = pathOf(request)
  } catch {
    return false
  }
  if (allPath[0] !== "browser" || allPath[1] !== "v1") return false
  const path = allPath.slice(2)
  const operation = mcpProjectPublicationOperation(path, request.method ?? "GET")
  if (operation === null) return false
  const id = requestId(request)
  response.setHeader("x-request-id", id)
  response.setHeader("cache-control", "no-store")
  startMcpRequestBudget(request)
  const admitted = await authorizeUserRequest(request, config, provider.sessionAdmission, id, AbortSignal.timeout(10_000), response)
  if (!admitted.ok) {
    response.statusCode = admitted.status
    response.setHeader("content-type", "application/json; charset=utf-8")
    response.end(
      JSON.stringify({ error: { code: admitted.code, message: "BFF user admission failed", retryable: admitted.status === 429 || admitted.status >= 500 } }),
    )
    return true
  }
  const identity = { tenant: admitted.context.identity.namespace, subject: admitted.context.identity.userId, requestId: id }
  const currentAccess = async (projectIds: string[], action: "read" | "manage", signal: AbortSignal): Promise<void> => {
    const fresh = await authorizeUserRequest(request, config, provider.sessionAdmission, id, signal, response)
    if (!fresh.ok) throw accessError(fresh.status, "MCP project publication admission failed")
    if (fresh.context.identity.namespace !== identity.tenant || fresh.context.identity.userId !== identity.subject)
      throw new ConnectError("Project not found", Code.NotFound)
    const checked = await authorizeMcpAction(provider.mcpAuthorization, fresh, action, signal)
    if (!checked.ok) throw accessError(checked.status, "MCP project publication action denied")
    if (provider.project === null) throw new ConnectError("Project owner unavailable", Code.Unavailable)
    for (const projectId of projectIds) {
      signal.throwIfAborted()
      const project = await provider.project.find({ tenantId: identity.tenant, subjectId: identity.subject }, projectId)
      signal.throwIfAborted()
      if (!project || project.id !== projectId) throw new ConnectError("Project not found", Code.NotFound)
    }
  }
  await mcpProjectPublicationRoute(request, response, identity, path, provider.client as McpProjectPublicationClient | null, currentAccess)
  return true
}
