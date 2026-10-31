import type { IncomingMessage, ServerResponse } from "node:http"
import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import { authorizeSkillAction, authorizeUserRequest } from "../../auth/user-admission.js"
import type { SkillAuthorizationClient } from "../../auth/skill-authorization.client.js"
import type { SkillProductConnectClient } from "../../infrastructure/clients/platform/skill-product-connect.js"
import { skillDraftsRoute } from "./skill-drafts.js"
import { requestId } from "../request.js"
import { send } from "../response.js"

type DraftMutation = Readonly<{
  skillId: string
  operation: "update" | "discard" | "audience"
  action: "update_draft" | "discard_draft" | "set_publication_audience"
}>

function decode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function match(request: IncomingMessage): DraftMutation | null {
  const parts = new URL(request.url ?? "/", "http://bff.local").pathname.split("/").filter(Boolean).map(decode)
  if (parts[0] !== "v1" || parts[1] !== "skills" || parts.length !== 4) return null
  if (request.method === "PATCH" && parts[3] === "draft") return { skillId: parts[2] ?? "", operation: "update", action: "update_draft" }
  if (request.method === "POST" && parts[3] === "discard") return { skillId: parts[2] ?? "", operation: "discard", action: "discard_draft" }
  if (request.method === "POST" && parts[3] === "audience") return { skillId: parts[2] ?? "", operation: "audience", action: "set_publication_audience" }
  return null
}

/** Skill draft mutations are owned by SkillsModule; the shared route retains the product contract. */
export async function handleSkillDraftMutationRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  admission: SessionAdmission,
  skillAuthorization: Pick<SkillAuthorizationClient, "check">,
  client: SkillProductConnectClient | null,
): Promise<boolean> {
  const operation = match(request)
  if (operation === null) return false
  const id = requestId(request)
  response.setHeader("x-request-id", id)
  response.setHeader("cache-control", "no-store")
  const signal = AbortSignal.timeout(10_000)
  try {
    const admitted = await authorizeUserRequest(request, config, admission, id, signal)
    if (!admitted.ok) {
      send(
        response,
        admitted.status,
        { error: { code: admitted.code, message: "BFF user admission failed", retryable: admitted.status === 429 || admitted.status === 503 } },
        admitted.retryAfter,
      )
      return true
    }
    const checked = await authorizeSkillAction(skillAuthorization, admitted, operation.action, signal)
    if (!checked.ok) {
      send(response, checked.status, {
        error: { code: checked.code, message: "Skill action admission failed", retryable: checked.status === 429 || checked.status === 503 },
      })
      return true
    }
    await skillDraftsRoute(request, response, admitted.context, operation.skillId, operation.operation, client)
  } catch {
    if (!response.headersSent && !response.destroyed && !response.writableEnded)
      send(response, 503, { error: { code: "skill_dependency_unavailable", message: "Skill dependency is unavailable", retryable: true } })
    else if (!response.writableEnded && !response.destroyed) response.destroy()
  }
  return true
}
