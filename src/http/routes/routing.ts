import type { BffConfig } from "../../config.js"

export function upstreamKey(segments: string[]): string | null {
  // Chat is a BFF-owned Web contract in mock mode and an Agent business
  // adapter in live mode; it never falls back to a Session service.
  if (segments[0] === "sessions") return "agents"
  if (segments[0] === "system") return "system"
  if (segments[0] === "models") return "model"
  if (segments[0] === "skills") return "capability"
  if (segments[0] === "mcp") return "capability"
  if (segments[0] === "agents") return "agents"
  if (segments[0] === "library") return "storage"
  if (segments[0] === "billing") return "billing"
  return null
}

export function bffOwnedBusinessPath(segments: string[]): boolean {
  return segments[0] === "projects" || segments[0] === "scheduled-tasks"
}

export function isMoriBusinessPath(segments: string[]): boolean {
  return segments[0] === "mori"
}

export function configuredUpstream(config: BffConfig, owner: string): string | null {
  return config.upstreams[owner] ?? null
}
