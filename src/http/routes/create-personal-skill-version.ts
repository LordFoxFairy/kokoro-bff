import type { IncomingMessage, ServerResponse } from "node:http"
import { Code, ConnectError } from "@connectrpc/connect"
import { SkillStatus } from "../../generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js"

import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import type { CatalogConnectClient } from "../../infrastructure/clients/platform/catalog-connect.js"
import { projectCreatePersonalSkillVersion } from "../../infrastructure/clients/platform/create-personal-skill-version-projector.js"
import { createPersonalSkillVersionCommandId, parseCreatePersonalSkillVersionInput } from "../create-personal-skill-version-input.js"
import { queryOf, requestContentType } from "../request.js"
import { lifecycleError, readPersonalSkillLifecycleBody, replyPersonalSkillLifecycle, withPersonalSkillLifecycle } from "./personal-skill-lifecycle.js"

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u
const KEY = /^[\x21-\x2B\x2D-\x7E]{1,128}$/u
const MAX_REVISION = 18_446_744_073_709_551_615n
const hasUnknownFields = (value: { $unknown?: readonly unknown[] | undefined } | undefined): boolean => (value?.$unknown?.length ?? 0) !== 0
const rawCount = (request: IncomingMessage, name: string): number =>
  request.rawHeaders.filter((value, index) => index % 2 === 0 && value.toLowerCase() === name).length
const rawValue = (request: IncomingMessage, name: string): string | undefined => {
  const index = request.rawHeaders.findIndex((value, offset) => offset % 2 === 0 && value.toLowerCase() === name)
  return index < 0 ? undefined : request.rawHeaders[index + 1]
}

function mapped(error: unknown): {
  status: number
  code: string
  retryAfter?: string
} {
  if (!(error instanceof ConnectError))
    return error instanceof Error && error.message === "skill_response_invalid"
      ? { status: 502, code: "skill_response_invalid" }
      : { status: 503, code: "skill_dependency_unavailable" }
  if (error.code === Code.NotFound || error.code === Code.PermissionDenied) return { status: 404, code: "skill_not_found" }
  if (error.code === Code.AlreadyExists) return { status: 409, code: "skill_idempotency_conflict" }
  if (error.code === Code.Aborted) return { status: 409, code: "skill_command_in_progress" }
  if (error.code === Code.FailedPrecondition) return { status: 412, code: "skill_precondition_failed" }
  if (error.code === Code.ResourceExhausted) {
    const retryAfter = error.metadata.get("retry-after")
    return /^(?:[1-9][0-9]{0,3}|[1-7][0-9]{4}|8[0-5][0-9]{3}|86[0-3][0-9]{2}|86400)$/u.test(retryAfter ?? "")
      ? {
          status: 429,
          code: "skill_rate_limited",
          retryAfter: retryAfter as string,
        }
      : { status: 502, code: "skill_response_invalid" }
  }
  if ([Code.Unavailable, Code.DeadlineExceeded, Code.Canceled, Code.Unauthenticated].includes(error.code))
    return { status: 503, code: "skill_dependency_unavailable" }
  return { status: 502, code: "skill_response_invalid" }
}

