import { zControlRequest } from "../../../generated/agent-http/zod.gen.js"
import type { AgentControl } from "./types.js"

export function buildAgentControl(sessionId: string, body: Record<string, unknown>): AgentControl | null {
  if (Object.hasOwn(body, "session_id") || sessionId.trim() === "") return null
  const parsed = zControlRequest.safeParse({ ...body, session_id: sessionId })
  if (!parsed.success) return null
  const control = parsed.data
  if (control.kind === "run.resume") {
    if (!Number.isSafeInteger(control.expected_pause_revision) || control.expected_pause_revision < 1 || control.pause_ref.trim() === "") return null
    const items = control.decisions.map((decision) => decision.item_id)
    if (items.some((item) => item.trim() === "") || new Set(items).size !== items.length) return null
  }
  return control as AgentControl
}
