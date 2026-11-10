import type { IncomingMessage, ServerResponse } from "node:http"
import type { BffConfig } from "../../config/runtime.js"
import type { SessionAdmission } from "../../auth/session-admission.types.js"
import { authorizeUserRequest } from "../../auth/user-admission.js"
import type { ArtifactLibraryRepository } from "../../application/account/artifact-library-repository.js"
import { deletePersonalFile, LibraryDeletionError, retireLibraryArtifact } from "../../infrastructure/clients/storage/library-deletion.js"
import { requestId } from "../request.js"
import { send } from "../response.js"

const filePath = /^\/v1\/library\/files\/([^/?]+)(?![\s\S])/u
const artifactPath = /^\/v1\/library\/artifacts\/([^/?]+)\/([^/?]+)(?![\s\S])/u
const identifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}(?![\s\S])/u
const commandKey = /^[\x21-\x2b\x2d-\x7e]{1,191}(?![\s\S])/u
const rejectedHeaders = ["transfer-encoding", "content-encoding", "if-match", "if-none-match", "if-unmodified-since", "if-modified-since", "if-range"]
const nativeFailures = {
  401: ["session_authentication_required", "session_invalid"],
  403: ["service_auth_failed", "product_tenant_forbidden", "session_forbidden"],
  429: ["session_rate_limited"],
  503: ["product_tenant_not_configured", "iam_admission_unavailable"],
}

export function libraryDeleteRequest(request: IncomingMessage): boolean {
  const pathname = request.url?.split("?", 1)[0] ?? ""
  return request.method === "DELETE" && (filePath.test(pathname) || artifactPath.test(pathname))
}

function canonicalIdentifier(segment: string | undefined): string | null {
  if (segment === undefined) return null
  try {
    const id = decodeURIComponent(segment)
    return identifier.test(id) && encodeURIComponent(id) === segment ? id : null
  } catch {
    return null
  }
}

export async function handleLibraryDeleteRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  admission: SessionAdmission,
  repository: ArtifactLibraryRepository,
): Promise<void> {
  const url = request.url ?? ""
  const artifact = artifactPath.test(url.split("?", 1)[0] ?? "")
  const segments = (artifact ? artifactPath : filePath).exec(url)
  const conversationId = artifact ? canonicalIdentifier(segments?.[1]) : null
  const targetId = canonicalIdentifier(segments?.[artifact ? 2 : 1])
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
      send(
        response,
        status,
        {
          error: {
            code,
            message: artifact ? "Library Artifact retirement could not be confirmed" : "Personal library file deletion could not be confirmed",
            retryable,
          },
        },
        retryAfter,
      )
  }
  try {
    const lengths = request.headersDistinct["content-length"] ?? []
    if (
      targetId === null ||
      (artifact && conversationId === null) ||
      lengths.length > 1 ||
      (lengths.length === 1 && lengths[0] !== "0") ||
      rejectedHeaders.some((header) => request.headers[header] !== undefined)
    ) {
      fail(400, artifact ? "invalid_artifact_delete_request" : "invalid_file_delete_request")
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
    const ownerContext = { tenantId, subjectId, requestId: id }
    let data
    if (artifact && conversationId !== null) {
      let association
      try {
        association = await repository.findCandidate(tenantId, subjectId, conversationId, targetId)
      } catch {
        fail(503, "business_store_unavailable", true)
        return
      }
      signal.throwIfAborted()
      if (association === null) {
        fail(404, "library_artifact_not_found")
        return
      }
      if (association.conversationId !== conversationId || association.artifactId !== targetId) {
        fail(503, "business_store_unavailable", true)
        return
      }
      // An exact owner command also recovers a lost ACK after the FINAL is hidden.
      data = await retireLibraryArtifact(config.storage, ownerContext, association, key, signal)
    } else {
      data = await deletePersonalFile(config.storage, ownerContext, targetId, key, signal)
    }
    signal.throwIfAborted()
    if (!response.destroyed && !response.writableEnded) send(response, 200, { data })
  } catch (error) {
    if (error instanceof LibraryDeletionError) fail(error.status, error.code, error.retryable, error.retryAfter)
    else fail(503, "storage_unavailable", true)
  } finally {
    request.off("aborted", cancel)
    response.off("close", cancel)
  }
}
