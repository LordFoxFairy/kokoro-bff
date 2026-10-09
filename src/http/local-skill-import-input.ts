import { createHash } from "node:crypto"

const KEY = /^[\x21-\x2B\x2D-\x7E]{1,128}$/u
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u
const SHA = /^[a-f0-9]{64}$/u

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_local_skill_import_request")
  return value as Record<string, unknown>
}
function exact(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")) throw new Error("invalid_local_skill_import_request")
}
export function localImportKey(values: string[]): string {
  if (values.length !== 1 || !KEY.test(values[0] ?? "")) throw new Error("local_skill_import_idempotency_key_required")
  return values[0]!
}
export function localImportId(value: string): string {
  if (!ID.test(value)) throw new Error("invalid_local_skill_import_request")
  return value
}
export function parseLocalImportBegin(value: unknown) {
  const input = record(value)
  exact(input, ["filename", "size_bytes", "content_sha256"])
  if (typeof input.filename !== "string" || input.filename.length < 1 || input.filename.length > 255 || /[\0/\\]/u.test(input.filename))
    throw new Error("invalid_local_skill_import_request")
  if (!Number.isSafeInteger(input.size_bytes) || (input.size_bytes as number) < 1) throw new Error("invalid_local_skill_import_request")
  if (typeof input.content_sha256 !== "string" || !SHA.test(input.content_sha256)) throw new Error("invalid_local_skill_import_request")
  return { filename: input.filename, sizeBytes: input.size_bytes as number, contentSha256: input.content_sha256 }
}
export function parseLocalImportComplete(value: unknown) {
  const input = record(value)
  exact(input, ["upload_id", "source_version_id", "size_bytes", "content_sha256"])
  if (typeof input.upload_id !== "string" || !ID.test(input.upload_id)) throw new Error("invalid_local_skill_import_request")
  if (
    typeof input.source_version_id !== "string" ||
    input.source_version_id.length < 1 ||
    input.source_version_id.length > 1024 ||
    /[^\x20-\x7e]/u.test(input.source_version_id)
  )
    throw new Error("invalid_local_skill_import_request")
  if (!Number.isSafeInteger(input.size_bytes) || (input.size_bytes as number) < 1) throw new Error("invalid_local_skill_import_request")
  if (typeof input.content_sha256 !== "string" || !SHA.test(input.content_sha256)) throw new Error("invalid_local_skill_import_request")
  return { uploadId: input.upload_id, sourceVersionId: input.source_version_id, sizeBytes: input.size_bytes as number, contentSha256: input.content_sha256 }
}
export function localImportCommandId(operation: string, tenant: string, subject: string, intent: string, key: string) {
  return `local-import:${createHash("sha256").update([operation, tenant, subject, intent, key].join("\0")).digest("hex")}`
}
export function localImportDigest(operation: string, tenant: string, subject: string, body: unknown) {
  return createHash("sha256")
    .update(JSON.stringify({ version: "1.0.0", operation, tenant, subject, body }))
    .digest("hex")
}
