import type { AppSkillBindingClient } from "./app-skill-bindings.types.js"
import { Code, ConnectError } from "@connectrpc/connect"
import type { RequestContext } from "../domain/request-context.js"
import type { PublicSkillListContext } from "./skill-specification.types.js"
import type { ProjectOwnerScope } from "./ports/project-repository.js"
import type { BffApplicationServices } from "./services.js"
import type { SkillDownloadBinding } from "./skill-download-handles.js"
import type { SkillDownloadFact, SkillSpecificationContext, SkillSpecificationOwner, SkillSpecificationSource } from "./skill-specification.types.js"

function identity<T>(value: T): T {
  return value
}

export function verifiedSkillDownloadPackage(
  owner: SkillDownloadFact,
  expected: Readonly<{ sourceRef: string; revision: string }>,
  objectOrigin: string | null,
) {
  if (
    owner.sourceRef !== expected.sourceRef ||
    owner.revision !== expected.revision ||
    owner.sizeBytes < 1n ||
    owner.sizeBytes > 33_554_432n ||
    !/^[a-f0-9]{64}$/u.test(owner.contentSha256) ||
    !owner.transfer ||
    !objectOrigin
  )
    throw new Error("skill_response_invalid")
  const transfer = owner.transfer,
    url = new URL(transfer.url),
    expiresAt = Date.parse(transfer.expiresAt)
  if (
    url.origin !== objectOrigin ||
    url.username ||
    url.password ||
    url.hash ||
    transfer.method !== "GET" ||
    Object.keys(transfer.requiredHeaders).length !== 0 ||
    expiresAt <= Date.now() ||
    expiresAt > Date.now() + 301_000
  )
    throw new Error("skill_response_invalid")
  return Object.freeze({
    sourceRef: owner.sourceRef,
    revision: owner.revision,
    filename: owner.filename,
    sizeBytes: Number(owner.sizeBytes),
    contentSha256: owner.contentSha256,
    expiresAt,
    transfer: Object.freeze({ url: transfer.url, method: transfer.method, requiredHeaders: Object.freeze({}), expiresAt }),
  })
}

/** Product representation aggregation; identity/lifecycle remain fixed owner contracts. */
export class SkillSpecificationService implements SkillSpecificationSource {
  public constructor(
    private readonly dependencies: {
      owner: SkillSpecificationOwner
      appBindings?: Pick<AppSkillBindingClient, "list">
      profiles: Readonly<{
        resolvePublic: (
          tenant: string,
          bearer: string,
          requestId: string,
          refs: ReadonlyArray<Readonly<{ kind: "user"; id: string }>>,
          signal: AbortSignal,
        ) => Promise<Map<string, Readonly<{ status: string; display_name?: string }>>>
        resolve(
          tenant: string,
          bearer: string,
          requestId: string,
          refs: ReadonlyArray<Readonly<{ kind: "user"; id: string }>>,
          signal: AbortSignal,
        ): Promise<Map<string, Readonly<{ status: string; display_name?: string }>>>
      }>
      usage?: BffApplicationServices["skillUsage"]
      projects?: Pick<BffApplicationServices["projects"], "find">
      objectOrigin: string | null
    },
  ) {}

