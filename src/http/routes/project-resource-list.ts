import type { IncomingMessage, ServerResponse } from "node:http"
import type { BffConfig } from "../../config/runtime.js"
import type { RequestContext } from "../../domain/request-context.js"
import type { BffBusinessStore } from "../../application/ports/bff-business-store.js"
import type { ProjectResourceContext } from "../../application/project-resource.types.js"
import { ProjectResourceError } from "../../application/project-resource.error.js"
import { StorageUploadClient } from "../../infrastructure/clients/storage/client.js"
import { projectResourceListInput } from "../project-resource-list-input.js"
import { failure, ok } from "../../contracts/index.js"
import { send } from "../response.js"

export async function projectResourceListRoute(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  context: RequestContext,
  projectRef: string,
  store: BffBusinessStore | null,
  clientFactory: (config: NonNullable<BffConfig["storage"]>, context: Omit<ProjectResourceContext, "key">) => Pick<StorageUploadClient, "listAssets"> = (
    cfg,
    scope,
  ) => new StorageUploadClient(cfg, scope),
): Promise<void> {
  const cancellation = new AbortController()
  const cancel = (): void => {
    if (!response.writableEnded) cancellation.abort()
  }
  request.once("aborted", cancel)
  response.once("close", cancel)
  const signal = AbortSignal.any([cancellation.signal, AbortSignal.timeout(10_000)])
  try {
    if (store === null) throw new ProjectResourceError("business_store_unavailable", 503, true)
    const scope = { tenantId: context.identity.namespace, subjectId: context.identity.userId }
    const project = await store.services.projects.find(scope, projectRef)
    if (project === null) throw new ProjectResourceError("project_not_found", 404)
    if (request.headers["transfer-encoding"] !== undefined || (request.headers["content-length"] !== undefined && request.headers["content-length"] !== "0"))
      throw new ProjectResourceError("invalid_project_resource_page", 400)
    const input = projectResourceListInput(new URL(request.url ?? "/", "http://bff.invalid").searchParams)
    if (config.storage === undefined) throw new ProjectResourceError("storage_projection_not_configured", 503, true)
    const page = await clientFactory(config.storage, { ...scope, projectId: project.id, requestId: context.requestId }).listAssets(input, signal)
    send(response, 200, ok(page, context.requestId))
  } catch (error) {
    const known = error instanceof ProjectResourceError ? error : new ProjectResourceError("project_resources_unavailable", 503, true)
    send(response, known.status, failure(known.code, "Project resources could not be read", context.requestId))
  } finally {
    request.off("aborted", cancel)
    response.off("close", cancel)
  }
}
