import { createHash } from "node:crypto"
import { assetDownloadRemaining, withinAssetDownloadBudget } from "../../../application/asset-download-budget.js"
import { AssetDownloadError } from "./asset-download.error.js"
import type { AssetDownloadReference } from "./asset-download.types.js"

const MAX_FILE_BYTES = 1_048_576

function retireResponse(response: Response): void {
  try {
    void response.body?.cancel().catch(() => undefined)
  } catch {
    // A late response may already have closed; it can never become public bytes.
  }
}

async function cancelTransfer(cancel: () => Promise<unknown>, signal: AbortSignal, deadlineAt: number): Promise<void> {
  try {
    // Cancellation must be attempted even when the business budget has expired.
    const pending = cancel()
    void pending.catch(() => undefined)
    await withinAssetDownloadBudget(signal, deadlineAt, () => pending)
  } catch {
    // Never let an uncooperative cancellation hold the completed request open.
  }
}

function referenceUrl(reference: AssetDownloadReference, size: number, sha: string, origin: string): URL {
  let url: URL
  try {
    url = new URL(reference.url)
  } catch {
    throw new AssetDownloadError("storage_response_invalid", 502)
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.origin !== origin ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== "" ||
    reference.method !== "GET" ||
    Object.keys(reference.requiredHeaders).length !== 0 ||
    !Number.isFinite(reference.expiresAt) ||
    reference.expiresAt <= Date.now() ||
    reference.expiresAt > Date.now() + 301_000 ||
    !Number.isSafeInteger(size) ||
    size < 0 ||
    size > MAX_FILE_BYTES ||
    !/^[0-9a-f]{64}$/u.test(sha)
  )
    throw new AssetDownloadError("storage_response_invalid", 502)
  return url
}

export async function readAssetBytes(
  reference: AssetDownloadReference,
  expectedSize: number,
  expectedSha256: string,
  allowedOrigin: string,
  signal: AbortSignal,
  deadlineAt: number,
  fetcher: typeof fetch = fetch,
): Promise<Buffer> {
  const url = referenceUrl(reference, expectedSize, expectedSha256, allowedOrigin)
  try {
    const response = await withinAssetDownloadBudget(
      signal,
      deadlineAt,
      () => fetcher(url, { method: "GET", redirect: "manual", credentials: "omit", signal }),
      retireResponse,
    )
    if (response.status !== 200) {
      await cancelTransfer(() => response.body?.cancel() ?? Promise.resolve(), signal, deadlineAt)
      throw new AssetDownloadError(
        response.status >= 500 ? "storage_unavailable" : "storage_response_invalid",
        response.status >= 500 ? 503 : 502,
        response.status >= 500,
      )
    }
    const declared = response.headers.get("content-length")
    if (declared !== null && (!/^(0|[1-9][0-9]*)$/u.test(declared) || Number(declared) !== expectedSize)) {
      await cancelTransfer(() => response.body?.cancel() ?? Promise.resolve(), signal, deadlineAt)
      throw new AssetDownloadError("storage_response_invalid", 502)
    }
    if (response.body === null) throw new AssetDownloadError("storage_response_invalid", 502)
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let length = 0
    try {
      while (true) {
        const { done, value } = await withinAssetDownloadBudget(signal, deadlineAt, () => reader.read())
        if (done) break
        length += value.byteLength
        if (length > expectedSize || length > MAX_FILE_BYTES) throw new AssetDownloadError("storage_response_invalid", 502)
        chunks.push(value)
      }
    } catch (error) {
      await cancelTransfer(() => reader.cancel(), signal, deadlineAt)
      throw error
    } finally {
      reader.releaseLock()
    }
    assetDownloadRemaining(signal, deadlineAt)
    const bytes = Buffer.concat(chunks, length)
    if (bytes.length !== expectedSize || createHash("sha256").update(bytes).digest("hex") !== expectedSha256)
      throw new AssetDownloadError("storage_response_invalid", 502)
    return bytes
  } catch (error) {
    try {
      assetDownloadRemaining(signal, deadlineAt)
    } catch {
      throw new AssetDownloadError("storage_unavailable", 503, true)
    }
    if (error instanceof AssetDownloadError) throw error
    throw new AssetDownloadError("storage_unavailable", 503, true)
  }
}
