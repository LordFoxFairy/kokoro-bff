export type CapabilityOperation = "skills" | "skillPool" | "skillCatalog" | "mcpServers"

export type CapabilitySkillProjection = {
  name: string
  description: string
  content_hash: string
  scope: string
  enabled: boolean
  installed?: boolean
  categories: string[]
}

export type CapabilitySkillsProjection = {
  skills: CapabilitySkillProjection[]
  next_cursor?: string | null
}

export type CapabilityMcpServerProjection = {
  scope: string
  name: string
  revision: number
  transport: "http" | "streamable_http"
  url: string
  allowed_tools: string[]
  secret_ref: null
  enabled: boolean
}

export type CapabilityMcpProjection = {
  servers: CapabilityMcpServerProjection[]
  next_cursor?: string
}

export type CapabilityProjection = CapabilitySkillsProjection | CapabilityMcpProjection

export type CapabilityFailure = {
  ok: false
  status: 400 | 502 | 503
  code: "invalid_query_parameter" | "capability_response_invalid" | "capability_unavailable"
  message: string
}

export type CapabilityResult = { ok: true; status: 200; data: CapabilityProjection } | CapabilityFailure
