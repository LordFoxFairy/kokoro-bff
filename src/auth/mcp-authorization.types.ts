import type { CheckAuthorizationData } from "../generated/iam-http/types.gen.js"
import type { SessionAdmissionInput } from "./session-admission.types.js"

export type McpAuthorizationSubject =
  | Readonly<{
      resource: "mcp_personal"
      action: Extract<CheckAuthorizationData["body"], { resource: "mcp_personal" }>["action"]
    }>
  | Readonly<{
      resource: "mcp_catalog"
      action: Extract<CheckAuthorizationData["body"], { resource: "mcp_catalog" }>["action"]
    }>

export type McpAuthorizationInput = SessionAdmissionInput &
  Readonly<{
    tenantId: string
    subjectId: string
  }> &
  McpAuthorizationSubject
export type McpAuthorizationResult =
  | Readonly<{ ok: true }>
  | Readonly<{
      ok: false
      status: 401 | 403 | 429 | 503
      code: string
      retryAfter?: string
    }>
