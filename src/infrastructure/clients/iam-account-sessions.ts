import { readIamServiceCredential } from "../../auth/iam-service-credential.js"
import { isDeepStrictEqual } from "node:util"
import { withIamAccountTransport } from "./iam-account-transport.js"
import { listAccountSessions, revokeAccountSession } from "../../generated/iam-http/sdk.gen.js"
import { zApiErrorResponse, zListAccountSessionsResponse, zRevokeAccountSessionResponse } from "../../generated/iam-http/zod.gen.js"
import type { AccountSessionInput, AccountSessionResult } from "./iam-account-sessions.types.js"

/** One absolute request budget, including uncooperative transport and body reads. */
export async function requestIamAccountSessions(input: AccountSessionInput): Promise<AccountSessionResult> {
  const unavailable = (): AccountSessionResult => ({ ok: false, status: 503, code: "account_sessions_unavailable" })
  const invalid = (): AccountSessionResult => ({ ok: false, status: 502, code: "account_session_response_invalid" })
  const transport = await withIamAccountTransport(
    {
      baseUrl: input.baseUrl,
      requestId: input.requestId,
      signal: input.signal,
      deadlineAt: input.deadlineAt,
      maxResponseBytes: input.maxResponseBytes,
      timeoutMs: 5000,
    },
    async ({ client, assertActive, response }): Promise<AccountSessionResult> => {
      if (!input.credentialFile || !input.cookie || !input.origin) return unavailable()
      const credential = await readIamServiceCredential(input.credentialFile, input.tenantId, "account_sessions", input.signal)
      const headers = {
        authorization: `Bearer ${credential}`,
        "x-request-id": input.requestId,
        accept: "application/json",
        cookie: input.cookie,
        Origin: input.origin,
      }
      // Override the generated validator at the official pre-strip boundary.
      const responseValidator = async (raw: unknown) => {
        const parsed = (input.kind === "list" ? zListAccountSessionsResponse : zRevokeAccountSessionResponse).safeParse(raw)
        if (!parsed.success || !isDeepStrictEqual(raw, parsed.data)) throw new Error("account_session_response")
        return parsed.data
      }
      const result =
        input.kind === "list"
          ? await listAccountSessions({
              client,
              headers,
              query: { limit: input.limit, ...(input.cursor === null ? {} : { cursor: input.cursor }) },
              responseValidator,
            })
          : await revokeAccountSession({ client, headers, path: { session_id: input.sessionId }, responseValidator })
      assertActive()
      if (result.response === undefined) return response() === undefined ? unavailable() : invalid()
      const status = result.response.status
      if (status === 200) {
        if (input.kind === "list") {
          const parsed = zListAccountSessionsResponse.safeParse(result.data)
          if (!parsed.success) return invalid()
          const value = parsed.data
          const ids = value.data.sessions.map((item) => item.session_id)
          if (
            ids.includes(value.data.current_session.session_id) ||
            new Set(ids).size !== ids.length ||
            ids.length > input.limit ||
            (value.meta.next_cursor !== null && (value.meta.next_cursor === input.cursor || ids.length === 0))
          )
            return invalid()
          return { ok: true, data: value.data, nextCursor: value.meta.next_cursor }
        }
        const parsed = zRevokeAccountSessionResponse.safeParse(result.data)
        if (!parsed.success || parsed.data.data.session_id !== input.sessionId) return invalid()
        return { ok: true, data: parsed.data.data }
      }
      const parsed = zApiErrorResponse.safeParse(result.error)
      if (!parsed.success || !isDeepStrictEqual(parsed.data, result.error)) return invalid()
      const code = parsed.data.error.code
      if (status === 400 && code === "INVALID_ARGUMENT") return { ok: false, status: 400, code: "account_session_input_invalid" }
      if (status === 401 && code === "account_session_invalid") return { ok: false, status: 401, code: "session_invalid" }
      if (status === 401) return unavailable()
      if (status === 403 && code === "PERMISSION_DENIED") return { ok: false, status: 403, code: "account_session_forbidden" }
      if (status === 404 && code === "NOT_FOUND") return { ok: false, status: 404, code: "account_session_not_found" }
      if (status === 409 && code === "TENANT_DISABLED") return { ok: false, status: 403, code: "session_forbidden" }
      if (status === 409 && code === "CONFLICT") return { ok: false, status: 409, code: "account_session_conflict" }
      if (status === 413 && code === "PAYLOAD_TOO_LARGE") return { ok: false, status: 413, code: "account_session_request_too_large" }
      if (status === 429 && code === "RATE_LIMITED") {
        const retry = response()?.headers.get("retry-after") ?? ""
        if (!/^[1-9][0-9]{0,4}$/u.test(retry) || Number(retry) > 86400) return invalid()
        return { ok: false, status: 429, code: "account_session_rate_limited", retryAfter: retry }
      }
      if ((status === 500 && code === "INTERNAL") || (status === 503 && code === "DEPENDENCY_UNAVAILABLE")) return unavailable()
      return invalid()
    },
  )
  return transport.ok ? transport.value : transport.reason === "unavailable" ? unavailable() : invalid()
}
