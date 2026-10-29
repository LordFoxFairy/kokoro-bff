import { currentResourceProject } from "../project-resource-access.js"
import type { IncomingMessage, ServerResponse } from "node:http"
import type { BffConfig } from "../../config/runtime.js"
import type { RequestContext } from "../../domain/request-context.js"
import type { BffBusinessStore } from "../../application/ports/bff-business-store.js"
import { ProjectResourceError } from "../../application/project-resource.error.js"
import { ProjectResourceAccessClient } from "../../infrastructure/clients/storage/project-resource-access.js"
import { spoolVerifiedArtifact, type VerifiedArtifactSpool } from "../../infrastructure/clients/storage/artifact-download-transfer.js"
import { failure, ok } from "../../contracts/index.js"
import { isEmptyProjectDeletionRequest } from "../project-deletion-input.js"
import { writeVerifiedDownload } from "../verified-download.js"
import { send } from "../response.js"

type Scope = { tenantId: string; subjectId: string; projectId: string; requestId: string }
export async function projectResourceReadRoute(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  context: RequestContext,
  projectRef: string,
  assetId: string,
  download: boolean,
  store: BffBusinessStore | null,
  clientFactory: (config: NonNullable<BffConfig["storage"]>, scope: Scope) => Pick<ProjectResourceAccessClient, "get" | "downloadReference"> = (cfg, scope) =>
    new ProjectResourceAccessClient(cfg, scope),
  spooler: typeof spoolVerifiedArtifact = spoolVerifiedArtifact,
): Promise<void> {
  const abort = new AbortController()
  const cancel = (): void => {
    if (!response.writableFinished) abort.abort()
  }
  request.once("aborted", cancel)
  response.once("close", cancel)
  response.setHeader("x-request-id", context.requestId)
  response.setHeader("referrer-policy", "no-referrer")
  response.setHeader("x-content-type-options", "nosniff")
  const admission = AbortSignal.any([abort.signal, AbortSignal.timeout(download ? 120_000 : 10_000)])
  let spool: VerifiedArtifactSpool | null = null
  try {
    if (
      request.method !== "GET" ||
      request.url !== `/v1/projects/${encodeURIComponent(projectRef)}/resources/${encodeURIComponent(assetId)}${download ? "/download" : ""}` ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(assetId) ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(projectRef) ||
      !isEmptyProjectDeletionRequest(request, false) ||
      request.headers["content-type"] !== undefined ||
      request.headers["idempotency-key"] !== undefined
    )
      throw new ProjectResourceError("invalid_project_resource", 400)
    const scope = { tenantId: context.identity.namespace, subjectId: context.identity.userId }
    const projectId = await currentResourceProject(store, scope, projectRef, admission)
    if (config.storage === undefined) throw new ProjectResourceError("storage_projection_not_configured", 503, true)
    const client = clientFactory(config.storage, { ...scope, projectId, requestId: context.requestId })
    const item = await client.get(assetId, admission)
    admission.throwIfAborted()
    if (!download) {
      if (!response.destroyed) send(response, 200, ok({ resource: item }, context.requestId))
      return
    }
    const reference = await client.downloadReference(item, admission)
    admission.throwIfAborted()
    try {
      spool = await spooler(reference, Number(item.size_bytes), item.content_sha256, config.storage.objectOrigin, abort.signal)
    } catch (error) {
      if (error instanceof ProjectResourceError && error.code === "artifact_download_busy")
        throw new ProjectResourceError("project_resource_download_busy", 503, true)
      throw error
    }
    abort.signal.throwIfAborted()
    const currentProjectId = await currentResourceProject(store, scope, projectId, AbortSignal.any([abort.signal, AbortSignal.timeout(10_000)]))
    abort.signal.throwIfAborted()
    if (currentProjectId !== projectId) throw new ProjectResourceError("project_not_found", 404)
    if (!response.destroyed)
      await writeVerifiedDownload(response, spool, { filename: item.filename, mimeType: item.mime_type, requestId: context.requestId }, abort.signal)
  } catch (error) {
    if (response.headersSent) {
      response.destroy()
      return
    }
    if (response.destroyed) return
    const known = error instanceof ProjectResourceError ? error : new ProjectResourceError("storage_unavailable", 503, true)
    send(response, known.status, failure(known.code, "Project resource could not be read", context.requestId))
  } finally {
    await spool?.cleanup()
    request.off("aborted", cancel)
    response.off("close", cancel)
  }
}
