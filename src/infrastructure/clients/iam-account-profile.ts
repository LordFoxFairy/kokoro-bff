import { strictParseRawJson } from "../raw-json.js"
import { isDeepStrictEqual } from "node:util"
import { createClient } from "../../generated/iam-http/client/index.js"
import { readAccountProfile, updateAccountProfile } from "../../generated/iam-http/sdk.gen.js"
import { zApiErrorResponse, zReadAccountProfileResponse, zUpdateAccountProfileResponse } from "../../generated/iam-http/zod.gen.js"
import type { AccountProfileInput, AccountProfileReadInput, AccountProfileReadResult, AccountProfileResult } from "./iam-account-profile.types.js"

type AccountProfileTransportInput = Pick<AccountProfileReadInput, "baseUrl" | "token" | "cookie" | "origin" | "requestId" | "signal" | "deadlineAt" | "maxResponseBytes">

type AccountProfileTransportResult<T> =
  | Readonly<{ ok: true; value: AccountProfileOwnerResult<T> }>
  | Readonly<{ ok: false; reason: "unavailable" | "invalid" }>

type AccountProfileOwnerResult<T> =
  | { data: T; error: undefined; response?: Response }
  | { data: undefined; error: unknown; response?: Response }

async function withAccountProfileTransport<T>(
  input: AccountProfileTransportInput,
  operation: (client: ReturnType<typeof createClient>) => Promise<AccountProfileOwnerResult<T>>,
): Promise<AccountProfileTransportResult<T>> {
  if (input.baseUrl === null || input.signal.aborted || input.deadlineAt <= performance.now()) return { ok: false, reason: "unavailable" }
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
    rejectBudget(new Error("account_profile_budget"))
  }
  input.signal.addEventListener("abort", interrupt, { once: true })
  const timer = setTimeout(interrupt, Math.max(0, Math.min(10000, input.deadlineAt - performance.now())))
  const assertActive = () => {
    if (retired || input.signal.aborted || performance.now() >= input.deadlineAt) throw new Error("account_profile_budget")
  }
  const boundedFetch: typeof fetch = async (request, init) => {
    const fetched = await fetch(request, { ...init, redirect: "manual", cache: "no-store", signal: controller.signal })
    if (retired) {
      void fetched.body?.cancel().catch(() => undefined)
      throw new Error("account_profile_budget")
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
      throw new Error("account_profile_response")
    let bytes = 2
    for (const [name, value] of headers) bytes += Buffer.byteLength(name) + Buffer.byteLength(value) + 4
    const max = Math.min(input.maxResponseBytes, 1024 * 1024)
    if (bytes > max) throw new Error("account_profile_response")
    const chunks: Uint8Array[] = []
    if (fetched.body) {
      reader = fetched.body.getReader()
      while (true) {
        const chunk = await reader.read()
        assertActive()
        if (chunk.done) break
        bytes += chunk.value.byteLength
        if (bytes > max) throw new Error("account_profile_response")
        chunks.push(chunk.value)
      }
      reader.releaseLock()
      reader = undefined
    }
    assertActive()
    const bytesBody = Buffer.concat(chunks)
    strictParseRawJson(bytesBody)
    return new Response(bytesBody, { status: fetched.status, headers })
  }
  try {
    const client = createClient({ baseUrl: input.baseUrl, fetch: boundedFetch })
    const result = await Promise.race([operation(client), budget])
    assertActive()
    return { ok: true, value: result.response === undefined && response !== undefined ? { ...result, response } : result }
  } catch {
    return { ok: false, reason: retired || input.signal.aborted || response === undefined ? "unavailable" : "invalid" }
  } finally {
    clearTimeout(timer)
    input.signal.removeEventListener("abort", interrupt)
    cancel()
  }
}

function mapAccountProfileError(result: { response?: Response; error?: unknown }, unavailable: string, invalid: string): AccountProfileResult | AccountProfileReadResult {
  if (result.response === undefined) return { ok: false, status: 503, code: unavailable }
  const status = result.response.status
  const parsed = zApiErrorResponse.safeParse(result.error)
  if (!parsed.success || !isDeepStrictEqual(parsed.data, result.error)) return { ok: false, status: 502, code: invalid }
  const code = parsed.data.error.code
  if (status === 400 && code === "INVALID_ARGUMENT") return { ok: false, status: 400, code: "account_profile_input_invalid" }
  if (status === 401 && code === "UNAUTHENTICATED") return { ok: false, status: 401, code: "session_invalid" }
  if (status === 403 && code === "PERMISSION_DENIED") return { ok: false, status: 403, code: "account_profile_forbidden" }
  if (status === 429 && code === "RATE_LIMITED") {
    const retry = result.response.headers.get("retry-after") ?? ""
    if (!/^[1-9][0-9]{0,4}$/u.test(retry) || Number(retry) > 86400) return { ok: false, status: 502, code: invalid }
    return { ok: false, status: 429, code: "account_profile_rate_limited", retryAfter: retry }
  }
  if ((status === 500 && code === "INTERNAL") || (status === 503 && code === "DEPENDENCY_UNAVAILABLE")) return { ok: false, status: 503, code: unavailable }
  return { ok: false, status: 502, code: invalid }
}

