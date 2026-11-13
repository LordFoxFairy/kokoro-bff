import { createHash } from "node:crypto"
import { performance } from "node:perf_hooks"
import type { IncomingMessage, ServerResponse } from "node:http"
import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import { authorizeUserRequest } from "../../auth/user-admission.js"
import { parseProjectAccessVersion, parseProjectGrantBody } from "../../domain/project/access.js"
import type { ProjectGrantStore } from "../../infrastructure/postgres/project-grants.js"
import { readIamTeamPage } from "../../infrastructure/clients/iam-team.js"
import { strictParseRawJson } from "../../infrastructure/raw-json.js"
import { failure, ok } from "../../contracts/index.js"
import { readBody, requestId } from "../request.js"
import { send } from "../response.js"

type Route = {
  projectId: string
  kind: "access" | "list" | "write"
  subjectId?: string
}
function routeFor(request: IncomingMessage): Route | null {
  const path = (request.url ?? "").split("?", 1)[0]
  const match = /^\/v1\/projects\/([A-Za-z0-9][A-Za-z0-9._:-]{0,190})\/(access|grants)(?:\/([A-Za-z0-9][A-Za-z0-9._:-]{0,254}))?$/u.exec(path ?? "")
  if (!match) return null
  if (request.method === "GET" && !match[3])
    return {
      projectId: match[1]!,
      kind: match[2] === "access" ? "access" : "list",
    }
  if ((request.method === "PUT" || request.method === "DELETE") && match[2] === "grants" && match[3])
    return { projectId: match[1]!, kind: "write", subjectId: match[3] }
  return null
}
function pageQuery(request: IncomingMessage, projectId: string, tenantId: string): { limit: number; after: string | null } | null {
  const query = new URL(request.url ?? "", "http://bff.local").searchParams
  if ([...query.keys()].some((key) => key !== "limit" && key !== "cursor") || query.getAll("limit").length > 1 || query.getAll("cursor").length > 1) return null
  const limit = query.get("limit") ?? "25"
  if (!/^[1-9][0-9]{0,2}$/u.test(limit) || Number(limit) > 100) return null
  let after: string | null = null
  if (query.has("cursor")) {
    const raw = query.get("cursor")!
    if (raw.length < 1 || raw.length > 2048 || !/^[A-Za-z0-9_-]+$/u.test(raw)) return null
    try {
      const value: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"))
      if (
        !Array.isArray(value) ||
        value.length !== 3 ||
        value[0] !== tenantId ||
        value[1] !== projectId ||
        typeof value[2] !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/u.test(value[2]) ||
        Buffer.from(JSON.stringify(value)).toString("base64url") !== raw
      )
        return null
      after = value[2]
    } catch {
      return null
    }
  }
  return { limit: Number(limit), after }
}

