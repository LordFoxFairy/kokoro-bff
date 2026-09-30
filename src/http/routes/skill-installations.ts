import type { IncomingMessage, ServerResponse } from "node:http"
import { Code, ConnectError } from "@connectrpc/connect"
import type { RequestContext } from "../../domain/request-context.js"
import type { PersonalInstallationConnectClient } from "../../infrastructure/clients/platform/personal-installation-connect.js"
import { installPersonalDigest, removePersonalDigest, setPersonalEnabledDigest } from "../../infrastructure/clients/platform/personal-installation-projector.js"
import { projectInstallation, projectInstallationAck, projectInstallationList } from "../../infrastructure/clients/platform/personal-installation-response.js"
import {
  exactIdempotencyKey,
  exactInstallationId,
  installationCommandId,
  parseEnabledInput,
  parseInstallInput,
  parseInstallationList,
} from "../skill-installation-input.js"
import { readBody } from "../request.js"
import { send } from "../response.js"
const failure = (code: string, message: string, retryable = false) => ({
  error: { code, message, retryable },
})
function idempotencyKey(request: IncomingMessage): string {
  const count = request.rawHeaders.filter((value, index) => index % 2 === 0 && value.toLowerCase() === "idempotency-key").length
  if (count !== 1) throw new Error("skill_installation_idempotency_key_required")
  return exactIdempotencyKey(request.headers["idempotency-key"])
}
function mapped(error: unknown) {
  if (!(error instanceof ConnectError))
    return error instanceof Error && error.message === "skill_installation_response_invalid"
      ? {
          status: 502,
          body: failure("skill_installation_response_invalid", "Skill installation owner returned an invalid response"),
        }
      : {
          status: 503,
          body: failure("skill_installation_dependency_unavailable", "Skill installation owner is unavailable", true),
        }
  if (error.code === Code.NotFound)
    return {
      status: 404,
      body: failure("skill_installation_not_found", "Skill installation was not found"),
    }
  if (error.code === Code.PermissionDenied)
    return {
      status: 403,
      body: failure("skill_installation_forbidden", "Skill installation operation is forbidden"),
    }
  if (error.code === Code.AlreadyExists)
    return {
      status: 409,
      body: failure("skill_installation_idempotency_conflict", "Skill installation command conflicts"),
    }
  if (error.code === Code.Aborted)
    return {
      status: 409,
      body: failure("skill_installation_command_in_progress", "Skill installation command is in progress", true),
    }
  if (error.code === Code.FailedPrecondition)
    return {
      status: 412,
      body: failure("skill_installation_precondition_failed", "Skill installation precondition failed"),
    }
  if (error.code === Code.ResourceExhausted)
    return {
      status: 429,
      body: failure("skill_installation_rate_limited", "Skill installation was rate limited", true),
      retryAfter: error.metadata.get("retry-after"),
    }
  if (error.code === Code.DeadlineExceeded)
    return {
      status: 504,
      body: failure("skill_installation_dependency_timeout", "Skill installation owner timed out", true),
    }
  if ([Code.Unavailable, Code.Canceled, Code.Unauthenticated].includes(error.code))
    return {
      status: 503,
      body: failure("skill_installation_dependency_unavailable", "Skill installation owner is unavailable", true),
    }
  return {
    status: 502,
    body: failure("skill_installation_response_invalid", "Skill installation owner returned an invalid response"),
  }
}
export async function skillInstallationRoute(
  request: IncomingMessage,
  response: ServerResponse,
  context: RequestContext,
  path: string[],
  client: PersonalInstallationConnectClient | null,
  signal?: AbortSignal,
): Promise<boolean> {
  if (path[0] !== "skill-installations") return false
  response.setHeader("x-request-id", context.requestId)
  response.setHeader("cache-control", "no-store")
  if (client === null) {
    send(response, 503, failure("skill_installation_dependency_unavailable", "Skill installation owner is unavailable", true))
    return true
  }
  try {
    const common = {
      requestId: context.requestId,
      tenant: context.identity.namespace,
      subject: context.identity.userId,
    }
    if (path.length === 1 && request.method === "POST") {
      if (new URL(request.url ?? "", "http://bff.local").search) throw new Error("invalid_skill_installation_request")
      const input = parseInstallInput(await readBody(request, 65_536)),
        key = idempotencyKey(request)
      const commandId = installationCommandId("install", common.tenant, common.subject, input.sourceRef, key)
      const result = await client.install(
        {
          ...common,
          ...input,
          commandId,
          digest: installPersonalDigest(common.tenant, common.subject, input.sourceRef),
        },
        signal,
      )
      send(response, 200, { data: projectInstallationAck(result) })
      return true
    }
    if (path.length === 1 && request.method === "GET") {
      if (request.headers["idempotency-key"] !== undefined || (await readBody(request, 1)).length) throw new Error("invalid_skill_installation_request")
      const input = parseInstallationList(request.url ?? "")
      const result = await client.list({ ...common, ...input }, signal)
      send(response, 200, projectInstallationList(result))
      return true
    }
    const id = exactInstallationId(path[1] ?? "")
    if (path.length === 2 && request.method === "GET") {
      if (new URL(request.url ?? "", "http://bff.local").search || request.headers["idempotency-key"] !== undefined || (await readBody(request, 1)).length)
        throw new Error("invalid_skill_installation_request")
      const result = await client.get({ ...common, installationId: id }, signal)
      send(response, 200, { data: projectInstallation(result.installation) })
      return true
    }
    if (path.length === 2 && request.method === "DELETE") {
      if (new URL(request.url ?? "", "http://bff.local").search) throw new Error("invalid_skill_installation_request")
      const key = idempotencyKey(request)
      if ((await readBody(request, 1)).length) throw new Error("invalid_skill_installation_request")
      const commandId = installationCommandId("remove", common.tenant, common.subject, id, key)
      const result = await client.remove(
        {
          ...common,
          installationId: id,
          commandId,
          digest: removePersonalDigest(common.tenant, common.subject, id),
        },
        signal,
      )
      send(response, 200, { data: projectInstallationAck(result) })
      return true
    }
    if (path.length === 3 && path[2] === "enabled" && request.method === "PUT") {
      if (new URL(request.url ?? "", "http://bff.local").search) throw new Error("invalid_skill_installation_request")
      const key = idempotencyKey(request),
        input = parseEnabledInput(await readBody(request, 65_536))
      const commandId = installationCommandId("set-enabled", common.tenant, common.subject, id, key)
      const result = await client.setEnabled(
        {
          ...common,
          installationId: id,
          ...input,
          commandId,
          digest: setPersonalEnabledDigest(common.tenant, common.subject, id, input.enabled),
        },
        signal,
      )
      send(response, 200, { data: projectInstallationAck(result) })
      return true
    }
    send(response, 404, failure("bff_route_not_found", "Business route was not found"))
    return true
  } catch (error) {
    if (response.destroyed) return true
    if (
      error instanceof Error &&
      ["invalid_skill_installation_request", "skill_installation_idempotency_key_required", "request_body_too_large", "request body too large"].includes(
        error.message,
      )
    ) {
      const oversized = error.message === "request_body_too_large" || error.message === "request body too large"
      send(response, oversized ? 413 : 400, failure(oversized ? "request_body_too_large" : error.message, "Skill installation request is invalid"))
      return true
    }
    const value = mapped(error)
    send(response, value.status, value.body, value.retryAfter ?? undefined)
    return true
  }
}
