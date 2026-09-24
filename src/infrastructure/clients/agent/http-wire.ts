import { zCreateRunResponse, zErrorEnvelope, zReplaySessionEventsResponse } from "../../../generated/agent-http/zod.gen.js"
import type { LaunchReceiptEnvelope } from "../../../generated/agent-http/types.gen.js"

/** The owner OpenAPI is the sole source of both successful HTTP response schemas. */
export function parseAgentHttpJson(body: Buffer): unknown {
  try {
    return JSON.parse(body.toString("utf8")) as unknown
  } catch {
    return undefined
  }
}

export function parseLaunchReceipt(status: number, body: unknown): LaunchReceiptEnvelope | null {
  if (status !== 202) return null
  const result = zCreateRunResponse.safeParse(body)
  return result.success ? result.data : null
}

export function parseReplayPage(status: number, body: unknown) {
  if (status !== 200) return null
  const result = zReplaySessionEventsResponse.safeParse(body)
  return result.success ? result.data : null
}

export function parseAgentErrorCode(body: unknown): string | null {
  const result = zErrorEnvelope.safeParse(body)
  if (!result.success) return null
  const code = result.data.error.code
  return /^[a-z][a-z0-9_]{0,63}$/u.test(code) ? code : null
}
