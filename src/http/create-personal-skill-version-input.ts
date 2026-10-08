import { createHash } from "node:crypto"

import { strictParseRawJson } from "../infrastructure/raw-json.js"
import { parseSkillExamplePrompts } from "../infrastructure/clients/platform/skill-example-prompts.js"

export type CreatePersonalSkillVersionInput = Readonly<{ displayName: string; summary: string; tags: string[]; examplePrompts?: string[] }>

export function parseCreatePersonalSkillVersionInput(raw: Buffer): CreatePersonalSkillVersionInput {
  if (raw.byteLength > 65_536) throw new Error("request_body_too_large")
  let value: unknown
  try {
    value = strictParseRawJson(new TextDecoder("utf-8", { fatal: true }).decode(raw))
  } catch {
    throw new Error("invalid_skill_request")
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("invalid_skill_request")
  const object = value as Record<string, unknown>
  const keys = Object.keys(object).sort().join(",")
  if (keys !== "display_name,summary,tags" && keys !== "display_name,example_prompts,summary,tags") throw new Error("invalid_skill_request")
  if (typeof object.display_name !== "string" || object.display_name.length < 1 || object.display_name.length > 255 || !/\S/u.test(object.display_name))
    throw new Error("invalid_skill_request")
  if (typeof object.summary !== "string" || object.summary.length > 65_535) throw new Error("invalid_skill_request")
  if (
    !Array.isArray(object.tags) ||
    object.tags.length > 100 ||
    new Set(object.tags).size !== object.tags.length ||
    object.tags.some((tag) => typeof tag !== "string" || tag.length < 1 || tag.length > 128 || !/\S/u.test(tag))
  )
    throw new Error("invalid_skill_request")
  let examplePrompts: string[] | undefined
  try {
    examplePrompts = object.example_prompts === undefined ? undefined : parseSkillExamplePrompts(object.example_prompts)
  } catch {
    throw new Error("invalid_skill_request")
  }
  return {
    displayName: object.display_name,
    summary: object.summary,
    tags: object.tags as string[],
    ...(examplePrompts === undefined ? {} : { examplePrompts }),
  }
}

export function createPersonalSkillVersionCommandId(tenant: string, user: string, skillId: string, key: string): string {
  const digest = createHash("sha256")
    .update(JSON.stringify(["kokoro-bff", "v1", "skill.create_version", tenant, user, skillId, key]))
    .digest("hex")
  return `bff.skill.create_version.v1.${digest}`
}
