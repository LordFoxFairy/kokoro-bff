import type { SkillListPrincipal } from "../auth/skill-list-admission.client.js"
import type { RequestContext } from "../domain/request-context.js"
import type { SkillDownloadBinding } from "./skill-download-handles.js"
export type SkillSpecificationContext = RequestContext & Readonly<{ humanBearer: string }>
export type PublicSkillListContext = RequestContext & Readonly<{ publicBearer: string; principal: SkillListPrincipal }>
export type SkillSpecificationOperation = "skill.list" | "ListSkills" | "ListHubSkills" | "GetSkill" | "DownloadSkill"
export type SkillProductFact = Readonly<{ source_kind?: string | undefined; creator_ref?: Readonly<{ kind: string; id: string }> | undefined; cover?: unknown }>
export type SkillInstallationFact = Readonly<{
  source_status: string
  acquisition_kind: "unknown" | "direct" | "hub"
  installation_id: string
  source_ref: string
  series_id: string
  revision: string
  installed: boolean
  enabled: boolean
  installed_at: string
  display_name: string
  summary: string
  example_prompts: string[]
  category_keys: string[]
  product: SkillProductFact
  skill_created_at: string
  skill_updated_at: string
  source_owner_scope: Readonly<{ kind: string; id: string }>
}>
export type SkillCatalogFact = Readonly<{
  series_id: string
  source_ref: string
  revision: string
  created_at: string
  content_hash: string
  product: SkillProductFact
}>
export type RevisionSkillFact = Readonly<{
  skill: Readonly<{
    skill_id: string
    source_ref: string
    series_id: string
    revision: string
    status: string
    name: string
    summary: string
    tags: string[]
    example_prompts: string[]
    category_keys: string[]
    skill_updated_at: string
    product: SkillProductFact
    package_phase: string
  }>
  record: Readonly<{ ownerKind: string; originalName?: string; fileCount?: number; archiveSize?: bigint }>
  createdAt: string
}>
export type CurrentSkillFact = RevisionSkillFact & Readonly<{ publishedAt: string }>
export type SkillDownloadFact = Readonly<{
  sourceRef: string
  revision: string
  filename: string
  sizeBytes: bigint
  contentSha256: string
  transfer: Readonly<{ url: string; method: string; requiredHeaders: Readonly<Record<string, string>>; expiresAt: string }>
}>
/** Narrow structural port; Platform wire decoding stays in its infrastructure facade. */
export type SkillSpecificationOwner = Readonly<{
  listInstallations(input: Readonly<Record<string, unknown>>, signal: AbortSignal): Promise<Readonly<{ items: SkillInstallationFact[]; nextCursor?: string }>>
  listCatalog(
    input: Readonly<Record<string, unknown>>,
    context: SkillSpecificationContext,
    signal: AbortSignal,
  ): Promise<Readonly<{ skills: SkillCatalogFact[]; nextCursor?: string }>>
  revision(sourceRef: string, context: SkillSpecificationContext, signal: AbortSignal, deadlineAt: number): Promise<RevisionSkillFact>
  current(seriesId: string, context: SkillSpecificationContext, signal: AbortSignal, deadlineAt: number): Promise<CurrentSkillFact>
  download(sourceRef: string, context: SkillSpecificationContext, signal: AbortSignal, deadlineAt: number): Promise<SkillDownloadFact>
}>
export type SkillSpecificationSource = Readonly<{
  readDetail(skillId: string, context: SkillSpecificationContext, signal: AbortSignal, deadlineAt: number): Promise<unknown>
  revisionSummary(sourceRef: string, context: SkillSpecificationContext, signal: AbortSignal, deadlineAt: number): Promise<unknown>
  readPublicList(input: Readonly<Record<string, unknown>>, context: PublicSkillListContext, signal: AbortSignal, deadlineAt: number): Promise<unknown>
  read(
    operation: "ListSkills" | "ListHubSkills",
    input: Readonly<Record<string, unknown>>,
    context: SkillSpecificationContext,
    signal: AbortSignal,
    deadlineAt: number,
  ): Promise<unknown>
  prepareDownload(
    operation: "DownloadSkill",
    skillId: string,
    context: SkillSpecificationContext,
    signal: AbortSignal,
    deadlineAt: number,
  ): Promise<{ skill: unknown; binding: SkillDownloadBinding }>
  confirmDownload(binding: SkillDownloadBinding, context: SkillSpecificationContext, signal: AbortSignal, deadlineAt: number): Promise<void>
}>
