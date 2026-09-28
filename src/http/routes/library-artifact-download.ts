import { createReadStream } from "node:fs"
import type { IncomingMessage, ServerResponse } from "node:http"
import { pipeline } from "node:stream/promises"
import type { BffConfig } from "../../config/runtime.js"
import type { RequestContext } from "../../domain/request-context.js"
import type { ArtifactLibraryRepository } from "../../application/ports/bff-business-store.js"
import { ProjectResourceError } from "../../application/project-resource.error.js"
import { FinalArtifactClient } from "../../infrastructure/clients/storage/final-artifact.js"
import { spoolVerifiedArtifact, type VerifiedArtifactSpool } from "../../infrastructure/clients/storage/artifact-download-transfer.js"
import { failure } from "../../contracts/index.js"
import { send } from "../response.js"
import { readPrivateArtifact, validateArtifactSelector, type FinalArtifactFactory } from "./library-artifact.js"

function safeDisposition(filename: string): string {
  const cleaned =
    filename
      .replace(/[\u0000-\u001f\u007f/\\]/gu, "_")
      .replace(/^\.+/u, "_")
      .slice(0, 255) || "download"
  const fallback = cleaned.replace(/[^\x20-\x7e]/gu, "_").replace(/[";]/gu, "_")
  const encoded = encodeURIComponent(cleaned).replace(/['()*]/gu, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`
}

export async function libraryArtifactDownloadRoute(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  context: RequestContext,
  repository: ArtifactLibraryRepository | undefined,
  conversationId: string,
  artifactId: string,
  clientFactory: FinalArtifactFactory = (storage, scope) => new FinalArtifactClient(storage, scope),
  spooler: typeof spoolVerifiedArtifact = spoolVerifiedArtifact,
): Promise<void> {
  const cancellation = new AbortController()
  const cancel = (): void => {
    if (!response.writableEnded) cancellation.abort()
  }
  request.once("aborted", cancel)
  response.once("close", cancel)
  const signal = AbortSignal.any([cancellation.signal, AbortSignal.timeout(120_000)])
  response.setHeader("x-request-id", context.requestId)
  response.setHeader("referrer-policy", "no-referrer")
  response.setHeader("x-content-type-options", "nosniff")
  let spool: VerifiedArtifactSpool | null = null
  try {
    validateArtifactSelector(request, conversationId, artifactId)
    const { item, client } = await readPrivateArtifact(config, context, repository, conversationId, artifactId, signal, clientFactory)
    const reference = await client.downloadReference(item, signal)
    if (config.storage === undefined) throw new ProjectResourceError("artifact_library_unavailable", 503, true)
    spool = await spooler(reference, Number(item.size_bytes), item.content_sha256, config.storage.objectOrigin, signal)
    if (signal.aborted || response.destroyed) return
    response.writeHead(200, {
      "content-type": item.mime_type,
      "content-length": spool.size,
      "content-disposition": safeDisposition(item.filename),
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "x-request-id": context.requestId,
    })
    await pipeline(createReadStream(spool.path), response, { signal })
  } catch (error) {
    if (response.headersSent) {
      response.destroy()
      return
    }
    if (response.destroyed) return
    const known = error instanceof ProjectResourceError ? error : new ProjectResourceError("storage_unavailable", 503, true)
    send(response, known.status, failure(known.code, "Library artifact download did not complete", context.requestId))
  } finally {
    await spool?.cleanup()
    request.off("aborted", cancel)
    response.off("close", cancel)
  }
}
