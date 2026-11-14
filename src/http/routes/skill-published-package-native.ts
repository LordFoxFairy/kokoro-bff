import type { IncomingMessage, ServerResponse } from "node:http"
import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import { authorizeUserRequest } from "../../auth/user-admission.js"
import type { SkillProductConnectClient } from "../../infrastructure/clients/platform/skill-product-connect.js"
import { publishedSkillPackageInspectionRoute } from "./skill-download.js"
import { requestId } from "../request.js"
import { send } from "../response.js"

function decode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/** Published package inspection is a SkillsModule read with one admitted Product owner client. */
export async function handlePublishedSkillPackageRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  admission: SessionAdmission,
  client: SkillProductConnectClient | null,
): Promise<boolean> {
  if (request.method !== "GET") return false
  const parts = new URL(request.url ?? "/", "http://bff.local").pathname.split("/").filter(Boolean).map(decode)
  if (parts.length !== 4 || parts[0] !== "v1" || parts[1] !== "skills" || parts[3] !== "package") return false
  const id = requestId(request)
  response.setHeader("x-request-id", id)
  const signal = AbortSignal.timeout(10_000)
  try {
    const admitted = await authorizeUserRequest(request, config, admission, id, signal, response)
    if (!admitted.ok) {
      send(
        response,
        admitted.status,
        { error: { code: admitted.code, message: "BFF user admission failed", retryable: admitted.status === 429 || admitted.status === 503 } },
        admitted.retryAfter,
      )
      return true
    }
    await publishedSkillPackageInspectionRoute(request, response, admitted.context, parts[2] ?? "", client)
  } catch {
    if (!response.headersSent && !response.destroyed && !response.writableEnded)
      send(response, 503, { error: { code: "skill_dependency_unavailable", message: "Skill dependency is unavailable", retryable: true } })
    else if (!response.writableEnded && !response.destroyed) response.destroy()
  }
  return true
}
