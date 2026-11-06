import { isRecord } from "../json.js"

export type SelectedResourceRef = {
  kind: "asset" | "artifact"
  resource_id: string
  version_id?: string
}

const RESOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}(?![\s\S])$/u

/** Opaque owner references only; URLs, content, identities and digests never cross this boundary. */
export function parseResourceReferenceSelection(value: unknown): SelectedResourceRef[] | null {
  if (!Array.isArray(value) || value.length > 16 || Buffer.byteLength(JSON.stringify(value), "utf8") > 4096) return null
  const refs: SelectedResourceRef[] = []
  const identities = new Set<string>()
  for (const item of value) {
    if (!isRecord(item)) return null
    const keys = Object.keys(item)
    if (keys.some((key) => !["kind", "resource_id", "version_id"].includes(key))) return null
    if (typeof item.kind !== "string" || (item.kind !== "asset" && item.kind !== "artifact")) return null
    if (typeof item.resource_id !== "string" || !RESOURCE_ID.test(item.resource_id)) return null
    if (item.version_id !== undefined && (typeof item.version_id !== "string" || !RESOURCE_ID.test(item.version_id))) return null
    const identity = `${item.kind}\u001f${item.resource_id}\u001f${item.version_id ?? ""}`
    if (identities.has(identity)) return null
    identities.add(identity)
    refs.push({
      kind: item.kind,
      resource_id: item.resource_id,
      ...(item.version_id === undefined ? {} : { version_id: item.version_id }),
    })
  }
  return refs
}
