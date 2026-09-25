import { randomUUID } from "node:crypto"
import { isDeepStrictEqual } from "node:util"

import {
  zApiErrorResponse,
  zCancelTenantInvitationResponse,
  zCreateTenantInvitationResponse,
  zLeaveTenantResponse,
  zListTenantInvitationsResponse,
  zListTenantMembersResponse,
  zListTenantRolesResponse,
  zRemoveTenantMemberResponse,
  zReplaceTenantMemberRolesResponse,
  zResendTenantInvitationResponse,
} from "../../generated/iam-http/zod.gen.js"

export type TeamReadKind = "members" | "invitations" | "roles"
export type TeamReadResult =
  | Readonly<{ ok: true; data: unknown[]; nextCursor: string | null }>
  | Readonly<{ ok: false; status: 400 | 401 | 403 | 404 | 429 | 502 | 503; code: string; retryAfter?: string }>

export type TeamReadInput = Readonly<{
  baseUrl: string | null
  tenantId: string
  token: string
  kind: TeamReadKind
  limit: number
  cursor: string | null
  requestId: string
  signal: AbortSignal
  timeoutMs: number
  maxResponseBytes: number
}>

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u
const RETRY_AFTER_PATTERN = /^[1-9][0-9]{0,4}$/u
const RESPONSE_SCHEMA = {
  members: zListTenantMembersResponse,
  invitations: zListTenantInvitationsResponse,
  roles: zListTenantRolesResponse,
} as const

function invalidOwnerResponse(): TeamReadResult {
  return { ok: false, status: 502, code: "team_owner_response_invalid" }
}

function unavailable(): TeamReadResult {
  return { ok: false, status: 503, code: "team_owner_unavailable" }
}

function validHeaders(headers: Headers): boolean {
  const requestId = headers.get("x-request-id")
  const cacheControl = headers.get("cache-control")
  const contentType = headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase()
  return (
    requestId !== null &&
    REQUEST_ID_PATTERN.test(requestId) &&
    cacheControl !== null &&
    cacheControl.split(",").some((part) => part.trim().toLowerCase() === "no-store") &&
    contentType === "application/json"
  )
}

function headerBytes(headers: Headers): number {
  let size = 2
  for (const [name, value] of headers) size += Buffer.byteLength(name) + Buffer.byteLength(value) + 4
  return size
}

