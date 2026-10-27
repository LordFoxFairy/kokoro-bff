import { isRecord } from "../json.js"

export type ProjectMcpRecommendation =
  { kind: "provider"; provider_key: string } | { kind: "mcp_connector"; connector_id: string } | { kind: "custom_api"; profile_id: string }
export type ProjectMcpRecommendations = { project_id: string; recommendations: ProjectMcpRecommendation[]; state_version: string }
export const projectMcpId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}(?![\s\S])/u.test(value)
export const projectMcpVersion = (value: unknown): value is string =>
  typeof value === "string" && /^[1-9][0-9]{0,9}(?![\s\S])/u.test(value) && BigInt(value) <= 2147483647n
export function recommendationIdentity(ref: ProjectMcpRecommendation): string {
  return JSON.stringify([ref.kind, ref.kind === "provider" ? ref.provider_key : ref.kind === "mcp_connector" ? ref.connector_id : ref.profile_id])
}
export function parseProjectMcpRecommendations(value: unknown): ProjectMcpRecommendation[] | null {
  if (!Array.isArray(value) || value.length > 16) return null
  const refs: ProjectMcpRecommendation[] = [],
    keys = new Set<string>()
  for (const item of value) {
    if (!isRecord(item) || Object.keys(item).length !== 2) return null
    let ref: ProjectMcpRecommendation
    if (item.kind === "provider" && typeof item.provider_key === "string" && /^[a-z0-9][a-z0-9._-]{0,63}(?![\s\S])/u.test(item.provider_key))
      ref = { kind: "provider", provider_key: item.provider_key }
    else if (item.kind === "mcp_connector" && projectMcpId(item.connector_id)) ref = { kind: "mcp_connector", connector_id: item.connector_id }
    else if (item.kind === "custom_api" && projectMcpId(item.profile_id)) ref = { kind: "custom_api", profile_id: item.profile_id }
    else return null
    const key = recommendationIdentity(ref)
    if (keys.has(key)) return null
    keys.add(key)
    refs.push(ref)
  }
  return refs.sort((a, b) => (recommendationIdentity(a) < recommendationIdentity(b) ? -1 : recommendationIdentity(a) > recommendationIdentity(b) ? 1 : 0))
}
export function decodeProjectMcpRecommendations(projectId: string, raw: unknown, version: unknown): ProjectMcpRecommendations {
  const refs = parseProjectMcpRecommendations(raw),
    stateVersion = String(version)
  if (
    !projectMcpId(projectId) ||
    !refs ||
    !projectMcpVersion(stateVersion) ||
    !Array.isArray(raw) ||
    refs.some((ref, index) => recommendationIdentity(ref) !== recommendationIdentity(raw[index] as ProjectMcpRecommendation))
  )
    throw new Error("PROJECT_MCP_RECOMMENDATIONS_INVALID")
  return { project_id: projectId, recommendations: refs, state_version: stateVersion }
}
