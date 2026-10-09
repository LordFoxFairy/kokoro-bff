import type { RequestContext } from "../../../domain/request-context.js"
import type { SkillDownloadBinding } from "../../../application/skill-download-handles.js"

export type SkillSpecificationContext = RequestContext & Readonly<{ humanBearer: string }>

export type SkillSpecificationOperation = "skill.list" | "ListSkills" | "ListHubSkills" | "GetSkill" | "DownloadSkill"
/** BFF dependency seam, not a guessed/unissued owner wire schema. */
export type SkillSpecificationSource = Readonly<{
  read(
    operation: "skill.list" | "ListSkills" | "ListHubSkills",
    input: Readonly<Record<string, unknown>>,
    context: SkillSpecificationContext,
    signal: AbortSignal,
    deadlineAt: number,
  ): Promise<unknown>
  prepareDownload(
    operation: "GetSkill" | "DownloadSkill",
    skillId: string,
    context: SkillSpecificationContext,
    signal: AbortSignal,
    deadlineAt: number,
  ): Promise<{ skill: unknown; binding: SkillDownloadBinding }>
  confirmDownload(binding: SkillDownloadBinding, context: SkillSpecificationContext, signal: AbortSignal, deadlineAt: number): Promise<void>
}>
