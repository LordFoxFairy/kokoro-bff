import { createHash } from "node:crypto"
import { mkdtemp, open, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ProjectResourceError } from "../../../application/project-resource.error.js"

export type ArtifactDownloadReference = Readonly<{ url: string; method: string; requiredHeaders: Record<string, string>; expiresAt: number }>
export type VerifiedArtifactSpool = Readonly<{ path: string; size: number; cleanup: () => Promise<void> }>

const MAX_ARTIFACT_BYTES = 1_073_741_824
const MAX_ACTIVE_SPOOLS = 2
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
  let response: Response
  try {
    response = await fetcher(url, { method: "GET", redirect: "manual", credentials: "omit", signal })
  } catch {
    release()
    throw new ProjectResourceError("storage_unavailable", 503, true)
  }
  if (response.status !== 200) {
    await response.body?.cancel().catch(() => undefined)
    release()
    throw new ProjectResourceError(
      response.status >= 500 ? "storage_unavailable" : "storage_response_invalid",
      response.status >= 500 ? 503 : 502,
      response.status >= 500,
    )
  }
  const declaredLength = response.headers.get("content-length")
  if (declaredLength !== null && (!/^(0|[1-9][0-9]*)$/u.test(declaredLength) || Number(declaredLength) !== expectedSize)) {
    await response.body?.cancel().catch(() => undefined)
    release()
    throw new ProjectResourceError("storage_response_invalid", 502)
  }
  if (response.body === null) {
    release()
    throw new ProjectResourceError("storage_response_invalid", 502)
  }

  let directory: string
  try {
    directory = await mkdtemp(join(temporaryRoot, "kokoro-bff-artifact-"))
  } catch {
    await response.body.cancel().catch(() => undefined)
    release()
    throw new ProjectResourceError("storage_unavailable", 503, true)
  }
  const path = join(directory, "content")
  let cleaned = false
  const cleanup = async (): Promise<void> => {
    if (cleaned) return
    cleaned = true
    try {
      await rm(directory, { recursive: true, force: true })
    } finally {
      release()
    }
  }
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    const file = await open(path, "wx", 0o600)
    try {
      reader = response.body.getReader()
      const digest = createHash("sha256")
      let length = 0
      while (true) {
        signal.throwIfAborted()
        const { done, value } = await reader.read()
        if (done) break
        length += value.byteLength
        if (length > expectedSize || length > MAX_ARTIFACT_BYTES) throw new ProjectResourceError("storage_response_invalid", 502)
        digest.update(value)
        let written = 0
        while (written < value.byteLength) {
          const result = await file.write(value, written, value.byteLength - written)
          if (result.bytesWritten <= 0) throw new ProjectResourceError("storage_response_invalid", 502)
          written += result.bytesWritten
        }
      }
      if (length !== expectedSize || digest.digest("hex") !== expectedSha256) throw new ProjectResourceError("storage_response_invalid", 502)
      await file.sync()
      return { path, size: length, cleanup }
    } finally {
      await file.close()
    }
  } catch (error) {
    if (reader === undefined) await response.body.cancel().catch(() => undefined)
    else await reader.cancel().catch(() => undefined)
    await cleanup()
    if (error instanceof ProjectResourceError) throw error
    throw new ProjectResourceError("storage_unavailable", 503, true)
  } finally {
    reader?.releaseLock()
  }
}
