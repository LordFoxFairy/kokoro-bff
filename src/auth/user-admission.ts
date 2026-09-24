import type { IncomingMessage } from "node:http"

import type { BffConfig } from "../config/runtime.js"
import type { RequestContext } from "../domain/request-context.js"
import type { SessionAdmission } from "./session-admission.types.js"

export type UserAdmissionResult =
  | Readonly<{ ok: true; context: RequestContext; bearerToken: string }>
  | Readonly<{ ok: false; status: 401 | 403 | 429 | 503; code: string; retryAfter?: string }>

function authorizationValues(request: IncomingMessage): string[] {
  const values: string[] = []
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index]?.toLowerCase() === "authorization") values.push(request.rawHeaders[index + 1] ?? "")
  }
  return values
}

function bearerToken(request: IncomingMessage): string | null {
  const values = authorizationValues(request)
  if (values.length !== 1) return null
  const match = /^Bearer ([^\s,]+)$/iu.exec(values[0]?.trim() ?? "")
  return match?.[1] ?? null
}

export async function authorizeUserRequest(
  request: IncomingMessage,
  config: BffConfig,
  admission: SessionAdmission,
  requestId: string,
  signal: AbortSignal,
): Promise<UserAdmissionResult> {
  if (request.headers["x-kokoro-service"] !== "web-bff" || config.sharedSecret === null || request.headers["x-kokoro-internal-secret"] !== config.sharedSecret)
    return { ok: false, status: 403, code: "service_auth_failed" }

  const token = bearerToken(request)
  if (token === null) return { ok: false, status: 401, code: "session_authentication_required" }
  const result = await admission.verify({ token, requestId, signal })
  if (!result.ok) return result
  return { ok: true, context: { requestId, identity: result.identity }, bearerToken: token }
}
