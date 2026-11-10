import { createHash } from "node:crypto"
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
const MIME = /^[A-Za-z0-9_.+-]+\/[A-Za-z0-9_.+-]+$/u

/** Public intent has no owner version, scope, digest, URL or identity semantics. */
export function parseResourceReferenceSelection(value: unknown): SelectedResourceRef[] | null {
  if (!Array.isArray(value) || value.length > 16 || Buffer.byteLength(JSON.stringify(value), "utf8") > 4096) return null
  const refs: SelectedResourceRef[] = []
  const identities = new Set<string>()
  for (const item of value) {
    if (!isRecord(item) || Object.keys(item).sort().join(",") !== "kind,resource_id") return null
    if (item.kind !== "asset" && item.kind !== "artifact" && item.kind !== "final_answer") return null
    if (typeof item.resource_id !== "string" || !RESOURCE_ID.test(item.resource_id)) return null
    const identity = `${item.kind}\u001f${item.resource_id}`
    if (identities.has(identity)) return null
    identities.add(identity)
    refs.push({ kind: item.kind, resource_id: item.resource_id })
  }
  return refs
}

function canonicalFinalAnswer(item: Record<string, unknown>): CanonicalFinalAnswerRef | null {
  if (
    Object.keys(item).sort().join(",") !==
    "content,content_sha256,kind,resource_id,size_bytes,source_final_segment_id,source_revision,source_run_id,source_scope"
  )
    return null
  const scope = item.source_scope
  if (
    !isRecord(scope) ||
    Object.keys(scope).sort().join(",") !== "id,kind" ||
    scope.kind !== "conversation" ||
    typeof scope.id !== "string" ||
    !RESOURCE_ID.test(scope.id)
  )
    return null
  if (
    typeof item.resource_id !== "string" ||
    !RESOURCE_ID.test(item.resource_id) ||
    typeof item.source_run_id !== "string" ||
    !RESOURCE_ID.test(item.source_run_id)
  )
    return null
  if (typeof item.source_final_segment_id !== "string" || !/^[^\u0000\p{Surrogate}]{1,255}(?![\s\S])$/u.test(item.source_final_segment_id)) return null
  if (
    typeof item.source_revision !== "string" ||
    !/^[1-9][0-9]{0,18}(?![\s\S])$/u.test(item.source_revision) ||
    BigInt(item.source_revision) > 9223372036854775807n
  )
    return null
  if (typeof item.content !== "string" || item.content.length === 0 || /[\u0000\p{Surrogate}]/u.test(item.content)) return null
  const bytes = Buffer.from(item.content, "utf8")
  if (
    bytes.length > FINAL_ANSWER_MAX_BYTES ||
    item.size_bytes !== String(bytes.length) ||
    item.content_sha256 !== createHash("sha256").update(bytes).digest("hex")
  )
    return null
  return {
    kind: "final_answer",
    resource_id: item.resource_id,
    source_scope: { kind: scope.kind, id: scope.id },
    source_run_id: item.source_run_id,
    source_final_segment_id: item.source_final_segment_id,
    source_revision: item.source_revision,
    content: item.content,
    content_sha256: item.content_sha256,
    size_bytes: item.size_bytes,
  }
}

/** Only the BFF owner resolver supplies this private immutable launch material. */
export function parseCanonicalResourceReferences(value: unknown): CanonicalResourceRef[] | null {
  if (!Array.isArray(value) || value.length > 16) return null
  const asciiBytes = Array.from(JSON.stringify(value)).reduce((size, char) => size + (char.charCodeAt(0) >= 127 ? char.length * 6 : 1), 0)
  if (asciiBytes > 32768) return null
  const refs: CanonicalResourceRef[] = []
  for (const item of value) {
    if (!isRecord(item)) return null
    if (item.kind === "final_answer") {
      const ref = canonicalFinalAnswer(item)
      if (ref === null) return null
      refs.push(ref)
      continue
    }
    if (item.kind !== "asset" && item.kind !== "artifact") return null
    const keys = [
      "kind",
      "resource_id",
      "asset_id",
      "content_sha256",
      "size_bytes",
      "mime_type",
      "filename",
      "source_scope",
      ...(item.kind === "artifact" ? ["source_run_id"] : []),
    ]
    if (Object.keys(item).sort().join(",") !== keys.sort().join(",")) return null
    if (![item.resource_id, item.asset_id].every((id) => typeof id === "string" && RESOURCE_ID.test(id))) return null
    if (typeof item.content_sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(item.content_sha256)) return null
    if (typeof item.size_bytes !== "string" || !/^(0|[1-9][0-9]{0,19})$/u.test(item.size_bytes) || BigInt(item.size_bytes) > 18446744073709551615n) return null
    if (typeof item.mime_type !== "string" || item.mime_type.length > 191 || !MIME.test(item.mime_type)) return null
    if (typeof item.filename !== "string" || !/^[^\u0000-\u001f\u007f/\\\uD800-\uDFFF]{1,255}$/u.test(item.filename) || [".", ".."].includes(item.filename))
      return null
    const scope = item.source_scope
    if (!isRecord(scope) || Object.keys(scope).sort().join(",") !== "id,kind" || typeof scope.id !== "string" || !RESOURCE_ID.test(scope.id)) return null
    if (item.kind === "artifact") {
      if (scope.kind !== "conversation" || typeof item.source_run_id !== "string" || !RESOURCE_ID.test(item.source_run_id)) return null
    } else if ((scope.kind !== "personal" && scope.kind !== "project") || item.resource_id !== item.asset_id) return null
    refs.push({
      kind: item.kind,
      resource_id: item.resource_id as string,
      asset_id: item.asset_id as string,
      content_sha256: item.content_sha256,
      size_bytes: item.size_bytes,
      mime_type: item.mime_type,
      filename: item.filename,
      source_scope: {
        kind: scope.kind as CanonicalStorageResourceRef["source_scope"]["kind"],
        id: scope.id,
      },
      ...(item.kind === "artifact" ? { source_run_id: item.source_run_id as string } : {}),
    })
  }
  return parseResourceReferenceSelection(refs.map(({ kind, resource_id }) => ({ kind, resource_id }))) === null ? null : refs
}
