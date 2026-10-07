import type { IncomingMessage, ServerResponse } from "node:http"

import type { BffBusinessStore } from "../../application/ports/bff-business-store.js"
import type { RequestContext } from "../../domain/request-context.js"
import { isEmptyProjectDeletionRequest, isProjectDeletionId, projectDeletionHeaderValues, validProjectDeletionKey } from "../project-deletion-input.js"
import { send } from "../response.js"

export async function projectDeleteRoute(
  request: IncomingMessage,
  response: ServerResponse,
  context: RequestContext,
  projectId: string,
  store: BffBusinessStore | null,
): Promise<void> {
  const fail = (status: number, code: string, message: string, retryable = false): void => send(response, status, { error: { code, message, retryable } })
  response.setHeader("x-request-id", context.requestId)
  response.setHeader("cache-control", "no-store")
  const keys = projectDeletionHeaderValues(request.rawHeaders, "idempotency-key")
  const key = keys[0]
  if (
    request.method !== "DELETE" ||
    request.url !== `/v1/projects/${projectId}` ||
    !isProjectDeletionId(projectId) ||
    !isEmptyProjectDeletionRequest(request, true)
  ) {
    fail(400, "invalid_project_deletion_request", "Project deletion request is invalid")
    return
  }
  if (keys.length !== 1 || key === undefined || !validProjectDeletionKey(key)) {
    fail(400, keys.length === 0 ? "idempotency_key_required" : "invalid_idempotency_key", "One valid Idempotency-Key is required")
    return
  }
  if (store === null) {
    fail(503, "business_store_unavailable", "Project deletion is unavailable", true)
    return
  }
  const abort = new AbortController()
  const stop = (): void => abort.abort()
  request.once("aborted", stop)
  response.once("close", stop)
  try {
    const result = await store.services.projects.delete(
      {
        tenantId: context.identity.namespace,
        subjectId: context.identity.userId,
      },
      projectId,
      key,
      context.requestId,
      abort.signal,
    )
    if (response.destroyed) return
    if (result.kind === "accepted") {
      response.setHeader("location", result.location)
      send(response, 202, { data: result.resource })
    } else if (result.kind === "not_found") fail(404, "project_not_found", "Project was not found")
    else if (result.kind === "in_progress") fail(409, "idempotency_in_progress", "Project deletion is in progress", true)
    else fail(409, "idempotency_conflict", "Idempotency key was used for different input")
  } catch {
    if (!response.destroyed) fail(503, "business_store_unavailable", "Project deletion is unavailable", true)
  } finally {
    request.removeListener("aborted", stop)
    response.removeListener("close", stop)
  }
}