  private active(signal: AbortSignal, deadlineAt: number): void {
    signal.throwIfAborted()
    if (performance.now() >= deadlineAt) throw new ConnectError("Skill deadline exceeded", Code.DeadlineExceeded)
  }
  private common(context: RequestContext) {
    return { requestId: context.requestId, tenant: context.identity.namespace, subject: context.identity.userId }
  }
  private async projectFind(scope: ProjectOwnerScope, id: string, signal: AbortSignal, deadlineAt: number) {
    this.active(signal, deadlineAt)
    if (!this.dependencies.projects) throw new ConnectError("Project owner unavailable", Code.Unavailable)
    try {
      const project = await this.dependencies.projects.find(scope, id)
      this.active(signal, deadlineAt)
      return project
    } catch (error) {
      this.active(signal, deadlineAt)
      if (error instanceof ConnectError) throw error
      throw new ConnectError("Project owner unavailable", Code.Unavailable)
    }
  }
  private async installations(context: RequestContext, signal: AbortSignal, deadlineAt: number, projectRef?: string) {
    const items: import("./skill-specification.types.js").SkillInstallationFact[] = [],
      seen = new Set<string>(),
      series = new Set<string>(),
      cursors = new Set<string>()
    let cursor: string | undefined
    do {
      this.active(signal, deadlineAt)
      const result = await this.dependencies.owner.listInstallations(
        {
          ...this.common(context),
          installed: true,
          limit: 100,
          ...(projectRef === undefined ? {} : { projectRef }),
          ...(cursor === undefined ? {} : { cursor }),
        },
        signal,
      )
      this.active(signal, deadlineAt)
      for (const item of result.items) {
        if (!item.installed || seen.has(item.installation_id) || series.has(item.series_id)) throw new Error("skill_response_invalid")
        seen.add(item.installation_id)
        series.add(item.series_id)
        // Retain the installation for management/history, not as a newly
        // available public Skill after its whole source series was deleted.
        if (item.source_status !== "deleted") items.push(item)
      }
      if (seen.size > 1000) throw new ConnectError("Skill list capacity exceeded", Code.ResourceExhausted)
      cursor = result.nextCursor
      if (cursor !== undefined) {
        if (cursors.has(cursor)) throw new Error("skill_response_invalid")
        cursors.add(cursor)
      }
    } while (cursor !== undefined)
    return items
  }
  private async catalog(input: Readonly<Record<string, unknown>>, context: SkillSpecificationContext, signal: AbortSignal, deadlineAt: number) {
    this.active(signal, deadlineAt)
    const result = await this.dependencies.owner.listCatalog(input, context, signal)
    this.active(signal, deadlineAt)
    return result
  }
  private async current(seriesId: string, context: SkillSpecificationContext, signal: AbortSignal, deadlineAt: number) {
    this.active(signal, deadlineAt)
    const result = await this.dependencies.owner.current(seriesId, context, signal, deadlineAt)
    this.active(signal, deadlineAt)
    return result
  }
  private async creatorProfiles(
    products: import("./skill-specification.types.js").SkillProductFact[],
    context: SkillSpecificationContext | PublicSkillListContext,
    signal: AbortSignal,
    deadlineAt: number,
  ) {
    const refs = [
      ...new Map(
        products.flatMap((product) =>
          product.creator_ref?.kind === "user" ? [[product.creator_ref.id, { kind: "user" as const, id: product.creator_ref.id }] as const] : [],
        ),
      ).values(),
    ]
    const result = new Map<string, Readonly<{ status: string; display_name?: string }>>()
    for (let offset = 0; offset < refs.length; offset += 100) {
      this.active(signal, deadlineAt)
      const resolver = "principal" in context ? this.dependencies.profiles.resolvePublic : this.dependencies.profiles.resolve
      const profiles = await resolver.call(
        this.dependencies.profiles,
        context.identity.namespace,
        "principal" in context ? context.publicBearer : context.humanBearer,
        context.requestId,
        refs.slice(offset, offset + 100),
        signal,
      )
      for (const [key, value] of profiles) result.set(key, value)
    }
    this.active(signal, deadlineAt)
    return result
  }
  private async detail(seriesId: string, context: SkillSpecificationContext, signal: AbortSignal, deadlineAt: number) {
    const current = await this.current(seriesId, context, signal, deadlineAt)
    const { skill, record, createdAt } = current
    const ownerType =
      skill.product.source_kind === "official"
        ? "official"
        : ({ user: "personal", organization: "team", project: "project", app: "app" } as Record<string, string>)[record.ownerKind]
    return {
      ...current,
      representation: identity({
        id: seriesId,
        name: record.originalName ?? skill.name,
        displayName: skill.name,
        description: skill.summary,
        userDescription: skill.summary,
        version: skill.skill_id,
        updatedAt: skill.skill_updated_at,
        createdAt,
        exampleQuestions: skill.example_prompts,
        tags: { values: skill.category_keys.map((key) => this.tag(key)) },
        ...(ownerType === undefined ? {} : { ownerType }),
        // A locator is not media proof; the independent GET checks this exact revision.
        coverImage: `/api/v1/skills/${encodeURIComponent(skill.skill_id)}/cover`,
      }),
    }
  }
  private publicOwnerType(item: import("./skill-specification.types.js").SkillInstallationFact): string {
    // Acquisition is an installation fact, not the website author vocabulary.
    if (item.acquisition_kind === "hub") return "hub"
    if (item.acquisition_kind === "unknown") return "unknown"
    if (item.acquisition_kind !== "direct") throw new Error("skill_response_invalid")
    return this.ownerType(item.product.source_kind, item.source_owner_scope.kind) ?? "unknown"
  }
  private ownerType(sourceKind: string | undefined, kind: string): string | undefined {
    return sourceKind === "official" ? "official" : ({ user: "personal", organization: "team", project: "project", app: "app" } as Record<string, string>)[kind]
  }
  private tag(key: string): string {
    const value = (
      {
        programming: "SKILL_HUB_TAG_CODING",
        data: "SKILL_HUB_TAG_DATA",
        automation: "SKILL_HUB_TAG_AUTOMATION",
        business: "SKILL_HUB_TAG_BUSINESS",
        design: "SKILL_HUB_TAG_DESIGN",
        media: "SKILL_HUB_TAG_MEDIA",
        content: "SKILL_HUB_TAG_CONTENT",
        apps: "SKILL_HUB_TAG_APPS",
      } as Record<string, string>
    )[key]
    if (!value) throw new Error("skill_response_invalid")
    return value
  }
  public async readPublicList(
    input: Readonly<Record<string, unknown>>,
    context: PublicSkillListContext,
    signal: AbortSignal,
    deadlineAt: number,
  ): Promise<unknown> {
    this.active(signal, deadlineAt)
    const principal = context.principal
    if (
      !principal ||
      !["user_api_key", "oauth_app"].includes(principal.kind) ||
      principal.tenant_id !== context.identity.namespace ||
      principal.user_id !== context.identity.userId
    )
      throw new ConnectError("Skill list identity required", Code.Unauthenticated)
    const ordinaryApp = principal.kind === "oauth_app" && !principal.trusted
    if (ordinaryApp && input.project_id !== undefined) throw new ConnectError("App project query invalid", Code.InvalidArgument)
    const scope = { tenantId: context.identity.namespace, subjectId: context.identity.userId }
    let projectRef: string | undefined
    if (input.project_id !== undefined) {
      const project = await this.projectFind(scope, String(input.project_id), signal, deadlineAt)
      if (!project) throw new ConnectError("Project not found", Code.NotFound)
      if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(project.id)) throw new Error("skill_response_invalid")
      projectRef = project.id
    }
    type Candidate = Readonly<{
      series_id: string
      name: string
      description: string
      owner_type: string
      created_at: string
      updated_at: string
      product: import("./skill-specification.types.js").SkillProductFact
    }>
    const bySeries = new Map<string, Candidate>()
    if (principal.kind === "oauth_app") {
      if (!this.dependencies.appBindings) throw new ConnectError("App binding owner unavailable", Code.Unavailable)
      const seen = new Set<string>(),
        series = new Set<string>(),
        cursors = new Set<string>()
      let cursor: string | undefined
      do {
        this.active(signal, deadlineAt)
        const result = await this.dependencies.appBindings.list(
          { ...this.common(context), appId: principal.app_id },
          { limit: 100, ...(cursor === undefined ? {} : { cursor }) },
          signal,
          deadlineAt,
        )
        this.active(signal, deadlineAt)
        for (const binding of result.items) {
          if (seen.has(binding.binding_id) || series.has(binding.series_id)) throw new Error("skill_response_invalid")
          seen.add(binding.binding_id)
          series.add(binding.series_id)
          if (seen.size > 1000) throw new ConnectError("Skill list capacity exceeded", Code.ResourceExhausted)
          if (binding.removed_at !== null || binding.metadata === null) continue
          const metadata = binding.metadata
          bySeries.set(binding.series_id, {
            series_id: binding.series_id,
            name: metadata.name,
            description: metadata.summary,
            owner_type: "app",
            created_at: metadata.created_at,
            updated_at: metadata.updated_at,
            product: metadata.product,
          })
        }
        cursor = result.nextCursor
        if (cursor !== undefined) {
          if (cursors.has(cursor)) throw new Error("skill_response_invalid")
          cursors.add(cursor)
        }
      } while (cursor !== undefined)
    }
    const addInstallations = async (project?: string): Promise<void> => {
      const installed = await this.installations(context, signal, deadlineAt, project)
      for (const item of installed)
        bySeries.set(item.series_id, {
          series_id: item.series_id,
          name: item.display_name,
          description: item.summary,
          owner_type: this.publicOwnerType(item),
          created_at: item.skill_created_at,
          updated_at: item.skill_updated_at,
          product: item.product,
        })
      if (bySeries.size > 1000) throw new ConnectError("Skill list capacity exceeded", Code.ResourceExhausted)
    }
    // Whole exact records win. No field-wise merge, latest lookup, fabricated installation or auto-upgrade.
    if (!ordinaryApp) await addInstallations()
    if (projectRef !== undefined) await addInstallations(projectRef)
    const rows = [...bySeries.values()]
    const profiles = await this.creatorProfiles(
      rows.map((item) => item.product),
      context,
      signal,
      deadlineAt,
    )
    const data = rows.map((item) => {
      const creator = item.product.creator_ref,
        profile = creator?.kind === "user" ? profiles.get(JSON.stringify(["user", creator.id])) : undefined
      return {
        id: item.series_id,
        name: item.name,
        description: item.description,
        owner_type: item.owner_type,
        created_at: Math.floor(Date.parse(item.created_at) / 1000),
        updated_at: Math.floor(Date.parse(item.updated_at) / 1000),
        ...(profile?.status === "found" && creator !== undefined ? { creator_info: { user_id: creator.id, name: profile.display_name } } : {}),
      }
    })
    if (projectRef !== undefined) {
      const fresh = await this.projectFind(scope, projectRef, signal, deadlineAt)
      if (!fresh || fresh.id !== projectRef) throw new ConnectError("Project not found", Code.NotFound)
    }
    this.active(signal, deadlineAt)
    return data
  }
  public async read(
    operation: "ListSkills" | "ListHubSkills",
    input: Readonly<Record<string, unknown>>,
    context: SkillSpecificationContext,
    signal: AbortSignal,
    deadlineAt: number,
  ): Promise<unknown> {
    this.active(signal, deadlineAt)
    if (operation === "ListSkills") {
      const installed = await this.installations(context, signal, deadlineAt)
      const official: Array<Record<string, unknown>> = [],
        cursors = new Set<string>()
      let cursor: string | undefined
      do {
        const page = await this.catalog({ source_kind: "official", limit: 100, ...(cursor === undefined ? {} : { cursor }) }, context, signal, deadlineAt)
        for (const item of page.skills) {
          if (item.product.source_kind !== "official") throw new Error("skill_response_invalid")
          const value = await this.detail(item.series_id, context, signal, deadlineAt)
          if (value.skill.source_ref !== item.source_ref) throw new ConnectError("Skill publication changed", Code.Unavailable)
          const installations = installed.filter((entry) => entry.series_id === item.series_id)
          if (installations.length > 1) throw new Error("skill_response_invalid")
          const installation = installations[0]
          official.push({
            ...value.representation,
            added: installation !== undefined,
            ...(installation === undefined ? {} : { installationId: installation.installation_id, enabled: installation.enabled }),
          })
        }
        if (official.length > 1000) throw new ConnectError("Skill list capacity exceeded", Code.ResourceExhausted)
        cursor = page.nextCursor ?? undefined
        if (cursor !== undefined) {
          if (cursors.has(cursor)) throw new Error("skill_response_invalid")
          cursors.add(cursor)
        }
      } while (cursor !== undefined)
      return identity({
        userAddedSkills: installed.map((item) => ({
          id: item.series_id,
          installationId: item.installation_id,
          name: item.display_name,
          displayName: item.display_name,
          description: item.summary,
          userDescription: item.summary,
          version: item.source_ref.slice(6),
          updatedAt: item.skill_updated_at,
          createdAt: item.skill_created_at,
          addTime: item.installed_at,
          enabled: item.enabled,
          added: true,
          exampleQuestions: item.example_prompts,
          tags: { values: item.category_keys.map((key) => this.tag(key)) },
          ...(this.ownerType(item.product.source_kind, item.source_owner_scope.kind) === undefined
            ? {}
            : { ownerType: this.ownerType(item.product.source_kind, item.source_owner_scope.kind) }),
        })),
        officialSkills: official,
      })
    }
    if (input.pageToken !== undefined && input.shuffle !== undefined) throw new ConnectError("Shuffle must be omitted with cursor", Code.InvalidArgument)
    const tag =
      input.tag === undefined
        ? undefined
        : ["programming", "data", "automation", "business", "design", "media", "content", "apps"].find((key) => this.tag(key) === input.tag)
    if (input.tag !== undefined && tag === undefined) throw new ConnectError("Skill tag invalid", Code.InvalidArgument)
    const page = await this.catalog(
      {
        limit: input.pageSize ?? 9,
        ...(input.includeOfficialSkills === undefined ? {} : { include_official_skills: input.includeOfficialSkills }),
        ...(input.shuffle === undefined ? {} : { shuffle: input.shuffle }),
        ...(input.query === undefined ? {} : { query: input.query }),
        ...(tag === undefined ? {} : { category_key: tag }),
        ...(input.pageToken === undefined ? {} : { cursor: input.pageToken }),
      },
      context,
      signal,
      deadlineAt,
    )
    const usage =
      page.skills.length === 0
        ? undefined
        : await this.dependencies.usage?.(
            context.identity.namespace,
            page.skills.map((item) => item.source_ref),
          )
    this.active(signal, deadlineAt)
    const skills = []
    for (const item of page.skills) {
      const value = await this.current(item.series_id, context, signal, deadlineAt)
      const { skill, record } = value
      if (skill.source_ref !== item.source_ref || skill.revision !== item.revision) throw new ConnectError("Skill publication changed", Code.Unavailable)
      const count = usage?.get(item.source_ref)
      skills.push({
        skillId: item.series_id,
        ...(record.originalName === undefined ? {} : { originalName: record.originalName }),
        displayName: skill.name,
        userDescription: skill.summary,
        publishStatus: "SKILL_HUB_PUBLISH_STATUS_PUBLISHED",
        createdAt: item.created_at,
        currentVersion: {
          versionUid: skill.skill_id,
          current: true,
          status: "SKILL_HUB_VERSION_STATUS_AVAILABLE",
          createdAt: value.createdAt,
          ...(item.content_hash === "" ? {} : { checksum: item.content_hash.replace(/^sha256:/u, "") }),
          ...(record.fileCount === undefined ? {} : { fileCount: record.fileCount }),
          ...(record.archiveSize === undefined ? {} : { archiveSize: record.archiveSize.toString() }),
        },
        ...(count?.status === "available" ? { usageCount: count.successfulRunCount } : {}),
        ...(skill.product.source_kind === "official"
          ? { publisherType: "SKILL_HUB_PUBLISHER_TYPE_MANUS_OFFICIAL" }
          : skill.product.source_kind === "third_party"
            ? { publisherType: "SKILL_HUB_PUBLISHER_TYPE_COMMUNITY" }
            : {}),
        exampleQuestions: skill.example_prompts,
        tags: { values: skill.category_keys.map((key) => this.tag(key)) },
        coverImage: `/api/v1/skills/${encodeURIComponent(skill.skill_id)}/cover`,
      })
    }
    this.active(signal, deadlineAt)
    return identity({
      skills,
      tagOptions: {
        values: [
          ["programming", "编程"],
          ["data", "数据"],
          ["automation", "自动化"],
          ["business", "商业"],
          ["design", "设计"],
          ["media", "媒体"],
          ["content", "内容"],
          ["apps", "应用"],
        ].map(([key, displayName]) => ({ tag: this.tag(key!), displayName })),
      },
      ...(page.nextCursor == null ? {} : { nextPageToken: page.nextCursor }),
    })
  }
  public async revisionSummary(sourceRef: string, context: SkillSpecificationContext, signal: AbortSignal, deadlineAt: number) {
    this.active(signal, deadlineAt)
    const value = await this.dependencies.owner.revision(sourceRef, context, signal, deadlineAt)
    this.active(signal, deadlineAt)
    const { skill, record, createdAt } = value
    if (skill.source_ref !== sourceRef || sourceRef !== `skill:${skill.skill_id}` || skill.status !== "active" || skill.package_phase !== "valid")
      throw new Error("skill_response_invalid")
    const profiles = await this.creatorProfiles([skill.product], context, signal, deadlineAt)
    const creator = skill.product.creator_ref
    const profile = creator?.kind === "user" ? profiles.get(JSON.stringify(["user", creator.id])) : undefined
    if (creator?.kind === "user" && (!profile || !["found", "missing"].includes(profile.status))) throw new Error("skill_response_invalid")
    this.active(signal, deadlineAt)
    return {
      skill_id: skill.skill_id,
      series_id: skill.series_id,
      revision: skill.revision,
      display_name: skill.name,
      description: skill.summary,
      tags: skill.tags,
      example_prompts: skill.example_prompts,
      category_keys: skill.category_keys,
      created_at: createdAt,
      updated_at: skill.skill_updated_at,
      owner_type: this.ownerType(skill.product.source_kind, record.ownerKind),
      source_kind: skill.product.source_kind,
      ...(record.originalName === undefined ? {} : { original_name: record.originalName }),
      ...(creator?.kind === "user" && profile?.status === "found" ? { author: { user_id: creator.id, display_name: profile.display_name } } : {}),
      cover_image: `/api/v1/skills/${encodeURIComponent(skill.skill_id)}/cover`,
    }
  }
  public async readDetail(skillId: string, context: SkillSpecificationContext, signal: AbortSignal, deadlineAt: number) {
    this.active(signal, deadlineAt)
    const value = await this.detail(skillId, context, signal, deadlineAt)
    this.active(signal, deadlineAt)
    return { skill: value.representation }
  }
  public async prepareDownload(_operation: "DownloadSkill", skillId: string, context: SkillSpecificationContext, signal: AbortSignal, deadlineAt: number) {
    const value = await this.detail(skillId, context, signal, deadlineAt)
    const owner = await this.dependencies.owner.download(value.skill.source_ref, context, signal, deadlineAt)
    const packageFact = verifiedSkillDownloadPackage(
      owner,
      { sourceRef: value.skill.source_ref, revision: value.skill.revision },
      this.dependencies.objectOrigin,
    )
    this.active(signal, deadlineAt)
    return {
      skill: value.representation,
      binding: {
        tenantId: context.identity.namespace,
        subjectId: context.identity.userId,
        qualifier: { kind: "catalog_current" as const, seriesId: skillId },
        ...packageFact,
      },
    }
  }
  public async confirmDownload(binding: SkillDownloadBinding, context: SkillSpecificationContext, signal: AbortSignal, deadlineAt: number): Promise<void> {
    if (binding.tenantId !== context.identity.namespace || binding.subjectId !== context.identity.userId)
      throw new ConnectError("Skill download not permitted", Code.PermissionDenied)
    if (binding.qualifier.kind !== "catalog_current") throw new ConnectError("Skill download not permitted", Code.PermissionDenied)
    const value = await this.prepareDownload("DownloadSkill", binding.qualifier.seriesId, context, signal, deadlineAt)
    if (
      value.binding.sourceRef !== binding.sourceRef ||
      value.binding.revision !== binding.revision ||
      value.binding.filename !== binding.filename ||
      value.binding.sizeBytes !== binding.sizeBytes ||
      value.binding.contentSha256 !== binding.contentSha256
    )
      throw new ConnectError("Skill download changed", Code.NotFound)
    this.active(signal, deadlineAt)
  }
}
