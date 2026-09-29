import type { IncomingMessage, ServerResponse } from "node:http"
import { Code, ConnectError } from "@connectrpc/connect"

import type { RequestContext } from "../../domain/request-context.js"
import type { CatalogConnectClient } from "../../infrastructure/clients/platform/catalog-connect.js"
import { projectBeginSkillPackage } from "../../infrastructure/clients/platform/begin-skill-package-projector.js"
import { beginSkillPackageCommandId, parseBeginSkillPackageInput } from "../begin-skill-package-input.js"
import { readBody } from "../request.js"
import { send } from "../response.js"

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u
const KEY = /^[\x21-\x2B\x2D-\x7E]{1,128}$/u
const MAX_EPOCH = 18_446_744_073_709_551_615n
const failure = (code: string, message: string, retryable = false) => ({ error: { code, message, retryable } })
function mapFailure(error: unknown): { status: number; body: ReturnType<typeof failure>; retryAfter?: string } {
  if (!(error instanceof ConnectError))
    return error instanceof Error && error.message === "skill_response_invalid"
      ? { status: 502, body: failure("skill_response_invalid", "Skill catalog returned an invalid upload reference") }
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
  return { status: 502, body: failure("skill_response_invalid", "Skill catalog returned an invalid upload reference") }
}

function project(result: Awaited<ReturnType<CatalogConnectClient["beginPackageUpload"]>>, skillId: string, approvedOrigin: string) {
  if (typeof result !== "object" || result === null) throw new Error("skill_response_invalid")
  const reference = result.transferReference
  const now = Date.now()
  let url: URL
  try {
    url = new URL(reference?.url ?? "")
  } catch {
    throw new Error("skill_response_invalid")
  }
  let origin: URL
  try {
    origin = new URL(approvedOrigin)
  } catch {
    throw new Error("skill_response_invalid")
  }
  const localHttp = origin.protocol === "http:" && ["127.0.0.1", "::1", "localhost", "[::1]"].includes(origin.hostname)
  const expiresAt = reference?.expiresAt
  const seconds = expiresAt?.seconds
  const nanos = expiresAt?.nanos
  const expiryMs =
    typeof seconds === "bigint" && typeof nanos === "number" && Number.isInteger(nanos) && nanos >= 0 && nanos < 1_000_000_000
      ? Number(seconds) * 1000 + Math.floor(nanos / 1_000_000)
      : NaN
  if (
    result.skillId?.value !== skillId ||
    typeof result.attemptId !== "string" ||
    !ID.test(result.attemptId) ||
    typeof result.uploadId !== "string" ||
    !ID.test(result.uploadId) ||
    typeof result.attemptEpoch !== "bigint" ||
    result.attemptEpoch < 1n ||
    result.attemptEpoch > MAX_EPOCH ||
    typeof result.replayed !== "boolean" ||
    reference == null ||
    typeof reference.url !== "string" ||
    !/^https?:\/\//u.test(reference.url) ||
    /[\u0000-\u001f\u007f]/u.test(reference.url) ||
    url.origin !== origin.origin ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== "" ||
    (origin.protocol !== "https:" && !localHttp) ||
    reference.method !== "PUT" ||
    typeof reference.requiredHeaders !== "object" ||
    reference.requiredHeaders === null ||
    Array.isArray(reference.requiredHeaders) ||
    Object.keys(reference.requiredHeaders).length !== 1 ||
    reference.requiredHeaders["content-type"] !== "application/zip" ||
    !Number.isFinite(expiryMs) ||
    expiryMs <= now ||
    expiryMs > now + 900_000
  )
    throw new Error("skill_response_invalid")
  return {
    skill_id: skillId,
    attempt_id: result.attemptId,
    attempt_epoch: result.attemptEpoch.toString(),
    upload_id: result.uploadId,
    transfer_reference: {
      url: reference.url,
      method: reference.method,
      required_headers: reference.requiredHeaders,
      expires_at: new Date(expiryMs).toISOString(),
    },
    replayed: result.replayed,
  }
}

export async function beginSkillPackageUploadRoute(
  request: IncomingMessage,
  response: ServerResponse,
  context: RequestContext,
  skillId: string,
  client: CatalogConnectClient | null,
  approvedOrigin: string | null,
  signal?: AbortSignal,
): Promise<void> {
  response.setHeader("x-request-id", context.requestId)
  response.setHeader("cache-control", "no-store")
  if (request.method !== "POST" || request.url !== `/v1/skills/${skillId}/package-upload` || !ID.test(skillId)) {
    send(response, 400, failure("invalid_skill_request", "Skill package Begin request is invalid"))
    return
  }
  if (client === null || approvedOrigin === null) {
    send(response, 503, failure("skill_dependency_unavailable", "Skill package Begin candidate is unavailable", true))
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
  let input
  try {
    input = parseBeginSkillPackageInput(await readBody(request, 65_536))
  } catch (error) {
    const oversized = error instanceof Error && ["request_body_too_large", "request body too large"].includes(error.message)
    send(response, oversized ? 413 : 400, failure(oversized ? "request_body_too_large" : "invalid_skill_request", "Skill package Begin request is invalid"))
    return
  }
  const raw = JSON.stringify({
    command_digest_version: "3.0.0",
    fq_method: "kokoro.platform.v1.SkillCatalogService/BeginSkillPackageUpload",
    tenant_ref: context.identity.namespace,
    request: {
      skill_id: { value: skillId },
      product_context: { subject_id: context.identity.userId, owner_scope: { kind: "user", id: context.identity.userId } },
      filename: input.filename,
      mime_type: input.mimeType,
      size_bytes: input.sizeBytes,
      content_sha256: input.contentSha256,
      ...(input.replacesAttemptId === undefined ? {} : { replaces_attempt_id: input.replacesAttemptId }),
    },
  })
  let digest: string
  try {
    digest = projectBeginSkillPackage(raw, true).sha256
  } catch {
    send(response, 400, failure("invalid_skill_request", "Skill package Begin request is invalid"))
    return
  }
  try {
    const owner = await client.beginPackageUpload(
      {
        requestId: context.requestId,
        commandId: beginSkillPackageCommandId(context.identity.namespace, context.identity.userId, skillId, key as string),
        digest,
        tenant: context.identity.namespace,
        user: context.identity.userId,
        skillId,
        ...input,
      },
      signal,
    )
    send(response, 201, { data: project(owner, skillId, approvedOrigin) })
  } catch (error) {
    if (response.destroyed) return
    const mapped = mapFailure(error)
    send(response, mapped.status, mapped.body, mapped.retryAfter)
  }
}
