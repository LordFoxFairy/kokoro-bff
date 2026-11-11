import type { IncomingMessage, ServerResponse } from "node:http"
import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import type { SkillAuthorizationClient } from "../../auth/skill-authorization.client.js"
import type { CatalogConnectClient } from "../../infrastructure/clients/platform/catalog-connect.js"
import { createPersonalSkillVersionRoute } from "./create-personal-skill-version.js"
import { deletePersonalSkillSeriesRoute } from "./delete-personal-skill-series.js"
import { withdrawPersonalSkillRoute } from "./withdraw-personal-skill.js"
import { requestId } from "../request.js"

type LifecycleAction = "create_version" | "delete_series" | "withdraw"

function match(request: IncomingMessage): Readonly<{ action: LifecycleAction; skillId: string }> | null {
  const pathname = new URL(request.url ?? "/", "http://bff.local").pathname
  const parts = pathname.split("/").filter(Boolean).map(decode)
  if (parts[0] !== "v1" || parts[1] !== "self" || parts[2] !== "skills") return null
  if (request.method === "POST" && parts.length === 5 && parts[4] === "versions") return { action: "create_version", skillId: parts[3] ?? "" }
  if (request.method === "POST" && parts.length === 5 && parts[4] === "withdraw") return { action: "withdraw", skillId: parts[3] ?? "" }
  if (request.method === "DELETE" && parts.length === 4) return { action: "delete_series", skillId: parts[3] ?? "" }
  return null
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/** Personal Skill lifecycle commands are owned by SkillsModule; GET managed reads remain separate. */
export async function handlePersonalSkillLifecycleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  admission: SessionAdmission,
  skillAuthorization: Pick<SkillAuthorizationClient, "check">,
  client: CatalogConnectClient | null,
): Promise<boolean> {
  const operation = match(request)
  if (operation === null) return false
  const id = requestId(request)
  if (operation.action === "create_version") {
    await createPersonalSkillVersionRoute(request, response, config, admission, id, operation.skillId, client, skillAuthorization)
  } else if (operation.action === "withdraw") {
    await withdrawPersonalSkillRoute(request, response, config, admission, id, operation.skillId, client, skillAuthorization)
  } else {
    await deletePersonalSkillSeriesRoute(request, response, config, admission, id, operation.skillId, client, skillAuthorization)
  }
  return true
}
