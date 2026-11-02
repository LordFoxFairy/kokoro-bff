import { randomUUID } from "node:crypto"

import { zApiErrorResponse, zVerifyNativeSessionResponse, zVerifySessionAuthorizationResponse } from "../generated/iam-http/zod.gen.js"
import type { NativeSessionAdmissionInput, SessionAdmission, SessionAdmissionInput, SessionAdmissionResult } from "./session-admission.types.js"
import { SessionAdmissionTransport } from "./session-admission.transport.js"
import { readIamSessionAdmissionCredential } from "./iam-session-admission-credential.js"

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u
const RETRY_AFTER_PATTERN = /^[1-9][0-9]{0,4}$/u

export type SessionAdmissionClientOptions = Readonly<{
  baseUrl: string | null
  credentialFile?: string | null | undefined
  webOrigin?: string | null | undefined
  tenantId?: string | null | undefined
  timeoutMs: number
  maxResponseBytes: number
}>

function unavailable(): SessionAdmissionResult {
  return { ok: false, status: 503, code: "iam_admission_unavailable" }
}

function controlledRequestId(value: string): string {
  return REQUEST_ID_PATTERN.test(value) ? value : randomUUID()
}

function validResponseHeaders(headers: Headers): boolean {
  const requestId = headers.get("x-request-id")
  const cacheControl = headers.get("cache-control")
  return (
    requestId !== null &&
    REQUEST_ID_PATTERN.test(requestId) &&
    cacheControl !== null &&
    cacheControl.split(",").some((directive) => directive.trim().toLowerCase() === "no-store")
  )
}

function parseJson(body: Buffer): unknown | null {
  try {
    return JSON.parse(body.toString("utf8")) as unknown
  } catch {
    return null
  }
}

function retryAfter(headers: Headers): string | null {
  const value = headers.get("retry-after")
  if (value === null || !RETRY_AFTER_PATTERN.test(value)) return null
  const seconds = Number(value)
  return Number.isSafeInteger(seconds) && seconds >= 1 && seconds <= 86_400 ? value : null
}

export class SessionAdmissionClient implements SessionAdmission {
  private readonly transport: SessionAdmissionTransport | null
  private readonly credentialFile: string | null
  private readonly webOrigin: string | null
  private readonly tenantId: string | null

  public constructor(options: SessionAdmissionClientOptions) {
    this.credentialFile = options.credentialFile ?? null
    this.webOrigin = options.webOrigin ?? null
    this.tenantId = options.tenantId ?? null
    this.transport =
      options.baseUrl === null
        ? null
        : new SessionAdmissionTransport({ baseUrl: options.baseUrl, timeoutMs: options.timeoutMs, maxResponseBytes: options.maxResponseBytes })
  }

  public async verify(input: SessionAdmissionInput): Promise<SessionAdmissionResult> {
    if (this.transport === null) return unavailable()
    try {
      const response = await this.transport.request({ ...input, requestId: controlledRequestId(input.requestId) })
      if (!validResponseHeaders(response.headers)) return unavailable()
      const body = parseJson(response.body)
      if (body === null) return unavailable()
      if (response.status === 200) {
        const parsed = zVerifySessionAuthorizationResponse.safeParse(body)
        if (!parsed.success) return unavailable()
        return {
          ok: true,
          identity: { namespace: parsed.data.data.tenant_id, userId: parsed.data.data.user_id },
          platformAdmin: parsed.data.data.platform_admin,
        }
      }
      if (!zApiErrorResponse.safeParse(body).success) return unavailable()
      if (response.status === 401) return { ok: false, status: 401, code: "session_invalid" }
      if (response.status === 403 || response.status === 404 || response.status === 409) {
        return { ok: false, status: 403, code: "session_forbidden" }
      }
      if (response.status === 429) {
        const header = retryAfter(response.headers)
        return {
          ok: false,
          status: 429,
          code: "session_rate_limited",
          ...(header === null ? {} : { retryAfter: header }),
        }
      }
      return unavailable()
    } catch {
      return unavailable()
    }
  }

  public async verifyNative(input: NativeSessionAdmissionInput): Promise<SessionAdmissionResult> {
    if (this.transport === null || this.credentialFile === null || this.webOrigin === null) return unavailable()
    if (input.origin !== this.webOrigin) return { ok: false, status: 403, code: "session_forbidden" }
    try {
      const credential = await readIamSessionAdmissionCredential(this.credentialFile, this.tenantId, input.signal)
      const response = await this.transport.requestNativeSession({ ...input, credential, requestId: controlledRequestId(input.requestId) })
      if (!validResponseHeaders(response.headers)) return unavailable()
      const body = parseJson(response.body)
      if (body === null) return unavailable()
      if (response.status === 200) {
        const parsed = zVerifyNativeSessionResponse.safeParse(body)
        if (!parsed.success) return unavailable()
        return {
          ok: true,
          identity: { namespace: parsed.data.data.tenant_id, userId: parsed.data.data.subject_id },
          platformAdmin: parsed.data.data.permissions.includes("platform.admin"),
        }
      }
      if (!zApiErrorResponse.safeParse(body).success) return unavailable()
      if (response.status === 401) return { ok: false, status: 401, code: "session_invalid" }
      if (response.status === 403) return { ok: false, status: 403, code: "session_forbidden" }
      if (response.status === 429) {
        const header = retryAfter(response.headers)
        return { ok: false, status: 429, code: "session_rate_limited", ...(header === null ? {} : { retryAfter: header }) }
      }
      if (response.status === 504) return { ok: false, status: 503, code: "iam_admission_unavailable" }
      return unavailable()
    } catch {
      return unavailable()
    }
  }
}
