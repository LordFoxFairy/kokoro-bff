import { z } from "zod"
import { sha256Jcs } from "./jcs.js"
import { skillDecimalSchema, skillIdSchema, skillPublicationPreconditionSchema } from "./skill-product-schema.js"

const inputSchema = z
  .object({
    tenant: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/u),
    user: skillIdSchema,
    skillId: skillIdSchema,
    expectedStateVersion: skillDecimalSchema.refine((value) => BigInt(value) < 9_223_372_036_854_775_807n),
    expectedPublication: skillPublicationPreconditionSchema,
  })
  .strict()
/** Canonical skill-series-delete-v1 binding; not the older Product command profile. */
export function projectDeletePersonalSkillSeries(value: unknown) {
  const input = inputSchema.parse(value)
  const projection = {
    operation: "skill.delete_personal_series",
    tenant_id: input.tenant,
    subject_id: input.user,
    skill_id: input.skillId,
    expected_state_version: input.expectedStateVersion,
    expected_publication: input.expectedPublication,
  }
  return { projection, ...sha256Jcs(projection) }
}
