import { z } from "zod"

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
const installed = optional({ ...detailFields, enabled: z.boolean(), icon: string, skillConfig: optional({ teamSkillForceAdd: z.boolean() }) })
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
const hubSkill = optional({
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
    owner_type: z.enum(["personal", "official", "team", "project", "app"]),
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
export const publicSkillQuerySchema = z.object({ project_id: string.min(1).max(191).optional() }).strict()
