import { createHash } from "node:crypto"
import { strictParseRawJson } from "../infrastructure/raw-json.js"

export type BeginSkillPackageInput = Readonly<{
  filename: string
  mimeType: "application/zip"
  sizeBytes: number
  contentSha256: string
  replacesAttemptId?: string
}>

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u
const FILENAME = /^(?!\.{1,2}$)(?!\s)(?!.*\s$)[^/\\\u0000-\u001f\u007f]+$/u
const SHA256 = /^[a-f0-9]{64}$/u

export function parseBeginSkillPackageInput(raw: Buffer): BeginSkillPackageInput {
  if (raw.length > 65_536) throw new Error("request_body_too_large")
  let parsed: unknown
  try {
    parsed = strictParseRawJson(raw)
  } catch {
    throw new Error("invalid_skill_request")
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("invalid_skill_request")
  const value = parsed as Record<string, unknown>
  const keys = Object.keys(value).sort().join(",")
  if (keys !== "content_sha256,filename,mime_type,size_bytes" && keys !== "content_sha256,filename,mime_type,replaces_attempt_id,size_bytes")
    throw new Error("invalid_skill_request")
  if (typeof value.filename !== "string" || !FILENAME.test(value.filename) || Buffer.byteLength(value.filename, "utf8") > 255)
    throw new Error("invalid_skill_request")
  if (
    value.mime_type !== "application/zip" ||
    !Number.isInteger(value.size_bytes) ||
    (value.size_bytes as number) < 1 ||
    (value.size_bytes as number) > 33_554_432
  )
    throw new Error("invalid_skill_request")
  if (typeof value.content_sha256 !== "string" || !SHA256.test(value.content_sha256)) throw new Error("invalid_skill_request")
  if (Object.hasOwn(value, "replaces_attempt_id") && (typeof value.replaces_attempt_id !== "string" || !ID.test(value.replaces_attempt_id)))
    throw new Error("invalid_skill_request")
  return {
    filename: value.filename,
    mimeType: "application/zip",
    sizeBytes: value.size_bytes as number,
    contentSha256: value.content_sha256,
    ...(Object.hasOwn(value, "replaces_attempt_id") ? { replacesAttemptId: value.replaces_attempt_id as string } : {}),
  }
}

export function beginSkillPackageCommandId(tenant: string, user: string, skillId: string, key: string): string {
  const digest = createHash("sha256")
    .update(JSON.stringify(["kokoro-bff", "v1", "skill.begin_package_upload", tenant, user, skillId, key]))
    .digest("hex")
  return `bff.skill.begin_package_upload.v1.${digest}`
}
