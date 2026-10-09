import { createHash } from "node:crypto"

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u
const SOURCE = /^skill:(?!skill:)[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u
const KEY = /^[\x21-\x2b\x2d-\x7e]{1,128}$/u
export const exactInstallationId = (value: string): string => {
  if (!ID.test(value)) throw new Error("invalid_skill_installation_request")
  return value
}
export function exactIdempotencyKey(value: string | string[] | undefined): string {
  if (typeof value !== "string" || !KEY.test(value)) throw new Error("skill_installation_idempotency_key_required")
  return value
}
function strictObject(raw: Buffer): Record<string, unknown> {
  if (raw.length > 65_536) throw new Error("request_body_too_large")
  try {
    const value: unknown = JSON.parse(raw.toString("utf8"))
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error()
    return value as Record<string, unknown>
  } catch {
    throw new Error("invalid_skill_installation_request")
  }
}
export function parseInstallInput(raw: Buffer): { sourceRef: string } {
  const value = strictObject(raw)
  if (Object.keys(value).join(",") !== "source_ref" || typeof value.source_ref !== "string" || !SOURCE.test(value.source_ref))
    throw new Error("invalid_skill_installation_request")
  return { sourceRef: value.source_ref }
}
export function parseEnabledInput(raw: Buffer): { enabled: boolean } {
  const value = strictObject(raw)
  if (Object.keys(value).join(",") !== "enabled" || typeof value.enabled !== "boolean") throw new Error("invalid_skill_installation_request")
  return { enabled: value.enabled }
}
/** The formal installed/owned query is a literal substring, not a LIKE expression. */
export function parsePersonalSkillQuery(value: unknown): string {
  if (typeof value !== "string" || /[\uD800-\uDFFF]/u.test(value)) throw new Error("invalid_skill_installation_request")
  const query = value.trim()
  if ([...query].length < 1 || [...query].length > 1024) throw new Error("invalid_skill_installation_request")
  return query
}
export function parseInstallationList(url: string): {
  enabled?: boolean
  installed?: boolean
  limit?: number
  cursor?: string
  query?: string
  sourceKind?: "personal" | "official" | "third_party"
} {
  const query = new URL(url, "http://bff.local").searchParams
  if (
    [...query.keys()].some((key) => !["enabled", "installed", "limit", "cursor", "source_kind", "query"].includes(key)) ||
    [...new Set(query.keys())].some((key) => query.getAll(key).length !== 1)
  )
    throw new Error("invalid_skill_installation_request")
  const result: {
    enabled?: boolean
    installed?: boolean
    limit?: number
    cursor?: string
    query?: string
    sourceKind?: "personal" | "official" | "third_party"
  } = {}
  for (const key of ["enabled", "installed"] as const) {
    if (!query.has(key)) continue
    const value = query.get(key)
    if (value !== "true" && value !== "false") throw new Error("invalid_skill_installation_request")
    result[key] = value === "true"
  }
  if (query.has("query")) result.query = parsePersonalSkillQuery(query.get("query"))
  if (query.has("source_kind")) {
    const value = query.get("source_kind")
    if (value !== "personal" && value !== "official" && value !== "third_party") throw new Error("invalid_skill_installation_request")
    result.sourceKind = value
  }
  if (query.has("limit")) {
    const value = query.get("limit") ?? ""
    if (!/^[1-9][0-9]{0,2}$/u.test(value) || Number(value) > 100) throw new Error("invalid_skill_installation_request")
    result.limit = Number(value)
  }
  if (query.has("cursor")) {
    const value = query.get("cursor") ?? ""
    if (!value || Buffer.byteLength(value, "utf8") > 4096 || !/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error("invalid_skill_installation_request")
    result.cursor = value
  }
  return result
}
export function installationCommandId(operation: string, tenant: string, user: string, target: string, key: string): string {
  return `bff.skill-installation.v1.${createHash("sha256")
    .update(JSON.stringify([operation, tenant, user, target, key]))
    .digest("hex")}`
}
