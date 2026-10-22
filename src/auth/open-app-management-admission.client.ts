import { isDeepStrictEqual } from "node:util"
import type { z } from "zod"
import { zApiErrorResponse, zVerifyOpenAppManagementAuthorizationResponse } from "../generated/iam-http/zod.gen.js"
import { strictParseRawJson } from "../infrastructure/raw-json.js"
import { SessionAdmissionTransport, type SessionAdmissionTransportInput } from "./session-admission.transport.js"
import type { SessionAdmissionClientOptions } from "./session-admission.client.js"

export type OpenAppManagementInput = SessionAdmissionTransportInput & Readonly<{ tenantId: string; appId: string }>
export type OpenAppRegistration = z.infer<typeof zVerifyOpenAppManagementAuthorizationResponse>["data"]
export type OpenAppManagementResult =
  Readonly<{ ok: true; registration: OpenAppRegistration }> | Readonly<{ ok: false; status: 401 | 403 | 429 | 503; code: string; retryAfter?: string }>
export type OpenAppManagementAdmission = Readonly<{ verify(input: OpenAppManagementInput): Promise<OpenAppManagementResult> }>
const unavailable = (): OpenAppManagementResult => ({ ok: false, status: 503, code: "iam_admission_unavailable" })

/** Fresh IAM operator eligibility and exact current registration, not platform-admin authority. */
export class OpenAppManagementAdmissionClient implements OpenAppManagementAdmission {
  private readonly transport: SessionAdmissionTransport | null
  constructor(options: SessionAdmissionClientOptions) {
    this.transport = options.baseUrl === null ? null : new SessionAdmissionTransport({ ...options, baseUrl: options.baseUrl })
  }
  async verify(input: OpenAppManagementInput): Promise<OpenAppManagementResult> {
    if (this.transport === null || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(input.appId)) return unavailable()
    try {
      const response = await this.transport.requestOpenAppManagement(input)
      input.signal.throwIfAborted()
      if (
        response.headers.get("x-request-id") !== input.requestId ||
        response.headers.get("cache-control") !== "no-store" ||
        response.headers.get("content-type")?.split(";", 1)[0] !== "application/json"
      )
        return unavailable()
      const raw = strictParseRawJson(new TextDecoder("utf-8", { fatal: true }).decode(response.body))
      if (response.status === 200) {
        const result = zVerifyOpenAppManagementAuthorizationResponse.safeParse(raw)
        if (
          !result.success ||
          !isDeepStrictEqual(result.data, JSON.parse(JSON.stringify(raw))) ||
          result.data.data.tenant_id !== input.tenantId ||
          result.data.data.app_id !== input.appId
        )
          return unavailable()
        return { ok: true, registration: Object.freeze(result.data.data) }
      }
      if (!zApiErrorResponse.safeParse(raw).success) return unavailable()
      if (response.status === 401) return { ok: false, status: 401, code: "session_invalid" }
      if ([403, 404, 409].includes(response.status)) return { ok: false, status: 403, code: "open_app_management_forbidden" }
      if (response.status === 429) {
        const retryAfter = response.headers.get("retry-after")
        if (retryAfter === null || !/^[1-9][0-9]{0,4}$/u.test(retryAfter) || Number(retryAfter) > 86400) return unavailable()
        return { ok: false, status: 429, code: "open_app_management_rate_limited", retryAfter }
      }
      return unavailable()
    } catch {
      return unavailable()
    }
  }
}
