import { isRecord } from "../json.js"

export type SelectedCustomApiProfile = { profile_id: string; expected_state_version: number }
const PROFILE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}(?![\s\S])/u

/** Only safe versioned references cross this boundary; these are intent, never grants. */
export function parseCustomApiProfileSelection(value: unknown): SelectedCustomApiProfile[] | null {
  if (!Array.isArray(value) || value.length > 32) return null
  const profiles: SelectedCustomApiProfile[] = []
  const ids = new Set<string>()
  for (const item of value) {
    if (
      !isRecord(item) ||
      Object.keys(item).length !== 2 ||
      typeof item.profile_id !== "string" ||
      !PROFILE_ID.test(item.profile_id) ||
      ids.has(item.profile_id) ||
      typeof item.expected_state_version !== "number" ||
      !Number.isInteger(item.expected_state_version) ||
      item.expected_state_version < 1 ||
      item.expected_state_version > 2147483647
    )
      return null
    ids.add(item.profile_id)
    profiles.push({ profile_id: item.profile_id, expected_state_version: item.expected_state_version })
  }
  return profiles
}
