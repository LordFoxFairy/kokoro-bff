import { createHash } from "node:crypto"
import { mkdtemp, open, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ProjectResourceError } from "../../../application/project-resource.error.js"

export type ArtifactDownloadReference = Readonly<{ url: string; method: string; requiredHeaders: Record<string, string>; expiresAt: number }>
export type VerifiedArtifactSpool = Readonly<{ path: string; size: number; cleanup: () => Promise<void> }>
export type DeadlineClock = Readonly<{
  schedule: (callback: () => void, milliseconds: number) => ReturnType<typeof setTimeout>
  clear: (timer: ReturnType<typeof setTimeout> | undefined) => void
}>
export type ArtifactSpoolTimings = Readonly<{ totalMs: number; idleMs: number; clock?: DeadlineClock }>

const MAX_ARTIFACT_BYTES = 1_073_741_824
const MAX_ACTIVE_SPOOLS = 2
const DEFAULT_TIMINGS: ArtifactSpoolTimings = { totalMs: 7 * 60_000, idleMs: 45_000 }
const SYSTEM_CLOCK: DeadlineClock = { schedule: (callback, milliseconds) => setTimeout(callback, milliseconds), clear: (timer) => clearTimeout(timer) }
let activeSpools = 0

function acquireSpoolSlot(): () => void {
  if (activeSpools >= MAX_ACTIVE_SPOOLS) throw new ProjectResourceError("artifact_download_busy", 503, true)
  activeSpools++
  let released = false
  return () => {
    if (released) return
    released = true
    activeSpools--
  }
}

/** Nothing is returned until the complete private object matches the owner receipt. */
export async function spoolVerifiedArtifact(
  reference: ArtifactDownloadReference,
  expectedSize: number,
  expectedSha256: string,
  allowedOrigin: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
  temporaryRoot = tmpdir(),
  timings: ArtifactSpoolTimings = DEFAULT_TIMINGS,
): Promise<VerifiedArtifactSpool> {
  let url: URL
  try {
    url = new URL(reference.url)
  } catch {
    throw new ProjectResourceError("storage_response_invalid", 502)
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.origin !== allowedOrigin ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== "" ||
    reference.method !== "GET" ||
    Object.keys(reference.requiredHeaders).length !== 0 ||
    !Number.isFinite(reference.expiresAt) ||
    reference.expiresAt <= Date.now() ||
    reference.expiresAt > Date.now() + 301_000 ||
    !Number.isSafeInteger(expectedSize) ||
    expectedSize < 0 ||
    expectedSize > MAX_ARTIFACT_BYTES ||
    !/^[0-9a-f]{64}$/u.test(expectedSha256)
  )
    throw new ProjectResourceError("storage_response_invalid", 502)

  const release = acquireSpoolSlot()
  const clock = timings.clock ?? SYSTEM_CLOCK
  const deadline = new AbortController()
  const transferSignal = AbortSignal.any([signal, deadline.signal])
  const totalTimer = clock.schedule(() => deadline.abort(), timings.totalMs)
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  const resetIdle = (): void => {
    clock.clear(idleTimer)
    idleTimer = clock.schedule(() => deadline.abort(), timings.idleMs)
  }
  resetIdle()
  let directory: string | undefined
  let cleaned = false
  const cleanup = async (): Promise<void> => {
    if (cleaned) return
    cleaned = true
    try {
      if (directory !== undefined) await rm(directory, { recursive: true, force: true })
    } finally {
      release()
    }
  }
  let body: ReadableStream<Uint8Array> | null = null
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  let readerCancellationStarted = false
  const cancelReader = (): void => {
    if (reader === undefined || readerCancellationStarted) return
    readerCancellationStarted = true
    try {
      void reader.cancel().catch(() => undefined)
    } catch {
      // The transfer signal already closes the underlying fetch transport.
    }
  }
  try {
    transferSignal.throwIfAborted()
    const response = await fetcher(url, { method: "GET", redirect: "manual", credentials: "omit", signal: transferSignal })
    transferSignal.throwIfAborted()
    body = response.body
    if (response.status !== 200)
      throw new ProjectResourceError(
        response.status >= 500 ? "storage_unavailable" : "storage_response_invalid",
        response.status >= 500 ? 503 : 502,
        response.status >= 500,
      )
    const declaredLength = response.headers.get("content-length")
    if (declaredLength !== null && (!/^(0|[1-9][0-9]*)$/u.test(declaredLength) || Number(declaredLength) !== expectedSize))
      throw new ProjectResourceError("storage_response_invalid", 502)
    if (body === null) throw new ProjectResourceError("storage_response_invalid", 502)
    directory = await mkdtemp(join(temporaryRoot, "kokoro-bff-artifact-"))
    transferSignal.throwIfAborted()
    const path = join(directory, "content")
    const file = await open(path, "wx", 0o600)
    let completedLength = 0
    try {
      transferSignal.throwIfAborted()
      reader = body.getReader()
      transferSignal.addEventListener("abort", cancelReader, { once: true })
      const digest = createHash("sha256")
      let length = 0
      while (true) {
        transferSignal.throwIfAborted()
        const { done, value } = await reader.read()
        transferSignal.throwIfAborted()
        if (done) break
        length += value.byteLength
        if (length > expectedSize || length > MAX_ARTIFACT_BYTES) throw new ProjectResourceError("storage_response_invalid", 502)
        digest.update(value)
        let written = 0
        while (written < value.byteLength) {
          const result = await file.write(value, written, value.byteLength - written)
          if (result.bytesWritten <= 0) throw new ProjectResourceError("storage_response_invalid", 502)
          written += result.bytesWritten
          transferSignal.throwIfAborted()
          resetIdle()
        }
      }
      if (length !== expectedSize || digest.digest("hex") !== expectedSha256) throw new ProjectResourceError("storage_response_invalid", 502)
      await file.sync()
      transferSignal.throwIfAborted()
      completedLength = length
    } finally {
      await file.close()
    }
    transferSignal.throwIfAborted()
    return { path, size: completedLength, cleanup }
  } catch (error) {
    const aborted = transferSignal.aborted
    deadline.abort()
    if (reader === undefined) {
      try {
        void body?.cancel().catch(() => undefined)
      } catch {
        // Cancellation is best effort; it must not retain the local spool slot.
      }
    } else cancelReader()
    await cleanup()
    if (aborted) throw new ProjectResourceError("storage_unavailable", 503, true)
    if (error instanceof ProjectResourceError) throw error
    throw new ProjectResourceError("storage_unavailable", 503, true)
  } finally {
    clock.clear(totalTimer)
    clock.clear(idleTimer)
    transferSignal.removeEventListener("abort", cancelReader)
    try {
      reader?.releaseLock()
    } catch {
      // A producer that ignores cancellation may still have a pending read.
    }
  }
}
