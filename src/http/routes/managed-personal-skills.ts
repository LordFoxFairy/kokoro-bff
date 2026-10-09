import { parsePersonalSkillQuery } from "../skill-installation-input.js"
import { startSkillRequestBudget } from "./skill-drafts.js"
import { IamPublisherProfileClient } from "../../infrastructure/clients/iam-publisher-profile.js"
import type { IncomingMessage, ServerResponse } from "node:http"

import { authorizeUserRequest } from "../../auth/user-admission.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import type { BffConfig } from "../../config/runtime.js"
import { zGetSelfManagedSkillPath, zListSelfManagedSkillsQuery } from "../../generated/platform-http/zod.gen.js"
import type { ListSelfManagedSkillsData } from "../../generated/platform-http/types.gen.js"
import { PlatformProjectionHttpClient, type ManagedPersonalSkillOperation } from "../../infrastructure/clients/platform/projection-http.js"
import { queryOf } from "../request.js"
import { send } from "../response.js"

const clients = new WeakMap<BffConfig, PlatformProjectionHttpClient>()
const listQueryKeys = new Set(["limit", "cursor", "status", "source_kind", "query"])

function whileActive<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const aborted = (): void => reject(signal.reason)
    signal.addEventListener("abort", aborted, { once: true })
    void promise.then(
      (value) => {
        signal.removeEventListener("abort", aborted)
        if (signal.aborted) reject(signal.reason)
        else resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener("abort", aborted)
        reject(error)
      },
    )
    if (signal.aborted) {
      signal.removeEventListener("abort", aborted)
      reject(signal.reason)
    }
  })
}

function envelope(requestId: string, error: { code: string; message: string }): object {
  return { error, meta: { request_id: requestId } }
}

function fail(response: ServerResponse, requestId: string, status: number, code: string, message: string, retryAfter?: string): void {
  response.setHeader("x-request-id", requestId)
  send(response, status, envelope(requestId, { code, message }), retryAfter)
}

function operationFor(path: string[]): ManagedPersonalSkillOperation | null {
  if (path.length === 2 && path[0] === "self" && path[1] === "skills") return "managedSkills"
  if (path.length === 3 && path[0] === "self" && path[1] === "skills") return "managedSkill"
  return null
}

function listQuery(request: IncomingMessage): ListSelfManagedSkillsData["query"] | null {
  const incoming = queryOf(request)
  const query: Record<string, unknown> = {}
  let textQuery: string | undefined
  for (const key of new Set(incoming.keys())) {
    if (!listQueryKeys.has(key)) return null
    const values = incoming.getAll(key)
    if (values.length !== 1 || values[0] === undefined || values[0].length === 0) return null
    if (key === "query") {
      try {
        textQuery = parsePersonalSkillQuery(values[0])
      } catch {
        return null
      }
    } else if (key === "limit") {
      if (!/^[1-9][0-9]*$/u.test(values[0])) return null
      query.limit = Number(values[0])
    } else query[key] = values[0]
  }
  const parsed = zListSelfManagedSkillsQuery.strict().safeParse(query)
  if (!parsed.success) return null
  return {
    // Zod max(length) counts UTF16; query is separately validated as formal Unicode scalars.
    ...(textQuery === undefined ? {} : { query: textQuery }),
    ...(parsed.data.limit === undefined ? {} : { limit: parsed.data.limit }),
    ...(parsed.data.cursor === undefined ? {} : { cursor: parsed.data.cursor }),
    ...(parsed.data.status === undefined ? {} : { status: parsed.data.status }),
    ...(parsed.data.source_kind === undefined ? {} : { source_kind: parsed.data.source_kind }),
  }
}

