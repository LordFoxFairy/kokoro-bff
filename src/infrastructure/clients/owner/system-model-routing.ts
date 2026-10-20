import { isDeepStrictEqual } from "node:util"

import { strictParseRawJson } from "../../raw-json.js"

import {
  zListModelLabelResponse,
  zListModelRevisionResponse,
  zListRoutingPolicyResponse,
  zPutRoutingPolicyResponse,
} from "../../../generated/system-http/zod.gen.js"

export type SystemModelRoutingReadKind = "routing" | "labels" | "revisions"
export type SystemModelRoutingResult =
  Readonly<{ ok: true; data: unknown; nextCursor?: string | null }> | Readonly<{ ok: false; status: 400 | 403 | 404 | 409 | 428 | 502 | 503; code: string }>

export type SystemModelRoutingInput = Readonly<{
  baseUrl: string | null
  secret: string | null
  tenantId: string
  actorId: string
  requestId: string
  signal: AbortSignal
  deadlineAt: number
  maxResponseBytes: number
}>

type ReadInput = SystemModelRoutingInput & Readonly<{ kind: SystemModelRoutingReadKind; limit: number; cursor: string | null }>
type WriteInput = SystemModelRoutingInput &
  Readonly<{
    labelId: string
    body: Readonly<{ model_revision_id: string | null; visible: boolean; is_default: boolean; priority: number }>
    idempotencyKey: string
    ifMatch: string | null
    ifNoneMatch: "*" | null
  }>

const RESPONSE_SCHEMA = {
  routing: zListRoutingPolicyResponse,
  labels: zListModelLabelResponse,
  revisions: zListModelRevisionResponse,
} as const
const OWNER_PATH = {
  routing: "/v1/system/model-catalog/routing-policies",
  labels: "/v1/system/model-catalog/labels",
  revisions: "/v1/system/model-catalog/revisions",
} as const

function invalidResponse(): SystemModelRoutingResult {
  return { ok: false, status: 502, code: "admin_model_routing_response_invalid" }
}

function unavailable(): SystemModelRoutingResult {
  return { ok: false, status: 503, code: "admin_model_routing_unavailable" }
}

function headerBytes(headers: Headers): number {
  let size = 2
  for (const [name, value] of headers) size += Buffer.byteLength(name) + Buffer.byteLength(value) + 4
  return size
}

async function boundedJson(response: Response, limit: number): Promise<Uint8Array> {
  let size = headerBytes(response.headers)
  if (size > limit || response.body === null) throw new Error("System response exceeded budget")
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  try {
    while (true) {
      const part = await reader.read()
      if (part.done) break
      size += part.value.byteLength
      if (size > limit) throw new Error("System response exceeded budget")
      chunks.push(part.value)
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)))
}

export function ownerError(raw: unknown, status: number, operation: "read" | "write"): SystemModelRoutingResult {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).length !== 1) return invalidResponse()
  const error = (raw as { error?: unknown }).error
  if (error === null || typeof error !== "object" || Array.isArray(error) || !isDeepStrictEqual(Object.keys(error).sort(), ["code", "message", "retryable"]))
    return invalidResponse()
  const value = error as Record<string, unknown>
  if (typeof value.code !== "string" || value.code.length < 1 || typeof value.message !== "string" || typeof value.retryable !== "boolean")
    return invalidResponse()
  if ((status === 503) !== value.retryable) return invalidResponse()
  if (status === 403 && value.code === "service_auth_failed") return unavailable()
  if (status === 503 && value.code === "SYSTEM_UNAVAILABLE") return unavailable()
  if (operation === "read" && status === 400 && value.code === "INVALID_CURSOR") return { ok: false, status: 400, code: "invalid_admin_model_routing_request" }
  if (status === 400 && value.code === "INVALID_ARGUMENT") return { ok: false, status: 400, code: "invalid_admin_model_routing_request" }
  if (status === 403 && value.code === "FORBIDDEN") return { ok: false, status: 403, code: "admin_model_routing_forbidden" }
  if (operation === "write" && status === 404 && value.code === "NOT_FOUND") return { ok: false, status: 404, code: "admin_model_routing_not_found" }
  if (operation === "write" && status === 409 && value.code === "VERSION_CONFLICT")
    return { ok: false, status: 409, code: "admin_model_routing_version_conflict" }
  if (operation === "write" && status === 409 && value.code === "IDEMPOTENCY_KEY_REUSED")
    return { ok: false, status: 409, code: "admin_model_routing_idempotency_conflict" }
  if (operation === "write" && status === 409 && value.code === "INVALID_STATE") return { ok: false, status: 409, code: "admin_model_routing_invalid_state" }
  if (operation === "write" && status === 428 && value.code === "PRECONDITION_REQUIRED")
    return { ok: false, status: 428, code: "admin_model_routing_precondition_required" }
  return invalidResponse()
}

