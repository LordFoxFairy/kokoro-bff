import { parseCustomApiProfileSelection, type SelectedCustomApiProfile } from "../../domain/chat/custom-api-profile-selection.js"
import { parseMcpConnectionSelection } from "../../domain/chat/mcp-connection-selection.js"
import { parseSkillSourceSelection } from "../../domain/chat/skill-source-selection.js"

export type MessageCreateInput = {
  content: string
  model?: string
  agent?: string
  thinking?: boolean
  selectedSkillSourceRefs?: string[]
  selectedMcpConnectionIds?: string[]
  selectedCustomApiProfiles?: SelectedCustomApiProfile[]
  projectRef?: string
}

const MESSAGE_CREATE_KEYS = new Set([
  "content",
  "model",
  "agent",
  "thinking",
  "selected_skill_source_refs",
  "selected_mcp_connection_ids",
  "selected_custom_api_profiles",
  "project_ref",
])

function optionalTrimmedString(value: unknown): string | undefined | null {
  if (value === undefined) return undefined
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed === "" ? null : trimmed
}

/** Strict runtime parser for the canonical public MessageCreateRequest. */
export function parseMessageCreateRequest(json: Record<string, unknown>, queryProjectRef: string | undefined): MessageCreateInput | null {
  if (Object.keys(json).some((key) => !MESSAGE_CREATE_KEYS.has(key))) return null
  const content = optionalTrimmedString(json.content)
  if (content === null || content === undefined || content.length > 100_000) return null
  const model = optionalTrimmedString(json.model)
  const agent = optionalTrimmedString(json.agent)
  const bodyProjectRef = optionalTrimmedString(json.project_ref)
  const fallbackProjectRef = optionalTrimmedString(queryProjectRef)
  const selectedSkillSourceRefs = json.selected_skill_source_refs === undefined ? undefined : parseSkillSourceSelection(json.selected_skill_source_refs)
  const selectedMcpConnectionIds = json.selected_mcp_connection_ids === undefined ? undefined : parseMcpConnectionSelection(json.selected_mcp_connection_ids)
  const selectedCustomApiProfiles =
    json.selected_custom_api_profiles === undefined ? undefined : parseCustomApiProfileSelection(json.selected_custom_api_profiles)
  if (
    model === null ||
    agent === null ||
    bodyProjectRef === null ||
    fallbackProjectRef === null ||
    selectedSkillSourceRefs === null ||
    selectedMcpConnectionIds === null ||
    selectedCustomApiProfiles === null ||
    (json.thinking !== undefined && typeof json.thinking !== "boolean") ||
    (bodyProjectRef !== undefined && fallbackProjectRef !== undefined && bodyProjectRef !== fallbackProjectRef)
  )
    return null
  const projectRef = bodyProjectRef ?? fallbackProjectRef
  return {
    content,
    ...(model === undefined ? {} : { model }),
    ...(agent === undefined ? {} : { agent }),
    ...(json.thinking === undefined ? {} : { thinking: json.thinking }),
    ...(selectedSkillSourceRefs === undefined ? {} : { selectedSkillSourceRefs }),
    ...(selectedMcpConnectionIds === undefined ? {} : { selectedMcpConnectionIds }),
    ...(selectedCustomApiProfiles === undefined ? {} : { selectedCustomApiProfiles }),
    ...(projectRef === undefined ? {} : { projectRef }),
  }
}
