import { currentResourceProject } from "../project-resource-access.js"
import type { IncomingMessage, ServerResponse } from "node:http"
import type { BffConfig } from "../../config/runtime.js"
import type { RequestContext } from "../../domain/request-context.js"
import type { BffBusinessStore } from "../../application/ports/bff-business-store.js"
import { ProjectResourceError } from "../../application/project-resource.error.js"
import { ProjectResourceAccessClient } from "../../infrastructure/clients/storage/project-resource-access.js"
import { projectDeletionHeaderValues, isEmptyProjectDeletionRequest } from "../project-deletion-input.js"
import { failure, ok } from "../../contracts/index.js"
import { send } from "../response.js"

type Scope = { tenantId: string; subjectId: string; projectId: string; requestId: string }
export async function projectResourceDeleteRoute(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  context: RequestContext,
  projectRef: string,
  assetId: string,
  store: BffBusinessStore | null,
  clientFactory: (config: NonNullable<BffConfig["storage"]>, scope: Scope) => Pick<ProjectResourceAccessClient, "delete"> = (cfg, scope) =>
    new ProjectResourceAccessClient(cfg, scope),
): Promise<void> {
  response.setHeader("x-request-id", context.requestId)
  const abort = new AbortController()
  const cancel = (): void => {
    if (!response.writableEnded) abort.abort()
  }
  request.once("aborted", cancel)
  response.once("close", cancel)
  const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(10_000)])
  try {
    const keys = projectDeletionHeaderValues(request.rawHeaders, "idempotency-key")
    const key = keys[0]
    if (
      request.method !== "DELETE" ||
      request.url !== `/v1/projects/${encodeURIComponent(projectRef)}/resources/${encodeURIComponent(assetId)}` ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(assetId) ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(projectRef) ||
      keys.length !== 1 ||
      key === undefined ||
      !/^[\x21-\x7e]{1,191}$/u.test(key) ||
      !isEmptyProjectDeletionRequest(request, true) ||
      request.headers["content-type"] !== undefined
    )
      throw new ProjectResourceError("invalid_project_resource", 400)
    const scope = { tenantId: context.identity.namespace, subjectId: context.identity.userId }
    const projectId = await currentResourceProject(store, scope, projectRef, signal)
    if (config.storage === undefined) throw new ProjectResourceError("storage_projection_not_configured", 503, true)
    const result = await clientFactory(config.storage, { ...scope, projectId, requestId: context.requestId }).delete(assetId, key, signal)
    signal.throwIfAborted()
    if (!response.destroyed) send(response, 200, ok(result, context.requestId))
  } catch (error) {
    if (response.destroyed) return
    const known = error instanceof ProjectResourceError ? error : new ProjectResourceError("project_resource_delete_unknown", 503, true)
    send(response, known.status, failure(known.code, "Project resource deletion did not complete", context.requestId))
  } finally {
    request.off("aborted", cancel)
    response.off("close", cancel)
  }
}