export async function dispatch(
  input: SystemModelRoutingInput,
  url: URL,
  init: RequestInit,
): Promise<{ response: Response; raw: unknown } | SystemModelRoutingResult> {
  if (input.baseUrl === null || input.secret === null || input.signal.aborted) return unavailable()
  const abort = new AbortController()
  const onAbort = (): void => abort.abort()
  input.signal.addEventListener("abort", onAbort, { once: true })
  const remaining = input.deadlineAt - Date.now()
  if (remaining <= 0) return unavailable()
  const timeout = setTimeout(onAbort, remaining)
  timeout.unref()
  try {
    const response = await fetch(url, { ...init, redirect: "manual", cache: "no-store", signal: abort.signal })
    const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase()
    if (contentType !== "application/json" || !/^[A-Za-z0-9._:-]{1,128}$/u.test(response.headers.get("x-request-id") ?? "")) {
      await response.body?.cancel().catch(() => undefined)
      return invalidResponse()
    }
    try {
      const bytes = await boundedJson(response, Math.min(input.maxResponseBytes, 1024 * 1024))
      if (abort.signal.aborted || Date.now() >= input.deadlineAt) return unavailable()
      try {
        strictParseRawJson(bytes)
        return { response, raw: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown }
      } catch {
        return invalidResponse()
      }
    } catch {
      return abort.signal.aborted ? unavailable() : invalidResponse()
    }
  } catch {
    return unavailable()
  } finally {
    clearTimeout(timeout)
    input.signal.removeEventListener("abort", onAbort)
  }
}

function ownerHeaders(input: SystemModelRoutingInput, permission: "system:read" | "system:write"): Record<string, string> {
  return {
    accept: "application/json",
    "x-kokoro-service": "web-bff",
    "x-kokoro-internal-secret": input.secret ?? "",
    "x-kokoro-tenant-id": input.tenantId,
    "x-kokoro-actor-id": input.actorId,
    "x-kokoro-iam-permissions": permission,
    "x-request-id": input.requestId,
  }
}

export async function readSystemModelRouting(input: ReadInput): Promise<SystemModelRoutingResult> {
  if (input.baseUrl === null) return unavailable()
  const url = new URL(OWNER_PATH[input.kind], `${input.baseUrl.replace(/\/+$/u, "")}/`)
  url.searchParams.set("limit", String(input.limit))
  if (input.cursor !== null) url.searchParams.set("cursor", input.cursor)
  const dispatched = await dispatch(input, url, { method: "GET", headers: ownerHeaders(input, "system:read") })
  if (!("response" in dispatched)) return dispatched
  if (dispatched.response.status !== 200) return ownerError(dispatched.raw, dispatched.response.status, "read")
  const parsed = RESPONSE_SCHEMA[input.kind].safeParse(dispatched.raw)
  if (!parsed.success || !isDeepStrictEqual(dispatched.raw, parsed.data)) return invalidResponse()
  if (input.kind === "routing" && (parsed.data.data.items as Array<{ tenant_id?: string }>).some((item) => item.tenant_id !== input.tenantId))
    return invalidResponse()
  if (Date.now() >= input.deadlineAt) return unavailable()
  return { ok: true, data: parsed.data.data.items, nextCursor: parsed.data.data.next_cursor }
}

export async function writeSystemModelRouting(input: WriteInput): Promise<SystemModelRoutingResult> {
  if (input.baseUrl === null) return unavailable()
  const url = new URL(`/v1/system/model-catalog/routing-policies/${encodeURIComponent(input.labelId)}`, `${input.baseUrl.replace(/\/+$/u, "")}/`)
  const dispatched = await dispatch(input, url, {
    method: "PUT",
    headers: {
      ...ownerHeaders(input, "system:write"),
      "content-type": "application/json",
      "idempotency-key": input.idempotencyKey,
      ...(input.ifMatch === null ? {} : { "if-match": input.ifMatch }),
      ...(input.ifNoneMatch === null ? {} : { "if-none-match": input.ifNoneMatch }),
    },
    body: JSON.stringify(input.body),
  })
  if (!("response" in dispatched)) return dispatched
  if (dispatched.response.status !== 200) return ownerError(dispatched.raw, dispatched.response.status, "write")
  const parsed = zPutRoutingPolicyResponse.safeParse(dispatched.raw)
  if (!parsed.success || !isDeepStrictEqual(dispatched.raw, parsed.data)) return invalidResponse()
  if (parsed.data.data.tenant_id !== input.tenantId || parsed.data.data.label_id !== input.labelId) return invalidResponse()
  if (
    !isDeepStrictEqual(
      {
        model_revision_id: parsed.data.data.model_revision_id,
        visible: parsed.data.data.visible,
        is_default: parsed.data.data.is_default,
        priority: parsed.data.data.priority,
      },
      input.body,
    )
  )
    return invalidResponse()
  if (Date.now() >= input.deadlineAt) return unavailable()
  return { ok: true, data: parsed.data.data }
}
