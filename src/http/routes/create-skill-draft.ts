import type { IncomingMessage, ServerResponse } from "node:http"
import { Code, ConnectError } from "@connectrpc/connect"
import { SkillStatus } from "../../generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js"
import type { RequestContext } from "../../domain/request-context.js"
import { readBody } from "../request.js"
import { send } from "../response.js"
import { parseSkillDraftInput, skillDraftCommandId } from "../create-skill-draft-input.js"
import { projectCreateSkillDraft } from "../../infrastructure/clients/platform/create-skill-draft-projector.js"
import type { CatalogConnectClient } from "../../infrastructure/clients/platform/catalog-connect.js"

const KEY = /^[\x21-\x2B\x2D-\x7E]{1,128}$/u
const skillFailure = (code: string, message: string, retryable = false) => ({ error: { code, message, retryable } })
function catalogFailure(error: unknown): { status: number; body: ReturnType<typeof skillFailure>; retryAfter?: string } {
  if (!(error instanceof ConnectError)) {
    return error instanceof Error && error.message === "skill_response_invalid"
      ? { status: 502, body: skillFailure("skill_response_invalid", "Skill catalog returned an invalid response") }
      : { status: 503, body: skillFailure("skill_dependency_unavailable", "Skill catalog is unavailable", true) }
  }
  if (error.code === Code.AlreadyExists)
    return { status: 409, body: skillFailure("skill_idempotency_conflict", "Skill command conflicts with an existing command") }
  if (error.code === Code.Aborted) return { status: 409, body: skillFailure("skill_command_in_progress", "Skill command is already in progress", true) }
  if (error.code === Code.FailedPrecondition) return { status: 412, body: skillFailure("skill_precondition_failed", "Skill precondition failed") }
  if (error.code === Code.ResourceExhausted) {
    const value = error.metadata.get("retry-after")
    return {
      status: 429,
      body: skillFailure("skill_rate_limited", "Skill catalog rate limited the command", true),
      ...(/^[1-9][0-9]{0,4}$/u.test(value ?? "") ? { retryAfter: value as string } : {}),
    }
  }
  if (error.code === Code.Unavailable || error.code === Code.DeadlineExceeded || error.code === Code.Canceled || error.code === Code.Unauthenticated)
    return { status: 503, body: skillFailure("skill_dependency_unavailable", "Skill catalog is unavailable", true) }
  return { status: 502, body: skillFailure("skill_response_invalid", "Skill catalog returned an invalid response") }
}
export async function createSkillDraftRoute(
  request: IncomingMessage,
  response: ServerResponse,
  context: RequestContext,
  client: CatalogConnectClient | null,
  signal?: AbortSignal,
): Promise<void> {
  const id = context.requestId
  response.setHeader("x-request-id", id)
  response.setHeader("cache-control", "no-store")
  if (client === null) {
    send(response, 503, skillFailure("skill_dependency_unavailable", "Skill draft candidate is unavailable", true))
    return
  }
  const rawValues = request.rawHeaders.flatMap((value, index) =>
    index % 2 === 0 && value.toLowerCase() === "idempotency-key" ? [request.rawHeaders[index + 1] ?? ""] : [],
  )
  const key = rawValues[0]
  if (request.headers["content-type"]?.toLowerCase().split(";", 1)[0]?.trim() !== "application/json") {
    send(response, 400, skillFailure("invalid_skill_request", "Content-Type must be application/json"))
    return
  }
  if (rawValues.length !== 1 || !KEY.test(key ?? "")) {
    send(response, 400, skillFailure(key === undefined ? "idempotency_key_required" : "invalid_idempotency_key", "A single valid Idempotency-Key is required"))
    return
  }
  let input
  try {
    input = parseSkillDraftInput(await readBody(request, 65_536))
  } catch (error) {
    const code =
      error instanceof Error && ["request_body_too_large", "request body too large"].includes(error.message)
        ? "request_body_too_large"
        : "invalid_skill_request"
    send(response, code === "request_body_too_large" ? 413 : 400, skillFailure(code, "Skill draft request is invalid"))
    return
  }
  const commandId = skillDraftCommandId(context.identity.namespace, context.identity.userId, key as string)
  const projection = projectCreateSkillDraft(
    JSON.stringify({
      command_digest_version: "3.0.0",
      fq_method: "kokoro.platform.v1.SkillCatalogService/CreateSkillDraft",
      tenant_ref: context.identity.namespace,
      request: {
        owner_scope: { kind: "user", id: context.identity.userId },
        product_context: { subject_id: context.identity.userId, owner_scope: { kind: "user", id: context.identity.userId } },
        metadata: {
          display_name: input.displayName,
          summary: input.summary,
          tags: input.tags,
          metadata_json: "e30",
        },
      },
    }),
    true,
  )
  try {
    const result = await client.create(
      {
        requestId: id,
        commandId,
        digest: projection.sha256,
        tenant: context.identity.namespace,
        user: context.identity.userId,
        ...input,
      },
      signal,
    )
    const ownerId = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u
    if (
      !result.skillId?.value ||
      !ownerId.test(result.skillId.value) ||
      !result.seriesId?.value ||
      !ownerId.test(result.seriesId.value) ||
      result.revision !== 1n ||
      result.status !== SkillStatus.DRAFT
    )
      throw new Error("skill_response_invalid")
    send(response, 201, {
      data: { skill_id: result.skillId.value, series_id: result.seriesId.value, revision: Number(result.revision), status: "draft", replayed: result.replayed },
    })
  } catch (error) {
    const mapped = catalogFailure(error)
    send(response, mapped.status, mapped.body, mapped.retryAfter)
  }
}
