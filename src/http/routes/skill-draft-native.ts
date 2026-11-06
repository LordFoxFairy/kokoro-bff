import type { IncomingMessage, ServerResponse } from "node:http"
import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import { authorizeSkillAction, authorizeUserRequest } from "../../auth/user-admission.js"
import type { SkillAuthorizationClient } from "../../auth/skill-authorization.client.js"
import type { CatalogConnectClient } from "../../infrastructure/clients/platform/catalog-connect.js"
import { createSkillDraftRoute } from "./create-skill-draft.js"
import { requestId } from "../request.js"
import { send } from "../response.js"

function admissionFailure(response: ServerResponse, result: { status: number; code: string; retryAfter?: string }): void {
  send(
    response,
    result.status,
    { error: { code: result.code, message: "BFF user admission failed", retryable: result.status === 429 || result.status === 503 } },
    result.retryAfter,
  )
}

/** The canonical initial Skill draft command is owned by SkillsModule. */
export async function handleSkillDraftRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  admission: SessionAdmission,
  skillAuthorization: Pick<SkillAuthorizationClient, "check">,
  client: CatalogConnectClient | null,
): Promise<boolean> {
  if (request.method !== "POST" || new URL(request.url ?? "/", "http://bff.local").pathname !== "/v1/skills/drafts") return false
  const id = requestId(request)
  response.setHeader("x-request-id", id)
  response.setHeader("cache-control", "no-store")
  if (request.url !== "/v1/skills/drafts") {
    send(response, 404, { error: { code: "bff_route_not_found", message: "Business route was not found", retryable: false } })
    return true
  }
  const signal = AbortSignal.timeout(10_000)
  try {
    const admitted = await authorizeUserRequest(request, config, admission, id, signal, response)
    if (!admitted.ok) {
      admissionFailure(response, admitted)
      return true
    }
    const checked = await authorizeSkillAction(skillAuthorization, admitted, "create_draft", signal)
    if (!checked.ok) {
      admissionFailure(response, checked)
      return true
    }
    await createSkillDraftRoute(request, response, admitted.context, client, signal)
  } catch {
    if (!response.headersSent && !response.destroyed && !response.writableEnded) {
      send(response, 503, { error: { code: "skill_dependency_unavailable", message: "Skill catalog is unavailable", retryable: true } })
    } else if (!response.writableEnded && !response.destroyed) response.destroy()
  }
  return true
}
