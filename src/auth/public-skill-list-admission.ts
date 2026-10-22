import type { IncomingMessage } from "node:http"
import type { BffConfig } from "../config/runtime.js"
import type { PublicSkillListContext } from "../application/skill-specification.types.js"
import type { SkillListAdmission, SkillListAdmissionResult } from "./skill-list-admission.client.js"
import { admitBrowserService } from "./browser-service-credential.policy.js"
import { bearerToken } from "./user-admission.js"

type PublicAdmission = Readonly<{ ok: true; context: PublicSkillListContext }> | Exclude<SkillListAdmissionResult, { ok: true }>

/** This is not a Session. Only the single public list route consumes this IAM principal. */
export async function authorizePublicSkillList(
  request: IncomingMessage,
  config: BffConfig,
  admission: SkillListAdmission,
  requestId: string,
  signal: AbortSignal,
): Promise<PublicAdmission> {
  if (admitBrowserService(request, config, { kind: "business" }) === null) return { ok: false, status: 403, code: "service_auth_failed" }
  const token = bearerToken(request)
  if (token === null) return { ok: false, status: 401, code: "skill_list_authentication_required" }
  const tenant = config.tenantId?.trim()
  if (!tenant) return { ok: false, status: 503, code: "product_tenant_not_configured" }
  const result = await admission.verify({ token, requestId, signal })
  signal.throwIfAborted()
  if (!result.ok) return result
  if (result.principal.tenant_id !== tenant) return { ok: false, status: 403, code: "product_tenant_forbidden" }
  const principal = Object.freeze({ ...result.principal })
  return {
    ok: true,
    context: Object.freeze({
      requestId,
      principal,
      publicBearer: token,
      identity: Object.freeze({ namespace: principal.tenant_id, userId: principal.user_id }),
    }),
  }
}
