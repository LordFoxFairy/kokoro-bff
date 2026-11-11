import type { IncomingMessage, ServerResponse } from "node:http"
import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import type { SkillAuthorizationClient } from "../../auth/skill-authorization.client.js"
import type { LocalSkillImportClient } from "./local-skill-import.js"
import { localSkillImportRoute } from "./local-skill-import.js"
import { requestId } from "../request.js"

/** Browser local-import routes are owned by SkillsModule and retain their two-action admission. */
export async function handleSkillLocalImportRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  admission: SessionAdmission,
  skillAuthorization: Pick<SkillAuthorizationClient, "check">,
  client: LocalSkillImportClient | undefined,
): Promise<boolean> {
  const segments = new URL(request.url ?? "/", "http://bff.local").pathname.split("/").filter(Boolean)
  if (segments[0] !== "browser" || segments[1] !== "v1" || segments[2] !== "skills" || segments[3] !== "local-imports") return false
  return localSkillImportRoute(request, response, config, admission, skillAuthorization, client, requestId(request), segments)
}
