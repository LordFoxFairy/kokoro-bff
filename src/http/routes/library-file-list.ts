import type { IncomingMessage, ServerResponse } from "node:http"
import type { BffConfig } from "../../config/runtime.js"
import type { RequestContext } from "../../domain/request-context.js"
import { ProjectResourceError } from "../../application/project-resource.error.js"
import { PersonalFileListClient, type PersonalFileContext } from "../../infrastructure/clients/storage/personal-file-list.js"
import { libraryFileListInput } from "../library-file-list-input.js"
import { failure, ok } from "../../contracts/index.js"
import { send } from "../response.js"
import type { ArtifactLibraryRepository } from "../../application/ports/bff-business-store.js"
import { libraryArtifactListRoute } from "./library-artifact-list.js"

export async function libraryFileListRoute(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  context: RequestContext,
  clientFactory: (config: NonNullable<BffConfig["storage"]>, context: PersonalFileContext) => Pick<PersonalFileListClient, "listAssets"> = (cfg, scope) =>
    new PersonalFileListClient(cfg, scope),
  artifactLibrary?: ArtifactLibraryRepository,
): Promise<void> {
  const cancellation = new AbortController()
  const cancel = (): void => {
    if (!response.writableEnded) cancellation.abort()
  }
  request.once("aborted", cancel)
  response.once("close", cancel)
  const signal = AbortSignal.any([cancellation.signal, AbortSignal.timeout(10_000)])
  response.setHeader("x-request-id", context.requestId)
  try {
    if (request.headers["transfer-encoding"] !== undefined || (request.headers["content-length"] !== undefined && request.headers["content-length"] !== "0"))
      throw new ProjectResourceError("invalid_library_page", 400)
    const input = libraryFileListInput(new URL(request.url ?? "/", "http://bff.invalid").searchParams)
    if (input.kind === "artifact") {
      await libraryArtifactListRoute(request, response, config, context, input, artifactLibrary)
      return
    }
    if (config.storage === undefined) throw new ProjectResourceError("storage_unavailable", 503, true)
    const page = await clientFactory(config.storage, {
      tenantId: context.identity.namespace,
      subjectId: context.identity.userId,
      requestId: context.requestId,
    }).listAssets(input, signal)
    send(response, 200, ok(page, context.requestId))
  } catch (error) {
    const known = error instanceof ProjectResourceError ? error : new ProjectResourceError("storage_unavailable", 503, true)
    send(response, known.status, failure(known.code, "Personal library files could not be read", context.requestId))
  } finally {
    request.off("aborted", cancel)
    response.off("close", cancel)
  }
}
