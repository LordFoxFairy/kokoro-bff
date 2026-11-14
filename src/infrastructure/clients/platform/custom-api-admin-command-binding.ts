import { sha256Jcs } from "./jcs.js"

export type CustomApiAdminIdentity = Readonly<{ tenantId: string; subjectId: string; requestId: string }>
export type CustomApiAdminCommandInput = Readonly<{
  kind: "quarantine" | "restore" | "revoke"
  profileId: string
  commandId: string
  expectedStateVersion: string
  reasonCode: "security_review" | "policy_violation" | "operator_request" | "review_completed"
}>
const mutations = {
  quarantine: { method: "QuarantineAdminCustomApi", action: "quarantined" },
  restore: { method: "RestoreAdminCustomApi", action: "restored" },
  revoke: { method: "RevokeAdminCustomApi", action: "revoked" },
} as const

/** Bind the original CAS/action/actor, never a later current-state inspection. */
export function bindCustomApiAdminCommand(identity: CustomApiAdminIdentity, input: CustomApiAdminCommandInput) {
  const mutation = mutations[input.kind]
  return {
    commandId: input.commandId,
    requestDigest: sha256Jcs({
      method: `kokoro.platform.v1.CustomApiAdminService/${mutation.method}`,
      tenant_id: identity.tenantId,
      actor_id: identity.subjectId,
      input: {
        profile_id: input.profileId,
        expected_state_version: input.expectedStateVersion,
        action: mutation.action,
        reason_code: input.reasonCode,
      },
    }).sha256,
  }
}
