import { sha256Jcs } from "./jcs.js"

function base(personalMethod: string, projectMethod: string, tenant: string, subject: string, members: Record<string, unknown>, projectRef?: string) {
  const projection = {
    command_digest_version: projectRef === undefined ? "product-personal-installation/1.0.0" : "product-project-installation/1.0.0",
    fq_method: `kokoro.platform.v1.${projectRef === undefined ? "ProductSkillInstallationService" : "ProductProjectSkillInstallationService"}/${projectRef === undefined ? personalMethod : projectMethod}`,
    tenant_ref: tenant,
    command: {
      subject_id: subject,
      target_owner_scope: projectRef === undefined ? { kind: "user", id: subject } : { kind: "project", id: projectRef },
      ...members,
    },
  }
  return sha256Jcs(projection).sha256
}
export const installSkillDigest = (tenant: string, subject: string, sourceRef: string, projectRef?: string): string =>
  base("InstallPersonalSkill", "InstallProjectSkill", tenant, subject, { source_ref: { present: true, value: sourceRef } }, projectRef)
export const updateSkillDigest = (
  tenant: string,
  subject: string,
  installationId: string,
  expectedSourceRef: string,
  sourceRef: string,
  projectRef?: string,
): string =>
  base(
    "UpdatePersonalSkillInstallation",
    "UpdateProjectSkillInstallation",
    tenant,
    subject,
    {
      installation_id: { present: true, value: installationId },
      expected_source_ref: { present: true, value: expectedSourceRef },
      source_ref: { present: true, value: sourceRef },
    },
    projectRef,
  )
export const setSkillEnabledDigest = (tenant: string, subject: string, installationId: string, enabled: boolean, projectRef?: string): string =>
  base(
    "SetPersonalSkillInstallationEnabled",
    "SetProjectSkillInstallationEnabled",
    tenant,
    subject,
    {
      installation_id: { present: true, value: installationId },
      enabled,
    },
    projectRef,
  )
export const removeSkillDigest = (tenant: string, subject: string, installationId: string, projectRef?: string): string =>
  base(
    "RemovePersonalSkillInstallation",
    "RemoveProjectSkillInstallation",
    tenant,
    subject,
    {
      installation_id: { present: true, value: installationId },
    },
    projectRef,
  )
