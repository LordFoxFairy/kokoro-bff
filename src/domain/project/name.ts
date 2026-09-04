const MAX_PROJECT_NAME_LENGTH = 160

/** Project names are a domain value: trim presentation whitespace and reject empty/oversized names. */
export function projectName(value: unknown): string | null {
  if (typeof value !== "string") return null
  const normalized = value.trim()
  return normalized === "" || normalized.length > MAX_PROJECT_NAME_LENGTH ? null : normalized
}
