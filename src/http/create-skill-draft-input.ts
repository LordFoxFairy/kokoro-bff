import { createHash } from "node:crypto"

export type SkillDraftInput = Readonly<{ displayName: string; summary: string; tags: string[] }>

export function parseSkillDraftInput(raw: Buffer): SkillDraftInput {
  if (raw.length > 65_536) throw new Error("request_body_too_large")
  let value: unknown
  try {
    value = JSON.parse(raw.toString("utf8"))
  } catch {
    throw new Error("invalid_skill_request")
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("invalid_skill_request")
  const object = value as Record<string, unknown>
  if (Object.keys(object).sort().join(",") !== "display_name,summary,tags") throw new Error("invalid_skill_request")
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
  return { displayName: object.display_name, summary: object.summary, tags: object.tags as string[] }
}

export function skillDraftCommandId(tenant: string, user: string, key: string): string {
  const digest = createHash("sha256")
    .update(JSON.stringify(["kokoro-bff", "v1", "skill.create_draft", tenant, user, key]))
    .digest("hex")
  return `bff.skill.create_draft.v1.${digest}`
}
