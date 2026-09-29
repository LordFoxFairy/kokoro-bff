import type { IncomingMessage, ServerResponse } from "node:http"
import { Code, ConnectError } from "@connectrpc/connect"
import { SkillStatus } from "../../generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js"
import type { RequestContext } from "../../domain/request-context.js"
import type { CatalogConnectClient } from "../../infrastructure/clients/platform/catalog-connect.js"
import { projectPublishSkill } from "../../infrastructure/clients/platform/publish-skill-projector.js"
import { publishSkillCommandId } from "../publish-skill-input.js"
import { readBody } from "../request.js"
import { send } from "../response.js"

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u
const KEY = /^[\x21-\x2B\x2D-\x7E]{1,128}$/u
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu
const MAX_REVISION = 18_446_744_073_709_551_615n
const failure = (code: string, message: string, retryable = false) => ({ error: { code, message, retryable } })
function mapFailure(error: unknown): { status: number; body: ReturnType<typeof failure>; retryAfter?: string } {
  if (!(error instanceof ConnectError))
    return error instanceof Error && error.message === "skill_response_invalid"
      ? { status: 502, body: failure("skill_response_invalid", "Skill catalog returned an invalid publication") }
      : { status: 503, body: failure("skill_dependency_unavailable", "Skill catalog is unavailable", true) }
  if (error.code === Code.NotFound || error.code === Code.PermissionDenied) return { status: 404, body: failure("skill_not_found", "Skill was not found") }
  if (error.code === Code.AlreadyExists) return { status: 409, body: failure("skill_idempotency_conflict", "Skill command conflicts with an existing command") }
  if (error.code === Code.Aborted) {
    if (error.metadata.get("x-kokoro-error-code") === "publish_snapshot_conflict")
      return { status: 412, body: failure("skill_precondition_failed", "Skill publication precondition failed") }
    return { status: 409, body: failure("skill_command_in_progress", "Skill command is already in progress", true) }
  }
  if (error.code === Code.FailedPrecondition) return { status: 412, body: failure("skill_precondition_failed", "Skill publication precondition failed") }
  if (error.code === Code.ResourceExhausted) {
    const retryAfter = error.metadata.get("retry-after")
    return {
      status: 429,
      body: failure("skill_rate_limited", "Skill catalog rate limited the command", true),
      ...(/^[1-9][0-9]{0,4}$/u.test(retryAfter ?? "") ? { retryAfter: retryAfter as string } : {}),
    }
  }
  if ([Code.Unavailable, Code.DeadlineExceeded, Code.Canceled, Code.Unauthenticated].includes(error.code))
    return { status: 503, body: failure("skill_dependency_unavailable", "Skill catalog is unavailable", true) }
  return { status: 502, body: failure("skill_response_invalid", "Skill catalog returned an invalid publication") }
}

function project(result: Awaited<ReturnType<CatalogConnectClient["publish"]>>, skillId: string) {
  if (
    typeof result !== "object" ||
    result === null ||
    typeof result.sourceRef?.value !== "string" ||
    result.sourceRef.value !== `skill:${skillId}` ||
    typeof result.revision !== "bigint" ||
    result.revision < 1n ||
    result.revision > MAX_REVISION ||
    result.status !== SkillStatus.ACTIVE ||
    typeof result.eventId !== "string" ||
    !UUID.test(result.eventId) ||
    typeof result.replayed !== "boolean"
  )
    throw new Error("skill_response_invalid")
  return { source_ref: result.sourceRef.value, revision: result.revision.toString(), status: "active", event_id: result.eventId, replayed: result.replayed }
}

export async function publishSkillRoute(
  request: IncomingMessage,
  response: ServerResponse,
  context: RequestContext,
  skillId: string,
  client: CatalogConnectClient | null,
  signal?: AbortSignal,
): Promise<void> {
  response.setHeader("x-request-id", context.requestId)
  response.setHeader("cache-control", "no-store")
  if (request.method !== "POST" || request.url !== `/v1/skills/${skillId}/publish` || !ID.test(skillId)) {
    send(response, 400, failure("invalid_skill_request", "Skill Publish request is invalid"))
    return
  }
  if (client === null) {
    send(response, 503, failure("skill_dependency_unavailable", "Skill Publish candidate is unavailable", true))
    return
  }
  const keys = request.rawHeaders.flatMap((name, index) =>
    index % 2 === 0 && name.toLowerCase() === "idempotency-key" ? [request.rawHeaders[index + 1] ?? ""] : [],
  )
  const key = keys[0]
  if (keys.length !== 1 || !KEY.test(key ?? "")) {
    send(response, 400, failure(key === undefined ? "idempotency_key_required" : "invalid_idempotency_key", "A single valid Idempotency-Key is required"))
    return
  }
  try {
    if ((await readBody(request, 65_536)).length !== 0) {
      send(response, 400, failure("invalid_skill_request", "Skill Publish request body must be empty"))
      return
    }
  } catch (error) {
    const oversized = error instanceof Error && ["request_body_too_large", "request body too large"].includes(error.message)
    send(response, oversized ? 413 : 400, failure(oversized ? "request_body_too_large" : "invalid_skill_request", "Skill Publish request is invalid"))
    return
  }
  const raw = JSON.stringify({
    command_digest_version: "3.0.0",
    fq_method: "kokoro.platform.v1.SkillCatalogService/PublishSkill",
    tenant_ref: context.identity.namespace,
    request: {
      skill_id: { value: skillId },
      product_context: { subject_id: context.identity.userId, owner_scope: { kind: "user", id: context.identity.userId } },
      visibility: 1,
    },
  })
  let digest: string
  try {
    digest = projectPublishSkill(raw, true).sha256
  } catch {
    send(response, 400, failure("invalid_skill_request", "Skill Publish request is invalid"))
    return
  }
  try {
    const owner = await client.publish(
      {
        requestId: context.requestId,
        commandId: publishSkillCommandId(context.identity.namespace, context.identity.userId, skillId, key as string),
        digest,
        tenant: context.identity.namespace,
        user: context.identity.userId,
        skillId,
      },
      signal,
    )
    send(response, 200, { data: project(owner, skillId) })
  } catch (error) {
    if (response.destroyed) return
    const mapped = mapFailure(error)
    send(response, mapped.status, mapped.body, mapped.retryAfter)
  }
}