/** Exact Project-owned endpoint; no generic proxy, organization-admin grant, or creator impersonation. */
export async function handleProjectGrantRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  admission: SessionAdmission,
  store: ProjectGrantStore,
  members: typeof readIamTeamPage = readIamTeamPage,
): Promise<boolean> {
  const route = routeFor(request)
  if (!route) return false
  const id = requestId(request)
  response.setHeader("x-request-id", id)
  const controller = new AbortController(),
    deadlineAt = performance.now() + 10_000
  const timeout = setTimeout(() => {
    controller.abort()
    if (response.destroyed || response.writableEnded) return
    if (response.headersSent) {
      response.destroy()
      return
    }
    response.setHeader("connection", "close")
    if (!request.complete) response.once("finish", () => request.destroy())
    send(response, 503, failure("project_access_unavailable", "Project access request failed", id))
  }, 10_000)
  const abort = () => {
    if (!response.writableEnded) controller.abort()
  }
  request.once("aborted", abort)
  response.once("close", abort)
  const fail = (status: number, code: string, retryAfter?: string) => {
    if (!controller.signal.aborted && !response.destroyed && !response.writableEnded)
      send(response, status, failure(code, "Project access request failed", id), retryAfter)
  }
  try {
    const admitted = await authorizeUserRequest(request, config, admission, id, controller.signal, response)
    if (!admitted.ok) {
      fail(admitted.status, admitted.code, admitted.retryAfter)
      return true
    }
    const scope = {
      tenantId: admitted.context.identity.namespace,
      subjectId: admitted.context.identity.userId,
    }
    const access = await store.access(scope, route.projectId, controller.signal, deadlineAt)
    controller.signal.throwIfAborted()
    if (!access) {
      fail(404, "project_not_found")
      return true
    }
    const query = new URL(request.url ?? "", "http://bff.local").searchParams
    if (route.kind === "access") {
      if (
        query.size ||
        request.headers["idempotency-key"] !== undefined ||
        request.headers["if-match"] !== undefined ||
        request.headers["if-none-match"] !== undefined ||
        (await readBody(request, 65_536)).length !== 0
      ) {
        fail(400, "invalid_project_access_request")
        return true
      }
      send(response, 200, ok(access, id))
      return true
    }
    if (access.role !== "owner") {
      fail(403, "project_management_forbidden")
      return true
    }
    if (route.kind === "list") {
      const query = pageQuery(request, route.projectId, scope.tenantId)
      if (
        !query ||
        request.headers["idempotency-key"] !== undefined ||
        request.headers["if-match"] !== undefined ||
        request.headers["if-none-match"] !== undefined ||
        (await readBody(request, 65_536)).length !== 0
      ) {
        fail(400, "invalid_project_grant_query")
        return true
      }
      const page = await store.list(scope, route.projectId, query.after, query.limit, controller.signal, deadlineAt)
      const current = await store.access(scope, route.projectId, controller.signal, deadlineAt)
      controller.signal.throwIfAborted()
      if (!page || current?.role !== "owner") {
        fail(404, "project_not_found")
        return true
      }
      send(response, 200, {
        data: page.items,
        meta: {
          request_id: id,
          next_cursor: page.next === null ? null : Buffer.from(JSON.stringify([scope.tenantId, route.projectId, page.next])).toString("base64url"),
        },
      })
      return true
    }
    const tag = request.headers["if-match"]
    if (tag === undefined) {
      fail(428, "project_access_precondition_required")
      return true
    }
    const version = parseProjectAccessVersion(tag),
      key = request.headers["idempotency-key"]
    if (
      !version ||
      typeof key !== "string" ||
      !/^[\x21-\x7e]{1,128}$/u.test(key) ||
      key.includes(",") ||
      request.headers["if-none-match"] !== undefined ||
      query.size ||
      route.subjectId === scope.subjectId
    ) {
      fail(400, "invalid_project_grant_request")
      return true
    }
    const raw = await readBody(request, 65_536)
    let body = null
    if (request.method === "PUT") {
      if (request.headers["content-type"]?.split(";", 1)[0]?.trim() !== "application/json") {
        fail(400, "invalid_project_grant_request")
        return true
      }
      try {
        body = parseProjectGrantBody(strictParseRawJson(raw), null)
      } catch {
        /* Closed parser rejects malformed/duplicate JSON. */
      }
      if (!body) {
        fail(400, "invalid_project_grant_request")
        return true
      }
    } else if (raw.length !== 0) {
      fail(400, "invalid_project_grant_request")
      return true
    }
    const receiptScope = JSON.stringify([scope.tenantId, scope.subjectId, request.method, route.projectId, route.subjectId, key])
    const fingerprint = createHash("sha256")
      .update(JSON.stringify(["project.grant:v1", request.method, route.projectId, route.subjectId, version, body]))
      .digest("hex")
    const prior = await store.receipt(receiptScope, controller.signal, deadlineAt)
    if (prior) {
      if (prior.fingerprint !== fingerprint) {
        fail(409, "project_grant_idempotency_conflict")
        return true
      }
      if (prior.data.project_id !== route.projectId || prior.data.subject_id !== route.subjectId) throw Error("PROJECT_GRANT_RECEIPT_INVALID")
      send(response, 200, ok(prior.data, id))
      return true
    }
    if (body) {
      if (body.expires_at !== null && Date.parse(body.expires_at) <= Date.now()) {
        fail(400, "invalid_project_grant_request")
        return true
      }
      let cursor: string | null = null,
        found = false
      const seen = new Set<string>()
      for (let page = 0; page < 20; page++) {
        const remaining = Math.floor(deadlineAt - performance.now())
        if (remaining < 1) throw Error("PROJECT_MEMBERSHIP_DEADLINE")
        const result = await members({
          baseUrl: config.iamBaseUrl,
          tenantId: scope.tenantId,
          credentialFile: config.iamUserContextServiceCredentialFile,
          subjectId: scope.subjectId,
          kind: "members",
          limit: 100,
          cursor,
          requestId: id,
          signal: controller.signal,
          timeoutMs: remaining,
          maxResponseBytes: config.upstreamMaxResponseBytes,
        })
        controller.signal.throwIfAborted()
        if (!result.ok) {
          fail(result.status, result.code, result.retryAfter)
          return true
        }
        found = result.data.some((value) => typeof value === "object" && value !== null && "user_id" in value && value.user_id === route.subjectId)
        if (found) break
        cursor = result.nextCursor
        if (cursor === null) {
          fail(409, "project_grantee_not_eligible")
          return true
        }
        if (seen.has(cursor)) throw Error("PROJECT_MEMBERSHIP_CURSOR_CYCLE")
        seen.add(cursor)
      }
      if (!found) {
        fail(503, "project_membership_lookup_incomplete")
        return true
      }
    }
    const result = await store.mutate({
      ...scope,
      projectId: route.projectId,
      targetSubjectId: route.subjectId!,
      expectedAccessVersion: version,
      body,
      receiptScope,
      fingerprint,
      signal: controller.signal,
      deadlineAt,
    })
    controller.signal.throwIfAborted()
    if (result.kind === "committed") send(response, 200, ok(result.data, id))
    else if (result.kind === "not_found") fail(404, "project_not_found")
    else if (result.kind === "forbidden") fail(403, "project_management_forbidden")
    else if (result.kind === "invalid") fail(400, "invalid_project_grant_request")
    else fail(409, result.kind === "precondition_failed" ? "project_access_version_conflict" : "project_grant_idempotency_conflict")
    return true
  } catch {
    fail(503, "project_access_unavailable")
    return true
  } finally {
    clearTimeout(timeout)
    request.off("aborted", abort)
    response.off("close", abort)
  }
}
