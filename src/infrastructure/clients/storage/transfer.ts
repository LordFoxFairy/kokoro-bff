import { ProjectResourceError } from "../../../application/project-resource.error.js"
import type { StorageTransfer } from "../../../application/project-resource.types.js"

export async function putStorageBytes(
  reference: StorageTransfer,
  bytes: Uint8Array,
  mimeType: string,
  allowedOrigin: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  let url: URL
  try {
    url = new URL(reference.url)
  } catch {
    throw new ProjectResourceError("storage_response_invalid", 502)
  }
  const headers = Object.entries(reference.headers)
  if (
    url.origin !== allowedOrigin ||
    !["http:", "https:"].includes(url.protocol) ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== "" ||
    reference.method !== "PUT" ||
    headers.length !== 1 ||
    headers[0]?.[0].toLowerCase() !== "content-type" ||
    headers[0]?.[1] !== mimeType ||
    !Number.isFinite(reference.expiresAt) ||
    reference.expiresAt <= Date.now() ||
    reference.expiresAt > Date.now() + 901_000
  )
    throw new ProjectResourceError("storage_response_invalid", 502)
  const response = await fetcher(url, {
    method: "PUT",
    headers: { "content-type": mimeType },
    body: new Uint8Array(bytes),
    signal,
    redirect: "error",
    credentials: "omit",
  })
  await response.body?.cancel()
  if (!response.ok) throw new ProjectResourceError("storage_upload_unavailable", 503, true)
}
