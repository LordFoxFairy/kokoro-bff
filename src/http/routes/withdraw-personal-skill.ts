import { assertSkillWireKnown, projectSkillStateVersion } from "../../infrastructure/clients/platform/skill-product-response.js"
import type { IncomingMessage, ServerResponse } from "node:http"
import { SkillStatus } from "../../generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js"

import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import type { CatalogConnectClient } from "../../infrastructure/clients/platform/catalog-connect.js"
import { projectWithdrawPersonalSkill } from "../../infrastructure/clients/platform/withdraw-personal-skill-projector.js"
import { parseWithdrawPersonalSkillInput, withdrawPersonalSkillCommandId } from "../withdraw-personal-skill-input.js"
import { queryOf, requestContentType } from "../request.js"
import {
  lifecycleError,
  readPersonalSkillLifecycleBody,
  replyPersonalSkillLifecycle,
  withPersonalSkillLifecycle,
  personalSkillLifecycleFailure,
} from "./personal-skill-lifecycle.js"

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u
const KEY = /^[\x21-\x2B\x2D-\x7E]{1,128}$/u
const EVENT = /^evt:[a-f0-9]{64}$/u
const hasUnknownFields = (value: { $unknown?: readonly unknown[] | undefined } | undefined): boolean => (value?.$unknown?.length ?? 0) !== 0
const rawCount = (request: IncomingMessage, name: string): number =>
  request.rawHeaders.filter((value, index) => index % 2 === 0 && value.toLowerCase() === name).length
const rawValue = (request: IncomingMessage, name: string): string | undefined => {
  const index = request.rawHeaders.findIndex((value, offset) => offset % 2 === 0 && value.toLowerCase() === name)
  return index < 0 ? undefined : request.rawHeaders[index + 1]
}

export async function withdrawPersonalSkillRoute(
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
    const rawMatch = /^\/v1\/self\/skills\/([^/]+)\/withdraw$/u.exec(rawPath)
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
      input = parseWithdrawPersonalSkillInput(await readPersonalSkillLifecycleBody(request, scope.signal))
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
      fq_method: "kokoro.platform.v1.SkillCatalogService/WithdrawSkill",
      tenant_ref: scope.context.identity.namespace,
      request: {
        expected_state_version: input.expectedStateVersion,
        source_ref: { value: `skill:${skillId}` },
        reason: input.reason,
        product_context: {
          subject_id: scope.context.identity.userId,
          owner_scope: { kind: "user", id: scope.context.identity.userId },
        },
      },
    })
    try {
      const digest = projectWithdrawPersonalSkill(raw, true).sha256
      const result = await client.withdrawPersonal(
        {
          requestId,
          commandId: withdrawPersonalSkillCommandId(scope.context.identity.namespace, scope.context.identity.userId, skillId, key as string),
          digest,
          tenant: scope.context.identity.namespace,
          user: scope.context.identity.userId,
          skillId,
          reason: input.reason,
          expectedStateVersion: input.expectedStateVersion,
        },
        scope.signal,
        scope.deadlineAt,
      )
      scope.active()
      assertSkillWireKnown(result)
      projectSkillStateVersion(result.stateVersion)
      if (
        hasUnknownFields(result) ||
        hasUnknownFields(result.sourceRef) ||
        result.sourceRef?.value !== `skill:${skillId}` ||
        result.status !== SkillStatus.WITHDRAWN ||
        !EVENT.test(result.eventId) ||
        typeof result.replayed !== "boolean"
      )
        throw new Error("skill_response_invalid")
      replyPersonalSkillLifecycle(response, scope, requestId, 200, {
        data: {
          state_version: projectSkillStateVersion(result.stateVersion),
          source_ref: result.sourceRef.value,
          status: "withdrawn",
          event_id: result.eventId,
          replayed: result.replayed,
        },
        meta: { request_id: requestId },
      })
    } catch (error) {
      const failure = personalSkillLifecycleFailure(error)
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
