import { createHash } from "node:crypto"

import { isRecord } from "../../../domain/json.js"

export type AgentControlReceipt = {
  command_id: string
  request_digest: string
  status: "pending" | "succeeded" | "failed"
  error_code?: string
  replayed: boolean
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value)
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("AGENT_CONTROL_DIGEST_INPUT_INVALID")
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (!isRecord(value)) throw new Error("AGENT_CONTROL_DIGEST_INPUT_INVALID")
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`
}

export function agentControlRequestDigest(runId: string, body: Record<string, unknown>): string {
  if (runId.trim() === "") throw new Error("AGENT_CONTROL_RUN_ID_REQUIRED")
  const material = canonicalJson({ run_id: runId, ...body })
  return `sha256:${createHash("sha256").update(material).digest("hex")}`
}

export function parseAgentControlReceipt(value: unknown): AgentControlReceipt | null {
  if (!isRecord(value)) return null
  const allowed = new Set(["command_id", "request_digest", "status", "error_code", "replayed"])
  if (Object.keys(value).some((key) => !allowed.has(key))) return null
  if (typeof value.command_id !== "string" || value.command_id.trim() === "") return null
  if (typeof value.request_digest !== "string" || value.request_digest.trim() === "") return null
  if (value.status !== "pending" && value.status !== "succeeded" && value.status !== "failed") return null
  if (typeof value.replayed !== "boolean") return null
  if (value.error_code !== undefined && (typeof value.error_code !== "string" || value.error_code.trim() === "")) return null
  return {
    command_id: value.command_id,
    request_digest: value.request_digest,
    status: value.status,
    ...(value.error_code === undefined ? {} : { error_code: value.error_code }),
    replayed: value.replayed,
  }
}
