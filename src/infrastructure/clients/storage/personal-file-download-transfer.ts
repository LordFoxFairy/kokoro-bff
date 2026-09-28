import { createHash } from "node:crypto"

const MAX_FILE_BYTES = 1_048_576

export class PersonalFileDownloadError extends Error {
  public constructor(
    public readonly code: string,
    public readonly status: number,
    public readonly retryable = false,
  ) {
    super(code)
  }
}

export type PersonalDownloadReference = Readonly<{ url: string; method: string; requiredHeaders: Record<string, string>; expiresAt: number }>

export async function readPersonalFileBytes(
  reference: PersonalDownloadReference,
  expectedSize: number,
  expectedSha256: string,
  allowedOrigin: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<Buffer> {
  let url: URL
  try {
    url = new URL(reference.url)
  } catch {
    throw new PersonalFileDownloadError("storage_response_invalid", 502)
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
    expectedSize > MAX_FILE_BYTES ||
    !/^[0-9a-f]{64}$/u.test(expectedSha256)
  )
    throw new PersonalFileDownloadError("storage_response_invalid", 502)

  let response: Response
  try {
    response = await fetcher(url, { method: "GET", redirect: "manual", credentials: "omit", signal })
  } catch {
    throw new PersonalFileDownloadError("storage_unavailable", 503, true)
  }
  if (response.status !== 200) {
    await response.body?.cancel().catch(() => undefined)
    throw new PersonalFileDownloadError(
      response.status >= 500 ? "storage_unavailable" : "storage_response_invalid",
      response.status >= 500 ? 503 : 502,
      response.status >= 500,
    )
  }
  const declaredLength = response.headers.get("content-length")
  if (declaredLength !== null && (!/^(0|[1-9][0-9]*)$/u.test(declaredLength) || Number(declaredLength) !== expectedSize)) {
    await response.body?.cancel().catch(() => undefined)
    throw new PersonalFileDownloadError("storage_response_invalid", 502)
  }
  if (response.body === null) throw new PersonalFileDownloadError("storage_response_invalid", 502)
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > expectedSize || length > MAX_FILE_BYTES) throw new PersonalFileDownloadError("storage_response_invalid", 502)
      chunks.push(value)
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined)
    if (error instanceof PersonalFileDownloadError) throw error
    throw new PersonalFileDownloadError("storage_unavailable", 503, true)
  } finally {
    reader.releaseLock()
  }
  const bytes = Buffer.concat(chunks, length)
  if (bytes.length !== expectedSize || createHash("sha256").update(bytes).digest("hex") !== expectedSha256)
    throw new PersonalFileDownloadError("storage_response_invalid", 502)
  return bytes
}
