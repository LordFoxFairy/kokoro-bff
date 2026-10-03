import { createHash } from "node:crypto"
import { strictParseRawJson } from "../infrastructure/raw-json.js"

export type CompleteSkillPackageInput = Readonly<{ attemptId: string; uploadId: string; contentSha256: string; sizeBytes: number }>
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u
const SHA256 = /^[a-f0-9]{64}$/u

export function parseCompleteSkillPackageInput(raw: Buffer): CompleteSkillPackageInput {
  if (raw.length > 65_536) throw new Error("request_body_too_large")
  let parsed: unknown
  try {
    parsed = strictParseRawJson(raw)
  } catch {
    throw new Error("invalid_skill_request")
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("invalid_skill_request")
  const value = parsed as Record<string, unknown>
  if (Object.keys(value).sort().join(",") !== "attempt_id,content_sha256,size_bytes,upload_id") throw new Error("invalid_skill_request")
  if (typeof value.attempt_id !== "string" || !ID.test(value.attempt_id) || typeof value.upload_id !== "string" || !ID.test(value.upload_id))
    throw new Error("invalid_skill_request")
  if (typeof value.content_sha256 !== "string" || !SHA256.test(value.content_sha256)) throw new Error("invalid_skill_request")
  if (!Number.isInteger(value.size_bytes) || (value.size_bytes as number) < 1 || (value.size_bytes as number) > 33_554_432)
    throw new Error("invalid_skill_request")
  return { attemptId: value.attempt_id, uploadId: value.upload_id, contentSha256: value.content_sha256, sizeBytes: value.size_bytes as number }
}

export function completeSkillPackageCommandId(tenant: string, user: string, skillId: string, key: string): string {
  const digest = createHash("sha256")
    .update(JSON.stringify(["kokoro-bff", "v1", "skill.complete_package_upload", tenant, user, skillId, key]))
    .digest("hex")
  return `bff.skill.complete_package_upload.v1.${digest}`
}
