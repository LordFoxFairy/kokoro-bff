import { performance } from "node:perf_hooks"
import type { IncomingMessage, ServerResponse } from "node:http"
import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import type { BffBusinessStore } from "../../application/ports/bff-business-store.js"
import { authorizeUserRequest } from "../../auth/user-admission.js"
import { assetDownloadRemaining, withinAssetDownloadBudget } from "../../application/asset-download-budget.js"
import { AssetDownloadClient } from "../../infrastructure/clients/storage/asset-download.js"
import { AssetDownloadError } from "../../infrastructure/clients/storage/asset-download.error.js"
import { failure } from "../../contracts/index.js"
import { fileDownloadDisposition } from "../file-download-disposition.js"
import { send } from "../response.js"

/** Claim raw and decoded aliases before the generic segment decoder can weaken this boundary. */
export function isProjectResourceDownloadCandidate(request: IncomingMessage): boolean {
  const raw = (request.url ?? "").split("?", 1)[0] ?? ""
  const candidates = [raw]
  // Node also accepts an absolute-form request target. Claim it here, but never accept it as an alias.
  try {
    candidates.push(new URL(request.url ?? "", "http://bff.invalid").pathname)
  } catch {
    /* Strict input is rejected below. */
  }
  for (const path of [...candidates]) {
    try {
      candidates.push(decodeURIComponent(path))
    } catch {
      /* The strict route rejects malformed escaping. */
    }
  }
  const candidate = /^\/v1\/(?:self\/)?projects\/.*\/resources\/.*\/content\/*$/u
  return candidates.some((path) => candidate.test(path) || candidate.test(`/${path.split("/").filter(Boolean).join("/")}`))
}

function downloadSelectors(target: string): { projectRef: string; assetId: string } | null {
  const path = /^\/v1\/projects\/([^/?#]+)\/resources\/([^/?#]+)\/content$/u.exec(target)
  if (path?.[1] === undefined || path[2] === undefined) return null
  const selector = (raw: string): string | null => {
    try {
      const decoded = decodeURIComponent(raw)
      if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(decoded)) return null
      // Accept a literal selector or the producer's standard component encoding, never a structural alias.
      return raw === decoded || raw === encodeURIComponent(decoded) ? decoded : null
    } catch {
      return null
    }
  }
  const projectRef = selector(path[1])
  const assetId = selector(path[2])
  return projectRef === null || assetId === null ? null : { projectRef, assetId }
}

export async function projectResourceDownloadRoute(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  admission: SessionAdmission,
  store: BffBusinessStore | null,
  requestId: string,
): Promise<void> {
  const deadlineAt = performance.now() + 20_000
  const cancellation = new AbortController()
  const cancel = (): void => {
    if (!response.writableEnded) cancellation.abort()
  }
  const timer = setTimeout(() => cancellation.abort(), 20_000)
  const signal = cancellation.signal
  if (request.aborted || response.destroyed || response.writableEnded) cancellation.abort()
  request.once("aborted", cancel)
  response.once("close", cancel)
  response.setHeader("x-request-id", requestId)
  response.setHeader("referrer-policy", "no-referrer")
  response.setHeader("x-content-type-options", "nosniff")
  try {
    const selectors = downloadSelectors(request.url ?? "")
    if (
      request.method !== "GET" ||
      selectors === null ||
      request.headers["transfer-encoding"] !== undefined ||
      (request.headers["content-length"] !== undefined && request.headers["content-length"] !== "0")
    )
      throw new AssetDownloadError("invalid_project_resource_request", 400)
    const { projectRef, assetId } = selectors
    const admitted = await withinAssetDownloadBudget(signal, deadlineAt, () => authorizeUserRequest(request, config, admission, requestId, signal))
    if (!admitted.ok) {
      if (!response.destroyed)
        send(
          response,
          admitted.status,
          failure(admitted.code, "Project resource access is unavailable", requestId),
          admitted.status === 429 ? admitted.retryAfter : undefined,
        )
      return
    }
    if (store === null) throw new AssetDownloadError("project_resources_unavailable", 503, true)
    const scope = { tenantId: admitted.context.identity.namespace, subjectId: admitted.context.identity.userId }
    const currentProject = (ref: string) =>
      withinAssetDownloadBudget(signal, deadlineAt, () => store.services.projects.findActiveResourceProjectId(scope, ref, signal, deadlineAt))
    const projectId = await currentProject(projectRef)
    if (projectId === null) throw new AssetDownloadError("project_not_found", 404)
    if (!/^project_[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.test(projectId)) throw new AssetDownloadError("project_resources_unavailable", 503, true)
    const storage = config.storage
    if (storage === undefined) throw new AssetDownloadError("storage_unavailable", 503, true)
    const file = await withinAssetDownloadBudget(signal, deadlineAt, () =>
      new AssetDownloadClient(storage, {
        ...scope,
        requestId,
        scope: { kind: "project", id: projectId },
      }).download(assetId, signal, deadlineAt),
    )
    if ((await currentProject(projectId)) !== projectId) throw new AssetDownloadError("project_not_found", 404)
    assetDownloadRemaining(signal, deadlineAt)
    if (response.destroyed || response.writableEnded || request.aborted) return
    response.writeHead(200, {
      "content-type": file.mimeType,
      "content-length": file.bytes.byteLength,
      "content-disposition": fileDownloadDisposition(file.filename),
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "x-request-id": requestId,
    })
    response.end(file.bytes)
  } catch (error) {
    if (response.destroyed || response.writableEnded) return
    let known = error instanceof AssetDownloadError ? error : new AssetDownloadError("project_resources_unavailable", 503, true)
    try {
      assetDownloadRemaining(signal, deadlineAt)
    } catch {
      known = new AssetDownloadError("project_resources_unavailable", 503, true)
    }
    send(response, known.status, failure(known.code, "Project resource download did not complete", requestId))
  } finally {
    cancellation.abort()
    clearTimeout(timer)
    request.off("aborted", cancel)
    response.off("close", cancel)
  }
}
