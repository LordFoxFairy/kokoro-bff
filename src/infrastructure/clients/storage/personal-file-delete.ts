import { createHash } from "node:crypto"
import { Code, ConnectError, createClient } from "@connectrpc/connect"
import { createConnectTransport } from "@connectrpc/connect-node"
import { ErrorCode } from "../../../generated/storage-connect/kokoro/common/v1/common_pb.js"
import { StorageService } from "../../../generated/storage-connect/kokoro/storage/v3/storage_pb.js"
import { assetDeletionError, assetDeletionReceipt, type AssetDeletionReceipt } from "./ordinary-asset-delete.js"
import type { PersonalFileContext } from "./personal-file-list.js"

export class PersonalFileDeletionError extends Error {
  constructor(
    public readonly status: 400 | 404 | 409 | 429 | 502 | 503,
    public readonly code: string,
    public readonly retryable = false,
    public readonly retryAfter?: string,
  ) {
    super(code)
  }
}

const unavailable = () => new PersonalFileDeletionError(503, "storage_unavailable", true)
const invalidResponse = () => new PersonalFileDeletionError(502, "storage_response_invalid")
const digest = (parts: readonly string[]) => createHash("sha256").update(JSON.stringify(parts)).digest("hex")

function mapDeleteFailure(error: unknown, requestId: string): PersonalFileDeletionError {
  if (!(error instanceof ConnectError)) return unavailable()
  if (error.details.length === 0 && [Code.Canceled, Code.DeadlineExceeded, Code.Unavailable].includes(error.code)) return unavailable()
  const detail = assetDeletionError(error, requestId)
  if (detail === null || detail.$unknown?.length || error.details.length !== 1) return invalidResponse()
  const { code, retryable } = detail
  if (error.code === Code.InvalidArgument && code === ErrorCode.INVALID_ARGUMENT && !retryable)
    return new PersonalFileDeletionError(400, "invalid_file_delete_request")
  if (error.code === Code.NotFound && code === ErrorCode.NOT_FOUND && !retryable) return new PersonalFileDeletionError(404, "file_not_found")
  if (error.code === Code.AlreadyExists && code === ErrorCode.COMMAND_DIGEST_MISMATCH && !retryable)
    return new PersonalFileDeletionError(409, "idempotency_conflict")
  if (error.code === (retryable ? Code.Aborted : Code.AlreadyExists) && code === ErrorCode.CONFLICT)
    return new PersonalFileDeletionError(409, "file_delete_conflict", retryable)
  if (error.code === Code.FailedPrecondition && code === ErrorCode.PRECONDITION_FAILED && !retryable)
    return new PersonalFileDeletionError(409, "file_delete_precondition_failed")
  if (error.code === Code.ResourceExhausted && code === ErrorCode.RATE_LIMITED && retryable)
    return new PersonalFileDeletionError(429, "storage_rate_limited", true, error.metadata.get("retry-after") ?? undefined)
  if (
    (error.code === Code.Unavailable && code === ErrorCode.DEPENDENCY_UNAVAILABLE) ||
    (error.code === Code.Internal && code === ErrorCode.INTERNAL) ||
    (error.code === Code.Unauthenticated && code === ErrorCode.UNAUTHENTICATED) ||
    (error.code === Code.PermissionDenied && code === ErrorCode.PERMISSION_DENIED)
  )
    return unavailable()
  return invalidResponse()
}

export async function deletePersonalFile(
  config: { baseUrl: string; secret: string },
  context: PersonalFileContext,
  assetId: string,
  key: string,
  signal: AbortSignal,
): Promise<AssetDeletionReceipt> {
  signal.throwIfAborted()
  const client = createClient(
    StorageService,
    createConnectTransport({
      baseUrl: config.baseUrl,
      httpVersion: "1.1",
      defaultTimeoutMs: 10_000,
      readMaxBytes: 1024 * 1024,
      writeMaxBytes: 1024 * 1024,
    }),
  )
  // Keep the owner command ID stable across same-key/different-asset
  // requests so Storage, not a BFF cache, detects the fingerprint conflict.
  const intent = ["personal-library-file-delete:v1", context.tenantId, context.subjectId, key]
  const command = {
    commandId: `personal-library-file-delete:${digest(intent)}`,
    requestDigest: digest([...intent, assetId]),
  }
  let result
  try {
    result = await client.deleteAsset(
      { command, assetId },
      {
        signal,
        headers: {
          "x-kokoro-service": "web-bff",
          "x-kokoro-internal-secret": config.secret,
          "x-kokoro-tenant-id": context.tenantId,
          "x-kokoro-subject-id": context.subjectId,
          "x-kokoro-request-id": context.requestId,
          "x-kokoro-scope-kind": "personal",
          "x-kokoro-scope-id": context.subjectId,
        },
      },
    )
  } catch (error) {
    throw mapDeleteFailure(error, context.requestId)
  }
  signal.throwIfAborted()
  const receipt = assetDeletionReceipt(result, assetId)
  if (receipt === null || result.deletedAt?.$unknown?.length) throw invalidResponse()
  return receipt
}
