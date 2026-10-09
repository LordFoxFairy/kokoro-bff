import { createHash } from "node:crypto"
import { strictParseRawJson } from "../infrastructure/raw-json.js"
import { skillMetadataInputSchema } from "../infrastructure/clients/platform/skill-product-schema.js"

export type SkillDraftInput = Readonly<{ displayName: string; summary: string; tags: string[]; examplePrompts?: string[]; categoryKeys?: string[] }>

export function parseSkillDraftInput(raw: Buffer): SkillDraftInput {
  if (raw.length > 65_536) throw new Error("request_body_too_large")
  try {
    const value = skillMetadataInputSchema.parse(strictParseRawJson(new TextDecoder("utf-8", { fatal: true }).decode(raw)))
    return {
      displayName: value.display_name,
      summary: value.summary,
      tags: value.tags,
      ...(value.example_prompts === undefined ? {} : { examplePrompts: value.example_prompts }),
      ...(value.category_keys === undefined ? {} : { categoryKeys: value.category_keys }),
    }
  } catch {
    throw new Error("invalid_skill_request")
  }
}

export function skillDraftCommandId(tenant: string, user: string, key: string): string {
  const digest = createHash("sha256")
    .update(JSON.stringify(["kokoro-bff", "v1", "skill.create_draft", tenant, user, key]))
    .digest("hex")
  return `bff.skill.create_draft.v1.${digest}`
}
