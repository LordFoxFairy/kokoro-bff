import { createReadStream } from "node:fs"
import type { IncomingMessage, ServerResponse } from "node:http"
import { Writable } from "node:stream"
import { pipeline } from "node:stream/promises"
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
    const outboundDeadline = new AbortController()
    const outboundSignal = AbortSignal.any([cancellation.signal, outboundDeadline.signal])
    const totalTimer = clock.schedule(() => outboundDeadline.abort(), timings.outboundTotalMs)
    let idleTimer: ReturnType<typeof setTimeout> | undefined
    const resetIdle = (): void => {
      clock.clear(idleTimer)
      idleTimer = clock.schedule(() => outboundDeadline.abort(), timings.outboundIdleMs)
    }
    let outboundActive = true
    resetIdle()
    const outbound = new Writable({
      write(chunk, _encoding, callback) {
        if (response.destroyed) return callback(new Error("Artifact response closed"))
        try {
          response.write(chunk, (error) => {
            if (outboundActive && !outboundSignal.aborted && (error === undefined || error === null)) resetIdle()
            callback(error)
          })
        } catch (error) {
          callback(error instanceof Error ? error : new Error("Artifact response write failed"))
        }
      },
      final(callback) {
        response.end(callback)
      },
    })
    try {
      response.writeHead(200, {
        "content-type": admitted.item.mime_type,
        "content-length": spool.size,
        "content-disposition": safeDisposition(admitted.item.filename),
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
        "x-request-id": context.requestId,
      })
      await pipeline(createReadStream(spool.path), outbound, { signal: outboundSignal })
      if (!response.writableFinished) throw new ProjectResourceError("storage_unavailable", 503, true)
    } finally {
      outboundActive = false
      clock.clear(totalTimer)
      clock.clear(idleTimer)
    }
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
