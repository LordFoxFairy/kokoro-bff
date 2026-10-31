import type { IncomingMessage, ServerResponse } from "node:http"
import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import { authorizeSkillAction, authorizeUserRequest } from "../../auth/user-admission.js"
import type { SkillAuthorizationClient } from "../../auth/skill-authorization.client.js"
import type { SkillAdminConnectClient } from "../../infrastructure/clients/platform/skill-admin-connect.js"
import { skillAdminRoute } from "./skill-admin.js"
import { requestId } from "../request.js"
import { send } from "../response.js"

function decode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function actionFor(method: string, path: string[]): "admin_read" | "admin_create_draft" | "admin_create_version" | "official_publish" | "admin_withdraw" | "quarantine" | "restore" | "admin_set_publication_audience" | "admin_discard_draft" | null {
  if (method === "GET" && path.length >= 2 && path[0] === "admin" && path[1] === "skills") return "admin_read"
  if (method === "POST" && path.length === 2) return "admin_create_draft"
  if (method !== "POST" || path.length !== 4) return null
  const actions = {
    versions: "admin_create_version",
    publish: "official_publish",
    withdraw: "admin_withdraw",
    quarantine: "quarantine",
    restore: "restore",
    audience: "admin_set_publication_audience",
    discard: "admin_discard_draft",
  } as const
  return actions[path[3] as keyof typeof actions] ?? null
}

/** Admin Skill routes share the SkillsModule action admission and admin owner client. */
export async function handleSkillAdminRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  admission: SessionAdmission,
  skillAuthorization: Pick<SkillAuthorizationClient, "check">,
  client: SkillAdminConnectClient | null,
): Promise<boolean> {
  const parts = new URL(request.url ?? "/", "http://bff.local").pathname.split("/").filter(Boolean).map(decode)
  if (parts[0] !== "v1" || parts[1] !== "admin" || parts[2] !== "skills") return false
  const path = parts.slice(1)
  if (!((request.method === "GET" && (path.length === 2 || path.length === 3)) || (request.method === "POST" && (path.length === 2 || path.length === 4)))) return false
  const action = actionFor(request.method ?? "GET", path)
  if (action === null) return false
  const id = requestId(request)
  const signal = AbortSignal.timeout(10_000)
  try {
    const admitted = await authorizeUserRequest(request, config, admission, id, signal)
    if (!admitted.ok) {
      send(response, admitted.status, { error: { code: admitted.code, message: "BFF user admission failed", retryable: admitted.status === 429 || admitted.status === 503 } }, admitted.retryAfter)
      return true
    }
    const checked = await authorizeSkillAction(skillAuthorization, admitted, action, signal)
    if (!checked.ok) {
      send(response, checked.status, { error: { code: checked.code, message: "Skill action admission failed", retryable: checked.status === 429 || checked.status === 503 } })
      return true
    }
    await skillAdminRoute(request, response, admitted.context, path, client, config.iamBaseUrl)
  } catch {
    if (!response.headersSent && !response.destroyed && !response.writableEnded)
      send(response, 503, { error: { code: "skill_dependency_unavailable", message: "Skill admin dependency is unavailable", retryable: true } })
    else if (!response.writableEnded && !response.destroyed) response.destroy()
  }
  return true
}