export async function createPersonalSkillVersionRoute(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  admission: SessionAdmission,
  requestId: string,
  skillId: string,
  client: CatalogConnectClient | null,
): Promise<void> {
  await withPersonalSkillLifecycle(request, response, config, admission, requestId, async (scope) => {
    const rawPath = (request.url ?? "").split("?", 1)[0] ?? ""
    const rawMatch = /^\/v1\/self\/skills\/([^/]+)\/versions$/u.exec(rawPath)
    if (
      rawMatch === null ||
      decodeURIComponent(rawMatch[1] ?? "") !== skillId ||
      !ID.test(skillId) ||
      queryOf(request).size !== 0 ||
      request.headers["transfer-encoding"] !== undefined ||
      rawCount(request, "content-type") !== 1
    ) {
      replyPersonalSkillLifecycle(response, scope, requestId, 400, lifecycleError(requestId, "invalid_skill_request", "Skill lifecycle request is invalid"))
      return
    }
    const key = rawValue(request, "idempotency-key")
    if (rawCount(request, "idempotency-key") !== 1 || !KEY.test(key ?? "")) {
      const code = key === undefined ? "idempotency_key_required" : "invalid_idempotency_key"
      replyPersonalSkillLifecycle(response, scope, requestId, 400, lifecycleError(requestId, code, "A single valid Idempotency-Key is required"))
      return
    }
    if (requestContentType(request).split(";", 1)[0]?.trim() !== "application/json") {
      replyPersonalSkillLifecycle(response, scope, requestId, 400, lifecycleError(requestId, "invalid_skill_request", "Skill lifecycle request is invalid"))
      return
    }
    let input
    try {
      input = parseCreatePersonalSkillVersionInput(await readPersonalSkillLifecycleBody(request, scope.signal))
      scope.active()
    } catch (error) {
      const large = error instanceof Error && error.message === "request_body_too_large"
      replyPersonalSkillLifecycle(
        response,
        scope,
        requestId,
        large ? 413 : 400,
        lifecycleError(requestId, large ? "request_body_too_large" : "invalid_skill_request", "Skill lifecycle request is invalid"),
      )
      return
    }
    if (client === null) {
      replyPersonalSkillLifecycle(
        response,
        scope,
        requestId,
        503,
        lifecycleError(requestId, "skill_dependency_unavailable", "Skill lifecycle dependency is unavailable"),
      )
      return
    }
    const raw = JSON.stringify({
      command_digest_version: "3.0.0",
      fq_method: "kokoro.platform.v1.SkillCatalogService/CreateSkillVersion",
      tenant_ref: scope.context.identity.namespace,
      request: {
        owner_scope: { kind: "user", id: scope.context.identity.userId },
        base_skill_id: { value: skillId },
        metadata: {
          display_name: input.displayName,
          summary: input.summary,
          tags: input.tags,
          metadata_json: "e30",
        },
        product_context: {
          subject_id: scope.context.identity.userId,
          owner_scope: { kind: "user", id: scope.context.identity.userId },
        },
      },
    })
    try {
      const digest = projectCreatePersonalSkillVersion(raw, true).sha256
      const result = await client.createPersonalVersion(
        {
          requestId,
          commandId: createPersonalSkillVersionCommandId(scope.context.identity.namespace, scope.context.identity.userId, skillId, key as string),
          digest,
          tenant: scope.context.identity.namespace,
          user: scope.context.identity.userId,
          baseSkillId: skillId,
          ...input,
        },
        scope.signal,
        scope.deadlineAt,
      )
      scope.active()
      if (
        hasUnknownFields(result) ||
        hasUnknownFields(result.skillId) ||
        hasUnknownFields(result.seriesId) ||
        !result.skillId?.value ||
        !ID.test(result.skillId.value) ||
        result.skillId.value === skillId ||
        !result.seriesId?.value ||
        !ID.test(result.seriesId.value) ||
        result.revision < 2n ||
        result.revision > MAX_REVISION ||
        result.status !== SkillStatus.DRAFT ||
        typeof result.replayed !== "boolean"
      )
        throw new Error("skill_response_invalid")
      replyPersonalSkillLifecycle(response, scope, requestId, 201, {
        data: {
          skill_id: result.skillId.value,
          series_id: result.seriesId.value,
          revision: result.revision.toString(),
          status: "draft",
          replayed: result.replayed,
        },
        meta: { request_id: requestId },
      })
    } catch (error) {
      const failure = mapped(error)
      replyPersonalSkillLifecycle(
        response,
        scope,
        requestId,
        failure.status,
        lifecycleError(
          requestId,
          failure.code,
          failure.status === 404 ? "Skill was not found" : failure.status === 502 ? "Skill owner response is invalid" : "Skill lifecycle command failed",
        ),
        failure.retryAfter,
      )
    }
  })
}
