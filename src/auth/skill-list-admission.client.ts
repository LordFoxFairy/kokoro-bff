import { isDeepStrictEqual } from "node:util"
import type { z } from "zod"
import { zApiErrorResponse, zVerifySkillListIdentityResponse } from "../generated/iam-http/zod.gen.js"
import { strictParseRawJson } from "../infrastructure/raw-json.js"
import { SessionAdmissionTransport, type SessionAdmissionTransportInput } from "./session-admission.transport.js"
import type { SessionAdmissionClientOptions } from "./session-admission.client.js"

export type SkillListPrincipal = z.infer<typeof zVerifySkillListIdentityResponse>["data"]
export type SkillListAdmissionResult =
  Readonly<{ ok: true; principal: SkillListPrincipal }> | Readonly<{ ok: false; status: 401 | 403 | 429 | 503; code: string; retryAfter?: string }>
export type SkillListAdmission = Readonly<{ verify(input: SessionAdmissionTransportInput): Promise<SkillListAdmissionResult> }>
const unavailable = (): SkillListAdmissionResult => ({ ok: false, status: 503, code: "iam_admission_unavailable" })

/** Public skill.list only. No Product-session fallback or inferred App trust. */
export class SkillListAdmissionClient implements SkillListAdmission {
  private readonly transport: SessionAdmissionTransport | null
  constructor(options: SessionAdmissionClientOptions) {
    this.transport = options.baseUrl === null ? null : new SessionAdmissionTransport({ ...options, baseUrl: options.baseUrl })
  }
  async verify(input: SessionAdmissionTransportInput): Promise<SkillListAdmissionResult> {
    if (this.transport === null) return unavailable()
    try {
      const response = await this.transport.requestSkillListIdentity(input)
      input.signal.throwIfAborted()
      if (
        response.headers.get("x-request-id") !== input.requestId ||
        response.headers.get("cache-control") !== "no-store" ||
        response.headers.get("content-type")?.split(";", 1)[0] !== "application/json"
      )
        return unavailable()
      const raw = strictParseRawJson(new TextDecoder("utf-8", { fatal: true }).decode(response.body))
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
