import { isDeepStrictEqual } from "node:util"
import { skillDecimalSchema, skillCreationProvenanceSchema, skillCategoryKeysSchema } from "./skill-product-schema.js"
import { toJson, type Message } from "@bufbuild/protobuf"
import { timestampDate } from "@bufbuild/protobuf/wkt"
import type { Timestamp } from "@bufbuild/protobuf/wkt"
import {
  SkillProductFactsSchema,
  SkillCreationProvenanceSchema,
  SkillCoverSchema,
  SkillPackagePhase,
  SkillStatus,
  type SkillProductFacts,
  type SkillProductRecord,
  type SkillCover,
} from "../../../generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js"
import { zSkillProductFacts, zSkillCover } from "../../../generated/platform-http/zod.gen.js"
import { parseSkillExamplePrompts } from "./skill-example-prompts.js"

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u
const U64_MAX = 18_446_744_073_709_551_615n
const states: Record<number, string> = {
  [SkillStatus.DRAFT]: "draft",
  [SkillStatus.ACTIVE]: "active",
  [SkillStatus.DISABLED]: "disabled",
  [SkillStatus.WITHDRAWN]: "withdrawn",
  [SkillStatus.QUARANTINED]: "quarantined",
  [SkillStatus.DISCARDED]: "discarded",
}
const packagePhases: Partial<Record<SkillPackagePhase, "none" | "upload_pending" | "uploaded" | "valid" | "aborted">> = {
  [SkillPackagePhase.NONE]: "none",
  [SkillPackagePhase.UPLOAD_PENDING]: "upload_pending",
  [SkillPackagePhase.UPLOADED]: "uploaded",
  [SkillPackagePhase.VALIDATED]: "valid",
  [SkillPackagePhase.ABORTED]: "aborted",
}
export function assertSkillWireKnown(value: unknown): void {
  if (typeof value !== "object" || value === null || value instanceof Uint8Array) return
  if ((value as Message).$unknown?.length) throw new Error("skill_response_invalid")
  for (const [key, member] of Object.entries(value))
    if (!key.startsWith("$")) {
      if (Array.isArray(member)) member.forEach(assertSkillWireKnown)
      else assertSkillWireKnown(member)
    }
}
export function skillTimestamp(value: Timestamp | undefined): string {
  if (value === undefined || value.seconds < -62135596800n || value.seconds > 253402300799n || value.nanos < 0 || value.nanos > 999999999)
    throw new Error("skill_response_invalid")
  return timestampDate(value).toISOString()
}
export function projectSkillCover(value: SkillCover | undefined) {
  if (!value) throw new Error("skill_response_invalid")
  assertSkillWireKnown(value)
  const result = zSkillCover.strict().safeParse(
    toJson(SkillCoverSchema, value, {
      useProtoFieldName: true,
      alwaysEmitImplicit: true,
    }),
  )
  if (!result.success) throw new Error("skill_response_invalid")
  return result.data
}

