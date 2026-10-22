import { createHash } from "node:crypto"
import type { IncomingMessage, ServerResponse } from "node:http"
import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import type { CatalogConnectClient } from "../../infrastructure/clients/platform/catalog-connect.js"
import { projectDeletePersonalSkillSeries } from "../../infrastructure/clients/platform/delete-personal-skill-series-projector.js"
import { assertSkillWireKnown, projectSkillStateVersion } from "../../infrastructure/clients/platform/skill-product-response.js"
import { parseSkillProductInput, skillIdSchema } from "../skill-product-input.js"
import { queryOf, requestContentType } from "../request.js"
import {
  lifecycleError,
  readPersonalSkillLifecycleBody,
  replyPersonalSkillLifecycle,
  withPersonalSkillLifecycle,
  personalSkillLifecycleFailure,
} from "./personal-skill-lifecycle.js"

const count = (request: IncomingMessage, name: string) => request.rawHeaders.filter((value, index) => index % 2 === 0 && value.toLowerCase() === name).length
export async function deletePersonalSkillSeriesRoute(
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
    const match = /^\/v1\/self\/skills\/([^/]+)$/u.exec(rawPath)
    if (
      match === null ||
      decodeURIComponent(match[1] ?? "") !== skillId ||
      !skillIdSchema.safeParse(skillId).success ||
      queryOf(request).size !== 0 ||
      request.headers["transfer-encoding"] !== undefined ||
      count(request, "content-type") !== 1 ||
      requestContentType(request).split(";", 1)[0]?.trim() !== "application/json"
    ) {
      replyPersonalSkillLifecycle(response, scope, requestId, 400, lifecycleError(requestId, "invalid_skill_request", "Skill deletion request is invalid"))
      return
    }
    const key = request.headers["idempotency-key"]
    if (count(request, "idempotency-key") !== 1 || typeof key !== "string" || !/^[\x21-\x2B\x2D-\x7E]{1,128}$/u.test(key)) {
      replyPersonalSkillLifecycle(
        response,
        scope,
        requestId,
        400,
        lifecycleError(requestId, key === undefined ? "idempotency_key_required" : "invalid_idempotency_key", "A single valid Idempotency-Key is required"),
      )
      return
    }
    let body
    try {
      body = parseSkillProductInput("deleteSeries", await readPersonalSkillLifecycleBody(request, scope.signal))
      scope.active()
    } catch (error) {
      const large = error instanceof Error && error.message === "request_body_too_large"
      replyPersonalSkillLifecycle(
        response,
        scope,
        requestId,
        large ? 413 : 400,
        lifecycleError(requestId, large ? "request_body_too_large" : "invalid_skill_request", "Skill deletion confirmation is invalid"),
      )
      return
    }
    if (client === null) {
      replyPersonalSkillLifecycle(
        response,
        scope,
        requestId,
        503,
        lifecycleError(requestId, "skill_dependency_unavailable", "Skill deletion dependency is unavailable"),
      )
      return
    }
    const input = {
      tenant: scope.context.identity.namespace,
      user: scope.context.identity.userId,
      skillId,
      expectedStateVersion: body.expected_state_version,
      expectedPublication: body.expected_publication,
    }
    const commandId = `bff.skill.delete-series.v1.${createHash("sha256")
      .update(JSON.stringify([input.tenant, input.user, skillId, key]))
      .digest("hex")}`
    try {
      const result = await client.deletePersonalSeries(
        { ...input, requestId, commandId, digest: projectDeletePersonalSkillSeries(input).sha256 },
        scope.signal,
        scope.deadlineAt,
      )
      scope.active()
      assertSkillWireKnown(result)
      if (
        result.skillId?.value !== skillId ||
        !skillIdSchema.safeParse(result.seriesId?.value).success ||
        result.stateVersion !== BigInt(body.expected_state_version) + 1n ||
        !/^evt:[a-f0-9]{64}$/u.test(result.eventId) ||
        typeof result.replayed !== "boolean"
      )
        throw new Error("skill_response_invalid")
      replyPersonalSkillLifecycle(response, scope, requestId, 200, {
        data: {
          series_id: result.seriesId!.value,
          skill_id: skillId,
          state_version: projectSkillStateVersion(result.stateVersion),
          status: "deleted",
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
        lifecycleError(requestId, failure.code, "Skill deletion command was not confirmed"),
        failure.retryAfter,
      )
    }
  })
}
