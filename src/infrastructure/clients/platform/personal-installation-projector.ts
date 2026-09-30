import { sha256Jcs } from "./jcs.js"

const VERSION = "product-personal-installation/1.0.0"
function base(fqMethod: string, tenant: string, subject: string, members: Record<string, unknown>) {
  const projection = {
    command_digest_version: VERSION,
    fq_method: fqMethod,
    tenant_ref: tenant,
    command: {
      subject_id: subject,
      target_owner_scope: { kind: "user", id: subject },
      ...members,
    },
  }
  return sha256Jcs(projection).sha256
}
export const installPersonalDigest = (tenant: string, subject: string, sourceRef: string): string =>
  base("kokoro.platform.v1.ProductSkillInstallationService/InstallPersonalSkill", tenant, subject, { source_ref: { present: true, value: sourceRef } })
export const setPersonalEnabledDigest = (tenant: string, subject: string, installationId: string, enabled: boolean): string =>
  base("kokoro.platform.v1.ProductSkillInstallationService/SetPersonalSkillInstallationEnabled", tenant, subject, {
    installation_id: { present: true, value: installationId },
    enabled,
  })
export const removePersonalDigest = (tenant: string, subject: string, installationId: string): string =>
  base("kokoro.platform.v1.ProductSkillInstallationService/RemovePersonalSkillInstallation", tenant, subject, {
    installation_id: { present: true, value: installationId },
  })
