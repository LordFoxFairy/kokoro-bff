import type { IncomingMessage, ServerResponse } from "node:http"
import type { BffConfig } from "../../config/runtime.js"
import type { RequestContext } from "../../domain/request-context.js"
import type { BffBusinessStore } from "../../application/ports/bff-business-store.js"
import { mutationTicket, type IdempotencyEntry, type MutationTicket } from "../../application/idempotency.js"
import { projectResourceFingerprint, uploadProjectResource } from "../../application/project-resource-upload.js"
import { ProjectResourceError } from "../../application/project-resource.error.js"
import type { ProjectResourceContext, ProjectResourceStorage } from "../../application/project-resource.types.js"
import { StorageUploadClient } from "../../infrastructure/clients/storage/client.js"
import { failure, ok } from "../../contracts/index.js"
import { parseProjectResource } from "../project-resource-input.js"
import { idempotencyKey } from "../request.js"
import { reply, send } from "../response.js"

export async function projectResourceRoute(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  context: RequestContext,
  projectRef: string,
  body: Buffer,
  store: BffBusinessStore | null,
  idempotency: Map<string, IdempotencyEntry>,
  clientFactory: (config: NonNullable<BffConfig["storage"]>, context: ProjectResourceContext) => ProjectResourceStorage = (storage, scope) =>
    new StorageUploadClient(storage, scope),
): Promise<void> {
  let mutation: MutationTicket | null = null
  const cancellation = new AbortController()
  const cancel = (): void => {
    if (!response.writableEnded) cancellation.abort()
  }
  request.once("aborted", cancel)
  response.once("close", cancel)
  const signal = AbortSignal.any([cancellation.signal, AbortSignal.timeout(45_000)])
  try {
    if (store === null) throw new ProjectResourceError("business_store_unavailable", 503)
    const scope = { tenantId: context.identity.namespace, subjectId: context.identity.userId }
    const project = await store.services.projects.find(scope, projectRef)
    if (project === null) throw new ProjectResourceError("project_not_found", 404)
    if (new URL(request.url ?? "/", "http://bff.invalid").search !== "") throw new ProjectResourceError("invalid_project_resource", 400)
    const key = idempotencyKey(request)
    if (key === null || key.length > 191 || !/^[\x21-\x7e]+$/u.test(key)) throw new ProjectResourceError("invalid_idempotency_key", 400)
    const input = await parseProjectResource(request.headers["content-type"] ?? "", body)
    const ticket = await mutationTicket(key, "POST", `/projects/${project.id}/resources`, context, projectResourceFingerprint(input), idempotency, store)
    if (ticket.replay !== null) {
      send(response, ticket.replay.status, ticket.replay.body)
      return
    }
    if (ticket.conflict || ticket.pending) throw new ProjectResourceError(ticket.conflict ? "idempotency_conflict" : "idempotency_in_progress", 409)
    mutation = ticket.ticket
    if (config.storage === undefined) throw new ProjectResourceError("storage_projection_not_configured", 503)
    const uploadContext = { ...scope, projectId: project.id, key, requestId: context.requestId }
    const resource = await uploadProjectResource(uploadContext, input, store, clientFactory(config.storage, uploadContext), signal)
    await reply(response, 200, ok({ resources: [resource] }, context.requestId), context, idempotency, mutation)
  } catch (error) {
    const known = error instanceof ProjectResourceError ? error : new ProjectResourceError("resource_upload_unavailable", 503, true)
    await reply(response, known.status, failure(known.code, "Project resource upload did not complete", context.requestId), context, idempotency, mutation)
  } finally {
    request.off("aborted", cancel)
    response.off("close", cancel)
  }
}
