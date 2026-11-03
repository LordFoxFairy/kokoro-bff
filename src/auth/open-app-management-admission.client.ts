import { isDeepStrictEqual } from "node:util"
import type { z } from "zod"
import { zApiErrorResponse, zVerifyOpenAppManagementAuthorizationResponse } from "../generated/iam-http/zod.gen.js"
import { createIamHttpClient } from "../infrastructure/clients/iam-http-transport.js"
import { iamUserContextHeaders } from "./iam-user-context.js"
import { verifyOpenAppManagementAuthorization } from "../generated/iam-http/sdk.gen.js"
import type { IamUserContextInput } from "./iam-user-context.js"
import type { SessionAdmissionClientOptions } from "./session-admission.client.js"

export type OpenAppManagementInput = IamUserContextInput & Readonly<{ tenantId: string; appId: string }>
export type OpenAppRegistration = z.infer<typeof zVerifyOpenAppManagementAuthorizationResponse>["data"]
export type OpenAppManagementResult =
  Readonly<{ ok: true; registration: OpenAppRegistration }> | Readonly<{ ok: false; status: 401 | 403 | 429 | 503; code: string; retryAfter?: string }>
export type OpenAppManagementAdmission = Readonly<{ verify(input: OpenAppManagementInput): Promise<OpenAppManagementResult> }>
const unavailable = (): OpenAppManagementResult => ({ ok: false, status: 503, code: "iam_admission_unavailable" })

/** Fresh IAM operator eligibility and exact current registration, not platform-admin authority. */
export class OpenAppManagementAdmissionClient implements OpenAppManagementAdmission {
  private readonly client: ReturnType<typeof createIamHttpClient> | null
  private readonly credentialFile: string | null
  constructor(options: SessionAdmissionClientOptions) {
    this.credentialFile = options.credentialFile ?? null
    this.client = options.baseUrl === null ? null : createIamHttpClient({ ...options, baseUrl: options.baseUrl })
  }
  async verify(input: OpenAppManagementInput): Promise<OpenAppManagementResult> {
    if (this.client === null || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(input.appId)) return unavailable()
    try {
      const result = await verifyOpenAppManagementAuthorization({
        client: this.client,
        path: { app_id: input.appId },
        headers: {
          ...(await iamUserContextHeaders({ ...input, credentialFile: this.credentialFile })),
          accept: "application/json",
          "x-request-id": input.requestId,
        },
        signal: input.signal,
        responseValidator: async (raw) => {
          const parsed = zVerifyOpenAppManagementAuthorizationResponse.parse(raw)
          if (!isDeepStrictEqual(parsed, raw)) throw new Error("iam_operator_response_invalid")
          return parsed
        },
      })
      const response = result.response
      if (response === undefined) return unavailable()
      input.signal.throwIfAborted()
      if (
        response.headers.get("x-request-id") !== input.requestId ||
        response.headers.get("cache-control") !== "no-store" ||
        response.headers.get("content-type")?.split(";", 1)[0] !== "application/json"
      )
        return unavailable()
      const raw: unknown = response.status === 200 ? result.data : result.error
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
      if (response.status === 401) return unavailable()
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
