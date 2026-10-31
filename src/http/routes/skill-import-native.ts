import type { IncomingMessage, ServerResponse } from "node:http"
import { authorizeUserRequest } from "../../auth/user-admission.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import type { BffConfig } from "../../config/runtime.js"
import type { IdempotencyRepository } from "../../application/ports/idempotency-repository.js"
import type { SkillProductConnectClient } from "../../infrastructure/clients/platform/skill-product-connect.js"
import { skillGithubImportRoute } from "./skill-github-import.js"
import { requestId } from "../request.js"
import { send } from "../response.js"

type SkillImportReceipts = Pick<IdempotencyRepository, "getReceipt" | "claimReceipt" | "compareAndSetReceipt">

/** GitHub Skill import is owned by SkillsModule; receipts remain the shared BFF idempotency protocol. */
export async function handleSkillGithubImportRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  admission: SessionAdmission,
  receipts: SkillImportReceipts | null,
  client: SkillProductConnectClient | null,
): Promise<boolean> {
  if (request.method !== "POST" || new URL(request.url ?? "/", "http://bff.local").pathname !== "/v1/skills/github/import") return false
  const id = requestId(request)
  const signal = AbortSignal.timeout(10_000)
  try {
    const admitted = await authorizeUserRequest(request, config, admission, id, signal)
    if (!admitted.ok) {
      send(response, admitted.status, { error: { code: admitted.code, message: "BFF user admission failed", retryable: admitted.status === 429 || admitted.status === 503 } }, admitted.retryAfter)
      return true
    }
    const readmit = async (currentSignal: AbortSignal): Promise<void> => {
      const current = await authorizeUserRequest(request, config, admission, id, currentSignal)
      if (!current.ok && current.status >= 500) throw new Error("skill_dependency_unavailable")
      if (!current.ok || current.context.identity.namespace !== admitted.context.identity.namespace || current.context.identity.userId !== admitted.context.identity.userId)
        throw new Error("skill_not_found")
      currentSignal.throwIfAborted()
    }
    await skillGithubImportRoute(request, response, admitted.context, config, receipts, client, readmit)
  } catch {
    if (!response.headersSent && !response.destroyed && !response.writableEnded)
      send(response, 503, { error: { code: "skill_dependency_unavailable", message: "GitHub Skill dependency is unavailable", retryable: true } })
    else if (!response.writableEnded && !response.destroyed) response.destroy()
  }
  return true
}
