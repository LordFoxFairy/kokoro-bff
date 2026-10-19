import { Code, ConnectError } from "@connectrpc/connect"
import type { IncomingMessage, ServerResponse } from "node:http"

import { authorizeUserRequest } from "../../auth/user-admission.js"
import type { BffServerComposition } from "../../bootstrap/runtime.js"
import type { BffConfig } from "../../config/runtime.js"
import { strictParseRawJson } from "../../infrastructure/raw-json.js"
import { setSkillEnabledDigest } from "../../infrastructure/clients/platform/skill-installation-projector.js"
import { projectInstallationAck } from "../../infrastructure/clients/platform/skill-installation-response.js"
import { exactIdempotencyKey, installationCommandId } from "../skill-installation-input.js"
import { send } from "../response.js"
import { setSkillInstallationEnabledRequestSchema } from "../skill-specification-schema.js"
import { readSkillBody, skillRequestRemaining, startSkillRequestBudget } from "./skill-drafts.js"

const path = "/skill.v1.SkillOptionalService/SetSkillInstallationEnabled"

function idempotencyKey(request: IncomingMessage): string {
  const values = request.rawHeaders.flatMap((name, index) =>
    index % 2 === 0 && name.toLowerCase() === "idempotency-key" ? [request.rawHeaders[index + 1] ?? ""] : [],
  )
  if (values.length !== 1) throw new Error("skill_installation_idempotency_key_required")
  return exactIdempotencyKey(values[0])
}

function failure(code: string, message: string, retryable = false) {
  return { error: { code, message, retryable } }
}

function mapped(error: unknown): Readonly<{ status: number; body: ReturnType<typeof failure>; retryAfter?: string }> {
  if (!(error instanceof ConnectError)) {
    if (error instanceof Error && error.message === "skill_installation_response_invalid")
      return { status: 502, body: failure("skill_installation_response_invalid", "Skill installation owner returned an invalid response") }
    return { status: 503, body: failure("skill_installation_dependency_unavailable", "Skill installation owner is unavailable", true) }
  }
  if (error.code === Code.InvalidArgument) return { status: 400, body: failure("invalid_skill_installation_request", "Skill installation request is invalid") }
  if (error.code === Code.NotFound) return { status: 404, body: failure("skill_installation_not_found", "Skill installation was not found") }
  if (error.code === Code.PermissionDenied) return { status: 403, body: failure("skill_installation_forbidden", "Skill installation operation is forbidden") }
  if (error.code === Code.AlreadyExists)
    return { status: 409, body: failure("skill_installation_idempotency_conflict", "Skill installation command conflicts") }
  if (error.code === Code.Aborted)
    return { status: 409, body: failure("skill_installation_command_in_progress", "Skill installation command is in progress", true) }
  if (error.code === Code.FailedPrecondition)
    return { status: 412, body: failure("skill_installation_precondition_failed", "Skill installation precondition failed") }
  if (error.code === Code.ResourceExhausted) {
    const retryAfter = error.metadata.get("retry-after")
    return {
      status: 429,
      body: failure("skill_installation_rate_limited", "Skill installation was rate limited", true),
      ...(retryAfter === null ? {} : { retryAfter }),
    }
  }
  if (error.code === Code.DeadlineExceeded)
    return { status: 504, body: failure("skill_installation_dependency_timeout", "Skill installation owner timed out", true) }
  if ([Code.Unavailable, Code.Canceled, Code.Unauthenticated].includes(error.code))
    return { status: 503, body: failure("skill_installation_dependency_unavailable", "Skill installation owner is unavailable", true) }
  return { status: 502, body: failure("skill_installation_response_invalid", "Skill installation owner returned an invalid response") }
}

/** Browser-private Manus command: only owner-issued installation identities are mutable. */
export async function skillSpecificationEnabledRoute(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  composition: BffServerComposition,
  requestId: string,
  pathname: string,
): Promise<boolean> {
  if (pathname !== path) return false
  response.setHeader("x-request-id", requestId)
  if (request.method !== "POST") {
    response.setHeader("allow", "POST")
    send(response, 405, failure("method_not_allowed", "Skill installation request method is invalid"))
    return true
  }

  const deadlineAt = startSkillRequestBudget(request)
  const controller = new AbortController()
  const abort = (): void => controller.abort(new Error("skill_installation_deadline"))
  request.once("aborted", abort)
  response.once("close", abort)
  const timer = setTimeout(abort, Math.max(0, skillRequestRemaining(request)))
  const within = <T>(work: Promise<T>): Promise<T> => {
    if (controller.signal.aborted) return Promise.reject(controller.signal.reason)
    return new Promise<T>((resolve, reject) => {
      const cancelled = () => reject(controller.signal.reason)
      controller.signal.addEventListener("abort", cancelled, { once: true })
      work.then(resolve, reject).finally(() => controller.signal.removeEventListener("abort", cancelled))
    })
  }

  try {
    if (new URL(request.url ?? "/", "http://bff.local").search || !/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(request.headers["content-type"] ?? ""))
      throw new ConnectError("Skill installation request is invalid", Code.InvalidArgument)
    const key = idempotencyKey(request)
    let input: { installationId: string; enabled: boolean }
    try {
      input = setSkillInstallationEnabledRequestSchema.parse(strictParseRawJson(await within(readSkillBody(request))))
    } catch {
      throw new ConnectError("Skill installation request is invalid", Code.InvalidArgument)
    }
    const admission = await within(authorizeUserRequest(request, config, composition.sessionAdmission, requestId, controller.signal))
    if (!admission.ok) {
      if (admission.retryAfter !== undefined) response.setHeader("retry-after", admission.retryAfter)
      send(
        response,
        admission.status,
        failure(admission.code, "Current user admission is required", admission.status === 429 || admission.status === 503),
        admission.retryAfter,
      )
      return true
    }
    if (composition.installationClient === null) throw new ConnectError("Skill installation owner unavailable", Code.Unavailable)
    if (performance.now() >= deadlineAt) throw new ConnectError("Skill installation deadline exceeded", Code.DeadlineExceeded)
    const tenant = admission.context.identity.namespace
    const subject = admission.context.identity.userId
    const result = await within(
      composition.installationClient.setEnabled(
        {
          requestId,
          tenant,
          subject,
          installationId: input.installationId,
          enabled: input.enabled,
          commandId: installationCommandId("set-enabled", tenant, subject, input.installationId, key),
          digest: setSkillEnabledDigest(tenant, subject, input.installationId, input.enabled),
        },
        controller.signal,
      ),
    )
    if (controller.signal.aborted || performance.now() >= deadlineAt) throw new ConnectError("Skill installation deadline exceeded", Code.DeadlineExceeded)
    send(response, 200, { data: projectInstallationAck(result) })
  } catch (error) {
    if (!request.aborted && !response.destroyed && !response.writableEnded) {
      if (error instanceof Error && error.message === "request_body_too_large")
        send(response, 413, failure("request_body_too_large", "Skill installation request body exceeds the request limit"))
      else if (error instanceof Error && ["skill_installation_idempotency_key_required", "invalid_skill_installation_request"].includes(error.message))
        send(response, 400, failure(error.message, "Skill installation request is invalid"))
      else if (controller.signal.aborted && !(error instanceof ConnectError && error.code === Code.Canceled))
        send(response, 504, failure("skill_installation_dependency_timeout", "Skill installation owner timed out", true))
      else {
        const value = mapped(error)
        send(response, value.status, value.body, value.retryAfter)
      }
    }
  } finally {
    clearTimeout(timer)
    request.removeListener("aborted", abort)
    response.removeListener("close", abort)
  }
  return true
}
