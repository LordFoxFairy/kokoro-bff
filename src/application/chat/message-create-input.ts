import { parseSkillSourceSelection } from "../../domain/chat/skill-source-selection.js"

export type MessageCreateInput = {
  content: string
  model?: string
  agent?: string
  thinking?: boolean
  selectedSkillSourceRefs: string[]
  mcpServers?: string[]
  projectRef?: string
}

const MESSAGE_CREATE_KEYS = new Set(["content", "model", "agent", "thinking", "selected_skill_source_refs", "mcp_servers", "project_ref"])

function optionalTrimmedString(value: unknown): string | undefined | null {
  if (value === undefined) return undefined
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed === "" ? null : trimmed
}

function optionalTrimmedStrings(value: unknown): string[] | undefined | null {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) return null
  const result: string[] = []
  for (const item of value) {
    const parsed = optionalTrimmedString(item)
    if (parsed === null || parsed === undefined) return null
    result.push(parsed)
  }
  return result
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
  const selectedSkillSourceRefs = parseSkillSourceSelection(json.selected_skill_source_refs === undefined ? [] : json.selected_skill_source_refs)
  const mcpServers = optionalTrimmedStrings(json.mcp_servers)
  if (
    model === null ||
    agent === null ||
    bodyProjectRef === null ||
    fallbackProjectRef === null ||
    selectedSkillSourceRefs === null ||
    mcpServers === null ||
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
    selectedSkillSourceRefs,
    ...(mcpServers === undefined ? {} : { mcpServers }),
    ...(projectRef === undefined ? {} : { projectRef }),
  }
}
