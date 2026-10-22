import { z } from "zod"
import { skillIdSchema } from "./skill-product-input.js"
const version = (zero: boolean) =>
  z
    .string()
    .max(19)
    .refine((value) => (zero ? /^(?:0|[1-9][0-9]*)$/u : /^[1-9][0-9]*$/u).test(value) && BigInt(value) < 9_223_372_036_854_775_807n)
export const putAppSkillBindingSchema = z.object({ skill_id: skillIdSchema, expected_binding_version: version(true) }).strict()
export const removeAppSkillBindingSchema = z.object({ expected_binding_version: version(false) }).strict()
export const appSkillBindingQuerySchema = z
  .object({ limit: z.coerce.number().int().min(1).max(100).default(25), cursor: z.string().min(1).max(4096).optional() })
  .strict()
