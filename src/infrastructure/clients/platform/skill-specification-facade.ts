import { Code, ConnectError } from "@connectrpc/connect"
import type { CurrentSkillFact, SkillDownloadFact, SkillSpecificationContext, SkillSpecificationOwner } from "../../../application/skill-specification.types.js"
import type { SkillProductConnectClient } from "./skill-product-connect.js"
import type { PersonalInstallationConnectClient } from "./personal-installation-connect.js"
import type { PlatformProjectionHttpClient } from "./projection-http.js"
import { projectInstallationList, projectInstallationSourceFacts } from "./personal-installation-response.js"
import { assertSkillWireKnown, projectSkillProductRecord, skillTimestamp } from "./skill-product-response.js"
import { zListVisibleSkillCatalogResponse, zSkill } from "../../../generated/platform-http/zod.gen.js"
import { z } from "zod"

/** Decodes fixed Platform transports into the narrow application owner port. */
export class PlatformSkillSpecificationFacade implements SkillSpecificationOwner {
  public constructor(
    private readonly dependencies: {
      product: Pick<SkillProductConnectClient, "current" | "download" | "revision">
      installations: Pick<PersonalInstallationConnectClient, "list">
      projection: Pick<PlatformProjectionHttpClient, "read">
    },
  ) {}
  private common(context: SkillSpecificationContext) {
    return { requestId: context.requestId, tenant: context.identity.namespace, subject: context.identity.userId }
  }
  public async listInstallations(input: Readonly<Record<string, unknown>>, signal: AbortSignal) {
    const raw = await this.dependencies.installations.list(input as Parameters<PersonalInstallationConnectClient["list"]>[0], signal)
    const projected = projectInstallationList(raw)
    return {
      items: projected.data.map((item, index) => ({
        ...item,
        installed_at: item.installed_at!,
        skill_updated_at: item.skill_updated_at!,
        ...projectInstallationSourceFacts(raw.installations[index]!),
      })),
      ...(projected.meta?.next_cursor === undefined ? {} : { nextCursor: projected.meta.next_cursor }),
    }
  }
  public async listCatalog(input: Readonly<Record<string, unknown>>, context: SkillSpecificationContext, signal: AbortSignal) {
    const result = await this.dependencies.projection.read(
      "catalog",
      context.identity.namespace,
      context.identity.userId,
      context.requestId,
      { query: { ...input } },
      signal,
    )
    if (!result.ok) {
      if (result.status === 400) throw new ConnectError("Skill query invalid", Code.InvalidArgument)
      if (result.status === 404) throw new ConnectError("Skill not found", Code.NotFound)
      if (result.status === 502) throw new Error("skill_response_invalid")
      throw new ConnectError("Skill dependency unavailable", Code.Unavailable)
    }
    const page = zListVisibleSkillCatalogResponse
      .strict()
      .extend({ data: zListVisibleSkillCatalogResponse.shape.data.strict().extend({ skills: z.array(zSkill.strict()) }) })
      .parse({ data: result.data }).data
    return { skills: page.skills, ...(page.next_cursor == null ? {} : { nextCursor: page.next_cursor }) }
  }
  public async revision(sourceRef: string, context: SkillSpecificationContext, signal: AbortSignal, deadlineAt: number) {
    const result = await this.dependencies.product.revision({ ...this.common(context), sourceRef }, signal, deadlineAt)
    assertSkillWireKnown(result)
    const id = sourceRef.slice(6)
    if (sourceRef !== `skill:${id}` || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(id)) throw new Error("skill_response_invalid")
    const skill = projectSkillProductRecord(result.skill, id)
    const record = result.skill!
    if (
      skill.source_ref !== sourceRef ||
      skill.status !== "active" ||
      skill.package_phase !== "valid" ||
      !record.ownerScope ||
      !record.ownerScope.id ||
      !["user", "organization", "project", "app"].includes(record.ownerScope.kind)
    )
      throw new Error("skill_response_invalid")
    return {
      skill,
      record: { ownerKind: record.ownerScope.kind, ...(record.originalName === undefined ? {} : { originalName: record.originalName }) },
      createdAt: skillTimestamp(record.createdAt),
    }
  }
  public async current(seriesId: string, context: SkillSpecificationContext, signal: AbortSignal, deadlineAt: number): Promise<CurrentSkillFact> {
    const result = await this.dependencies.product.current({ ...this.common(context), seriesId }, signal, deadlineAt)
    assertSkillWireKnown(result)
    const publication = result.publication
    if (
      !publication ||
      publication.seriesId?.value !== seriesId ||
      !publication.current ||
      publication.stateVersion < 1n ||
      publication.stateVersion > 9_223_372_036_854_775_807n ||
      !["owner", "tenant", "catalog"].includes(publication.audience)
    )
      throw new Error("skill_response_invalid")
    const skill = projectSkillProductRecord(publication.currentVersion)
    if (skill.series_id !== seriesId || skill.status !== "active" || skill.package_phase !== "valid") throw new Error("skill_response_invalid")
    const record = publication.currentVersion!
    if (!record.ownerScope || !record.ownerScope.id || !record.ownerScope.kind) throw new Error("skill_response_invalid")
    return {
      skill,
      record: {
        ownerKind: record.ownerScope.kind,
        ...(record.originalName === undefined ? {} : { originalName: record.originalName }),
        ...(record.fileCount === undefined ? {} : { fileCount: record.fileCount }),
        ...(record.archiveSize === undefined ? {} : { archiveSize: record.archiveSize }),
      },
      createdAt: skillTimestamp(record.createdAt),
      publishedAt: skillTimestamp(publication.publishedAt),
    }
  }
  public async download(sourceRef: string, context: SkillSpecificationContext, signal: AbortSignal, deadlineAt: number): Promise<SkillDownloadFact> {
    const owner = await this.dependencies.product.download({ ...this.common(context), sourceRef }, signal, deadlineAt)
    assertSkillWireKnown(owner)
    if (!owner.sourceRef || !owner.transferReference) throw new Error("skill_response_invalid")
    return {
      sourceRef: owner.sourceRef.value,
      revision: owner.revision.toString(),
      filename: owner.filename,
      sizeBytes: owner.sizeBytes,
      contentSha256: owner.contentSha256,
      transfer: {
        url: owner.transferReference.url,
        method: owner.transferReference.method,
        requiredHeaders: owner.transferReference.requiredHeaders,
        expiresAt: skillTimestamp(owner.transferReference.expiresAt),
      },
    }
  }
}