async function boundedJson(response: Response, maxBytes: number): Promise<unknown> {
  const bytes = headerBytes(response.headers)
  if (bytes > maxBytes || response.body === null) {
    await response.body?.cancel().catch(() => undefined)
    throw new Error("IAM Team response exceeded the budget")
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = bytes
  try {
    while (true) {
      const part = await reader.read()
      if (part.done) break
      size += part.value.byteLength
      if (size > maxBytes) throw new Error("IAM Team response exceeded the budget")
      chunks.push(part.value)
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
  return JSON.parse(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8")) as unknown
}

function mappedError(status: number, headers: Headers): TeamReadResult {
  if (status === 400) return { ok: false, status: 400, code: "team_query_invalid" }
  if (status === 401) return { ok: false, status: 401, code: "session_invalid" }
  if (status === 403) return { ok: false, status: 403, code: "team_forbidden" }
  if (status === 404) return { ok: false, status: 404, code: "team_not_found" }
  if (status === 429) {
    const retryAfter = headers.get("retry-after")
    const seconds = retryAfter !== null && RETRY_AFTER_PATTERN.test(retryAfter) ? Number(retryAfter) : 0
    return { ok: false, status: 429, code: "team_rate_limited", ...(seconds >= 1 && seconds <= 86_400 ? { retryAfter: retryAfter! } : {}) }
  }
  if (status === 409) return { ok: false, status: 403, code: "team_forbidden" }
  if (status === 500 || status === 503) return unavailable()
  return invalidOwnerResponse()
}

export async function readIamTeamPage(input: TeamReadInput): Promise<TeamReadResult> {
  if (input.baseUrl === null) return unavailable()
  const requestId = REQUEST_ID_PATTERN.test(input.requestId) ? input.requestId : randomUUID()
  const target = new URL(`/internal/v1/tenants/${encodeURIComponent(input.tenantId)}/${input.kind}`, `${input.baseUrl.replace(/\/+$/u, "")}/`)
  target.searchParams.set("limit", String(input.limit))
  if (input.cursor !== null) target.searchParams.set("cursor", input.cursor)
  const abort = new AbortController()
  const onAbort = (): void => abort.abort()
  if (input.signal.aborted) return unavailable()
  input.signal.addEventListener("abort", onAbort, { once: true })
  const timeout = setTimeout(onAbort, Math.min(input.timeoutMs, 5000))
  timeout.unref()
  try {
    const response = await fetch(target, {
      method: "GET",
      headers: { accept: "application/json", authorization: `Bearer ${input.token}`, "x-request-id": requestId },
      redirect: "manual",
      cache: "no-store",
      signal: abort.signal,
    })
    if (!validHeaders(response.headers)) {
      await response.body?.cancel().catch(() => undefined)
      return invalidOwnerResponse()
    }
    const maxBytes = Math.min(input.maxResponseBytes, 1024 * 1024)
    let raw: unknown
    try {
      raw = await boundedJson(response, maxBytes)
    } catch {
      return invalidOwnerResponse()
    }
    if (response.status === 200) {
      const parsed = RESPONSE_SCHEMA[input.kind].safeParse(raw)
      if (!parsed.success || !isDeepStrictEqual(raw, parsed.data) || (parsed.data.meta.next_cursor !== null && parsed.data.meta.next_cursor.length > 2048))
        return invalidOwnerResponse()
      return { ok: true, data: parsed.data.data, nextCursor: parsed.data.meta.next_cursor }
    }
    const parsedError = zApiErrorResponse.safeParse(raw)
    if (!parsedError.success || !isDeepStrictEqual(raw, parsedError.data)) return invalidOwnerResponse()
    return mappedError(response.status, response.headers)
  } catch {
    return unavailable()
  } finally {
    clearTimeout(timeout)
    input.signal.removeEventListener("abort", onAbort)
  }
}

export type TeamWriteKind = "create-invitation" | "resend-invitation" | "cancel-invitation" | "replace-roles" | "remove-member" | "leave"
export type TeamWriteResult =
  Readonly<{ ok: true; data: unknown }> | Readonly<{ ok: false; status: 400 | 401 | 403 | 404 | 409 | 429 | 502 | 503; code: string; retryAfter?: string }>
export type TeamWriteInput = Readonly<{
  baseUrl: string | null
  tenantId: string
  token: string
  kind: TeamWriteKind
  resourceId: string | null
  body: Readonly<Record<string, unknown>> | null
  requestId: string
  signal: AbortSignal
  timeoutMs: number
  maxResponseBytes: number
}>

const WRITE_SCHEMA = {
  "create-invitation": zCreateTenantInvitationResponse,
  "resend-invitation": zResendTenantInvitationResponse,
  "cancel-invitation": zCancelTenantInvitationResponse,
  "replace-roles": zReplaceTenantMemberRolesResponse,
  "remove-member": zRemoveTenantMemberResponse,
  leave: zLeaveTenantResponse,
} as const
const CONFLICT_CODES = new Set(["LAST_OWNER", "INVITATION_CONFLICT", "CONFLICT", "ROLE_NAME_CONFLICT", "ROLE_IN_USE", "INVITATION_EXPIRED", "TENANT_DISABLED"])
const NOT_FOUND_CODES = new Set(["NOT_FOUND", "TENANT_NOT_FOUND", "MEMBER_NOT_FOUND", "ROLE_NOT_FOUND", "INVITATION_NOT_FOUND"])

function writeTarget(input: TeamWriteInput): { method: "POST" | "PUT" | "DELETE"; path: string } {
  const tenant = encodeURIComponent(input.tenantId)
  const id = input.resourceId === null ? "" : encodeURIComponent(input.resourceId)
  const root = `/internal/v1/tenants/${tenant}`
  switch (input.kind) {
    case "create-invitation":
      return { method: "POST", path: `${root}/invitations` }
    case "resend-invitation":
      return { method: "POST", path: `${root}/invitations/${id}/resend` }
    case "cancel-invitation":
      return { method: "DELETE", path: `${root}/invitations/${id}` }
    case "replace-roles":
      return { method: "PUT", path: `${root}/members/${id}/roles` }
    case "remove-member":
      return { method: "DELETE", path: `${root}/members/${id}` }
    case "leave":
      return { method: "DELETE", path: `${root}/members/me` }
  }
}

function writeError(status: number, code: string, headers: Headers): TeamWriteResult {
  if ((status === 400 && code === "INVALID_ARGUMENT") || (status === 413 && code === "PAYLOAD_TOO_LARGE"))
    return { ok: false, status: 400, code: "team_input_invalid" }
  if (status === 401 && code === "UNAUTHENTICATED") return { ok: false, status: 401, code: "session_invalid" }
  if (status === 403 && code === "PERMISSION_DENIED") return { ok: false, status: 403, code: "team_forbidden" }
  if (status === 404) return NOT_FOUND_CODES.has(code) ? { ok: false, status: 404, code } : invalidOwnerResponse()
  if (status === 409) return CONFLICT_CODES.has(code) ? { ok: false, status: 409, code } : invalidOwnerResponse()
  if (status === 429 && code === "RATE_LIMITED") {
    const retryAfter = headers.get("retry-after")
    const seconds = retryAfter !== null && RETRY_AFTER_PATTERN.test(retryAfter) ? Number(retryAfter) : 0
    return { ok: false, status: 429, code: "team_rate_limited", ...(seconds >= 1 && seconds <= 86_400 ? { retryAfter: retryAfter! } : {}) }
  }
  if ((status === 500 && code === "INTERNAL") || (status === 503 && code === "DEPENDENCY_UNAVAILABLE")) return unavailable()
  return invalidOwnerResponse()
}

export async function writeIamTeam(input: TeamWriteInput): Promise<TeamWriteResult> {
  if (input.baseUrl === null || input.signal.aborted) return unavailable()
  const requestId = REQUEST_ID_PATTERN.test(input.requestId) ? input.requestId : randomUUID()
  const target = writeTarget(input)
  const url = new URL(target.path, `${input.baseUrl.replace(/\/+$/u, "")}/`)
  const abort = new AbortController()
  const onAbort = (): void => abort.abort()
  input.signal.addEventListener("abort", onAbort, { once: true })
  const timeout = setTimeout(onAbort, Math.min(input.timeoutMs, 5000))
  timeout.unref()
  try {
    const response = await fetch(url, {
      method: target.method,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${input.token}`,
        "x-request-id": requestId,
        ...(input.body === null ? {} : { "content-type": "application/json" }),
      },
      ...(input.body === null ? {} : { body: JSON.stringify(input.body) }),
      redirect: "manual",
      cache: "no-store",
      signal: abort.signal,
    })
    if (!validHeaders(response.headers)) {
      await response.body?.cancel().catch(() => undefined)
      return invalidOwnerResponse()
    }
    let raw: unknown
    try {
      raw = await boundedJson(response, Math.min(input.maxResponseBytes, 1024 * 1024))
    } catch {
      return abort.signal.aborted ? unavailable() : invalidOwnerResponse()
    }
    if (response.status === 200) {
      const parsed = WRITE_SCHEMA[input.kind].safeParse(raw)
      if (!parsed.success || !isDeepStrictEqual(raw, parsed.data)) return invalidOwnerResponse()
      return { ok: true, data: parsed.data.data }
    }
    const parsedError = zApiErrorResponse.safeParse(raw)
    if (!parsedError.success || !isDeepStrictEqual(raw, parsedError.data)) return invalidOwnerResponse()
    return writeError(response.status, parsedError.data.error.code, response.headers)
  } catch {
    return unavailable()
  } finally {
    clearTimeout(timeout)
    input.signal.removeEventListener("abort", onAbort)
  }
}
