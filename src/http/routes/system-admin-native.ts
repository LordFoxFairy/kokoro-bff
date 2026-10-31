import type { IncomingMessage, ServerResponse } from "node:http"
import { authorizeUserRequest } from "../../auth/user-admission.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import type { BffConfig } from "../../config/runtime.js"
import { liveModelConfigurationAdmin } from "./model-configuration-admin.js"
import { liveModelRoutingAdmin } from "./model-routing-admin.js"
import { matchModelConfiguration } from "../../infrastructure/clients/owner/system-model-configuration.js"
import { pathOf, requestId } from "../request.js"
import { send } from "../response.js"
import { failure } from "../../contracts/index.js"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

function matchesRouting(method: string, path: readonly string[]): boolean {
  if (method === "GET" && path.length === 2 && path[0] === "admin" && ["model-routing", "model-labels", "model-revisions"].includes(path[1] ?? "")) return true
  return method === "PUT" && path.length === 3 && path[0] === "admin" && path[1] === "model-routing" && UUID.test(path[2] ?? "")
}

/** System-owned model administration is admitted and terminated before the transitional dispatcher. */
export async function handleSystemAdminRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  admission: SessionAdmission,
): Promise<boolean> {
  let path: string[]
  try { path = pathOf(request).slice(1) } catch { return false }
  const configuration = matchModelConfiguration(request.method ?? "GET", path)
  if (configuration === null && !matchesRouting(request.method ?? "GET", path)) return false
  const id = requestId(request)
  const deadlineAt = Date.now() + Math.min(config.upstreamTimeoutMs, 10_000)
  try {
    const admitted = await authorizeUserRequest(request, config, admission, id, AbortSignal.timeout(Math.max(1, deadlineAt - Date.now())))
    if (!admitted.ok) {
      send(response, admitted.status, failure(admitted.code, "BFF user admission failed", id), admitted.retryAfter)
      return true
    }
    if (configuration !== null) await liveModelConfigurationAdmin(request, response, config, admitted.context, path, deadlineAt)
    else await liveModelRoutingAdmin(request, response, config, admitted.context, path)
  } catch {
    if (!response.headersSent && !response.destroyed && !response.writableEnded) send(response, 503, failure("system_admin_unavailable", "System administrator route is unavailable", id))
    else if (!response.writableEnded && !response.destroyed) response.destroy()
  }
  return true
}
