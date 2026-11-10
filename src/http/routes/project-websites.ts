import type { IncomingMessage, ServerResponse } from "node:http"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import { authorizeUserRequest } from "../../auth/user-admission.js"
import type { BffConfig } from "../../config/runtime.js"
import { failure } from "../../contracts/index.js"
import { isRecord } from "../../domain/json.js"
import { normalizeProjectWebsiteUrls, projectWebsitesProjectId, validProjectWebsitesStateVersion } from "../../domain/project/website-urls.js"
import type { ProjectMutationStore, ProjectReadStore } from "../../infrastructure/postgres/project-store.js"
import { strictParseRawJson } from "../../infrastructure/raw-json.js"
import { rawHeaderCount, readBodyBeforeDeadline } from "../request-body.js"
import { requestId } from "../request.js"
import { send } from "../response.js"

const pathPattern = /^\/v1\/projects\/([^/?]+)\/websites(?:\?|$)/u
const maxBodyBytes = 65_536
const incompatibleHeaders = [
  "idempotency-key",
  "transfer-encoding",
  "content-encoding",
  "if-match",
  "if-none-match",
  "if-modified-since",
  "if-unmodified-since",
  "if-range",
]

function parseInput(bytes: Buffer): { websites: string[]; expectedStateVersion: string } | null {
  let body: unknown
  try {
    body = strictParseRawJson(bytes)
  } catch {
    return null
  }
  if (!isRecord(body) || Object.keys(body).length !== 2 || !validProjectWebsitesStateVersion(body.expected_state_version)) return null
  const websites = normalizeProjectWebsiteUrls(body.websites)
  return websites === null ? null : { websites, expectedStateVersion: body.expected_state_version }
}

/** The Project owner stores addresses; this route never calls a site or another owner. */
export async function handleProjectWebsitesRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  admission: SessionAdmission,
  reads: Pick<ProjectReadStore, "readWebsites">,
  mutations: Pick<ProjectMutationStore, "replaceWebsites">,
): Promise<boolean> {
  const url = request.url ?? ""
  const projectId = pathPattern.exec(url)?.[1]
  const put = request.method === "PUT"
  if (projectId === undefined || (!put && request.method !== "GET")) return false
  const id = requestId(request)
  response.setHeader("x-request-id", id)
  const fail = (status: number, code: string, message: string, retryAfter?: string): true => {
    if (!response.destroyed && !response.writableEnded) send(response, status, failure(code, message, id), retryAfter)
    return true
  }
  const invalid = () => fail(400, "invalid_project_websites_request", "Project website request is invalid")
  const tooLarge = () => fail(413, "payload_too_large", "Project website request body is too large")
  if (
    !projectWebsitesProjectId.test(projectId) ||
    url !== `/v1/projects/${projectId}/websites` ||
    incompatibleHeaders.some((key) => request.headers[key] !== undefined)
  )
    return invalid()
  const contentType = request.headers["content-type"],
    length = request.headers["content-length"]
  if (put) {
    if (
      rawHeaderCount(request, "content-type") !== 1 ||
      !/^application\/json(?:;\s*charset=utf-8)?$/iu.test(contentType ?? "") ||
      rawHeaderCount(request, "content-length") !== 1 ||
      typeof length !== "string" ||
      !/^(0|[1-9][0-9]*)$/u.test(length)
    )
      return invalid()
    if (Number(length) > maxBodyBytes) {
      request.resume()
      return tooLarge()
    }
  } else if (contentType !== undefined || length !== undefined) return invalid()

  const cancellation = new AbortController()
  const close = (): void => {
    if (!response.writableEnded) cancellation.abort()
  }
  request.once("aborted", close)
  response.once("close", close)
  if (request.aborted || response.destroyed) close()
  const signal = AbortSignal.any([cancellation.signal, AbortSignal.timeout(Math.min(config.upstreamTimeoutMs, 10_000))])
  try {
    signal.throwIfAborted()
    const admitted = await authorizeUserRequest(request, config, admission, id, signal, response)
    signal.throwIfAborted()
    if (!admitted.ok) return fail(admitted.status, admitted.code, "BFF user admission failed", admitted.retryAfter)
    const { namespace: tenantId, userId: subjectId } = admitted.context.identity
    const scope = { projectId, tenantId, subjectId, signal }
    if (!put) {
      const data = await reads.readWebsites(scope)
      signal.throwIfAborted()
      if (data === null) return fail(404, "project_not_found", "Project was not found")
      send(response, 200, { data })
      return true
    }
    const bytes = await readBodyBeforeDeadline(request, signal, maxBodyBytes)
    const input = bytes.byteLength === Number(length) ? parseInput(bytes) : null
    if (input === null) return invalid()
    const result = await mutations.replaceWebsites({ ...scope, ...input })
    signal.throwIfAborted()
    if (result.kind === "not_found") return fail(404, "project_not_found", "Project was not found")
    if (result.kind === "precondition_failed") return fail(412, "project_websites_precondition_failed", "Project website state is no longer current")
    send(response, 200, { data: result.data })
    return true
  } catch (error) {
    if (error instanceof Error && error.message === "request body too large") return tooLarge()
    return fail(503, "project_websites_unavailable", "Project websites are unavailable")
  } finally {
    request.off("aborted", close)
    response.off("close", close)
  }
}
