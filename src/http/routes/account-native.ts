import type { IncomingMessage, ServerResponse } from "node:http"
import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import { authorizeUserRequest } from "../../auth/user-admission.js"
import { failure } from "../../contracts/index.js"
import { accountProfileRoute } from "./account-profile.js"
import { accountSessionsRoute } from "./account-sessions.js"
import { handlePersonalizationRequest } from "./personalization.js"
import { liveTeamRead, liveTeamWrite } from "./team.js"
import type { PersonalizationProvider } from "../../modules/account/personalization.provider.js"
import { pathOf, requestId } from "../request.js"
import { send } from "../response.js"

export function isAccountNativeRequest(request: IncomingMessage): boolean {
  const path = (request.url ?? "").split("?", 1)[0] ?? ""
  return (
    path === "/v1/account/profile" ||
    path === "/v1/account/sessions" ||
    path.startsWith("/v1/account/sessions/") ||
    path === "/v1/me" ||
    path === "/v1/team" ||
    path.startsWith("/v1/team/") ||
    path === "/v1/preferences/personalization"
  )
}

/** Account-owned native-session adapter for paths that do not need the global dispatcher. */
export async function handleAccountNativeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  admission: SessionAdmission,
  personalizationProvider: PersonalizationProvider | null,
): Promise<boolean> {
  if (!isAccountNativeRequest(request)) return false
  const path = (request.url ?? "").split("?", 1)[0] ?? ""
  if (path === "/v1/account/profile") {
    await accountProfileRoute(request, response, config, admission, requestId(request))
    return true
  }
  if (path === "/v1/preferences/personalization") {
    await handlePersonalizationRequest(request, response, config, admission, personalizationProvider)
    return true
  }

  const id = requestId(request)
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), Math.min(config.upstreamTimeoutMs, 10_000))
  const onAborted = (): void => abort.abort()
  const onClosed = (): void => {
    if (!response.writableEnded) abort.abort()
  }
  request.once("aborted", onAborted)
  response.once("close", onClosed)
  try {
    const admitted = await authorizeUserRequest(request, config, admission, id, abort.signal)
    if (!admitted.ok) {
      response.setHeader("x-request-id", id)
      send(response, admitted.status, failure(admitted.code, "BFF user admission failed", id), admitted.retryAfter)
      return true
    }
    const segments = pathOf(request)
    const businessPath = segments.slice(1)
    if (businessPath[0] === "me") {
      response.setHeader("x-request-id", id)
      if (request.method !== "GET") {
        send(response, 404, failure("bff_route_not_found", "Business route was not found", id))
        return true
      }
      if (request.url !== "/v1/me") {
        send(response, 400, failure("current_user_query_invalid", "Current user request must not contain query parameters", id))
        return true
      }
      if (
        (request.headers["content-length"] !== undefined && request.headers["content-length"] !== "0") ||
        request.headers["transfer-encoding"] !== undefined
      ) {
        send(response, 400, failure("current_user_body_rejected", "Current user request must not contain a body", id))
        return true
      }
      send(response, 200, {
        data: {
          user_id: admitted.context.identity.userId,
          tenant_id: admitted.context.identity.namespace,
          platform_admin: admitted.context.platformAdmin,
        },
        meta: { request_id: id },
      })
      return true
    }
    if (businessPath[0] === "account" && businessPath[1] === "sessions") {
      await accountSessionsRoute(request, response, config, admitted.context, admitted, businessPath)
      return true
    }
    if (businessPath[0] === "team") {
      if (request.method === "GET") await liveTeamRead(request, response, config, admitted.context, admitted, businessPath)
      else await liveTeamWrite(request, response, config, admitted.context, admitted, businessPath)
      return true
    }
    return false
  } finally {
    clearTimeout(timer)
    request.removeListener("aborted", onAborted)
    response.removeListener("close", onClosed)
  }
}
