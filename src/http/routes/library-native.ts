import type { IncomingMessage, ServerResponse } from "node:http"
import type { BffConfig } from "../../config/runtime.js"
import type { RequestContext } from "../../domain/request-context.js"
import type { ArtifactLibraryRepository } from "../../application/ports/bff-business-store.js"
import type { IdempotencyRepository } from "../../application/ports/idempotency-repository.js"
import type { IdempotencyEntry } from "../../application/idempotency.js"
import { pathOf } from "../request.js"
import { libraryFileListRoute } from "./library-file-list.js"
import { libraryArtifactRoute } from "./library-artifact.js"
import { libraryArtifactDownloadRoute } from "./library-artifact-download.js"
import { personalFileDownloadRoute } from "./personal-file-download.js"
import { personalFileUploadRoute } from "./personal-file-upload.js"

export type LibraryProvider = Readonly<{
  artifactLibrary?: ArtifactLibraryRepository
  receipts: IdempotencyRepository | null
  idempotency: Map<string, IdempotencyEntry>
}>

export function libraryRequest(request: IncomingMessage): boolean {
  try {
    const path = pathOf(request).slice(1)
    if (path[0] !== "library") return false
    if (request.method === "GET" && path.length === 1) return true
    if (request.method === "GET" && path.length === 4 && path[1] === "artifacts") return true
    if (request.method === "GET" && path.length === 5 && path[1] === "artifacts" && path[4] === "content") return true
    if (request.method === "GET" && path.length === 4 && path[1] === "files" && path[3] === "content") return true
    return request.method === "POST" && path.length === 2 && path[1] === "files"
  } catch {
    return false
  }
}

export async function handleLibraryRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  context: RequestContext,
  provider: LibraryProvider,
  body: Buffer = Buffer.alloc(0),
): Promise<boolean> {
  if (!libraryRequest(request)) return false
  const path = pathOf(request).slice(1)
  if (path.length === 1 && path[0] === "library") {
    await libraryFileListRoute(request, response, config, context, undefined, provider.artifactLibrary)
    return true
  }
  if (path.length === 4 && path[1] === "artifacts") {
    await libraryArtifactRoute(request, response, config, context, provider.artifactLibrary, path[2] ?? "", path[3] ?? "")
    return true
  }
  if (path.length === 5 && path[1] === "artifacts" && path[4] === "content") {
    await libraryArtifactDownloadRoute(request, response, config, context, provider.artifactLibrary, path[2] ?? "", path[3] ?? "")
    return true
  }
  if (path.length === 4 && path[1] === "files" && path[3] === "content") {
    await personalFileDownloadRoute(request, response, config, context, path[2] ?? "")
    return true
  }
  await personalFileUploadRoute(request, response, config, context, body, provider.receipts, provider.idempotency)
  return true
}
