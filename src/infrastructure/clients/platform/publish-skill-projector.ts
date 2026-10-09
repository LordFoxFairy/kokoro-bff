import { projectSkillProductCommand } from "./create-skill-draft-projector.js"
import { strictParseRawJson } from "../../raw-json.js"

export function projectPublishSkill(raw: Uint8Array | string, validateAdmission = false): ReturnType<typeof projectSkillProductCommand> {
  const root = strictParseRawJson(raw) as { fq_method?: unknown }
  if (root?.fq_method !== "kokoro.platform.v1.SkillCatalogService/PublishSkill") throw new Error("platform execution operations: wire header")
  return projectSkillProductCommand(raw, validateAdmission)
}
