import { zApiErrorResponse, zListAuditEventsResponse } from "../../generated/iam-http/zod.gen.js"
import { iamUserContextHeaders } from "../../auth/iam-user-context.js"
import { strictParseRawJson } from "../raw-json.js"
import { requestIamHttp } from "./iam-http-transport.js"

const ownerData = zListAuditEventsResponse.shape.data
const pageSchema = zListAuditEventsResponse
  .extend({ data: ownerData.extend({ items: ownerData.shape.items.element.strict().array().max(100) }).strict() })
  .strict()
type AuditPage = ReturnType<typeof pageSchema.parse>["data"]
type AuditFailure = Readonly<{ ok: false; status: 400 | 403 | 429 | 502 | 503; code: string; retryAfter?: string }>
export type IamAuditEventsResult = Readonly<{ ok: true; data: AuditPage }> | AuditFailure
const unavailable = (): AuditFailure => ({ ok: false, status: 503, code: "admin_identity_owner_unavailable" })
const invalid = (): AuditFailure => ({ ok: false, status: 502, code: "admin_identity_owner_response_invalid" })

/** One IAM-owned page. Authentication facts and transport remain with their existing owners. */
export async function readIamAuditEvents(
  input: Readonly<{
    baseUrl: string | null
    credentialFile: string | null | undefined
    tenantId: string
    subjectId: string
    requestId: string
    limit: number
    cursor: string | null
    signal: AbortSignal
    timeoutMs: number
    maxResponseBytes: number
  }>,
): Promise<IamAuditEventsResult> {
  if (input.baseUrl === null || input.signal.aborted || input.timeoutMs <= 0) return unavailable()
  let response: Awaited<ReturnType<typeof requestIamHttp>>
  try {
    const target = new URL("/internal/v1/audit-events", input.baseUrl)
    target.searchParams.set("limit", String(input.limit))
    if (input.cursor !== null) target.searchParams.set("cursor", input.cursor)
    const headers = await iamUserContextHeaders(input)
    input.signal.throwIfAborted()
    response = await requestIamHttp(
      { ...input, baseUrl: input.baseUrl },
      {
        target,
        method: "GET",
        headers: { ...headers, accept: "application/json", "x-request-id": input.requestId },
        body: null,
        signal: input.signal,
      },
    )
    input.signal.throwIfAborted()
  } catch (error) {
    if (!input.signal.aborted && error instanceof Error && error.message === "IAM admission response exceeded its byte limit") return invalid()
    return unavailable()
  }
  const requestId = response.headers.get("x-request-id")
  if (
    !requestId ||
    !/^[A-Za-z0-9_-]{1,128}$/u.test(requestId) ||
    response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json" ||
    !response.headers
      .get("cache-control")
      ?.split(",")
      .some((value) => value.trim().toLowerCase() === "no-store") ||
    response.headers.has("set-cookie") ||
    response.headers.has("location")
  )
    return invalid()
  let raw: unknown
  try {
    raw = strictParseRawJson(response.body)
  } catch {
    return invalid()
  }
  if (response.status === 200) {
    const parsed = pageSchema.safeParse(raw)
    if (!parsed.success || parsed.data.data.items.length > input.limit || parsed.data.data.items.some((event) => event.tenant_id !== input.tenantId))
      return invalid()
    return { ok: true, data: parsed.data.data }
  }
  const error = zApiErrorResponse.safeParse(raw)
  if (!error.success) return invalid()
  const code = error.data.error.code
  if (response.status === 400 && code === "INVALID_ARGUMENT") return { ok: false, status: 400, code: "admin_identity_query_invalid" }
  if (response.status === 403 && (code === "PERMISSION_DENIED" || code === "TENANT_DISABLED"))
    return { ok: false, status: 403, code: "admin_identity_forbidden" }
  if (response.status === 429 && code === "RATE_LIMITED") {
    const after = response.headers.get("retry-after")
    return {
      ok: false,
      status: 429,
      code: "admin_identity_rate_limited",
      ...(after !== null && /^[1-9][0-9]{0,4}$/u.test(after) && Number(after) <= 86400 ? { retryAfter: after } : {}),
    }
  }
  if (
    (response.status === 401 && ["UNAUTHENTICATED", "bff_user_context_service_unauthenticated"].includes(code)) ||
    (response.status === 500 && code === "INTERNAL") ||
    (response.status === 503 && code === "DEPENDENCY_UNAVAILABLE")
  )
    return unavailable()
  return invalid()
}
