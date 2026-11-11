import { isDeepStrictEqual } from "node:util"
import type { z } from "zod"
import { zApiErrorResponse, zVerifySkillListIdentityResponse } from "../generated/iam-http/zod.gen.js"
import { createIamHttpClient } from "../infrastructure/clients/iam-http-transport.js"
import { verifySkillListIdentity } from "../generated/iam-http/sdk.gen.js"
import type { SessionAdmissionClientOptions } from "./session-admission.client.js"

export type SkillListIdentityInput = Readonly<{ token: string; requestId: string; signal: AbortSignal }>
export type SkillListPrincipal = z.infer<typeof zVerifySkillListIdentityResponse>["data"]
export type SkillListAdmissionResult =
  Readonly<{ ok: true; principal: SkillListPrincipal }> | Readonly<{ ok: false; status: 401 | 403 | 429 | 503; code: string; retryAfter?: string }>
export type SkillListAdmission = Readonly<{ verify(input: SkillListIdentityInput): Promise<SkillListAdmissionResult> }>
const unavailable = (): SkillListAdmissionResult => ({ ok: false, status: 503, code: "iam_admission_unavailable" })

/** Public skill.list only. No Product-session fallback or inferred App trust. */
export class SkillListAdmissionClient implements SkillListAdmission {
  private readonly client: ReturnType<typeof createIamHttpClient> | null
  constructor(options: SessionAdmissionClientOptions) {
    this.client = options.baseUrl === null ? null : createIamHttpClient({ ...options, baseUrl: options.baseUrl })
  }
  async verify(input: SkillListIdentityInput): Promise<SkillListAdmissionResult> {
    if (this.client === null) return unavailable()
    try {
      const result = await verifySkillListIdentity({
        client: this.client,
        headers: { authorization: `Bearer ${input.token}`, accept: "application/json", "x-request-id": input.requestId },
        signal: input.signal,
        responseValidator: async (raw) => {
          const parsed = zVerifySkillListIdentityResponse.parse(raw)
          if (!isDeepStrictEqual(parsed, raw)) throw new Error("iam_identity_response_invalid")
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
        const result = zVerifySkillListIdentityResponse.safeParse(raw)
        if (!result.success || !isDeepStrictEqual(result.data, JSON.parse(JSON.stringify(raw)))) return unavailable()
        return { ok: true, principal: Object.freeze(result.data.data) }
      }
      if (!zApiErrorResponse.safeParse(raw).success) return unavailable()
      if (response.status === 401) return { ok: false, status: 401, code: "skill_list_identity_invalid" }
      if ([403, 404, 409].includes(response.status)) return { ok: false, status: 403, code: "skill_list_identity_forbidden" }
      if (response.status === 429) {
        const retryAfter = response.headers.get("retry-after")
        if (retryAfter === null || !/^[1-9][0-9]{0,4}$/u.test(retryAfter) || Number(retryAfter) > 86400) return unavailable()
        return { ok: false, status: 429, code: "skill_list_rate_limited", retryAfter }
      }
      return unavailable()
    } catch {
      return unavailable()
    }
  }
}
