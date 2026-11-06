import { isRecord } from "../domain/json.js"
import { parseProjectMcpRecommendations, projectMcpVersion } from "../domain/project/mcp-recommendations.js"
import { strictParseRawJson } from "../infrastructure/raw-json.js"
export function parseProjectMcpRecommendationsInput(bytes: Buffer) {
  let raw: unknown
  try {
    raw = strictParseRawJson(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
  } catch {
    return null
  }
  if (!isRecord(raw) || Object.keys(raw).length !== 2 || !projectMcpVersion(raw.expected_state_version)) return null
  const refs = parseProjectMcpRecommendations(raw.recommendations)
  return refs === null ? null : { expectedStateVersion: raw.expected_state_version, recommendations: refs }
}
