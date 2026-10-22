import type { AppSkillBindingFact } from "../../../application/app-skill-bindings.types.js"
import { SkillStatus, type AppSkillBinding } from "../../../generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js"
import { assertSkillWireKnown, projectSkillProductRecord, projectSkillStateVersion, skillTimestamp } from "./skill-product-response.js"
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u
const states: Partial<Record<SkillStatus, string>> = {
  [SkillStatus.DRAFT]: "draft",
  [SkillStatus.ACTIVE]: "active",
  [SkillStatus.DISABLED]: "disabled",
  [SkillStatus.WITHDRAWN]: "withdrawn",
  [SkillStatus.QUARANTINED]: "quarantined",
  [SkillStatus.DISCARDED]: "discarded",
  [SkillStatus.DELETED]: "deleted",
}
export function projectAppSkillBinding(value: AppSkillBinding | undefined): AppSkillBindingFact {
  assertSkillWireKnown(value)
  if (
    !value ||
    !ID.test(value.bindingId) ||
    !ID.test(value.seriesId?.value ?? "") ||
    !ID.test(value.skillId?.value ?? "") ||
    value.revision < 1n ||
    value.revision > 18_446_744_073_709_551_615n ||
    !states[value.sourceStatus]
  )
    throw new Error("skill_response_invalid")
  const created = skillTimestamp(value.createdAt),
    updated = skillTimestamp(value.updatedAt),
    removed = value.removedAt === undefined ? null : skillTimestamp(value.removedAt)
  if (
    Date.parse(updated) < Date.parse(created) ||
    (removed !== null && (Date.parse(removed) < Date.parse(created) || Date.parse(removed) > Date.parse(updated)))
  )
    throw new Error("skill_response_invalid")
  if (removed !== null && value.skill !== undefined) throw new Error("skill_response_invalid")
  let metadata: AppSkillBindingFact["metadata"] = null
  if (value.skill !== undefined) {
    const skill = projectSkillProductRecord(value.skill, value.skillId!.value)
    const skillCreated = skillTimestamp(value.skill.createdAt)
    if (
      skill.series_id !== value.seriesId!.value ||
      skill.revision !== value.revision.toString() ||
      !(
        (skill.status === "active" && value.sourceStatus === SkillStatus.ACTIVE) ||
        (skill.status === "disabled" && value.sourceStatus === SkillStatus.DISABLED)
      ) ||
      skill.package_phase !== "valid" ||
      Date.parse(skillCreated) > Date.parse(skill.skill_updated_at)
    )
      throw new Error("skill_response_invalid")
    metadata = { name: skill.name, summary: skill.summary, created_at: skillCreated, updated_at: skill.skill_updated_at, product: skill.product }
  }
  return {
    binding_id: value.bindingId,
    series_id: value.seriesId!.value,
    skill_id: value.skillId!.value,
    revision: value.revision.toString(),
    state_version: projectSkillStateVersion(value.stateVersion),
    source_status: states[value.sourceStatus]!,
    created_at: created,
    updated_at: updated,
    removed_at: removed,
    metadata,
  }
}
