import type { IncomingMessage, ServerResponse } from "node:http"
import type { BffConfig } from "../../config/runtime.js"
import type { RequestContext } from "../../domain/request-context.js"
import type { ArtifactAssociation, ArtifactLibraryRepository, ArtifactPosition } from "../../application/ports/bff-business-store.js"
import { ProjectResourceError } from "../../application/project-resource.error.js"
import { FinalArtifactClient, type FinalArtifactContext, type FinalArtifact } from "../../infrastructure/clients/storage/final-artifact.js"
import { failure, ok } from "../../contracts/index.js"
import { send } from "../response.js"

type PageInput = Readonly<{ kind: "artifact"; limit: number; cursor: string }>

function positionOf(association: ArtifactAssociation): ArtifactPosition {
  return { deliveredAt: association.deliveredAt, conversationId: association.conversationId, artifactId: association.artifactId }
}

function encodeCursor(tenantId: string, subjectId: string, limit: number, position: ArtifactPosition): string {
  return `art1_${Buffer.from(JSON.stringify({ kind: "artifact", tenantId, subjectId, limit, ...position })).toString("base64url")}`
}

function decodeCursor(cursor: string, tenantId: string, subjectId: string, limit: number): ArtifactPosition | null {
  if (cursor === "") return null
  if (!cursor.startsWith("art1_")) throw new ProjectResourceError("invalid_library_page", 400)
  const encoded = cursor.slice(5)
  if (encoded.length === 0 || Buffer.from(encoded, "base64url").toString("base64url") !== encoded) throw new ProjectResourceError("invalid_library_page", 400)
  let value: unknown
  try {
    value = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"))
  } catch {
    throw new ProjectResourceError("invalid_library_page", 400)
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new ProjectResourceError("invalid_library_page", 400)
  const fields = value as Record<string, unknown>
  if (
    Object.keys(fields).sort().join(",") !== "artifactId,conversationId,deliveredAt,kind,limit,subjectId,tenantId" ||
    fields.kind !== "artifact" ||
    fields.tenantId !== tenantId ||
    fields.subjectId !== subjectId ||
    fields.limit !== limit ||
    typeof fields.deliveredAt !== "string" ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(fields.deliveredAt) ||
    !Number.isFinite(Date.parse(fields.deliveredAt)) ||
    typeof fields.conversationId !== "string" ||
    fields.conversationId.length === 0 ||
    typeof fields.artifactId !== "string" ||
    fields.artifactId.length === 0
  )
    throw new ProjectResourceError("invalid_library_page", 400)
  if (new Date(fields.deliveredAt).toISOString() !== fields.deliveredAt) throw new ProjectResourceError("invalid_library_page", 400)
  return { deliveredAt: fields.deliveredAt, conversationId: fields.conversationId, artifactId: fields.artifactId }
}

export async function libraryArtifactListRoute(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  context: RequestContext,
  input: PageInput,
  repository: ArtifactLibraryRepository | undefined,
  clientFactory: (config: NonNullable<BffConfig["storage"]>, context: FinalArtifactContext) => Pick<FinalArtifactClient, "get"> = (storage, scope) =>
    new FinalArtifactClient(storage, scope),
): Promise<void> {
  const cancellation = new AbortController()
  const cancel = (): void => {
    if (!response.writableEnded) cancellation.abort()
  }
  request.once("aborted", cancel)
  response.once("close", cancel)
  const signal = AbortSignal.any([cancellation.signal, AbortSignal.timeout(30_000)])
  response.setHeader("x-request-id", context.requestId)
  try {
    if (repository === undefined || config.storage === undefined) throw new ProjectResourceError("artifact_library_unavailable", 503, true)
    const tenantId = context.identity.namespace
    const subjectId = context.identity.userId
    const position = decodeCursor(input.cursor, tenantId, subjectId, input.limit)
    const budget = Math.min(500, input.limit * 5)
    const candidates = await repository.listCandidates(tenantId, subjectId, position, budget + 1)
    if (candidates.length > budget + 1) throw new ProjectResourceError("business_store_unavailable", 503, true)
    const items: FinalArtifact[] = []
    let last: ArtifactAssociation | undefined
    for (const candidate of candidates.slice(0, budget)) {
      signal.throwIfAborted()
      last = candidate
      try {
        const item = await clientFactory(config.storage, { tenantId, subjectId, conversationId: candidate.conversationId, requestId: context.requestId }).get(
          candidate,
          signal,
        )
        items.push(item)
      } catch (error) {
        if (!(error instanceof ProjectResourceError && error.status === 404)) throw error
      }
      if (items.length === input.limit) break
    }
    const nextCursor =
      last !== undefined && (candidates.length > budget || candidates.at(-1) !== last) ? encodeCursor(tenantId, subjectId, input.limit, positionOf(last)) : null
    send(response, 200, ok({ items, next_cursor: nextCursor }, context.requestId))
  } catch (error) {
    if (response.destroyed) return
    const known = error instanceof ProjectResourceError ? error : new ProjectResourceError("business_store_unavailable", 503, true)
    send(response, known.status, failure(known.code, "Artifact library could not be read", context.requestId))
  } finally {
    request.off("aborted", cancel)
    response.off("close", cancel)
  }
}
