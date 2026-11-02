import { writeVerifiedDownload } from "../verified-download.js"
import type { IncomingMessage, ServerResponse } from "node:http"
import type { BffConfig } from "../../config/runtime.js"
import type { RequestContext } from "../../domain/request-context.js"
import type { ArtifactLibraryRepository } from "../../application/ports/bff-business-store.js"
import { ProjectResourceError } from "../../application/project-resource.error.js"
import { FinalArtifactClient } from "../../infrastructure/clients/storage/final-artifact.js"
import { spoolVerifiedArtifact, type DeadlineClock, type VerifiedArtifactSpool } from "../../infrastructure/clients/storage/artifact-download-transfer.js"
import { failure } from "../../contracts/index.js"
import { send } from "../response.js"
import { readPrivateArtifact, validateArtifactSelector, type FinalArtifactFactory } from "./library-artifact.js"

type ArtifactRouteTimings = Readonly<{ admissionMs: number; outboundTotalMs: number; outboundIdleMs: number; clock?: DeadlineClock }>
const DEFAULT_TIMINGS: ArtifactRouteTimings = {
  admissionMs: 120_000,
  outboundTotalMs: 28 * 60_000,
  outboundIdleMs: 25_000,
}
const SYSTEM_CLOCK: DeadlineClock = { schedule: (callback, milliseconds) => setTimeout(callback, milliseconds), clear: (timer) => clearTimeout(timer) }

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
  timings: ArtifactRouteTimings = DEFAULT_TIMINGS,
): Promise<void> {
  const clock = timings.clock ?? SYSTEM_CLOCK
  const cancellation = new AbortController()
  const cancel = (): void => {
    if (!response.writableFinished) cancellation.abort()
  }
  request.once("aborted", cancel)
  response.once("close", cancel)
  response.setHeader("x-request-id", context.requestId)
  response.setHeader("referrer-policy", "no-referrer")
  response.setHeader("x-content-type-options", "nosniff")
  let spool: VerifiedArtifactSpool | null = null
  let admissionSignal: AbortSignal | undefined
  try {
    validateArtifactSelector(request, conversationId, artifactId)
    const admissionDeadline = new AbortController()
    admissionSignal = AbortSignal.any([cancellation.signal, admissionDeadline.signal])
    const admissionTimer = clock.schedule(() => admissionDeadline.abort(), timings.admissionMs)
    let admitted
    let reference
    try {
      admitted = await readPrivateArtifact(config, context, repository, conversationId, artifactId, admissionSignal, clientFactory)
      reference = await admitted.client.downloadReference(admitted.item, admissionSignal)
      admissionSignal.throwIfAborted()
    } finally {
      clock.clear(admissionTimer)
    }
    if (config.storage === undefined) throw new ProjectResourceError("artifact_library_unavailable", 503, true)
    spool = await spooler(reference, Number(admitted.item.size_bytes), admitted.item.content_sha256, config.storage.objectOrigin, cancellation.signal)
    if (cancellation.signal.aborted || response.destroyed) return
    await writeVerifiedDownload(
      response,
      spool,
      { filename: admitted.item.filename, mimeType: admitted.item.mime_type, requestId: context.requestId },
      cancellation.signal,
      { totalMs: timings.outboundTotalMs, idleMs: timings.outboundIdleMs, clock },
    )
  } catch (error) {
    if (response.headersSent) {
      response.destroy()
      return
    }
    if (response.destroyed) return
    const known = admissionSignal?.aborted
      ? new ProjectResourceError("storage_unavailable", 503, true)
      : error instanceof ProjectResourceError
        ? error
        : new ProjectResourceError("storage_unavailable", 503, true)
    send(response, known.status, failure(known.code, "Library artifact download did not complete", context.requestId))
  } finally {
    await spool?.cleanup()
    request.off("aborted", cancel)
    response.off("close", cancel)
  }
}
