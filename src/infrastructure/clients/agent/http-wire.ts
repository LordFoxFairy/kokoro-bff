import { zCreateRunResponse, zErrorEnvelope, zLaunchRequest, zReplaySessionEventsResponse } from "../../../generated/agent-http/zod.gen.js"
import { isRecord } from "../../../domain/json.js"
import type { LaunchRequest, LaunchReceiptEnvelope } from "../../../generated/agent-http/types.gen.js"

/** The owner OpenAPI is the sole source of both successful HTTP response schemas. */
export function parseAgentHttpJson(body: Buffer): unknown {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)) as unknown
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

/** Project BFF's one saved scope into the current owner wire; never re-read current Project state. */
export function projectSavedAgentLaunch(value: unknown): LaunchRequest | null {
  if (!isRecord(value) || Object.hasOwn(value, "project_ref") || !isRecord(value.trace)) return null
  // These are BFF-owned persisted formats, not caller-provided authentication.
  if (value.trace.source !== "kokoro-bff" && value.trace.source !== "kokoro-bff-scheduler") return null
  const project = value.trace.project_ref
  if (Object.hasOwn(value.trace, "project_ref") && (typeof project !== "string" || !/^[^\s\u0000-\u001f\u007f]{1,255}$/u.test(project))) return null
  const projected = zLaunchRequest.strict().safeParse({ ...value, project_ref: project ?? null })
  if (!projected.success) return null
  const { requested_model_label, trace, selected_mcp_connection_ids, selected_custom_api_profiles, ...required } = projected.data
  return {
    ...required,
    ...(requested_model_label === undefined ? {} : { requested_model_label }),
    ...(trace === undefined ? {} : { trace }),
    ...(selected_mcp_connection_ids === undefined ? {} : { selected_mcp_connection_ids }),
    ...(selected_custom_api_profiles === undefined ? {} : { selected_custom_api_profiles }),
  }
}
