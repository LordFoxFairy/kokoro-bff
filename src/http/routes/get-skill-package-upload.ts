import type { IncomingMessage, ServerResponse } from "node:http"
import { Code, ConnectError } from "@connectrpc/connect"
import { SkillPackagePhase } from "../../generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js"
import type { RequestContext } from "../../domain/request-context.js"
import type { CatalogConnectClient } from "../../infrastructure/clients/platform/catalog-connect.js"
import { send } from "../response.js"

const SKILL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u
const OWNER_ID = SKILL_ID
const MAX_EPOCH = 18_446_744_073_709_551_615n
const failure = (code: string, message: string, retryable = false) => ({ error: { code, message, retryable } })

function catalogFailure(error: unknown): { status: number; body: ReturnType<typeof failure>; retryAfter?: string } {
  if (!(error instanceof ConnectError)) {
    return error instanceof Error && error.message === "skill_response_invalid"
      ? { status: 502, body: failure("skill_response_invalid", "Skill catalog returned an invalid package state") }
      : { status: 503, body: failure("skill_dependency_unavailable", "Skill catalog is unavailable", true) }
  }
  if (error.code === Code.NotFound || error.code === Code.PermissionDenied) return { status: 404, body: failure("skill_not_found", "Skill was not found") }
  if (error.code === Code.FailedPrecondition) return { status: 412, body: failure("skill_precondition_failed", "Skill is not a current draft") }
  if (error.code === Code.ResourceExhausted) {
    const value = error.metadata.get("retry-after")
    return {
      status: 429,
      body: failure("skill_rate_limited", "Skill catalog rate limited the request", true),
      ...(/^[1-9][0-9]{0,4}$/u.test(value ?? "") ? { retryAfter: value as string } : {}),
    }
  }
  if ([Code.Unavailable, Code.DeadlineExceeded, Code.Canceled, Code.Unauthenticated].includes(error.code))
    return { status: 503, body: failure("skill_dependency_unavailable", "Skill catalog is unavailable", true) }
  return { status: 502, body: failure("skill_response_invalid", "Skill catalog returned an invalid package state") }
}

function project(result: Awaited<ReturnType<CatalogConnectClient["getPackageUpload"]>>, skillId: string) {
  const epoch = result.attemptEpoch
  const attempt = result.attemptId
  const upload = result.uploadId
  const phase = new Map([
    [SkillPackagePhase.NONE, "none"],
    [SkillPackagePhase.INTENT, "intent"],
    [SkillPackagePhase.UPLOAD_PENDING, "upload_pending"],
    [SkillPackagePhase.UPLOADED, "uploaded"],
    [SkillPackagePhase.VALIDATED, "validated"],
    [SkillPackagePhase.ABORTED, "aborted"],
  ]).get(result.phase)
  if (
    result.skillId?.value !== skillId ||
    phase === undefined ||
    typeof epoch !== "bigint" ||
    epoch < 0n ||
    epoch > MAX_EPOCH ||
    (attempt !== undefined && !OWNER_ID.test(attempt)) ||
    (upload !== undefined && !OWNER_ID.test(upload)) ||
    (phase === "none" && (epoch !== 0n || attempt !== undefined || upload !== undefined)) ||
    (phase !== "none" && (epoch === 0n || attempt === undefined)) ||
    (phase === "intent" && upload !== undefined) ||
    (["upload_pending", "uploaded", "validated"].includes(phase) && upload === undefined)
  )
    throw new Error("skill_response_invalid")
  return {
    skill_id: skillId,
    attempt_epoch: epoch.toString(),
    phase,
    ...(attempt === undefined ? {} : { attempt_id: attempt }),
    ...(upload === undefined ? {} : { upload_id: upload }),
  }
}

export async function getSkillPackageUploadRoute(
  request: IncomingMessage,
  response: ServerResponse,
  context: RequestContext,
  skillId: string,
  client: CatalogConnectClient | null,
  signal?: AbortSignal,
): Promise<void> {
  response.setHeader("x-request-id", context.requestId)
  response.setHeader("cache-control", "no-store")
  if (
    request.method !== "GET" ||
    request.url !== `/v1/skills/${skillId}/package-upload` ||
    !SKILL_ID.test(skillId) ||
    (request.headers["content-length"] !== undefined && request.headers["content-length"] !== "0") ||
    request.headers["transfer-encoding"] !== undefined ||
    request.rawHeaders.some((name, index) => index % 2 === 0 && name.toLowerCase() === "idempotency-key")
  ) {
    send(response, 400, failure("invalid_skill_request", "Skill package Get request is invalid"))
    return
  }
  if (client === null) {
    send(response, 503, failure("skill_dependency_unavailable", "Skill package Get candidate is unavailable", true))
    return
  }
  try {
    const result = await client.getPackageUpload(
      { requestId: context.requestId, skillId, tenant: context.identity.namespace, user: context.identity.userId },
      signal,
    )
    send(response, 200, { data: project(result, skillId) })
  } catch (error) {
    const mapped = catalogFailure(error)
    send(response, mapped.status, mapped.body, mapped.retryAfter)
  }
}
