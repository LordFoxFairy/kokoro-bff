import { performance } from "node:perf_hooks"
import type { IncomingMessage, ServerResponse } from "node:http"
import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import type { BffBusinessStore } from "../../application/ports/bff-business-store.js"
import { authorizeUserRequest } from "../../auth/user-admission.js"
import { withinAssetDownloadBudget } from "../../application/asset-download-budget.js"
import { failure } from "../../contracts/index.js"
import { projectResourceReadRoute } from "./project-resource-read.js"
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
  const candidate = /^\/v1\/(?:self\/)?projects\/.*\/resources\/.*\/download\/*$/u
  return candidates.some((path) => candidate.test(path) || candidate.test(`/${path.split("/").filter(Boolean).join("/")}`))
}

function downloadSelectors(target: string): { projectRef: string; assetId: string } | null {
  const path = /^\/v1\/projects\/([^/?#]+)\/resources\/([^/?#]+)\/download$/u.exec(target)
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
  const controller = new AbortController()
  const stop = () => controller.abort()
  const close = () => {
    if (!response.writableEnded) stop()
  }
  const timer = setTimeout(stop, Math.max(0, deadlineAt - performance.now()))
  request.once("aborted", stop)
  response.once("close", close)
  response.setHeader("x-request-id", requestId)
  response.setHeader("cache-control", "no-store")
  if (request.aborted || response.destroyed) stop()
  try {
    const selectors = downloadSelectors(request.url ?? "")
    if (
      request.method !== "GET" ||
      selectors === null ||
      request.headers["transfer-encoding"] !== undefined ||
      (request.headers["content-length"] !== undefined && request.headers["content-length"] !== "0") ||
      request.headers["content-type"] !== undefined ||
      request.headers["idempotency-key"] !== undefined
    ) {
      send(response, 400, failure("invalid_project_resource", "Project resource request is invalid", requestId))
      return
    }
    const result = await withinAssetDownloadBudget(controller.signal, deadlineAt, () =>
      authorizeUserRequest(request, config, admission, requestId, controller.signal),
    )
    if (!result.ok) {
      if (!response.destroyed)
        send(
          response,
          result.status,
          failure(result.code, "Project resource access is unavailable", requestId),
          result.status === 429 ? result.retryAfter : undefined,
        )
      return
    }
    await projectResourceReadRoute(request, response, config, result.context, selectors.projectRef, selectors.assetId, true, store, undefined, undefined, {
      signal: controller.signal,
      deadlineAt,
    })
  } catch {
    if (!response.destroyed && !response.headersSent)
      send(response, 503, failure("storage_unavailable", "Project resource download did not complete", requestId))
    else if (!response.destroyed) response.destroy()
  } finally {
    stop()
    clearTimeout(timer)
    request.off("aborted", stop)
    response.off("close", close)
  }
}
