import type { CheckAuthorizationData } from "../generated/iam-http/types.gen.js"
import type { SessionAdmissionInput } from "./session-admission.types.js"

export type McpAuthorizationInput = SessionAdmissionInput &
  Readonly<{
    tenantId: string
    subjectId: string
    action: Extract<CheckAuthorizationData["body"], { resource: "mcp_personal" }>["action"]
  }>
export type McpAuthorizationResult = Readonly<{ ok: true }> | Readonly<{ ok: false; status: 401 | 403 | 429 | 503; code: string }>
