import { Code, ConnectError } from "@connectrpc/connect"
import type { SkillDownloadBinding, SkillDownloadHandle, SkillDownloadHandles } from "./skill-download-handles.js"
import type { SkillDownloadFact, SkillSpecificationContext } from "./skill-specification.types.js"
import { verifiedSkillDownloadPackage } from "./skill-specification.js"

export type ExactSkillDownloadQualifier = Exclude<SkillDownloadBinding["qualifier"], { kind: "catalog_current" }>
export type ExactSkillDownloadRecord = Readonly<{ sourceRef: string; revision: string }>
export type ExactInstallationProjection = Readonly<{
  installation_id: string
  source_ref: string
  revision: string
  installed: boolean
}>
type Resolver = (id: string, context: SkillSpecificationContext, signal: AbortSignal, deadlineAt: number) => Promise<ExactSkillDownloadRecord | null>

export function exactInstallationRecord(requestedId: string, value: ExactInstallationProjection): ExactSkillDownloadRecord | null {
  if (value.installation_id !== requestedId) throw new Error("skill_installation_response_invalid")
  return value.installed ? { sourceRef: value.source_ref, revision: value.revision } : null
}

export function exactManagedRecord(requestedId: string, input: unknown): ExactSkillDownloadRecord | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw new Error("skill_response_invalid")
  const value = input as Record<string, unknown>
  if (
    value.skill_id !== requestedId ||
    value.source_ref !== `skill:${value.skill_id}` ||
    typeof value.revision !== "string" ||
    !REVISION.test(value.revision) ||
    !["draft", "active", "disabled", "withdrawn", "quarantined", "discarded"].includes(String(value.status))
  )
    throw new Error("skill_response_invalid")
  return value.status === "active" ? { sourceRef: value.source_ref, revision: value.revision } : null
}

export type ExactSkillDownloadSource = Readonly<{
  prepare(qualifier: ExactSkillDownloadQualifier, context: SkillSpecificationContext, signal: AbortSignal, deadlineAt: number): Promise<SkillDownloadHandle>
  confirm(binding: SkillDownloadBinding, context: SkillSpecificationContext, signal: AbortSignal, deadlineAt: number): Promise<void>
}>

export class ExactSkillDownloadService implements ExactSkillDownloadSource {
  public constructor(
    private readonly dependencies: Readonly<{
      installation: Resolver
      managed: Resolver
      share: Resolver
      download(sourceRef: string, context: SkillSpecificationContext, signal: AbortSignal, deadlineAt: number): Promise<SkillDownloadFact>
      handles: SkillDownloadHandles
      objectOrigin: string | null
    }>,
  ) {}

  private resolver(qualifier: ExactSkillDownloadQualifier): readonly [Resolver, string] {
    if (qualifier.kind === "installation") return [this.dependencies.installation, qualifier.installationId]
    if (qualifier.kind === "managed") return [this.dependencies.managed, qualifier.versionId]
    return [this.dependencies.share, qualifier.shareId]
  }

  private async record(qualifier: ExactSkillDownloadQualifier, context: SkillSpecificationContext, signal: AbortSignal, deadlineAt: number) {
    active(signal, deadlineAt)
    const [resolve, id] = this.resolver(qualifier)
    const record = await resolve(id, context, signal, deadlineAt)
    active(signal, deadlineAt)
    if (record === null) throw new ConnectError("Exact Skill was not found", Code.NotFound)
    if (!SOURCE.test(record.sourceRef) || !REVISION.test(record.revision) || BigInt(record.revision) > MAX_REVISION) throw new Error("skill_response_invalid")
    return record
  }

  private async binding(
    qualifier: ExactSkillDownloadQualifier,
    record: ExactSkillDownloadRecord,
    context: SkillSpecificationContext,
    signal: AbortSignal,
    deadlineAt: number,
  ): Promise<SkillDownloadBinding> {
    const owner = await this.dependencies.download(record.sourceRef, context, signal, deadlineAt)
    active(signal, deadlineAt)
    const packageFact = verifiedSkillDownloadPackage(owner, record, this.dependencies.objectOrigin)
    return {
      tenantId: context.identity.namespace,
      subjectId: context.identity.userId,
      qualifier,
      ...packageFact,
    }
  }

  public async prepare(qualifier: ExactSkillDownloadQualifier, context: SkillSpecificationContext, signal: AbortSignal, deadlineAt: number) {
    return this.dependencies.handles.issue(
      await this.binding(qualifier, await this.record(qualifier, context, signal, deadlineAt), context, signal, deadlineAt),
    )
  }

  public async confirm(binding: SkillDownloadBinding, context: SkillSpecificationContext, signal: AbortSignal, deadlineAt: number): Promise<void> {
    if (binding.tenantId !== context.identity.namespace || binding.subjectId !== context.identity.userId || binding.qualifier.kind === "catalog_current")
      throw new ConnectError("Skill download not permitted", Code.PermissionDenied)
    const current = await this.binding(binding.qualifier, await this.record(binding.qualifier, context, signal, deadlineAt), context, signal, deadlineAt)
    if (
      current.sourceRef !== binding.sourceRef ||
      current.revision !== binding.revision ||
      current.filename !== binding.filename ||
      current.sizeBytes !== binding.sizeBytes ||
      current.contentSha256 !== binding.contentSha256
    )
      throw new ConnectError("Skill download changed", Code.NotFound)
    active(signal, deadlineAt)
  }
}

const SOURCE = /^skill:[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u
const REVISION = /^[1-9][0-9]{0,19}$/u
const MAX_REVISION = 18_446_744_073_709_551_615n
function active(signal: AbortSignal, deadlineAt: number): void {
  signal.throwIfAborted()
  if (performance.now() >= deadlineAt) throw new ConnectError("Skill download deadline exceeded", Code.DeadlineExceeded)
}
