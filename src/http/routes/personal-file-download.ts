import type { IncomingMessage, ServerResponse } from "node:http"
import type { BffConfig } from "../../config/runtime.js"
import type { RequestContext } from "../../domain/request-context.js"
import { failure } from "../../contracts/index.js"
import { performance } from "node:perf_hooks"
import { AssetDownloadClient } from "../../infrastructure/clients/storage/asset-download.js"
import { AssetDownloadError } from "../../infrastructure/clients/storage/asset-download.error.js"
import type { AssetDownloadContext } from "../../infrastructure/clients/storage/asset-download.types.js"
import { fileDownloadDisposition } from "../file-download-disposition.js"
import { send } from "../response.js"

export async function personalFileDownloadRoute(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  context: RequestContext,
  assetId: string,
  clientFactory: (config: NonNullable<BffConfig["storage"]>, context: AssetDownloadContext) => Pick<AssetDownloadClient, "download"> = (storage, scope) =>
    new AssetDownloadClient(storage, scope),
): Promise<void> {
  const cancellation = new AbortController()
  const cancel = (): void => {
    if (!response.writableEnded) cancellation.abort()
  }
  request.once("aborted", cancel)
  response.once("close", cancel)
  const deadlineAt = performance.now() + 20_000
  const timer = setTimeout(() => cancellation.abort(), 20_000)
  const signal = cancellation.signal
  if (request.aborted || response.destroyed || response.writableEnded) cancellation.abort()
  response.setHeader("x-request-id", context.requestId)
  response.setHeader("referrer-policy", "no-referrer")
  response.setHeader("x-content-type-options", "nosniff")
  try {
    if (
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(assetId) ||
      new URL(request.url ?? "/", "http://bff.invalid").search !== "" ||
      request.headers["transfer-encoding"] !== undefined ||
      (request.headers["content-length"] !== undefined && request.headers["content-length"] !== "0")
    )
      throw new AssetDownloadError("invalid_library_file", 400)
    if (config.storage === undefined) throw new AssetDownloadError("storage_unavailable", 503, true)
    const scope: AssetDownloadContext = {
      tenantId: context.identity.namespace,
      subjectId: context.identity.userId,
      requestId: context.requestId,
      scope: { kind: "personal", id: context.identity.userId },
    }
    const file = await clientFactory(config.storage, scope).download(assetId, signal, deadlineAt)
    if (signal.aborted || response.destroyed) return
    response.writeHead(200, {
      "content-type": file.mimeType,
      "content-length": file.bytes.byteLength,
      "content-disposition": fileDownloadDisposition(file.filename),
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "x-request-id": context.requestId,
    })
    response.end(file.bytes)
  } catch (error) {
    if (response.destroyed) return
    const known = error instanceof AssetDownloadError ? error : new AssetDownloadError("storage_unavailable", 503, true)
    send(response, known.status, failure(known.code, "Personal file download did not complete", context.requestId))
  } finally {
    cancellation.abort()
    clearTimeout(timer)
    request.off("aborted", cancel)
    response.off("close", cancel)
  }
}
