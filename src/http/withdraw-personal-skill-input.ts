import { skillDecimalSchema } from "../infrastructure/clients/platform/skill-product-schema.js"
import { createHash } from "node:crypto"

import { strictParseRawJson } from "../infrastructure/raw-json.js"

export type WithdrawPersonalSkillInput = Readonly<{ reason: string; expectedStateVersion: string }>

export function parseWithdrawPersonalSkillInput(raw: Buffer): WithdrawPersonalSkillInput {
  if (raw.byteLength > 65_536) throw new Error("request_body_too_large")
  let value: unknown
  try {
    value = strictParseRawJson(new TextDecoder("utf-8", { fatal: true }).decode(raw))
  } catch {
    throw new Error("invalid_skill_request")
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("invalid_skill_request")
  const object = value as Record<string, unknown>
  const expectedStateVersion = skillDecimalSchema.parse(object.expected_state_version)
  delete object.expected_state_version
  if (Object.keys(object).join(",") !== "reason" || typeof object.reason !== "string") throw new Error("invalid_skill_request")
  const length = Array.from(object.reason).length
  if (length < 1 || length > 2048 || object.reason.includes("\u0000") || !/\S/u.test(object.reason)) throw new Error("invalid_skill_request")
  return { reason: object.reason, expectedStateVersion }
}

export function withdrawPersonalSkillCommandId(tenant: string, user: string, skillId: string, key: string): string {
  const digest = createHash("sha256")
    .update(JSON.stringify(["kokoro-bff", "v1", "skill.withdraw", tenant, user, skillId, key]))
    .digest("hex")
  return `bff.skill.withdraw.v1.${digest}`
}
