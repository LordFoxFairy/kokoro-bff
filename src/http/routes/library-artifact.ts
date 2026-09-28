import type { IncomingMessage, ServerResponse } from "node:http"
import type { BffConfig } from "../../config/runtime.js"
import type { RequestContext } from "../../domain/request-context.js"
import type { ArtifactLibraryRepository } from "../../application/ports/bff-business-store.js"
import { ProjectResourceError } from "../../application/project-resource.error.js"
import { FinalArtifactClient, type FinalArtifact, type FinalArtifactContext } from "../../infrastructure/clients/storage/final-artifact.js"
import { failure, ok } from "../../contracts/index.js"
import { send } from "../response.js"

export type FinalArtifactFactory = (
  storage: NonNullable<BffConfig["storage"]>,
  context: FinalArtifactContext,
) => Pick<FinalArtifactClient, "get" | "downloadReference">

export function validateArtifactSelector(request: IncomingMessage, conversationId: string, artifactId: string): void {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(conversationId) ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(artifactId) ||
    new URL(request.url ?? "/", "http://bff.invalid").search !== "" ||
    request.headers["transfer-encoding"] !== undefined ||
    (request.headers["content-length"] !== undefined && request.headers["content-length"] !== "0")
  )
    throw new ProjectResourceError("invalid_library_artifact", 400)
}

export async function readPrivateArtifact(
  config: BffConfig,
  context: RequestContext,
  repository: ArtifactLibraryRepository | undefined,
  conversationId: string,
  artifactId: string,
  signal: AbortSignal,
  clientFactory: FinalArtifactFactory,
): Promise<{ item: FinalArtifact; client: Pick<FinalArtifactClient, "get" | "downloadReference"> }> {
  if (repository === undefined || config.storage === undefined) throw new ProjectResourceError("artifact_library_unavailable", 503, true)
  const tenantId = context.identity.namespace
  const subjectId = context.identity.userId
  let association
  try {
    association = await repository.findCandidate(tenantId, subjectId, conversationId, artifactId)
  } catch {
    throw new ProjectResourceError("business_store_unavailable", 503, true)
  }
  if (association === null) throw new ProjectResourceError("library_artifact_not_found", 404)
  const client = clientFactory(config.storage, { tenantId, subjectId, conversationId, requestId: context.requestId })
  const item = await client.get(association, signal)
  return { item, client }
}

export async function libraryArtifactRoute(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  context: RequestContext,
  repository: ArtifactLibraryRepository | undefined,
  conversationId: string,
  artifactId: string,
  clientFactory: FinalArtifactFactory = (storage, scope) => new FinalArtifactClient(storage, scope),
): Promise<void> {
  const cancellation = new AbortController()
  const cancel = (): void => {
    if (!response.writableEnded) cancellation.abort()
  }
  request.once("aborted", cancel)
  response.once("close", cancel)
  const signal = AbortSignal.any([cancellation.signal, AbortSignal.timeout(20_000)])
  response.setHeader("x-request-id", context.requestId)
  try {
    validateArtifactSelector(request, conversationId, artifactId)
    const { item } = await readPrivateArtifact(config, context, repository, conversationId, artifactId, signal, clientFactory)
    if (!response.destroyed) send(response, 200, ok(item, context.requestId))
  } catch (error) {
    if (response.destroyed) return
    const known = error instanceof ProjectResourceError ? error : new ProjectResourceError("storage_unavailable", 503, true)
    send(response, known.status, failure(known.code, "Library artifact could not be read", context.requestId))
  } finally {
    request.off("aborted", cancel)
    response.off("close", cancel)
  }
}
