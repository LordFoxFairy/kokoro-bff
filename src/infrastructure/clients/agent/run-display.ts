import { AGENT_PROCESS_CONSTRAINTS } from "../../../generated/agent-http/process-profile.gen.js"
import type { BffConfig } from "../../../config/runtime.js"
import { zRunDisplayEnvelope } from "../../../generated/agent-http/zod.gen.js"
import { agentIdentityHeaders } from "./identity.js"
import { safeSkillDisplays, safeVirtualPath } from "./display-safety.js"
import { strictParseRawJson } from "../../raw-json.js"
import type { RequestContext } from "../../../domain/request-context.js"
const activityIdPattern = new RegExp(AGENT_PROCESS_CONSTRAINTS.activityId.pattern, "u")
export async function readAgentRunDisplay(config: BffConfig, context: RequestContext, runId: string, signal: AbortSignal) {
  const base = config.upstreams.agents
  if (!config.agentEnabled || !base || !config.upstreamSecret) throw Error("run_display_unavailable")
  const response = await fetch(new URL(`/v1/runs/${encodeURIComponent(runId)}/display`, base), {
    method: "GET",
    redirect: "error",
    signal,
    headers: {
      accept: "application/json",
      authorization: `Bearer ${config.upstreamSecret}`,
      "x-kokoro-service": "kokoro-bff",
      "x-request-id": context.requestId,
      "x-kokoro-request-id": context.requestId,
      ...agentIdentityHeaders(context.identity, `bff:display:${context.requestId}`),
    },
  })
  if (response.status !== 200) {
    await response.body?.cancel()
    throw Error(response.status === 404 ? "run_display_not_found" : "run_display_unavailable")
  }
  const length = response.headers.get("content-length")
  if (
    !/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(response.headers.get("content-type") ?? "") ||
    response.headers.has("content-encoding") ||
    (length !== null && (!/^[1-9][0-9]*$/u.test(length) || Number(length) > 1048576))
  ) {
    await response.body?.cancel()
    throw Error("run_display_response_invalid")
  }
  const chunks: Uint8Array[] = []
  let bytes = 0
  const reader = response.body?.getReader()
  if (!reader) throw Error("run_display_response_invalid")
  try {
    for (;;) {
      const result = await reader.read()
      if (result.done) break
      bytes += result.value.byteLength
      if (bytes > 1048576) throw Error("run_display_response_invalid")
      chunks.push(result.value)
    }
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
  if (length !== null && Number(length) !== bytes) throw Error("run_display_response_invalid")
  let raw: unknown
  try {
    raw = strictParseRawJson(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks)))
  } catch {
    throw Error("run_display_response_invalid")
  }
  const parsed = zRunDisplayEnvelope.safeParse(raw)
  if (!parsed.success) throw Error("run_display_response_invalid")
  const data = parsed.data.data
  if (
    data.run_id !== runId ||
    !safeSkillDisplays(data.display_skills) ||
    new Set(data.tool_paths.map((item) => item.activity_id)).size !== data.tool_paths.length ||
    data.tool_paths.some((item) => !activityIdPattern.test(item.activity_id) || !safeVirtualPath(item.virtual_path))
  )
    throw Error("run_display_response_invalid")
  return data
}
