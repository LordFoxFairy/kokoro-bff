import type { IncomingMessage, ServerResponse } from "node:http"

import type { BffBusinessStore } from "../../application/ports/bff-business-store.js"
import type { RequestContext } from "../../domain/request-context.js"
import { isEmptyProjectDeletionRequest, isProjectDeletionId, projectDeletionHeaderValues } from "../project-deletion-input.js"
import { send } from "../response.js"

export async function projectDeletionStatusRoute(
  request: IncomingMessage,
  response: ServerResponse,
  context: RequestContext,
  projectId: string,
  store: BffBusinessStore | null,
): Promise<void> {
  const fail = (status: number, code: string, message: string, retryable = false): void => send(response, status, { error: { code, message, retryable } })
  response.setHeader("x-request-id", context.requestId)
  response.setHeader("cache-control", "no-store")
  if (
    request.method !== "GET" ||
    request.url !== `/v1/projects/${projectId}/deletion` ||
    !isProjectDeletionId(projectId) ||
    !isEmptyProjectDeletionRequest(request, false) ||
    projectDeletionHeaderValues(request.rawHeaders, "idempotency-key").length !== 0
  ) {
    fail(400, "invalid_project_deletion_request", "Project deletion status request is invalid")
    return
  }
  if (store === null) {
    fail(503, "business_store_unavailable", "Project deletion status is unavailable", true)
    return
  }
  const abort = new AbortController()
  const stop = (): void => abort.abort()
  request.once("aborted", stop)
  response.once("close", stop)
  if (request.aborted || response.destroyed) abort.abort()
  try {
    const resource = await store.services.projects.deletion(
      {
        tenantId: context.identity.namespace,
        subjectId: context.identity.userId,
      },
      projectId,
      abort.signal,
    )
    if (response.destroyed) return
    if (resource === null) fail(404, "project_not_found", "Project was not found")
    else send(response, 200, { data: resource })
  } catch {
    if (!response.destroyed) fail(503, "business_store_unavailable", "Project deletion status is unavailable", true)
  } finally {
    request.removeListener("aborted", stop)
    response.removeListener("close", stop)
  }
}
