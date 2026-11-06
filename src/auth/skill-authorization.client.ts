import { randomUUID } from "node:crypto"

import { zApiErrorResponse, zCheckTenantSkillAuthorizationBody, zCheckTenantSkillAuthorizationResponse } from "../generated/iam-http/zod.gen.js"
import type { SessionAdmissionClientOptions } from "./session-admission.client.js"
import { createIamHttpClient } from "../infrastructure/clients/iam-http-transport.js"
import { iamUserContextHeaders } from "./iam-user-context.js"
import { checkTenantSkillAuthorization } from "../generated/iam-http/sdk.gen.js"
import type { SkillAuthorizationInput, SkillAuthorizationResult } from "./skill-authorization.types.js"

const skillResponseSchema = zCheckTenantSkillAuthorizationResponse.extend({ data: zCheckTenantSkillAuthorizationResponse.shape.data.strict() }).strict()
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u

export class SkillAuthorizationClient {
  private readonly client: ReturnType<typeof createIamHttpClient> | null
  private readonly credentialFile: string | null

  public constructor(options: SessionAdmissionClientOptions) {
    this.credentialFile = options.credentialFile ?? null
    this.client = options.baseUrl === null ? null : createIamHttpClient({ ...options, baseUrl: options.baseUrl })
  }

  public async check(input: SkillAuthorizationInput): Promise<SkillAuthorizationResult> {
    const unavailable = { ok: false, status: 503, code: "iam_admission_unavailable" } as const
    if (this.client === null || !input.tenantId.trim() || !input.subjectId.trim()) return unavailable
    if (!zCheckTenantSkillAuthorizationBody.safeParse({ action: input.action }).success) return unavailable
    try {
      const result = await checkTenantSkillAuthorization({
        client: this.client,
        path: { tenant_id: input.tenantId },
        body: { action: input.action },
        headers: {
          ...(await iamUserContextHeaders({ ...input, credentialFile: this.credentialFile })),
          accept: "application/json",
          "x-request-id": REQUEST_ID_PATTERN.test(input.requestId) ? input.requestId : randomUUID(),
        },
        signal: input.signal,
        responseValidator: async (raw) => skillResponseSchema.parse(raw),
      })
      const response = result.response
      if (response === undefined) return unavailable
      const requestId = response.headers.get("x-request-id")
      const cacheControl = response.headers.get("cache-control")
      if (requestId === null || !REQUEST_ID_PATTERN.test(requestId) || !cacheControl?.split(",").some((value) => value.trim().toLowerCase() === "no-store"))
        return unavailable
      if (response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") return unavailable
      const body: unknown = response.status === 200 ? result.data : result.error
      if (response.status === 200) {
        const parsed = skillResponseSchema.safeParse(body)
        if (
          !parsed.success ||
          parsed.data.data.tenant_id !== input.tenantId ||
          parsed.data.data.subject_id !== input.subjectId ||
          parsed.data.data.action !== input.action
        )
          return unavailable
        return { ok: true }
      }
      const error = zApiErrorResponse.safeParse(body)
      if (!error.success) return unavailable
      if (response.status === 401 && error.data.error.code === "UNAUTHENTICATED") return unavailable
      if (response.status === 403 && error.data.error.code === "PERMISSION_DENIED") return { ok: false, status: 403, code: "skill_forbidden" }
      if (response.status === 429 && error.data.error.code === "RATE_LIMITED") return { ok: false, status: 429, code: "skill_rate_limited" }
      return unavailable
    } catch {
      return unavailable
    }
  }
}
