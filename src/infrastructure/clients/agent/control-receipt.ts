import { createHash } from "node:crypto"

import { isRecord } from "../../../domain/json.js"

export type AgentControlReceipt = {
  command_id: string
  request_digest: string
  status: "pending" | "succeeded" | "failed"
  error_code?: string
  replayed: boolean
}

/** Match the fixed owner's Python JSON encoder after it parses the actual HTTP JSON. */
function ownerJsonNumber(value: number): string {
  const wire = JSON.stringify(value)
  // A decimal integer on the wire is decoded as Python int, including values >= 1e16.
  if (!/[.e]/u.test(wire)) return wire
  const exponential = value.toExponential().split("e")
  const exponent = Number(exponential[1])
  if (exponent >= -4 && exponent < 16) return wire
  return `${exponential[0]}e${exponent < 0 ? "-" : "+"}${String(Math.abs(exponent)).padStart(2, "0")}`
}

function ownerKeyOrder(left: string, right: string): number {
  const a = Array.from(left, (character) => character.codePointAt(0) ?? 0)
  const b = Array.from(right, (character) => character.codePointAt(0) ?? 0)
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0)
    if (difference !== 0) return difference
  }
  return a.length - b.length
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value)
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("AGENT_CONTROL_DIGEST_INPUT_INVALID")
    return ownerJsonNumber(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (!isRecord(value)) throw new Error("AGENT_CONTROL_DIGEST_INPUT_INVALID")
  return `{${Object.keys(value).sort(ownerKeyOrder).map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`
}

export function agentControlRequestDigest(runId: string, body: Record<string, unknown>): string {
  if (runId.trim() === "") throw new Error("AGENT_CONTROL_RUN_ID_REQUIRED")
  const { command_id: _commandId, request_digest: _requestDigest, ...semantic } = body
  if (semantic.kind === "run.resume" && Array.isArray(semantic.decisions)) {
    semantic.decisions = semantic.decisions.map((decision: unknown) => {
      if (!isRecord(decision)) throw new Error("AGENT_CONTROL_DIGEST_INPUT_INVALID")
      const normalized = { ...decision }
      if (normalized.type === "approve" && normalized.args === null) delete normalized.args
      if (normalized.type === "reject" && normalized.reason === null) delete normalized.reason
      return normalized
    })
  }
  const material = canonicalJson({ run_id: runId, ...semantic })
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
