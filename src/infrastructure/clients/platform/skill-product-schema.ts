import { z } from "zod"
import { parseSkillExamplePrompts } from "./skill-example-prompts.js"

export const skillIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u)
export const skillSourceRefSchema = z.string().regex(/^skill:[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u)
export const skillDecimalSchema = z
  .string()
  .regex(/^[1-9][0-9]*$/u)
  .refine((value) => BigInt(value) <= 9_223_372_036_854_775_807n)
export const skillPublicationPreconditionSchema = z
  .object({
    current_version_id: skillIdSchema,
    state_version: skillDecimalSchema.refine((value) => BigInt(value) < 9_223_372_036_854_775_807n),
  })
  .strict()
  .nullable()
export type SkillPublicationPrecondition = z.infer<typeof skillPublicationPreconditionSchema>
export function skillPublicationPreconditionWire(value: SkillPublicationPrecondition) {
  const expected = skillPublicationPreconditionSchema.parse(value)
  return expected === null
    ? { absent: true }
    : { current: { current_version_id: { value: expected.current_version_id }, state_version: expected.state_version } }
}
export const skillCategoryKeysSchema = z
  .array(z.enum(["programming", "data", "automation", "business", "design", "media", "content", "apps"]))
  .max(8)
  .refine((keys) => new Set(keys).size === keys.length)
export const skillMetadataInputSchema = z
  .object({
    display_name: z
      .string()
      .min(1)
      .max(255)
      .refine((value) => /\S/u.test(value)),
    summary: z.string().max(65_535),
    tags: z
      .array(
        z
          .string()
          .min(1)
          .max(128)
          .refine((value) => /\S/u.test(value)),
      )
      .max(100)
      .refine((tags) => new Set(tags).size === tags.length),
    example_prompts: z
      .unknown()
      .transform((value, context) => {
        try {
          return parseSkillExamplePrompts(value)
        } catch {
          context.addIssue({ code: "custom", message: "invalid skill examples" })
          return z.NEVER
        }
      })
      .optional(),
    category_keys: skillCategoryKeysSchema.optional(),
  })
  .strict()
const scalar = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine(
      (value) =>
        value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value) && !/[\uD800-\uDFFF]/u.test(value.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/gu, "")),
    )
const digest = z.string().regex(/^[a-f0-9]{64}$/u)
const nonnegative = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/u)
  .refine((value) => BigInt(value) <= 9_223_372_036_854_775_807n)
const packageFacts = {
  asset_ref: scalar(255),
  content_sha256: digest,
  size_bytes: skillDecimalSchema.refine((value) => BigInt(value) <= 33_554_432n),
  mime_type: z.literal("application/zip"),
}
const githubProvenance = z
  .object({
    repository_id: z.string().regex(/^[1-9][0-9]{0,254}$/u),
    repository_url: scalar(2048),
    owner_login: scalar(255),
    owner_url: scalar(2048),
    commit: z.string().regex(/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u),
    path: z.union([z.literal(""), scalar(2048)]),
    repo_stats: z
      .object({
        stars: nonnegative,
        forks: nonnegative,
        observed_at: z
          .string()
          .regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u)
          .refine((v) => Number.isFinite(Date.parse(v))),
        metadata_source_url: scalar(2048),
      })
      .strict()
      .optional(),
    ...packageFacts,
    asset_ref: packageFacts.asset_ref.optional(),
  })
  .strict()
  .refine((value) => {
    const match = /^https:\/\/github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)\/([A-Za-z0-9_.-]+)$/u.exec(value.repository_url)
    return (
      match !== null &&
      match[1] === value.owner_login &&
      ![".", ".."].includes(match[2]!) &&
      value.owner_url === `https://github.com/${value.owner_login}` &&
      !value.path.includes("\\") &&
      (value.path === "" || value.path.split("/").every((v) => v !== "" && v !== "." && v !== "..")) &&
      (value.repo_stats === undefined || value.repo_stats.metadata_source_url === `https://api.github.com/repos/${match[1]}/${match[2]}`)
    )
  })
export const skillCreationProvenanceSchema = z.union([
  z.object({ local: z.object({}).strict() }).strict(),
  z
    .object({
      ai: z
        .object({
          conversation_id: scalar(255),
          run_ref: scalar(255),
          artifact_ref: scalar(255),
          source_event_id: scalar(255),
          source_event_seq: skillDecimalSchema,
          source_event_digest: digest,
          ...packageFacts,
        })
        .strict(),
    })
    .strict(),
  z.object({ github: githubProvenance }).strict(),
])
export const skillAudienceSchema = z.enum(["owner", "tenant", "catalog"])
export const skillIamRefSchema = z.object({ kind: z.enum(["user", "organization"]), id: scalar(255) }).strict()
export const skillSourceVersionSchema = z
  .string()
  .regex(/^[\x21-\x7e]{1,1024}$/u)
  .refine((value) => value !== "null")

export const githubSkillSelectorSchema = z
  .object({
    owner: z
      .string()
      .regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/u)
      .max(39),
    repository: z
      .string()
      .regex(/^[A-Za-z0-9_.-]+$/u)
      .max(100)
      .refine((v) => v !== "." && v !== ".."),
    commit: z.string().regex(/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u),
    path: z
      .string()
      .max(256)
      .refine((v) => v === "" || (!v.includes("\\") && !v.startsWith("/") && v.split("/").every((part) => part !== "" && part !== "." && part !== ".."))),
  })
  .strict()

export const skillHandoffResultSchema = z
  .object({
    skill_id: skillIdSchema,
    source_ref: skillSourceRefSchema,
    status: z.literal("draft"),
    state_version: skillDecimalSchema,
    valid: z.literal(true),
    content_digest: digest,
    manifest_identity: z.string().regex(/^(?:skill-md-v1|zip-v2):sha256:[a-f0-9]{64}$/u),
  })
  .strict()
  .refine((value) => value.source_ref === `skill:${value.skill_id}`)