export async function managedPersonalSkillsRoute(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  admissionSource: SessionAdmission,
  requestId: string,
  path: string[],
): Promise<void> {
  const operation = operationFor(path)
  if (operation === null) return
  if (request.aborted || response.destroyed || response.writableEnded) return
  response.setHeader("x-request-id", requestId)
  const deadlineAt = startSkillRequestBudget(request)
  const deadline = new AbortController()
  let timedOut = false
  const timer = setTimeout(
    () => {
      timedOut = true
      deadline.abort(new Error("managed_personal_skill_deadline"))
    },
    Math.max(0, deadlineAt - performance.now()),
  )
  const abort = (): void => deadline.abort(new Error("managed_personal_skill_cancelled"))
  const close = (): void => {
    if (!response.writableEnded) abort()
  }
  request.once("aborted", abort)
  response.once("close", close)
  const expired = (): boolean => {
    if (performance.now() < deadlineAt) return false
    timedOut = true
    if (!deadline.signal.aborted) deadline.abort(new Error("managed_personal_skill_deadline"))
    return true
  }
  try {
    if (request.aborted || response.destroyed || response.writableEnded) return
    if (
      request.headers["content-length"] !== undefined ||
      request.headers["transfer-encoding"] !== undefined ||
      request.headers["idempotency-key"] !== undefined
    ) {
      fail(response, requestId, 400, "invalid_skill_request", "Managed Skill request is invalid")
      return
    }
    const query = operation === "managedSkills" ? listQuery(request) : queryOf(request).size === 0 ? {} : null
    const skillId = operation === "managedSkill" ? path[2] : undefined
    if (query === null || (operation === "managedSkill" && !zGetSelfManagedSkillPath.strict().safeParse({ skill_id: skillId }).success)) {
      fail(response, requestId, 400, "invalid_skill_request", "Managed Skill request is invalid")
      return
    }
    let admission
    try {
      if (expired()) {
        fail(response, requestId, 503, "iam_admission_unavailable", "BFF user admission failed")
        return
      }
      admission = await whileActive(authorizeUserRequest(request, config, admissionSource, requestId, deadline.signal), deadline.signal)
      if (expired()) {
        if (!response.destroyed && !response.writableEnded) fail(response, requestId, 503, "iam_admission_unavailable", "BFF user admission failed")
        return
      }
    } catch {
      if (!response.destroyed && !response.writableEnded) fail(response, requestId, 503, "iam_admission_unavailable", "BFF user admission failed")
      return
    }
    if (!admission.ok) {
      if (!deadline.signal.aborted && !response.destroyed && !response.writableEnded)
        fail(response, requestId, admission.status, admission.code, "BFF user admission failed", admission.retryAfter)
      return
    }
    const projection = config.platformProjection
    if (projection === undefined || projection.baseUrl === null || projection.credentialFile === null || config.iamBaseUrl === null) {
      fail(response, requestId, 503, "skill_dependency_unavailable", "Managed Skill dependency is unavailable")
      return
    }
    let client = clients.get(config)
    if (client === undefined) {
      client = new PlatformProjectionHttpClient(projection.baseUrl, config.iamBaseUrl, projection.credentialFile, projection.timeoutMs)
      clients.set(config, client)
    }
    if (expired()) {
      fail(response, requestId, 503, "skill_dependency_unavailable", "Managed Skill dependency is unavailable")
      return
    }
    const result = await whileActive(
      client.readManagedPersonalSkill(
        operation,
        admission.context.identity.namespace,
        admission.context.identity.userId,
        requestId,
        { query, ...(skillId === undefined ? {} : { skillId }) },
        deadline.signal,
        deadlineAt,
      ),
      deadline.signal,
    ).catch(() => ({ ok: false, status: 503, code: "skill_dependency_unavailable" }) as const)
    if (expired() || deadline.signal.aborted || response.destroyed || response.writableEnded) {
      if (timedOut && !response.destroyed && !response.writableEnded)
        fail(response, requestId, 503, "skill_dependency_unavailable", "Managed Skill dependency is unavailable")
      return
    }
    if (result.ok) {
      const enriched = await new IamPublisherProfileClient(config.iamBaseUrl ?? "", 5000).enrich(
        admission.context.identity.namespace,
        admission.bearerToken,
        requestId,
        result.data,
        deadline.signal,
      )
      const payload = Buffer.from(JSON.stringify({ data: enriched, meta: { request_id: requestId } }))
      if (expired() || deadline.signal.aborted || request.aborted || response.destroyed || response.writableEnded) {
        if (timedOut && !response.destroyed && !response.writableEnded)
          fail(response, requestId, 503, "skill_dependency_unavailable", "Managed Skill dependency is unavailable")
        return
      }
      response.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "content-length": payload.byteLength,
      })
      response.end(payload)
      return
    }
    const message =
      result.status === 400
        ? "Managed Skill request is invalid"
        : result.status === 404
          ? "Skill was not found"
          : result.status === 502
            ? "Managed Skill response is invalid"
            : "Managed Skill dependency is unavailable"
    fail(response, requestId, result.status, result.code, message)
  } finally {
    clearTimeout(timer)
    request.removeListener("aborted", abort)
    response.removeListener("close", close)
  }
}
