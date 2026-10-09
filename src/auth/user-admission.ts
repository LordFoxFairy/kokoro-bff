import type { IncomingMessage } from "node:http"

import type { BffConfig } from "../config/runtime.js"
import type { AdmittedUserRequestContext } from "../domain/request-context.js"
import type { SessionAdmission } from "./session-admission.types.js"

export type UserAdmissionResult =
  | Readonly<{ ok: true; context: AdmittedUserRequestContext; bearerToken: string }>
  | Readonly<{ ok: false; status: 401 | 403 | 429 | 503; code: string; retryAfter?: string }>

function authorizationValues(request: IncomingMessage): string[] {
  const values: string[] = []
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index]?.toLowerCase() === "authorization") values.push(request.rawHeaders[index + 1] ?? "")
  }
  return values
}

function bearerToken(request: IncomingMessage): string | null {
  const values = authorizationValues(request)
  if (values.length !== 1) return null
  const match = /^Bearer ([^\s,]+)$/iu.exec(values[0]?.trim() ?? "")
  return match?.[1] ?? null
}

export async function authorizeUserRequest(
  request: IncomingMessage,
  config: BffConfig,
  admission: SessionAdmission,
  requestId: string,
  signal: AbortSignal,
): Promise<UserAdmissionResult> {
  if (request.headers["x-kokoro-service"] !== "web-bff" || config.sharedSecret === null || request.headers["x-kokoro-internal-secret"] !== config.sharedSecret)
    return { ok: false, status: 403, code: "service_auth_failed" }

  const token = bearerToken(request)
  if (token === null) return { ok: false, status: 401, code: "session_authentication_required" }
  const fixedTenantId = config.tenantId?.trim()
  if (!fixedTenantId) return { ok: false, status: 503, code: "product_tenant_not_configured" }
  const result = await admission.verify({ token, requestId, signal })
  if (!result.ok) return result
  if (result.identity.namespace !== fixedTenantId) return { ok: false, status: 403, code: "product_tenant_forbidden" }
  return { ok: true, context: { requestId, identity: result.identity, platformAdmin: result.platformAdmin }, bearerToken: token }
}

/** Human admission is fresh for every Skill command and Skills admin read. */
export async function authorizeSkillAction(
  source: Pick<import("./skill-authorization.client.js").SkillAuthorizationClient, "check">,
  admission: Extract<UserAdmissionResult, { ok: true }>,
  action: import("./skill-authorization.types.js").SkillAuthorizationInput["action"],
  signal: AbortSignal,
) {
  return source.check({
    token: admission.bearerToken,
    requestId: admission.context.requestId,
    signal,
    tenantId: admission.context.identity.namespace,
    subjectId: admission.context.identity.userId,
    action,
  })
}
export function skillActionForRequest(method: string, path: string[]): import("./skill-authorization.types.js").SkillAuthorizationInput["action"] | null {
  if (path[0] === "admin" && path[1] === "skills") {
    if (method === "GET") return "admin_read"
    const actions: Record<string, import("./skill-authorization.types.js").SkillAuthorizationInput["action"]> = {
      versions: "admin_create_version",
      publish: "official_publish",
      withdraw: "admin_withdraw",
      quarantine: "quarantine",
      restore: "restore",
      audience: "admin_set_publication_audience",
      discard: "admin_discard_draft",
    }
    return method === "POST" && path.length === 4 ? (actions[path[3]!] ?? null) : null
  }
  if (path[0] === "skill-installations" && method !== "GET")
    return method === "DELETE" ? "remove_installation" : path.length === 1 ? "install" : "set_installation_enabled"
  if (path[0] === "self" && path[1] === "skills" && method === "POST")
    return path[3] === "versions" ? "create_version" : path[3] === "withdraw" ? "withdraw" : null
  if (path[0] !== "skills" || method === "GET") return null
  if (path[1] === "drafts" && method === "POST") return "create_draft"
  if ((path[1] === "ai-import" || path[1] === "github") && method === "POST" && path[2] !== "preview") return "create_draft"
  const actions: Record<string, import("./skill-authorization.types.js").SkillAuthorizationInput["action"]> = {
    "package-upload": path[3] === "complete" ? "complete_upload" : "begin_upload",
    "cover-upload": path[3] === "complete" ? "complete_upload" : "begin_upload",
    validate: "validate_draft",
    publish: "publish",
    discard: "discard_draft",
    audience: "set_publication_audience",
    draft: "update_draft",
  }
  return method === "POST" || method === "PATCH" ? (actions[path[2]!] ?? null) : null
}

/** Adds current Skill action admission inside an existing route's single admission/deadline boundary. */
export function withSkillActionAdmission(
  session: SessionAdmission,
  checks: Pick<import("./skill-authorization.client.js").SkillAuthorizationClient, "check">,
  action: import("./skill-authorization.types.js").SkillAuthorizationInput["action"],
  tenant: string | null | undefined,
): SessionAdmission {
  return {
    verify: async (input) => {
      const result = await session.verify(input)
      if (!result.ok || result.identity.namespace !== tenant) return result
      input.signal.throwIfAborted()
      const checked = await checks.check({ ...input, tenantId: result.identity.namespace, subjectId: result.identity.userId, action })
      input.signal.throwIfAborted()
      return checked.ok ? result : checked
    },
  }
}

/** Only current human MCP membership is accepted; workload scope is not user authority. */
export async function authorizeMcpAction(
  source: Pick<import("./mcp-authorization.client.js").McpAuthorizationClient, "check">,
  admission: Extract<UserAdmissionResult, { ok: true }>,
  action: import("./mcp-authorization.types.js").McpAuthorizationInput["action"],
  signal: AbortSignal,
) {
  signal.throwIfAborted()
  const result = await source.check({
    token: admission.bearerToken,
    requestId: admission.context.requestId,
    signal,
    tenantId: admission.context.identity.namespace,
    subjectId: admission.context.identity.userId,
    action,
  })
  signal.throwIfAborted()
  return result
}
export function mcpActionForRequest(method: string, path: string[]): import("./mcp-authorization.types.js").McpAuthorizationInput["action"] | null {
  if (path[0] !== "mcp" && !(path[0] === "self" && path[1] === "mcp")) return null
  return method === "GET" ? "read" : "manage"
}
