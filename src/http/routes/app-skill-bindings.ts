import { createHash } from "node:crypto"
import type { IncomingMessage, ServerResponse } from "node:http"
import type { BffConfig } from "../../config/runtime.js"
import type { BffServerComposition } from "../../bootstrap/runtime.js"
import { bearerToken } from "../../auth/user-admission.js"
import { strictParseRawJson } from "../../infrastructure/raw-json.js"
import { skillIdSchema } from "../skill-product-input.js"
import { appSkillBindingQuerySchema, putAppSkillBindingSchema, removeAppSkillBindingSchema } from "../app-skill-binding-input.js"
import { queryOf } from "../request.js"
import { send } from "../response.js"
import {
  withPersonalSkillLifecycle,
  readPersonalSkillLifecycleBody,
  replyPersonalSkillLifecycle,
  lifecycleError,
  personalSkillLifecycleFailure,
} from "./personal-skill-lifecycle.js"

const count = (request: IncomingMessage, name: string) => request.rawHeaders.filter((value, index) => index % 2 === 0 && value.toLowerCase() === name).length
/** Exact App binding scope is derived from fresh IAM operator qualification, never platform-admin or body identity. */
export async function appSkillBindingsRoute(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  composition: BffServerComposition,
  requestId: string,
  pathname: string,
): Promise<boolean> {
  const match = /^\/v1\/admin\/open-apps\/([^/]+)\/skill-bindings(?:\/([^/]+))?$/u.exec(pathname)
  if (!match) return false
  const method = request.method ?? "GET"
  if (match[2] === undefined ? !["GET", "POST"].includes(method) : method !== "DELETE") {
    response.setHeader("allow", match[2] === undefined ? "GET, POST" : "DELETE")
    send(response, 405, lifecycleError(requestId, "method_not_allowed", "Request method is invalid"))
    return true
  }
  await withPersonalSkillLifecycle(request, response, config, composition.sessionAdmission, requestId, async (scope) => {
    const fail = (status: number, code: string, retryAfter?: string) =>
      replyPersonalSkillLifecycle(
        response,
        scope,
        requestId,
        status,
        lifecycleError(requestId, code, "App Skill binding request was not confirmed"),
        retryAfter,
      )
    try {
      let appId: string, seriesId: string | undefined
      try {
        appId = decodeURIComponent(match[1]!)
        seriesId = match[2] === undefined ? undefined : decodeURIComponent(match[2])
      } catch {
        fail(400, "invalid_skill_request")
        return
      }
      if (!skillIdSchema.safeParse(appId).success || (seriesId !== undefined && !skillIdSchema.safeParse(seriesId).success)) {
        fail(400, "invalid_skill_request")
        return
      }
      let page: { limit: number; cursor?: string } | undefined, input: { target: string; expectedBindingVersion: string } | undefined, key: string | undefined
      if (method === "GET") {
        if (
          request.headers["transfer-encoding"] !== undefined ||
          (request.headers["content-length"] !== undefined && request.headers["content-length"] !== "0") ||
          request.headers["idempotency-key"] !== undefined
        ) {
          fail(400, "invalid_skill_request")
          return
        }
        const query = queryOf(request),
          values: Record<string, string> = {}
        for (const name of new Set(query.keys())) {
          if (query.getAll(name).length !== 1) {
            fail(400, "invalid_skill_request")
            return
          }
          values[name] = query.get(name)!
        }
        if (values.limit !== undefined && !/^[1-9][0-9]*$/u.test(values.limit)) {
          fail(400, "invalid_skill_request")
          return
        }
        const parsed = appSkillBindingQuerySchema.safeParse(values)
        if (!parsed.success) {
          fail(400, "invalid_skill_request")
          return
        }
        page = { limit: parsed.data.limit, ...(parsed.data.cursor === undefined ? {} : { cursor: parsed.data.cursor }) }
      } else {
        if (
          queryOf(request).size !== 0 ||
          request.headers["transfer-encoding"] !== undefined ||
          count(request, "content-type") !== 1 ||
          !/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(request.headers["content-type"] ?? "")
        ) {
          fail(400, "invalid_skill_request")
          return
        }
        const incomingKey = request.headers["idempotency-key"]
        if (count(request, "idempotency-key") !== 1 || typeof incomingKey !== "string" || !/^[\x21-\x2B\x2D-\x7E]{1,128}$/u.test(incomingKey)) {
          fail(400, "invalid_idempotency_key")
          return
        }
        key = incomingKey
        let raw: unknown
        try {
          raw = strictParseRawJson(new TextDecoder("utf-8", { fatal: true }).decode(await readPersonalSkillLifecycleBody(request, scope.signal)))
        } catch (error) {
          scope.active()
          fail(error instanceof Error && error.message === "request_body_too_large" ? 413 : 400, "invalid_skill_request")
          return
        }
        if (method === "POST") {
          const parsed = putAppSkillBindingSchema.safeParse(raw)
          if (!parsed.success) {
            fail(400, "invalid_skill_request")
            return
          }
          input = { target: parsed.data.skill_id, expectedBindingVersion: parsed.data.expected_binding_version }
        } else {
          const parsed = removeAppSkillBindingSchema.safeParse(raw)
          if (!parsed.success) {
            fail(400, "invalid_skill_request")
            return
          }
          input = { target: seriesId!, expectedBindingVersion: parsed.data.expected_binding_version }
        }
      }
      scope.active()
      const checked = await composition.openAppManagementAdmission.verify({
        token: bearerToken(request)!,
        requestId,
        signal: scope.signal,
        tenantId: scope.context.identity.namespace,
        appId,
      })
      scope.active()
      if (!checked.ok) {
        fail(checked.status, checked.code, checked.retryAfter)
        return
      }
      if (
        checked.registration.tenant_id !== scope.context.identity.namespace ||
        checked.registration.app_id !== appId ||
        !skillIdSchema.safeParse(checked.registration.client_id).success
      ) {
        fail(503, "iam_admission_unavailable")
        return
      }
      const client = composition.appSkillBindingClient
      if (client === null) {
        fail(503, "skill_dependency_unavailable")
        return
      }
      const context = { requestId, tenant: checked.registration.tenant_id, subject: scope.context.identity.userId, appId: checked.registration.app_id }
      if (method === "GET") {
        const result = await client.list(context, page!, scope.signal, scope.deadlineAt)
        scope.active()
        replyPersonalSkillLifecycle(response, scope, requestId, 200, {
          data: { bindings: result.items, next_cursor: result.nextCursor ?? null },
          meta: { request_id: requestId },
        })
      } else {
        const operation = method === "POST" ? "put" : "remove"
        const commandId = `bff.skill.app-binding.v1.${createHash("sha256")
          .update(JSON.stringify([context.tenant, context.subject, context.appId, operation, key]))
          .digest("hex")}`
        const result = await client.command(operation, { ...context, commandId }, input!, scope.signal, scope.deadlineAt)
        scope.active()
        replyPersonalSkillLifecycle(response, scope, requestId, 200, { data: result, meta: { request_id: requestId } })
      }
    } catch (error) {
      scope.active()
      const fault = personalSkillLifecycleFailure(error)
      fail(fault.status, fault.code, fault.retryAfter)
    }
  })
  return true
}
