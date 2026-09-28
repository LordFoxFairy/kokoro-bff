import type { CheckTenantSkillAuthorizationData } from "../generated/iam-http/types.gen.js"
import type { SessionAdmissionInput } from "./session-admission.types.js"

export type SkillAuthorizationInput = SessionAdmissionInput &
  Readonly<{
    tenantId: string
    subjectId: string
    action: CheckTenantSkillAuthorizationData["body"]["action"]
  }>

export type SkillAuthorizationResult = Readonly<{ ok: true }> | Readonly<{ ok: false; status: 401 | 403 | 429 | 503; code: string }>
