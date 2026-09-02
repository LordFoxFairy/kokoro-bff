import type { AgentControl } from "./types.js"

function jsonValue(value: unknown): unknown {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? value
    : Array.isArray(value)
      ? value.map(jsonValue)
      : typeof value === "object" && value !== null
        ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonValue(item)]))
        : String(value)
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys)
  return Object.keys(value).every((key) => allowed.has(key))
}

export function buildAgentControl(
  sessionId: string,
  body: Record<string, unknown>,
): AgentControl | null {
  const kind = body.kind
  if (kind === "run.cancel" && hasOnlyKeys(body, ["kind"])) {
    return { kind, session_id: sessionId }
  }
  if (kind === "run.resume" && hasOnlyKeys(body, ["kind", "decisions"]) && Array.isArray(body.decisions) && body.decisions.length > 0) {
    return { kind, session_id: sessionId, decisions: body.decisions.map(jsonValue) }
  }
  if (kind === "run.steer" && hasOnlyKeys(body, ["kind", "message_id", "content"]) && typeof body.message_id === "string" && typeof body.content === "string" && body.message_id.trim() !== "" && body.content.trim() !== "") {
    return { kind, session_id: sessionId, message_id: body.message_id, content: body.content }
  }
  return null
}

