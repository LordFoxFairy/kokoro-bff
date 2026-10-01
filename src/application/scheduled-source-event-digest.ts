import { createHash } from "node:crypto"

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value)
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("SCHEDULED_AGENT_SOURCE_DIGEST_VALUE_INVALID")
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (typeof value === "object") {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`
  }
  throw new Error("SCHEDULED_AGENT_SOURCE_DIGEST_VALUE_INVALID")
}

export function scheduledSourceEventDigest(value: Record<string, unknown>): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex")
}
