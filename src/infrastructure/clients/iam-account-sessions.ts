import { isDeepStrictEqual } from "node:util"
import { createClient } from "../../generated/iam-http/client/index.js"
import { listAccountSessions, revokeAccountSession } from "../../generated/iam-http/sdk.gen.js"
import { zApiErrorResponse, zListAccountSessionsResponse, zRevokeAccountSessionResponse } from "../../generated/iam-http/zod.gen.js"
import type { AccountSessionInput, AccountSessionResult } from "./iam-account-sessions.types.js"

/** One absolute request budget, including uncooperative transport and body reads. */
export async function requestIamAccountSessions(input: AccountSessionInput): Promise<AccountSessionResult> {
  const unavailable = (): AccountSessionResult => ({ ok: false, status: 503, code: "account_sessions_unavailable" })
  const invalid = (): AccountSessionResult => ({ ok: false, status: 502, code: "account_session_response_invalid" })
  if (input.baseUrl === null || input.signal.aborted || input.deadlineAt <= performance.now()) return unavailable()
  const controller = new AbortController()
  let retired = false
  let response: Response | undefined
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  let rejectBudget!: (cause: Error) => void
  const budget = new Promise<never>((_resolve, reject) => {
    rejectBudget = reject
  })
  const cancel = () => {
    retired = true
    controller.abort()
    const activeReader = reader
    reader = undefined
    void activeReader?.cancel().catch(() => undefined)
    try {
      activeReader?.releaseLock()
    } catch {
      /* A retired read never regains ownership. */
    }
    if (response?.body && !response.body.locked) void response.body.cancel().catch(() => undefined)
  }
  const interrupt = () => {
    cancel()
    rejectBudget(new Error("account_session_budget"))
  }
  input.signal.addEventListener("abort", interrupt, { once: true })
  const timer = setTimeout(interrupt, Math.max(0, Math.min(5000, input.deadlineAt - performance.now())))
  const assertActive = () => {
    if (retired || input.signal.aborted || performance.now() >= input.deadlineAt) throw new Error("account_session_budget")
  }
  const boundedFetch: typeof fetch = async (request, init) => {
    const fetched = await fetch(request, { ...init, redirect: "manual", cache: "no-store", signal: controller.signal })
    if (retired) {
      void fetched.body?.cancel().catch(() => undefined)
      throw new Error("account_session_budget")
    }
    response = fetched
    assertActive()
    const headers = fetched.headers
    if (
      headers.get("x-request-id") !== input.requestId ||
      headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json" ||
      !headers
        .get("cache-control")
        ?.split(",")
        .some((value) => value.trim().toLowerCase() === "no-store") ||
      headers.has("location") ||
      headers.has("set-cookie")
    )
      throw new Error("account_session_response")
    let bytes = 2
    for (const [name, value] of headers) bytes += Buffer.byteLength(name) + Buffer.byteLength(value) + 4
    const max = Math.min(input.maxResponseBytes, 1024 * 1024)
    if (bytes > max) throw new Error("account_session_response")
    const chunks: Uint8Array[] = []
    if (fetched.body) {
      reader = fetched.body.getReader()
      while (true) {
        const chunk = await reader.read()
        assertActive()
        if (chunk.done) break
        bytes += chunk.value.byteLength
        if (bytes > max) throw new Error("account_session_response")
        chunks.push(chunk.value)
      }
      reader.releaseLock()
      reader = undefined
    }
    assertActive()
    return new Response(Buffer.concat(chunks), { status: fetched.status, headers })
  }
  try {
    const operation = async (): Promise<AccountSessionResult> => {
      const client = createClient({ baseUrl: input.baseUrl!, fetch: boundedFetch })
      const headers = { authorization: `Bearer ${input.token}`, "x-request-id": input.requestId, accept: "application/json" }
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
      if (result.response === undefined) return response === undefined ? unavailable() : invalid()
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
      if (status === 401 && code === "UNAUTHENTICATED") return { ok: false, status: 401, code: "session_invalid" }
      if (status === 403 && code === "PERMISSION_DENIED") return { ok: false, status: 403, code: "account_session_forbidden" }
      if (status === 404 && code === "NOT_FOUND") return { ok: false, status: 404, code: "account_session_not_found" }
      if (status === 409 && code === "TENANT_DISABLED") return { ok: false, status: 403, code: "session_forbidden" }
      if (status === 409 && code === "CONFLICT") return { ok: false, status: 409, code: "account_session_conflict" }
      if (status === 413 && code === "PAYLOAD_TOO_LARGE") return { ok: false, status: 413, code: "account_session_request_too_large" }
      if (status === 429 && code === "RATE_LIMITED") {
        const retry = response?.headers.get("retry-after") ?? ""
        if (!/^[1-9][0-9]{0,4}$/u.test(retry) || Number(retry) > 86400) return invalid()
        return { ok: false, status: 429, code: "account_session_rate_limited", retryAfter: retry }
      }
      if ((status === 500 && code === "INTERNAL") || (status === 503 && code === "DEPENDENCY_UNAVAILABLE")) return unavailable()
      return invalid()
    }
    return await Promise.race([operation(), budget])
  } catch {
    return retired || input.signal.aborted || response === undefined ? unavailable() : invalid()
  } finally {
    clearTimeout(timer)
    input.signal.removeEventListener("abort", interrupt)
    cancel()
  }
}
