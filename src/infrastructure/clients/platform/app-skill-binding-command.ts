import { z } from "zod"
import { sha256Jcs } from "./jcs.js"
const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u)
const command = z
  .object({
    tenantId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/u),
    subjectId: identifier,
    appId: identifier,
    operation: z.enum(["skill.app_binding.put", "skill.app_binding.remove"]),
    target: identifier,
    expected_binding_version: z
      .string()
      .max(19)
      .refine((value) => /^(0|[1-9][0-9]*)$/u.test(value) && BigInt(value) < 9_223_372_036_854_775_807n),
  })
  .strict()
/** app-skill-binding-v1.request_digest: UTF-8 RFC8785, not the general Skill command profile. */
export function projectAppSkillBindingCommand(value: unknown) {
  const input = command.parse(value)
  if (input.operation === "skill.app_binding.remove" && input.expected_binding_version === "0") throw new Error("app_binding_command_invalid")
  const projection = {
    operation: input.operation,
    tenant_id: input.tenantId,
    subject_id: input.subjectId,
    app_id: input.appId,
    target_id: input.target,
    expected_binding_version: input.expected_binding_version,
  }
  return { projection, ...sha256Jcs(projection) }
}
