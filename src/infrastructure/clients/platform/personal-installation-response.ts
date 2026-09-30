import type { Timestamp } from "@bufbuild/protobuf/wkt"
import { SkillInstallationChange, type ProductSkillInstallation } from "../../../generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js"

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u,
  SOURCE = /^skill:(?!skill:)[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u,
  EVENT = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u
const changes: Record<number, string> = { 1: "installed", 2: "upgraded", 3: "reinstalled", 4: "enabled", 5: "disabled", 6: "removed", 7: "unchanged" }
function instant(value: Timestamp | undefined, required: boolean): string | undefined {
  if (!value) {
    if (required) throw new Error("skill_installation_response_invalid")
    return undefined
  }
  if (value.nanos < 0 || value.nanos > 999999999) throw new Error("skill_installation_response_invalid")
  const milliseconds = Number(value.seconds * 1000n + BigInt(Math.floor(value.nanos / 1_000_000)))
  const date = new Date(milliseconds)
  if (!Number.isSafeInteger(milliseconds) || Number.isNaN(date.valueOf())) throw new Error("skill_installation_response_invalid")
  return date.toISOString()
}
export function projectInstallation(value: ProductSkillInstallation | undefined) {
  if (
    !value?.installationId ||
    !ID.test(value.installationId.value) ||
    !value.sourceRef ||
    !SOURCE.test(value.sourceRef.value) ||
    !value.seriesId ||
    !ID.test(value.seriesId.value) ||
    value.revision < 1n ||
    value.revision > 18446744073709551615n
  )
    throw new Error("skill_installation_response_invalid")
  const installedAt = instant(value.installedAt, true),
    updatedAt = instant(value.updatedAt, true),
    removedAt = instant(value.removedAt, false)
  if (
    (value.installed && removedAt !== undefined) ||
    (!value.installed && (value.enabled || removedAt === undefined)) ||
    new Date(updatedAt!).valueOf() < new Date(installedAt!).valueOf() ||
    (removedAt && new Date(removedAt).valueOf() < new Date(installedAt!).valueOf())
  )
    throw new Error("skill_installation_response_invalid")
  return {
    installation_id: value.installationId.value,
    source_ref: value.sourceRef.value,
    series_id: value.seriesId.value,
    revision: value.revision.toString(),
    installed: value.installed,
    enabled: value.enabled,
    installed_at: installedAt,
    updated_at: updatedAt,
    ...(removedAt === undefined ? {} : { removed_at: removedAt }),
  }
}
export function projectInstallationAck(value: {
  installation?: ProductSkillInstallation | undefined
  change: SkillInstallationChange
  eventId?: string | undefined
  replayed: boolean
}) {
  const change = changes[value.change]
  if (!change) throw new Error("skill_installation_response_invalid")
  if (change === "unchanged" ? value.eventId !== undefined : typeof value.eventId !== "string" || !EVENT.test(value.eventId))
    throw new Error("skill_installation_response_invalid")
  return {
    installation: projectInstallation(value.installation),
    change,
    ...(value.eventId === undefined ? {} : { event_id: value.eventId }),
    replayed: value.replayed,
  }
}
export function projectInstallationList(value: { installations: ProductSkillInstallation[]; page?: { nextCursor?: string | undefined } | undefined }) {
  const ids = new Set<string>()
  const data = value.installations.map((item) => projectInstallation(item))
  for (const item of data) {
    if (ids.has(item.installation_id)) throw new Error("skill_installation_response_invalid")
    ids.add(item.installation_id)
  }
  const cursor = value.page?.nextCursor
  if (cursor !== undefined && (!cursor || Buffer.byteLength(cursor, "utf8") > 4096)) throw new Error("skill_installation_response_invalid")
  return { data, ...(cursor === undefined ? {} : { meta: { next_cursor: cursor } }) }
}
