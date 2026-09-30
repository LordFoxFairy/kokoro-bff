/** BFF value validation mirrors the pinned Agent LaunchRequest contract. */
const SKILL_SOURCE_REF = /^skill:(?!skill:)[A-Za-z0-9][A-Za-z0-9._:-]{0,190}(?![\s\S])/u

export function parseSkillSourceSelection(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 16) return null
  const refs: string[] = []
  for (const item of value) {
    if (typeof item !== "string" || !SKILL_SOURCE_REF.test(item)) return null
    refs.push(item)
  }
  if (new Set(value).size !== value.length || Buffer.byteLength(JSON.stringify(value), "utf8") > 4096) return null
  return refs
}
