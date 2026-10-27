import { z } from "zod"
import { isDeepStrictEqual } from "node:util"
import { projectSkillProductJson } from "../infrastructure/clients/platform/skill-product-response.js"
import { skillPublisherProfileSchema } from "../infrastructure/clients/iam-publisher-profile.js"

// Website observations define types, not default/enum/required rules for absent members.
const string = z.string()
const strings = z.array(string)
const optional = <T extends z.ZodRawShape>(shape: T) => z.object(shape).partial().strict()
const icon = optional({ type: string, value: string })
const tags = optional({ values: strings })
const detailFields = {
  id: string,
  name: string,
  description: string,
  version: string,
  updatedAt: string,
  ownerType: string,
  type: string,
  displayName: string,
  sortOrder: string,
  createdAt: string,
  visibility: string,
  userDescription: string,
  coverImage: string,
  addTime: string,
  added: z.boolean(),
  defaultEnable: z.boolean(),
  defaultAdd: z.boolean(),
  exampleQuestions: strings,
  sessionTypes: strings,
  tags,
  skillIcon: icon,
}
export const websiteSkillSchema = optional(detailFields)
export const websiteDetailResponseSchema = z.object({ skill: websiteSkillSchema }).strict()
const installed = optional({
  ...detailFields,
  installationId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u),
  enabled: z.boolean(),
  icon: string,
  skillConfig: optional({ teamSkillForceAdd: z.boolean() }),
})
const official = installed.extend({ deviceCapable: z.boolean().optional() }).strict()
const source = optional({
  type: string,
  url: string,
  owner: string,
  repository: string,
  ref: string,
  path: string,
  stars: string,
  forks: string,
  latestCommitSha: string,
  latestCommitAt: string,
  licenseSpdxId: string,
  licenseUrl: string,
  licenseStatus: string,
  licenseCategory: string,
  pathCommitAt: string,
})
const version = optional({
  versionUid: string,
  checksum: string,
  archiveSize: string,
  fileCount: z.number().int(),
  status: string,
  current: z.boolean(),
  createdAt: string,
  sourceRevision: string,
  sourceRevisionAt: string,
  licenseSpdxId: string,
  licenseUrl: string,
})
const hubProduct = z.unknown().transform((raw, context) => {
  try {
    return projectSkillProductJson(raw)
  } catch {
    context.addIssue({ code: "custom", message: "invalid owner product" })
    return z.NEVER
  }
})
const hubPublisherProfile = z.unknown().transform((raw, context) => {
  const parsed = skillPublisherProfileSchema.safeParse(raw)
  if (!parsed.success || !isDeepStrictEqual(raw, parsed.data)) {
    context.addIssue({ code: "custom", message: "invalid publisher profile" })
    return z.NEVER
  }
  return parsed.data
})
const hubSkill = optional({
  product: hubProduct,
  publisher_profile: hubPublisherProfile,
  skillId: string,
  originalName: string,
  displayName: string,
  userDescription: string,
  icon,
  publishStatus: string,
  currentVersion: version,
  sortOrder: string,
  createdAt: string,
  publisherType: string,
  verified: z.boolean(),
  usageCount: string,
  exampleQuestions: strings,
  tags,
  type: string,
  coverImage: string,
  source,
  syncStatus: string,
  cmsUpdatedAt: string,
}).superRefine((value, context) => {
  const publisher = value.product?.publisher,
    profile = value.publisher_profile
  if (publisher?.kind === "iam") {
    if (!profile || profile.kind !== publisher.iam.kind || profile.id !== publisher.iam.id)
      context.addIssue({
        code: "custom",
        message: "publisher profile must match the owner ref",
      })
  } else if (profile !== undefined)
    context.addIssue({
      code: "custom",
      message: "publisher profile requires IAM publisher",
    })
})
export const websiteHubResponseSchema = z
  .object({
    skills: z.array(hubSkill),
    tagOptions: optional({ values: z.array(optional({ tag: string, displayName: string })) }),
    nextPageToken: string.optional(),
  })
  .strict()
export const websiteListResponseSchema = z.object({ userAddedSkills: z.array(installed), officialSkills: z.array(official) }).strict()
export const publicSkillListSchema = z.array(
  optional({
    id: string,
    name: string,
    description: string,
    owner_type: z.enum(["personal", "official", "team", "project", "app", "hub", "device", "unknown"]),
    creator_info: optional({ user_id: string, name: string }),
    created_at: z.number().int().safe(),
    updated_at: z.number().int().safe(),
  }),
)
export const websiteHubRequestSchema = z
  .object({
    pageSize: z.number().int().positive().optional(),
    shuffle: z.boolean().optional(),
    includeOfficialSkills: z.boolean().optional(),
    tag: string.optional(),
    query: string.optional(),
    pageToken: string.optional(),
    excludeTop: z.boolean().optional(),
  })
  .strict()
export const websiteEmptyRequestSchema = z.object({}).strict()
export const websiteSkillRequestSchema = z.object({ skillId: string.min(1).max(191) }).strict()
const stableInstallationId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u)
export const setSkillInstallationEnabledRequestSchema = z.object({ installationId: stableInstallationId, enabled: z.boolean() }).strict()
export const publicSkillQuerySchema = z.object({ project_id: string.min(1).max(191).optional() }).strict()

const sharedId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u)
export const sharedSkillSummarySchema = z
  .object({
    skill_id: sharedId,
    series_id: sharedId,
    revision: z
      .string()
      .regex(/^[1-9][0-9]{0,19}$/u)
      .refine((v) => BigInt(v) <= 18_446_744_073_709_551_615n),
    display_name: z.string().min(1).max(255),
    description: z.string().max(65_535),
    tags: z.array(z.string()),
    example_prompts: z.array(z.string()),
    category_keys: z.array(z.enum(["programming", "data", "automation", "business", "design", "media", "content", "apps"])),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
    owner_type: z.enum(["personal", "official", "team", "project", "app"]),
    source_kind: z.enum(["personal", "official", "third_party"]),
    original_name: z.string().min(1).optional(),
    author: z
      .object({ user_id: sharedId, display_name: z.string().min(1) })
      .strict()
      .optional(),
    cover_image: z.string().optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.cover_image !== undefined && v.cover_image !== `/api/v1/skills/${encodeURIComponent(v.skill_id)}/cover`)
      ctx.addIssue({ code: "custom", message: "cover revision binding invalid" })
  })
