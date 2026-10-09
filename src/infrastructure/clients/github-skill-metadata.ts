import { FAILSAFE_SCHEMA, load } from "js-yaml"
import { skillMetadataInputSchema } from "./platform/skill-product-schema.js"

/** Parse real SKILL.md frontmatter; never synthesize metadata from filenames/body/repository labels. */
export function githubSkillMetadata(bytes: Buffer) {
  if (bytes.length > 1_048_576) throw new Error("github_metadata_invalid")
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  if (!/^---\r?\n/u.test(text) || text.includes("\u0000")) throw new Error("github_metadata_invalid")
  const opening = text.indexOf("\n") + 1
  const end = /^---\r?$/gmu.exec(text.slice(opening))
  if (!end || Buffer.byteLength(text.slice(opening, opening + end.index)) > 65_536) throw new Error("github_metadata_invalid")
  let depth = 0,
    nodes = 0
  const value = load(text.slice(opening, opening + end.index), {
    schema: FAILSAFE_SCHEMA,
    json: false,
    listener: (event) => {
      if (event === "open") {
        if (++depth > 20 || ++nodes > 1024) throw new Error("github_metadata_invalid")
      } else depth--
    },
  })
  const seen = new WeakSet<object>()
  let inspected = 0
  const inspect = (node: unknown, level: number): void => {
    if (++inspected > 2048 || level > 20) throw new Error("github_metadata_invalid")
    if (node === null || typeof node === "string") return
    if (typeof node !== "object" || seen.has(node)) throw new Error("github_metadata_invalid")
    seen.add(node)
    for (const [key, child] of Object.entries(node)) {
      if (["__proto__", "constructor", "prototype"].includes(key)) throw new Error("github_metadata_invalid")
      inspect(child, level + 1)
    }
  }
  inspect(value, 0)
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("github_metadata_invalid")
  const frontmatter = value as Record<string, unknown>
  if (typeof frontmatter.name !== "string" || typeof frontmatter.description !== "string") throw new Error("github_metadata_invalid")
  return skillMetadataInputSchema.parse({
    display_name: frontmatter.name,
    summary: frontmatter.description,
    tags: Object.hasOwn(frontmatter, "tags") ? frontmatter.tags : [],
    ...(Object.hasOwn(frontmatter, "example_prompts") ? { example_prompts: frontmatter.example_prompts } : {}),
    ...(Object.hasOwn(frontmatter, "category_keys") ? { category_keys: frontmatter.category_keys } : {}),
  })
}
