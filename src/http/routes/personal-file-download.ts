import type { IncomingMessage, ServerResponse } from "node:http"
import type { BffConfig } from "../../config/runtime.js"
import type { RequestContext } from "../../domain/request-context.js"
import { failure } from "../../contracts/index.js"
import {
  PersonalFileDownloadClient,
  PersonalFileDownloadError,
  type PersonalFileDownloadContext,
} from "../../infrastructure/clients/storage/personal-file-download.js"
import { send } from "../response.js"

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

export async function personalFileDownloadRoute(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  context: RequestContext,
  assetId: string,
  clientFactory: (config: NonNullable<BffConfig["storage"]>, context: PersonalFileDownloadContext) => Pick<PersonalFileDownloadClient, "download"> = (
    storage,
    scope,
  ) => new PersonalFileDownloadClient(storage, scope),
): Promise<void> {
  const cancellation = new AbortController()
  const cancel = (): void => {
    if (!response.writableEnded) cancellation.abort()
  }
  request.once("aborted", cancel)
  response.once("close", cancel)
  const signal = AbortSignal.any([cancellation.signal, AbortSignal.timeout(20_000)])
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
      throw new PersonalFileDownloadError("invalid_library_file", 400)
    if (config.storage === undefined) throw new PersonalFileDownloadError("storage_unavailable", 503, true)
    const scope = { tenantId: context.identity.namespace, subjectId: context.identity.userId, requestId: context.requestId }
    const file = await clientFactory(config.storage, scope).download(assetId, signal)
    if (signal.aborted || response.destroyed) return
    response.writeHead(200, {
      "content-type": file.mimeType,
      "content-length": file.bytes.byteLength,
      "content-disposition": safeDisposition(file.filename),
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "x-request-id": context.requestId,
    })
    response.end(file.bytes)
  } catch (error) {
    if (response.destroyed) return
    const known = error instanceof PersonalFileDownloadError ? error : new PersonalFileDownloadError("storage_unavailable", 503, true)
    send(response, known.status, failure(known.code, "Personal file download did not complete", context.requestId))
  } finally {
    request.off("aborted", cancel)
    response.off("close", cancel)
  }
}
