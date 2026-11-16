import { iamUserContextHeaders } from "../../auth/iam-user-context.js"
import { strictParseRawJson } from "../raw-json.js"
import { isDeepStrictEqual } from "node:util"
import type { createClient } from "../../generated/iam-http/client/index.js"
import { withIamAccountTransport } from "./iam-account-transport.js"
import { readAccountProfile, updateAccountProfile } from "../../generated/iam-http/sdk.gen.js"
import { zApiErrorResponse, zReadAccountProfileResponse, zUpdateAccountProfileResponse } from "../../generated/iam-http/zod.gen.js"
import type { AccountProfileInput, AccountProfileReadInput, AccountProfileReadResult, AccountProfileResult } from "./iam-account-profile.types.js"

type AccountProfileTransportInput = Pick<AccountProfileReadInput, "baseUrl" | "requestId" | "signal" | "deadlineAt" | "maxResponseBytes">

type AccountProfileTransportResult<T> = Readonly<{ ok: true; value: AccountProfileOwnerResult<T> }> | Readonly<{ ok: false; reason: "unavailable" | "invalid" }>

type AccountProfileOwnerResult<T> = { data: T; error: undefined; response?: Response } | { data: undefined; error: unknown; response?: Response }

async function withAccountProfileTransport<T>(
  input: AccountProfileTransportInput,
  operation: (client: ReturnType<typeof createClient>) => Promise<AccountProfileOwnerResult<T>>,
): Promise<AccountProfileTransportResult<T>> {
  return withIamAccountTransport(
    {
      baseUrl: input.baseUrl,
      requestId: input.requestId,
      signal: input.signal,
      deadlineAt: input.deadlineAt,
      maxResponseBytes: input.maxResponseBytes,
      timeoutMs: 10000,
      inspectResponseBody: strictParseRawJson,
    },
    ({ client }) => operation(client),
    (result, { assertActive, response }) => {
      assertActive()
      const fetched = response()
      return result.response === undefined && fetched !== undefined ? { ...result, response: fetched } : result
    },
  )
}

function mapAccountProfileError(
  result: { response?: Response; error?: unknown },
  unavailable: string,
  invalid: string,
): AccountProfileResult | AccountProfileReadResult {
  if (result.response === undefined) return { ok: false, status: 503, code: unavailable }
  const status = result.response.status
  const parsed = zApiErrorResponse.safeParse(result.error)
  if (!parsed.success || !isDeepStrictEqual(parsed.data, result.error)) return { ok: false, status: 502, code: invalid }
  const code = parsed.data.error.code
  if (status === 400 && code === "INVALID_ARGUMENT") return { ok: false, status: 400, code: "account_profile_input_invalid" }
  if (status === 401 && (code === "UNAUTHENTICATED" || code === "bff_user_context_service_unauthenticated"))
    return { ok: false, status: 503, code: unavailable }
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
      ...(await iamUserContextHeaders(input)),
      "x-request-id": input.requestId,
      accept: "application/json",
    }
    // Override the generated validator at the official pre-strip boundary.
    const responseValidator = async (raw: unknown) => {
      const parsed = zUpdateAccountProfileResponse.safeParse(raw)
      if (!parsed.success || !isDeepStrictEqual(raw, parsed.data)) throw new Error("account_profile_response")
      return parsed.data
    }
    return updateAccountProfile({ client, headers, body: { name: input.name, expected_name: input.expected_name }, responseValidator })
  })
  if (!transport.ok)
    return {
      ok: false,
      status: transport.reason === "unavailable" ? 503 : 502,
      code: transport.reason === "unavailable" ? "account_profile_unavailable" : "account_profile_response_invalid",
    }
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
      ...(await iamUserContextHeaders(input)),
      "x-request-id": input.requestId,
      accept: "application/json",
    }
    const responseValidator = async (raw: unknown) => {
      const parsed = zReadAccountProfileResponse.safeParse(raw)
      if (!parsed.success || !isDeepStrictEqual(raw, parsed.data)) throw new Error("account_profile_response")
      return parsed.data
    }
    return readAccountProfile({ client, headers, responseValidator })
  })
  if (!transport.ok)
    return {
      ok: false,
      status: transport.reason === "unavailable" ? 503 : 502,
      code: transport.reason === "unavailable" ? "account_profile_unavailable" : "account_profile_response_invalid",
    }
  const result = transport.value
  if (result.response?.status === 200) {
    const parsed = zReadAccountProfileResponse.safeParse(result.data)
    if (!parsed.success || parsed.data.data.subject !== input.expectedSubject) return { ok: false, status: 502, code: "account_profile_response_invalid" }
    return { ok: true, data: parsed.data.data }
  }
  return mapAccountProfileError(result, "account_profile_unavailable", "account_profile_response_invalid") as AccountProfileReadResult
}
