import type { IncomingMessage, ServerResponse } from "node:http"
import type { BffConfig } from "../../config/runtime.js"
import type { RequestContext } from "../../domain/request-context.js"
import type { ArtifactDetailCandidate, ArtifactLibraryRepository } from "../../application/account/artifact-library-repository.js"
import { ProjectResourceError } from "../../application/project-resource.error.js"
import { FinalArtifactClient, type FinalArtifact, type FinalArtifactContext } from "../../infrastructure/clients/storage/final-artifact.js"
import { failure, ok } from "../../contracts/index.js"
import { send } from "../response.js"
import { readBodyBeforeDeadline } from "../request-body.js"
import { requestBodyJson, requestContentType } from "../request.js"

export type FinalArtifactFactory = (
  storage: NonNullable<BffConfig["storage"]>,
  context: FinalArtifactContext,
) => Pick<FinalArtifactClient, "get" | "downloadReference">

function validateArtifactTarget(request: IncomingMessage, conversationId: string, artifactId: string): void {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(conversationId) ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(artifactId) ||
    new URL(request.url ?? "/", "http://bff.invalid").search !== ""
  )
    throw new ProjectResourceError("invalid_library_artifact", 400)
}

export function validateArtifactSelector(request: IncomingMessage, conversationId: string, artifactId: string): void {
  validateArtifactTarget(request, conversationId, artifactId)
  if (request.headers["transfer-encoding"] !== undefined || (request.headers["content-length"] !== undefined && request.headers["content-length"] !== "0"))
    throw new ProjectResourceError("invalid_library_artifact", 400)
}

async function favoriteTarget(request: IncomingMessage, signal: AbortSignal): Promise<boolean> {
  if (/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(requestContentType(request))) {
    try {
      const body = requestBodyJson(request, await readBodyBeforeDeadline(request, signal, 256))
      if (body !== null && Object.keys(body).length === 1 && typeof body.favorited === "boolean") return body.favorited
    } catch {
      signal.throwIfAborted()
    }
  }
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
): Promise<{
  association: ArtifactDetailCandidate
  item: FinalArtifact
  client: Pick<FinalArtifactClient, "get" | "downloadReference">
  projectRef: string | null | undefined
  favorited: boolean
}> {
  if (repository === undefined || config.storage === undefined) throw new ProjectResourceError("artifact_library_unavailable", 503, true)
  const tenantId = context.identity.namespace
  const subjectId = context.identity.userId
  let association
  try {
    association = await repository.findCandidate(tenantId, subjectId, conversationId, artifactId, { signal, deadlineAt: performance.now() + 10000 })
  } catch {
    throw new ProjectResourceError("business_store_unavailable", 503, true)
  }
  if (association === null) throw new ProjectResourceError("library_artifact_not_found", 404)
  signal.throwIfAborted()
  const client = clientFactory(config.storage, { tenantId, subjectId, conversationId, requestId: context.requestId })
  const { projectRef: _projectRef, favorited: _favorited, projectAccess: _projectAccess, ...artifact } = association
  const item = await client.get(artifact, signal)
  const current = await assertCurrentArtifact(context, repository, association, signal)
  return { association: current, item, client, projectRef: current.projectRef, favorited: current.favorited }
}

/** The association is rechecked after owner I/O/spooling, never by impersonating its Run actor. */
export async function assertCurrentArtifact(
  context: RequestContext,
  repository: ArtifactLibraryRepository,
  original: ArtifactDetailCandidate,
  signal: AbortSignal,
): Promise<ArtifactDetailCandidate> {
  signal.throwIfAborted()
  const current = await repository.findCandidate(context.identity.namespace, context.identity.userId, original.conversationId, original.artifactId, {
    signal,
    deadlineAt: performance.now() + 10000,
  })
  signal.throwIfAborted()
  if (
    !current ||
    ["conversationId", "artifactId", "runId", "sourceAssetId", "sourceArtifactKind", "sourceContentSha256", "deliveredAt", "projectRef"].some(
      (key) => current[key as keyof ArtifactDetailCandidate] !== original[key as keyof ArtifactDetailCandidate],
    )
  )
    throw new ProjectResourceError("library_artifact_not_found", 404)
  return current
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
  const updating = request.method === "PUT"
  response.setHeader("x-request-id", context.requestId)
  try {
    let target
    if (updating) {
      validateArtifactTarget(request, conversationId, artifactId)
      target = await favoriteTarget(request, signal)
    } else validateArtifactSelector(request, conversationId, artifactId)
    const { association, item, projectRef, favorited } = await readPrivateArtifact(
      config,
      context,
      repository,
      conversationId,
      artifactId,
      signal,
      clientFactory,
    )
    if (target !== undefined) {
      if (association.projectAccess) throw new ProjectResourceError("library_artifact_not_found", 404)
      signal.throwIfAborted()
      if (repository === undefined) throw new ProjectResourceError("artifact_library_unavailable", 503, true)
      let updated
      try {
        updated = await repository.setFavorite({
          tenantId: context.identity.namespace,
          subjectId: context.identity.userId,
          conversationId,
          artifactId,
          runId: item.source_run_id,
          sourceAssetId: item.asset_id,
          sourceContentSha256: item.content_sha256,
          favorited: target,
          signal,
        })
      } catch {
        throw new ProjectResourceError("business_store_unavailable", 503, true)
      }
      if (updated === null) throw new ProjectResourceError("library_artifact_not_found", 404)
      signal.throwIfAborted()
      if (!response.destroyed) send(response, 200, ok({ conversation_id: conversationId, artifact_id: artifactId, favorited: updated }, context.requestId))
      return
    }
    if (!response.destroyed) {
      const { asset_id: _assetId, ...sharedItem } = item
      send(
        response,
        200,
        ok(
          association.projectAccess
            ? { ...sharedItem, project_ref: association.projectAccess.project_id, project_access: association.projectAccess }
            : { ...item, favorited, ...(projectRef === undefined ? {} : { project_ref: projectRef }) },
          context.requestId,
        ),
      )
    }
  } catch (error) {
    if (response.destroyed) return
    const known = error instanceof ProjectResourceError ? error : new ProjectResourceError("storage_unavailable", 503, true)
    send(
      response,
      known.status,
      failure(known.code, updating ? "Library artifact favorite could not be updated" : "Library artifact could not be read", context.requestId),
    )
  } finally {
    request.off("aborted", cancel)
    response.off("close", cancel)
  }
}
