import type { IncomingMessage, ServerResponse } from "node:http"
import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import { authorizeUserRequest } from "../../auth/user-admission.js"
import { deletePersonalFile, PersonalFileDeletionError } from "../../infrastructure/clients/storage/personal-file-delete.js"
import { requestId } from "../request.js"
import { send } from "../response.js"

const path = /^\/v1\/library\/files\/([^/?]+)(?![\s\S])/u
const identifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}(?![\s\S])/u
const commandKey = /^[\x21-\x2b\x2d-\x7e]{1,191}(?![\s\S])/u
const rejectedHeaders = ["transfer-encoding", "content-encoding", "if-match", "if-none-match", "if-unmodified-since", "if-modified-since", "if-range"]
const nativeFailures = {
  401: ["session_authentication_required", "session_invalid"],
  403: ["service_auth_failed", "product_tenant_forbidden", "session_forbidden"],
  429: ["session_rate_limited"],
  503: ["product_tenant_not_configured", "iam_admission_unavailable"],
}

export function personalFileDeleteRequest(request: IncomingMessage): boolean {
  return request.method === "DELETE" && path.test(request.url?.split("?", 1)[0] ?? "")
}

function canonicalAssetId(request: IncomingMessage): string | null {
  const segment = path.exec(request.url ?? "")?.[1]
  if (segment === undefined) return null
  try {
    const asset = decodeURIComponent(segment)
    return identifier.test(asset) && encodeURIComponent(asset) === segment ? asset : null
  } catch {
    return null
  }
}

export async function handlePersonalFileDeleteRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  admission: SessionAdmission,
): Promise<void> {
  const id = requestId(request)
  response.setHeader("x-request-id", id)
  const disconnected = new AbortController()
  const cancel = () => {
    if (!response.writableEnded) disconnected.abort()
  }
  request.once("aborted", cancel)
  response.once("close", cancel)
  const signal = AbortSignal.any([disconnected.signal, AbortSignal.timeout(Math.min(10_000, config.upstreamTimeoutMs))])
  const fail = (status: number, code: string, retryable = false, retryAfter?: string) => {
    if (!response.destroyed && !response.writableEnded && !disconnected.signal.aborted)
      send(response, status, { error: { code, message: "Personal library file deletion could not be confirmed", retryable } }, retryAfter)
  }
  try {
    const assetId = canonicalAssetId(request)
    const lengths = request.headersDistinct["content-length"] ?? []
    if (
      assetId === null ||
      lengths.length > 1 ||
      (lengths.length === 1 && lengths[0] !== "0") ||
      rejectedHeaders.some((header) => request.headers[header] !== undefined)
    ) {
      fail(400, "invalid_file_delete_request")
      return
    }
    const keys = request.headersDistinct["idempotency-key"] ?? []
    const key = keys[0]
    if (keys.length !== 1 || key === undefined || !commandKey.test(key)) {
      fail(400, "invalid_idempotency_key")
      return
    }
    signal.throwIfAborted()
    const admitted = await authorizeUserRequest(request, config, admission, id, signal, response)
    if (!admitted.ok) {
      if (nativeFailures[admitted.status].includes(admitted.code))
        fail(admitted.status, admitted.code, admitted.status === 429 || admitted.status === 503, admitted.status === 429 ? admitted.retryAfter : undefined)
      else fail(503, "iam_admission_unavailable", true)
      return
    }
    signal.throwIfAborted()
    if (config.storage === undefined) {
      fail(503, "storage_unavailable", true)
      return
    }
    const { namespace: tenantId, userId: subjectId } = admitted.context.identity
    const data = await deletePersonalFile(config.storage, { tenantId, subjectId, requestId: id }, assetId, key, signal)
    signal.throwIfAborted()
    if (!response.destroyed && !response.writableEnded) send(response, 200, { data })
  } catch (error) {
    if (error instanceof PersonalFileDeletionError) fail(error.status, error.code, error.retryable, error.retryAfter)
    else fail(503, "storage_unavailable", true)
  } finally {
    request.off("aborted", cancel)
    response.off("close", cancel)
  }
}
