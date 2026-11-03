import type { IncomingMessage, ServerResponse } from "node:http"
import { ConnectError, Code } from "@connectrpc/connect"
import type { BffConfig } from "../../config/runtime.js"
import { authorizeUserRequest } from "../../auth/user-admission.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import type { RequestContext } from "../../domain/request-context.js"
import type { SkillUsageResult } from "../../application/agui/skill-usage.js"
import { parseSkillProductInput } from "../skill-product-input.js"
import { runSkillRoute } from "./skill-drafts.js"
import { readSkillBody as readBody } from "./skill-drafts.js"
import { send } from "../response.js"
import { requestId } from "../request.js"
export async function skillUsageRoute(
  request: IncomingMessage,
  response: ServerResponse,
  context: RequestContext,
  reader: ((tenant: string, refs: readonly string[]) => Promise<Map<string, SkillUsageResult>>) | undefined,
) {
  await runSkillRoute(request, response, context, async (signal) => {
    if (
      new URL(request.url!, "http://bff.local").search ||
      request.headers["idempotency-key"] !== undefined ||
      request.headers["content-type"]?.split(";", 1)[0] !== "application/json"
    )
      throw new ConnectError("Usage input invalid", Code.InvalidArgument)
    const input = parseSkillProductInput("usage", await readBody(request, 65_536))
    if (!reader) throw new ConnectError("Usage store unavailable", Code.Unavailable)
    const result = await reader(context.identity.namespace, input.source_refs)
    if (result.size !== input.source_refs.length) throw new Error("skill_response_invalid")
    const items = input.source_refs.map((sourceRef) => {
      const value = result.get(sourceRef)
      if (!value) throw new Error("skill_response_invalid")
      if (value.status === "unavailable") {
        if (Object.keys(value).join(",") !== "status") throw new Error("skill_response_invalid")
        return { source_ref: sourceRef, status: "unavailable" }
      }
      if (
        value.status !== "available" ||
        Object.keys(value).sort().join(",") !== "status,successfulRunCount" ||
        !/^(0|[1-9][0-9]*)$/u.test(value.successfulRunCount) ||
        BigInt(value.successfulRunCount) > 9_223_372_036_854_775_807n
      )
        throw new Error("skill_response_invalid")
      return { source_ref: sourceRef, status: "available", successful_run_count: value.successfulRunCount }
    })
    signal.throwIfAborted()
    send(response, 200, { data: { items } })
  })
}

export async function handleSkillUsageRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  admission: SessionAdmission,
  reader: ((tenant: string, refs: readonly string[]) => Promise<Map<string, SkillUsageResult>>) | undefined,
): Promise<boolean> {
  const pathname = new URL(request.url ?? "/", "http://bff.local").pathname
  if (pathname !== "/v1/skills/usage" || request.method !== "POST") return false
  const id = requestId(request)
  const signal = AbortSignal.timeout(10_000)
  const admitted = await authorizeUserRequest(request, config, admission, id, signal, response)
  if (!admitted.ok) {
    send(
      response,
      admitted.status,
      { error: { code: admitted.code, message: "BFF user admission failed", retryable: admitted.status === 429 || admitted.status === 503 } },
      admitted.retryAfter,
    )
    return true
  }
  await skillUsageRoute(request, response, admitted.context, reader)
  return true
}
