import type { IncomingMessage, ServerResponse } from "node:http"
import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import type { OpenAppManagementAdmission } from "../../auth/open-app-management-admission.client.js"
import type { AppSkillBindingClient } from "../../application/app-skill-bindings.types.js"
import { requestId } from "../request.js"
import { appSkillBindingsRoute, type AppSkillBindingProvider } from "./app-skill-bindings.js"

export async function handleAppSkillBindingsRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  admission: SessionAdmission,
  openAppManagementAdmission: OpenAppManagementAdmission,
  appSkillBindingClient: AppSkillBindingClient | null,
): Promise<boolean> {
  const pathname = new URL(request.url ?? "/", "http://bff.local").pathname
  if (!/^\/v1\/admin\/open-apps\/[^/]+\/skill-bindings(?:\/[^/]+)?$/u.test(pathname)) return false
  const id = requestId(request)
  response.setHeader("x-request-id", id)
  const provider: AppSkillBindingProvider = { sessionAdmission: admission, openAppManagementAdmission, appSkillBindingClient }
  return appSkillBindingsRoute(request, response, config, provider, id, pathname)
}