export function projectSkillProductJson(value: unknown) {
  const parsed = zSkillProductFacts.strict().safeParse(value)
  if (!parsed.success) throw new Error("skill_response_invalid")
  const result = parsed.data
  if (!isDeepStrictEqual(value, result)) throw new Error("skill_response_invalid")
  if (!skillDecimalSchema.safeParse(result.state_version).success) throw new Error("skill_response_invalid")
  if ((result.source_kind === undefined) !== (result.publisher === undefined)) throw new Error("skill_response_invalid")
  if (result.creation_provenance !== undefined) {
    const { kind, ...fields } = result.creation_provenance
    if (!skillCreationProvenanceSchema.safeParse({ [kind]: fields }).success) throw new Error("skill_response_invalid")
  }
  if (
    result.source_kind === "third_party" &&
    (result.publisher?.kind !== "github_repository" ||
      result.creation_provenance?.kind !== "github" ||
      result.publisher.github_repository.repository_id !== result.creation_provenance.repository_id ||
      result.presentation_kind !== "github_repository")
  )
    throw new Error("skill_response_invalid")
  if (["personal", "official"].includes(result.source_kind ?? "") && (result.publisher?.kind !== "iam" || result.presentation_kind !== "first_party"))
    throw new Error("skill_response_invalid")
  return result
}
export function projectSkillProductFacts(value: SkillProductFacts | undefined) {
  if (!value || value.stateVersion < 1n || value.stateVersion > 9_223_372_036_854_775_807n) throw new Error("skill_response_invalid")
  assertSkillWireKnown(value)
  const wire = toJson(SkillProductFactsSchema, value, {
    useProtoFieldName: true,
    alwaysEmitImplicit: true,
  }) as Record<string, unknown>
  if (value.creationProvenance !== undefined) {
    const provenance = toJson(SkillCreationProvenanceSchema, value.creationProvenance, { useProtoFieldName: true, alwaysEmitImplicit: true }) as Record<
      string,
      object
    >
    const kind = value.creationProvenance.provenance.case
    if (!kind) throw new Error("skill_response_invalid")
    wire.creation_provenance = { kind, ...provenance[kind] }
  }
  const publisher = value.publisher?.publisher
  if (publisher) {
    if (publisher.case === "iam")
      wire.publisher = {
        kind: "iam",
        iam: { kind: publisher.value.kind, id: publisher.value.id },
      }
    else if (publisher.case === "githubRepository") {
      const json = wire.publisher as { github_repository?: unknown }
      wire.publisher = {
        kind: "github_repository",
        github_repository: {
          kind: "github",
          ...(json.github_repository as object),
        },
      }
    } else throw new Error("skill_response_invalid")
  }
  const result = projectSkillProductJson(wire)
  if ((result.source_kind === undefined) !== (result.publisher === undefined)) throw new Error("skill_response_invalid")
  if (
    result.source_kind === "third_party" &&
    (result.publisher?.kind !== "github_repository" ||
      result.creation_provenance?.kind !== "github" ||
      result.publisher.github_repository.repository_id !== result.creation_provenance.repository_id)
  )
    throw new Error("skill_response_invalid")
  if (["personal", "official"].includes(result.source_kind ?? "") && result.publisher?.kind !== "iam") throw new Error("skill_response_invalid")
  if (value.cover) projectSkillCover(value.cover)
  return result
}
export function projectSkillProductRecord(value: SkillProductRecord | undefined, expectedSkillId?: string) {
  const packagePhase = value === undefined ? undefined : packagePhases[value.packagePhase]
  if (
    !value ||
    !value.skillId ||
    !ID.test(value.skillId.value) ||
    (expectedSkillId !== undefined && value.skillId.value !== expectedSkillId) ||
    !value.seriesId ||
    !ID.test(value.seriesId.value) ||
    value.sourceRef?.value !== `skill:${value.skillId.value}` ||
    value.revision < 1n ||
    value.revision > U64_MAX ||
    !states[value.status] ||
    !value.metadata ||
    value.metadata.displayName.trim().length === 0 ||
    value.metadata.displayName.length > 255 ||
    value.metadata.summary.length > 65_535 ||
    packagePhase === undefined
  )
    throw new Error("skill_response_invalid")
  assertSkillWireKnown(value)
  const metadata = value.metadata
  const categories = skillCategoryKeysSchema.safeParse(metadata.categoryKeys?.keys ?? [])
  if (!categories.success) throw new Error("skill_response_invalid")
  let examples: string[]
  try {
    examples = parseSkillExamplePrompts(metadata.examplePrompts?.prompts ?? [])
  } catch (error) {
    throw new Error("skill_response_invalid", { cause: error })
  }
  return {
    skill_id: value.skillId.value,
    source_ref: value.sourceRef.value,
    series_id: value.seriesId.value,
    revision: value.revision.toString(),
    status: states[value.status]!,
    name: metadata.displayName,
    summary: metadata.summary,
    tags: metadata.tags,
    example_prompts: examples,
    category_keys: categories.data,
    skill_updated_at: skillTimestamp(value.skillUpdatedAt),
    product: projectSkillProductFacts(value.product),
    package_phase: packagePhase,
  }
}
export function projectSkillProductAck(
  value: {
    skill?: SkillProductRecord | undefined
    eventId: string
    replayed: boolean
  },
  expectedSkillId?: string,
) {
  if (!ID.test(value.eventId) || typeof value.replayed !== "boolean") throw new Error("skill_response_invalid")
  assertSkillWireKnown(value)
  return {
    skill: projectSkillProductRecord(value.skill, expectedSkillId),
    event_id: value.eventId,
    replayed: value.replayed,
  }
}

export function projectSkillStateVersion(value: bigint): string {
  if (typeof value !== "bigint" || value < 1n || value > 9_223_372_036_854_775_807n) throw new Error("skill_response_invalid")
  return value.toString()
}
