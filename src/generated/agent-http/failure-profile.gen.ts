// This file is generated from the fixed kokoro-agent ChatFailure schema. Do not edit.
import { z } from "zod"

export const AGENT_FAILURE_CODES = [
  "token_budget_exceeded",
  "recursion_limit_exceeded",
  "assembly_failed",
  "enqueue_failed",
  "dispatch_exhausted",
  "contract_incompatible",
  "internal_error",
  "model_unavailable",
  "dependency_unavailable",
  "model_access_denied",
] as const
export const RETRYABLE_AGENT_FAILURE_CODES = ["model_unavailable", "dependency_unavailable"] as const

export type AgentFailureCode = (typeof AGENT_FAILURE_CODES)[number]
export type AgentFailureProfile = { source: "agent"; code: AgentFailureCode; retryable: boolean }

const retryableCodes = new Set<AgentFailureCode>(RETRYABLE_AGENT_FAILURE_CODES)
const chatFailureSchema = z
  .object({ status: z.literal("failed"), code: z.enum(AGENT_FAILURE_CODES), retryable: z.boolean() })
  .strict()
  .refine((failure) => !failure.retryable || retryableCodes.has(failure.code), { message: "retryable Agent failure code is invalid" })

export function parseAgentFailure(value: unknown): AgentFailureProfile | null {
  const result = chatFailureSchema.safeParse(value)
  return result.success ? { source: "agent", code: result.data.code, retryable: result.data.retryable } : null
}
