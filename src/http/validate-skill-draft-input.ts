import { createHash } from "node:crypto"
import { strictParseRawJson } from "../infrastructure/raw-json.js"

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u

export function parseValidateSkillDraftInput(raw: Buffer): { attemptId: string } {
  if (raw.length > 65_536) throw new Error("request_body_too_large")
  let parsed: unknown
  try {
    parsed = strictParseRawJson(raw)
  } catch {
    throw new Error("invalid_skill_request")
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("invalid_skill_request")
  const value = parsed as Record<string, unknown>
  if (Object.keys(value).length !== 1 || typeof value.attempt_id !== "string" || !ID.test(value.attempt_id)) throw new Error("invalid_skill_request")
  return { attemptId: value.attempt_id }
}

export function validateSkillDraftCommandId(tenant: string, user: string, skillId: string, key: string): string {
  const digest = createHash("sha256")
    .update(JSON.stringify(["kokoro-bff", "v1", "skill.validate_draft", tenant, user, skillId, key]))
    .digest("hex")
  return `bff.skill.validate_draft.v1.${digest}`
}
