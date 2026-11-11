import type { IncomingMessage, ServerResponse } from "node:http"
import { authorizeUserRequest } from "../../auth/user-admission.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import type { BffConfig } from "../../config/runtime.js"
import { liveAdminCreditGrant } from "./billing-credit-grant-admin.js"
import { liveAdminMetering, matchMeteringAdmin } from "./billing-metering-admin.js"
import { requestId, pathOf } from "../request.js"
import { send } from "../response.js"
import { failure } from "../../contracts/index.js"

function isCreditGrant(request: IncomingMessage): boolean {
  return request.method === "POST" && new URL(request.url ?? "/", "http://bff.local").pathname === "/v1/admin/billing/credit-grants"
}

/** Billing administrator routes are admitted and terminated by BillingModule. */
export async function handleBillingAdminRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  admission: SessionAdmission,
): Promise<boolean> {
  const creditGrant = isCreditGrant(request)
  let metering: ReturnType<typeof matchMeteringAdmin> = null
  if (!creditGrant) {
    let path: string[]
    try {
      path = pathOf(request)
    } catch {
      return false
    }
    metering = matchMeteringAdmin(request.method ?? "GET", path.slice(1))
  }
  if (!creditGrant && metering === null) return false
  const id = requestId(request)
  const deadlineAt = Date.now() + Math.min(config.upstreamTimeoutMs, 10_000)
  try {
    const admitted = await authorizeUserRequest(request, config, admission, id, AbortSignal.timeout(Math.max(1, deadlineAt - Date.now())), response)
    if (!admitted.ok) {
      send(response, admitted.status, failure(admitted.code, "BFF user admission failed", id), admitted.retryAfter)
      return true
    }
    const recheck = (signal: AbortSignal) => authorizeUserRequest(request, config, admission, id, signal, response)
    if (creditGrant) await liveAdminCreditGrant(request, response, config, admitted.context, recheck, deadlineAt)
    else await liveAdminMetering(request, response, config, admitted.context, recheck, metering!, deadlineAt)
  } catch {
    if (!response.headersSent && !response.destroyed && !response.writableEnded)
      send(response, 503, failure("billing_admin_unavailable", "Billing administrator route is unavailable", id))
    else if (!response.writableEnded && !response.destroyed) response.destroy()
  }
  return true
}
