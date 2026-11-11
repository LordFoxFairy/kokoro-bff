import { isRecord } from "../json.js"

export type StorageSelectedResourceRef = {
  kind: "asset" | "artifact"
  resource_id: string
}
export type SelectedResourceRef = StorageSelectedResourceRef | { kind: "final_answer"; resource_id: string }
export type CanonicalStorageResourceRef = {
  kind: "asset" | "artifact"
  resource_id: string
  asset_id: string
  content_sha256: string
  size_bytes: string
  mime_type: string
  filename: string
  source_scope: { kind: "personal" | "project" | "conversation"; id: string }
  source_run_id?: string
}
export type CanonicalFinalAnswerRef = {
  kind: "final_answer"
  resource_id: string
  source_scope: { kind: "conversation"; id: string }
  source_run_id: string
  source_final_segment_id: string
  source_revision: string
  content: string
  content_sha256: string
  size_bytes: string
}
export type CanonicalResourceRef = CanonicalStorageResourceRef | CanonicalFinalAnswerRef

export const FINAL_ANSWER_MAX_BYTES = 24 * 1024

const RESOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}(?![\s\S])$/u
export function isResourceReferenceId(value: unknown): value is string {
  return typeof value === "string" && RESOURCE_ID.test(value)
}

/** Public intent has no owner version, scope, digest, URL or identity semantics. */
export function parseResourceReferenceSelection(value: unknown): SelectedResourceRef[] | null {
  if (!Array.isArray(value) || value.length > 16 || Buffer.byteLength(JSON.stringify(value), "utf8") > 4096) return null
  const refs: SelectedResourceRef[] = []
  const identities = new Set<string>()
  for (const item of value) {
    if (!isRecord(item) || Object.keys(item).sort().join(",") !== "kind,resource_id") return null
    if (item.kind !== "asset" && item.kind !== "artifact" && item.kind !== "final_answer") return null
    if (!isResourceReferenceId(item.resource_id)) return null
    const identity = `${item.kind}\u001f${item.resource_id}`
    if (identities.has(identity)) return null
    identities.add(identity)
    refs.push({ kind: item.kind, resource_id: item.resource_id })
  }
  return refs
}
