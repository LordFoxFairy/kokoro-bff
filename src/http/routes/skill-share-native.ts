import type { IncomingMessage, ServerResponse } from "node:http"
import { authorizeUserRequest } from "../../auth/user-admission.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import type { BffConfig } from "../../config/runtime.js"
import type { SkillShareRepository } from "../../application/ports/skill-share-repository.js"
import type { BffBusinessStore } from "../../application/ports/bff-business-store.js"
import type { SkillSpecificationSource } from "../../application/skill-specification.types.js"
import type { SkillProductConnectClient } from "../../infrastructure/clients/platform/skill-product-connect.js"
import { skillShareRoute } from "./skill-share.js"
import { requestId } from "../request.js"
import { send } from "../response.js"

function pathOf(request: IncomingMessage): string[] | null {
  const parts = new URL(request.url ?? "/", "http://bff.local").pathname.split("/").filter(Boolean)
  if (parts[0] !== "v1" || parts[1] !== "skill-shares") return null
  return parts.slice(1)
}

function matches(path: readonly string[], method: string): boolean {
  return (
    (path.length === 1 && method === "POST") ||
    (path.length === 2 && ["GET", "DELETE"].includes(method)) ||
    (path.length === 3 && path[2] === "skill" && method === "GET")
  )
}

export function skillShareRepositoryFromBusinessStore(store: BffBusinessStore | null): SkillShareRepository | undefined {
  return store?.skillShares
}

/** Skill share lifecycle is owned by SkillsModule and reuses the existing projection boundary. */
export async function handleSkillShareRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  admission: SessionAdmission,
  repository: SkillShareRepository | undefined,
  client: SkillProductConnectClient | null,
  specification: SkillSpecificationSource | null,
): Promise<boolean> {
  const path = pathOf(request)
  if (path === null || !matches(path, request.method ?? "GET")) return false
  const id = requestId(request)
  const signal = AbortSignal.timeout(10_000)
  try {
    const admitted = await authorizeUserRequest(request, config, admission, id, signal)
    if (!admitted.ok) {
      send(response, admitted.status, { error: { code: admitted.code, message: "BFF user admission failed", retryable: admitted.status === 429 || admitted.status === 503 } }, admitted.retryAfter)
      return true
    }
    await skillShareRoute(request, response, { ...admitted.context, humanBearer: admitted.bearerToken }, path, repository, client, config.iamRelay?.webOrigin, specification)
  } catch {
    if (!response.headersSent && !response.destroyed && !response.writableEnded)
      send(response, 503, { error: { code: "skill_dependency_unavailable", message: "Skill share dependency is unavailable", retryable: true } })
    else if (!response.writableEnded && !response.destroyed) response.destroy()
  }
  return true
}
