/** Defaults refer to installations, not display names, source ownership or mutable pins. */
export function parseProjectSkillSelection(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 16) return null
  if (value.some((id) => typeof id !== "string" || /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}(?![\s\S])/u.exec(id)?.[0] !== id)) return null
  if (new Set(value).size !== value.length || Buffer.byteLength(JSON.stringify(value), "utf8") > 4096) return null
  return [...value] as string[]
}
