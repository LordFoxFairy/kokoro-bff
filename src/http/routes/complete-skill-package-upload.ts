import type { IncomingMessage, ServerResponse } from "node:http"
import { Code, ConnectError } from "@connectrpc/connect"
import { SkillPackagePhase, SkillPackageScanState } from "../../generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js"
import type { RequestContext } from "../../domain/request-context.js"
import type { CatalogConnectClient } from "../../infrastructure/clients/platform/catalog-connect.js"
import { projectCompleteSkillPackage } from "../../infrastructure/clients/platform/complete-skill-package-projector.js"
import { completeSkillPackageCommandId, parseCompleteSkillPackageInput, type CompleteSkillPackageInput } from "../complete-skill-package-input.js"
import { readBody } from "../request.js"
import { send } from "../response.js"

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u
const KEY = /^[\x21-\x2B\x2D-\x7E]{1,128}$/u
const MAX_EPOCH = 18_446_744_073_709_551_615n
const failure = (code: string, message: string, retryable = false) => ({ error: { code, message, retryable } })
function mapFailure(error: unknown): { status: number; body: ReturnType<typeof failure>; retryAfter?: string } {
  if (!(error instanceof ConnectError))
    return error instanceof Error && error.message === "skill_response_invalid"
      ? { status: 502, body: failure("skill_response_invalid", "Skill catalog returned an invalid completion") }
      : { status: 503, body: failure("skill_dependency_unavailable", "Skill catalog is unavailable", true) }
  if (error.code === Code.NotFound || error.code === Code.PermissionDenied) return { status: 404, body: failure("skill_not_found", "Skill was not found") }
  if (error.code === Code.AlreadyExists) return { status: 409, body: failure("skill_idempotency_conflict", "Skill command conflicts with an existing command") }
  if (error.code === Code.Aborted) return { status: 409, body: failure("skill_command_in_progress", "Skill command is already in progress", true) }
  if (error.code === Code.FailedPrecondition) return { status: 412, body: failure("skill_precondition_failed", "Skill upload precondition failed") }
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
  return { status: 502, body: failure("skill_response_invalid", "Skill catalog returned an invalid completion") }
}

function project(result: Awaited<ReturnType<CatalogConnectClient["completePackageUpload"]>>, skillId: string, input: CompleteSkillPackageInput) {
  if (typeof result !== "object" || result === null) throw new Error("skill_response_invalid")
  const scan = new Map([
    [SkillPackageScanState.CLEAN, "clean"],
    [SkillPackageScanState.PENDING, "pending"],
    [SkillPackageScanState.UNKNOWN, "unknown"],
  ]).get(result.scanState)
  if (
    result.skillId?.value !== skillId ||
    typeof result.attemptId !== "string" ||
    result.attemptId !== input.attemptId ||
    !ID.test(result.attemptId) ||
    typeof result.uploadId !== "string" ||
    result.uploadId !== input.uploadId ||
    !ID.test(result.uploadId) ||
    typeof result.assetId !== "string" ||
    !ID.test(result.assetId) ||
    typeof result.attemptEpoch !== "bigint" ||
    result.attemptEpoch < 1n ||
    result.attemptEpoch > MAX_EPOCH ||
    result.phase !== SkillPackagePhase.UPLOADED ||
    typeof result.replayed !== "boolean" ||
    typeof result.contentSha256 !== "string" ||
    result.contentSha256 !== input.contentSha256 ||
    scan === undefined
  )
    throw new Error("skill_response_invalid")
  return {
    skill_id: skillId,
    attempt_id: result.attemptId,
    attempt_epoch: result.attemptEpoch.toString(),
    upload_id: result.uploadId,
    phase: "uploaded",
    replayed: result.replayed,
    content_sha256: result.contentSha256,
    scan_state: scan,
  }
}

export async function completeSkillPackageUploadRoute(
  request: IncomingMessage,
  response: ServerResponse,
  context: RequestContext,
  skillId: string,
  client: CatalogConnectClient | null,
  signal?: AbortSignal,
): Promise<void> {
  response.setHeader("x-request-id", context.requestId)
  response.setHeader("cache-control", "no-store")
  if (request.method !== "POST" || request.url !== `/v1/skills/${skillId}/package-upload/complete` || !ID.test(skillId)) {
    send(response, 400, failure("invalid_skill_request", "Skill package Complete request is invalid"))
    return
  }
  if (client === null) {
    send(response, 503, failure("skill_dependency_unavailable", "Skill package Complete candidate is unavailable", true))
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
  if (
    request.headers["content-type"]?.toLowerCase().split(";", 1)[0]?.trim() !== "application/json" ||
    request.rawHeaders.filter((name, index) => index % 2 === 0 && name.toLowerCase() === "content-type").length !== 1
  ) {
    send(response, 400, failure("invalid_skill_request", "Content-Type must be application/json"))
    return
  }
  let input: CompleteSkillPackageInput
  try {
    input = parseCompleteSkillPackageInput(await readBody(request, 65_536))
  } catch (error) {
    const oversized = error instanceof Error && ["request_body_too_large", "request body too large"].includes(error.message)
    send(response, oversized ? 413 : 400, failure(oversized ? "request_body_too_large" : "invalid_skill_request", "Skill package Complete request is invalid"))
    return
  }
  const raw = JSON.stringify({
    command_digest_version: "3.0.0",
    fq_method: "kokoro.platform.v1.SkillCatalogService/CompleteSkillPackageUpload",
    tenant_ref: context.identity.namespace,
    request: {
      skill_id: { value: skillId },
      product_context: { subject_id: context.identity.userId, owner_scope: { kind: "user", id: context.identity.userId } },
      attempt_id: input.attemptId,
      upload_id: input.uploadId,
      content_sha256: input.contentSha256,
      size_bytes: input.sizeBytes,
    },
  })
  let digest: string
  try {
    digest = projectCompleteSkillPackage(raw, true).sha256
  } catch {
    send(response, 400, failure("invalid_skill_request", "Skill package Complete request is invalid"))
    return
  }
  try {
    const owner = await client.completePackageUpload(
      {
        requestId: context.requestId,
        commandId: completeSkillPackageCommandId(context.identity.namespace, context.identity.userId, skillId, key as string),
        digest,
        tenant: context.identity.namespace,
        user: context.identity.userId,
        skillId,
        ...input,
      },
      signal,
    )
    send(response, 200, { data: project(owner, skillId, input) })
  } catch (error) {
    if (response.destroyed) return
    const mapped = mapFailure(error)
    send(response, mapped.status, mapped.body, mapped.retryAfter)
  }
}
