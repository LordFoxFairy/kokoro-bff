import { z } from "zod"
import { zPersonalSkillHistory, zPersonalSkillHistoryVersion, zListSelfSkillVersionsResponse } from "../../../generated/platform-http/zod.gen.js"

const version = zPersonalSkillHistoryVersion
  .strict()
  .extend({ created_at: zPersonalSkillHistoryVersion.shape.created_at.refine((value) => value.endsWith("Z")) })
const publication = zPersonalSkillHistory.shape.publication
  .unwrap()
  .strict()
  .extend({
    withdrawn_at: zPersonalSkillHistory.shape.publication.unwrap().shape.withdrawn_at.refine((value) => value === null || value.endsWith("Z")),
  })
const page = zPersonalSkillHistory.strict().extend({ versions: version.array().max(100), publication: publication.nullable() })
export const personalSkillHistoryResponse = zListSelfSkillVersionsResponse.strict().extend({ data: page })

/** Validate facts before passing the unchanged exact revisions into the public projection. */
export function validPersonalSkillHistoryPage(value: z.infer<typeof page>, limit = 50): boolean {
  if (value.versions.length > limit || (value.next_cursor !== undefined && value.versions.length === 0)) return false
  if (value.publication === null) return value.versions.length === 0 && value.next_cursor === undefined
  let previous: bigint | undefined
  const ids = new Set<string>()
  for (const item of value.versions) {
    if (item.revision.length > 10 || BigInt(item.revision) > 2147483647n || ids.has(item.skill_id)) return false
    const revision = BigInt(item.revision)
    if (previous !== undefined && revision >= previous) return false
    if (item.is_current !== (item.skill_id === value.publication.current_version_id)) return false
    previous = revision
    ids.add(item.skill_id)
  }
  return true
}
