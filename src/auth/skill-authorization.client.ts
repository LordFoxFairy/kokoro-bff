import { randomUUID } from "node:crypto"

import { zApiErrorResponse, zCheckTenantSkillAuthorizationBody, zCheckTenantSkillAuthorizationResponse } from "../generated/iam-http/zod.gen.js"
import type { SessionAdmissionClientOptions } from "./session-admission.client.js"
import { SessionAdmissionTransport } from "./session-admission.transport.js"
import type { SkillAuthorizationInput, SkillAuthorizationResult } from "./skill-authorization.types.js"

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u

export class SkillAuthorizationClient {
  private readonly transport: SessionAdmissionTransport | null

  public constructor(options: SessionAdmissionClientOptions) {
    this.transport = options.baseUrl === null ? null : new SessionAdmissionTransport({ ...options, baseUrl: options.baseUrl })
  }

  public async check(input: SkillAuthorizationInput): Promise<SkillAuthorizationResult> {
    const unavailable = { ok: false, status: 503, code: "iam_admission_unavailable" } as const
    if (this.transport === null || !input.token.trim() || !input.tenantId.trim() || !input.subjectId.trim()) return unavailable
    if (!zCheckTenantSkillAuthorizationBody.safeParse({ action: input.action }).success) return unavailable
    try {
      const response = await this.transport.requestSkillAuthorization({
        ...input,
        requestId: REQUEST_ID_PATTERN.test(input.requestId) ? input.requestId : randomUUID(),
      })
      const requestId = response.headers.get("x-request-id")
      const cacheControl = response.headers.get("cache-control")
      if (requestId === null || !REQUEST_ID_PATTERN.test(requestId) || !cacheControl?.split(",").some((value) => value.trim().toLowerCase() === "no-store"))
        return unavailable
      if (response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") return unavailable
      const body: unknown = JSON.parse(response.body.toString("utf8"))
      if (response.status === 200) {
        const schema = zCheckTenantSkillAuthorizationResponse.extend({ data: zCheckTenantSkillAuthorizationResponse.shape.data.strict() }).strict()
        const parsed = schema.safeParse(body)
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
      if (response.status === 401 && error.data.error.code === "UNAUTHENTICATED") return { ok: false, status: 401, code: "session_invalid" }
      if (response.status === 403 && error.data.error.code === "PERMISSION_DENIED") return { ok: false, status: 403, code: "skill_forbidden" }
      if (response.status === 429 && error.data.error.code === "RATE_LIMITED") return { ok: false, status: 429, code: "skill_rate_limited" }
      return unavailable
    } catch {
      return unavailable
    }
  }
}
