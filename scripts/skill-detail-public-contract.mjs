// Build/test-only exact inverse of the metadata/file split; never imported by runtime.
import { createHash } from "node:crypto"
const hash = (value) => createHash("sha256").update(value).digest("hex")
const metadataSchema = `    SpecificationDetailResponse:
      type: object
      additionalProperties: false
      required: [skill]
      properties:
        skill: { $ref: "#/components/schemas/SpecificationSkill" }
`
export function restorePublic24SkillDetailContract(source) {
  if (!/^  version: 25\.0\.0$/mu.test(source)) return source
  const detail = source.match(/^  \/skill\.v1\.SkillOptionalService\/GetSkill:\n[\s\S]*?(?=^  \/)/mu)?.[0]
  const ref = "#/components/schemas/SpecificationDetailResponse"
  if (!detail || detail.split(ref).length !== 2 || source.split(metadataSchema).length !== 2) throw Error("Skill detail exact metadata delta drift")
  const parent = source
    .replace(detail, () => detail.replace(ref, "#/components/schemas/SpecificationDownloadInfo"))
    .replace(metadataSchema, "")
    .replace(/^  version: 25\.0\.0$/mu, "  version: 24.0.0")
  if (hash(parent) !== "f4caf11f3cd9255d2cd9daf69b74ff9988505d640e31c686ce495e6d8a578b2c") throw Error("Skill detail complete Public24 parent drift")
  return parent
}
