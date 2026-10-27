import { createReadStream } from "node:fs"
import type { ServerResponse } from "node:http"
import { Writable } from "node:stream"
import { pipeline } from "node:stream/promises"
import type { DeadlineClock, VerifiedArtifactSpool } from "../infrastructure/clients/storage/artifact-download-transfer.js"
import { ProjectResourceError } from "../application/project-resource.error.js"

export type VerifiedDownloadTimings = Readonly<{ totalMs: number; idleMs: number; clock?: DeadlineClock }>
const DEFAULT_TIMINGS: VerifiedDownloadTimings = { totalMs: 28 * 60_000, idleMs: 25_000 }
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
/** Transfer an already verified private spool. Contains no Asset/Artifact authorization. */
export async function writeVerifiedDownload(
  response: ServerResponse,
  spool: VerifiedArtifactSpool,
  metadata: Readonly<{ filename: string; mimeType: string; requestId: string }>,
  signal: AbortSignal,
  timings: VerifiedDownloadTimings = DEFAULT_TIMINGS,
): Promise<void> {
  signal.throwIfAborted()
  const clock = timings.clock ?? SYSTEM_CLOCK
  const deadline = new AbortController()
  const outboundSignal = AbortSignal.any([signal, deadline.signal])
  const totalTimer = clock.schedule(() => deadline.abort(), timings.totalMs)
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  const resetIdle = (): void => {
    clock.clear(idleTimer)
    idleTimer = clock.schedule(() => deadline.abort(), timings.idleMs)
  }
  let active = true
  resetIdle()
  const outbound = new Writable({
    write(chunk, _encoding, callback) {
      if (response.destroyed) return callback(new Error("Download response closed"))
      try {
        response.write(chunk, (error) => {
          if (active && !outboundSignal.aborted && (error === undefined || error === null)) resetIdle()
          callback(error)
        })
      } catch (error) {
        callback(error instanceof Error ? error : new Error("Download response write failed"))
      }
    },
    final(callback) {
      response.end(callback)
    },
  })
  try {
    response.writeHead(200, {
      "content-type": metadata.mimeType,
      "content-length": spool.size,
      "content-disposition": safeDisposition(metadata.filename),
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "x-request-id": metadata.requestId,
    })
    await pipeline(createReadStream(spool.path), outbound, { signal: outboundSignal })
    if (!response.writableFinished) throw new ProjectResourceError("storage_unavailable", 503, true)
  } finally {
    active = false
    clock.clear(totalTimer)
    clock.clear(idleTimer)
  }
}