/** One absolute request budget, including uncooperative transport and body reads. */
export async function requestIamAccountProfile(input: AccountProfileInput): Promise<AccountProfileResult> {
  const transport = await withAccountProfileTransport(input, async (client) => {
      const headers = {
        authorization: `Bearer ${input.token}`,
        "x-request-id": input.requestId,
        accept: "application/json",
        ...(input.cookie === undefined || input.origin === undefined ? {} : { cookie: input.cookie, origin: input.origin }),
      }
      // Override the generated validator at the official pre-strip boundary.
      const responseValidator = async (raw: unknown) => {
        const parsed = zUpdateAccountProfileResponse.safeParse(raw)
        if (!parsed.success || !isDeepStrictEqual(raw, parsed.data)) throw new Error("account_profile_response")
        return parsed.data
      }
      return updateAccountProfile({ client, headers, body: { name: input.name, expected_name: input.expected_name }, responseValidator })
    })
  if (!transport.ok) return { ok: false, status: transport.reason === "unavailable" ? 503 : 502, code: transport.reason === "unavailable" ? "account_profile_unavailable" : "account_profile_response_invalid" }
  const result = transport.value
  if (result.response?.status === 200) {
    const parsed = zUpdateAccountProfileResponse.safeParse(result.data)
    if (!parsed.success || parsed.data.data.subject !== input.expectedSubject || parsed.data.data.name !== input.name)
      return { ok: false, status: 502, code: "account_profile_response_invalid" }
    return { ok: true, data: parsed.data.data }
  }
  const mapped = mapAccountProfileError(result, "account_profile_unavailable", "account_profile_response_invalid")
  if (result.response?.status === 404 || result.response?.status === 409) {
    const code = zApiErrorResponse.safeParse(result.error).success ? (result.error as { error: { code: string } }).error.code : ""
    if (result.response.status === 404 && code === "TENANT_NOT_FOUND") return { ok: false, status: 403, code: "session_forbidden" }
    if (result.response.status === 409 && code === "TENANT_DISABLED") return { ok: false, status: 403, code: "session_forbidden" }
    if (result.response.status === 409 && code === "CONFLICT") return { ok: false, status: 409, code: "account_profile_conflict" }
  }
  if (result.response?.status === 413 && result.error && zApiErrorResponse.safeParse(result.error).success)
    return { ok: false, status: 413, code: "account_profile_request_too_large" }
  return mapped as AccountProfileResult
}

export async function requestIamAccountProfileRead(input: AccountProfileReadInput): Promise<AccountProfileReadResult> {
  const transport = await withAccountProfileTransport(input, async (client) => {
    const headers = {
      authorization: `Bearer ${input.token}`,
      "x-request-id": input.requestId,
      accept: "application/json",
      ...(input.cookie === undefined || input.origin === undefined ? {} : { cookie: input.cookie, origin: input.origin }),
    }
    const responseValidator = async (raw: unknown) => {
      const parsed = zReadAccountProfileResponse.safeParse(raw)
      if (!parsed.success || !isDeepStrictEqual(raw, parsed.data)) throw new Error("account_profile_response")
      return parsed.data
    }
    return readAccountProfile({ client, headers, responseValidator })
  })
  if (!transport.ok) return { ok: false, status: transport.reason === "unavailable" ? 503 : 502, code: transport.reason === "unavailable" ? "account_profile_unavailable" : "account_profile_response_invalid" }
  const result = transport.value
  if (result.response?.status === 200) {
    const parsed = zReadAccountProfileResponse.safeParse(result.data)
    if (!parsed.success || parsed.data.data.subject !== input.expectedSubject) return { ok: false, status: 502, code: "account_profile_response_invalid" }
    return { ok: true, data: parsed.data.data }
  }
  return mapAccountProfileError(result, "account_profile_unavailable", "account_profile_response_invalid") as AccountProfileReadResult
}
