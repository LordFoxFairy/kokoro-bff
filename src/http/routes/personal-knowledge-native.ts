import type { IncomingMessage, ServerResponse } from "node:http"
import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import { authorizeUserRequest } from "../../auth/user-admission.js"
import type { PersonalKnowledgeRepository } from "../../application/ports/personal-knowledge-repository.js"
import type { BffBusinessStore } from "../../application/ports/bff-business-store.js"
import { personalKnowledgeRoute } from "./personal-knowledge.js"
import { requestId } from "../request.js"
import { send } from "../response.js"

type KnowledgeRepository = PersonalKnowledgeRepository | BffBusinessStore | null

function repositoryOf(value: KnowledgeRepository): PersonalKnowledgeRepository | null {
  if (value === null) return null
  if ("personalKnowledge" in value) return value.personalKnowledge ?? null
  const legacy = value as BffBusinessStore & { services?: { personalKnowledge?: PersonalKnowledgeRepository } }
  return legacy.services?.personalKnowledge ?? (value as PersonalKnowledgeRepository)
}

/** Account-owned Knowledge routes use one admitted user context and a feature-local repository. */
export async function handlePersonalKnowledgeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  admission: SessionAdmission,
  repository: KnowledgeRepository,
): Promise<boolean> {
  const pathname = new URL(request.url ?? "/", "http://bff.local").pathname
  if (!(pathname === "/v1/preferences/knowledge" || pathname === "/v1/preferences/knowledge-usage" || pathname.startsWith("/v1/preferences/knowledge/"))) return false
  const id = requestId(request)
  const signal = AbortSignal.timeout(5_000)
  try {
    const admitted = await authorizeUserRequest(request, config, admission, id, signal)
    if (!admitted.ok) {
      send(response, admitted.status, { error: { code: admitted.code, message: "BFF user admission failed", retryable: admitted.status === 429 || admitted.status === 503 } }, admitted.retryAfter)
      return true
    }
    await personalKnowledgeRoute(request, response, admitted.context, repositoryOf(repository))
  } catch {
    if (!response.headersSent && !response.destroyed && !response.writableEnded)
      send(response, 503, { error: { code: "knowledge_unavailable", message: "Knowledge store is unavailable", retryable: request.method === "GET" } })
    else if (!response.writableEnded && !response.destroyed) response.destroy()
  }
  return true
}
