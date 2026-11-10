import { createHash } from "node:crypto"
import { Code, ConnectError, createClient } from "@connectrpc/connect"
import { createConnectTransport } from "@connectrpc/connect-node"
import { ErrorCode } from "../../../generated/storage-connect/kokoro/common/v1/common_pb.js"
import { StorageService } from "../../../generated/storage-connect/kokoro/storage/v3/storage_pb.js"
import { assetDeletionError, assetDeletionReceipt, storageDeletionTimestamp, type AssetDeletionReceipt } from "./ordinary-asset-delete.js"
import type { ArtifactAssociation } from "../../../application/account/artifact-library-repository.js"
import type { PersonalFileContext } from "./personal-file-list.js"

export class LibraryDeletionError extends Error {
  constructor(
    public readonly status: 400 | 404 | 409 | 429 | 502 | 503,
    public readonly code: string,
    public readonly retryable = false,
    public readonly retryAfter?: string,
  ) {
    super(code)
  }
}

const unavailable = () => new LibraryDeletionError(503, "storage_unavailable", true)
const invalidResponse = () => new LibraryDeletionError(502, "storage_response_invalid")
const digest = (parts: readonly string[]) => createHash("sha256").update(JSON.stringify(parts)).digest("hex")

function mapDeleteFailure(error: unknown, requestId: string, kind: "file" | "artifact"): LibraryDeletionError {
  if (!(error instanceof ConnectError)) return unavailable()
  if (error.details.length === 0 && [Code.Canceled, Code.DeadlineExceeded, Code.Unavailable].includes(error.code)) return unavailable()
  const detail = assetDeletionError(error, requestId)
  if (detail === null || detail.$unknown?.length || error.details.length !== 1) return invalidResponse()
  const { code, retryable } = detail
  if (error.code === Code.InvalidArgument && code === ErrorCode.INVALID_ARGUMENT && !retryable)
    return new LibraryDeletionError(400, `invalid_${kind}_delete_request`)
  if (error.code === Code.NotFound && code === ErrorCode.NOT_FOUND && !retryable)
    return new LibraryDeletionError(404, kind === "file" ? "file_not_found" : "library_artifact_not_found")
  if (error.code === Code.AlreadyExists && code === ErrorCode.COMMAND_DIGEST_MISMATCH && !retryable)
    return new LibraryDeletionError(409, "idempotency_conflict")
  if (error.code === (retryable ? Code.Aborted : Code.AlreadyExists) && code === ErrorCode.CONFLICT)
    return new LibraryDeletionError(409, `${kind}_delete_conflict`, retryable)
  if (error.code === Code.FailedPrecondition && code === ErrorCode.PRECONDITION_FAILED && !retryable)
    return new LibraryDeletionError(409, `${kind}_delete_precondition_failed`)
  if (error.code === Code.ResourceExhausted && code === ErrorCode.RATE_LIMITED && retryable)
    return new LibraryDeletionError(429, "storage_rate_limited", true, error.metadata.get("retry-after") ?? undefined)
  if (
    (error.code === Code.Unavailable && code === ErrorCode.DEPENDENCY_UNAVAILABLE) ||
    (error.code === Code.Internal && code === ErrorCode.INTERNAL) ||
    (error.code === Code.Unauthenticated && code === ErrorCode.UNAUTHENTICATED) ||
    (error.code === Code.PermissionDenied && code === ErrorCode.PERMISSION_DENIED)
  )
    return unavailable()
  return invalidResponse()
}

type StorageConfig = { baseUrl: string; secret: string }

function deletionClient(config: StorageConfig) {
  return createClient(
    StorageService,
    createConnectTransport({
      baseUrl: config.baseUrl,
      httpVersion: "1.1",
      defaultTimeoutMs: 10_000,
      readMaxBytes: 1024 * 1024,
      writeMaxBytes: 1024 * 1024,
    }),
  )
}

function deletionHeaders(config: StorageConfig, context: PersonalFileContext, kind: "personal" | "conversation", scopeId: string) {
  return {
    "x-kokoro-service": "web-bff",
    "x-kokoro-internal-secret": config.secret,
    "x-kokoro-tenant-id": context.tenantId,
    "x-kokoro-subject-id": context.subjectId,
    "x-kokoro-request-id": context.requestId,
    "x-kokoro-scope-kind": kind,
    "x-kokoro-scope-id": scopeId,
  }
}

export async function deletePersonalFile(
  config: StorageConfig,
  context: PersonalFileContext,
  assetId: string,
  key: string,
  signal: AbortSignal,
): Promise<AssetDeletionReceipt> {
  signal.throwIfAborted()
  const client = deletionClient(config)
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
        headers: deletionHeaders(config, context, "personal", context.subjectId),
      },
    )
  } catch (error) {
    throw mapDeleteFailure(error, context.requestId, "file")
  }
  signal.throwIfAborted()
  const receipt = assetDeletionReceipt(result, assetId)
  if (receipt === null || result.deletedAt?.$unknown?.length) throw invalidResponse()
  return receipt
}

export async function retireLibraryArtifact(
  config: StorageConfig,
  context: PersonalFileContext,
  association: ArtifactAssociation,
  key: string,
  signal: AbortSignal,
) {
  signal.throwIfAborted()
  const { conversationId, artifactId, sourceAssetId, sourceContentSha256, runId } = association
  const intent = ["library-artifact-delete:v1", context.tenantId, context.subjectId, conversationId, key]
  const command = {
    commandId: `library-artifact-delete:${digest(intent)}`,
    requestDigest: digest([...intent, artifactId, sourceAssetId, sourceContentSha256, runId]),
  }
  let result
  try {
    result = await deletionClient(config).deleteFinalArtifact(
      { command, artifactId, assetId: sourceAssetId, contentSha256: sourceContentSha256, sourceRunId: runId },
      { signal, headers: deletionHeaders(config, context, "conversation", conversationId) },
    )
  } catch (error) {
    throw mapDeleteFailure(error, context.requestId, "artifact")
  }
  signal.throwIfAborted()
  const deletedAt = storageDeletionTimestamp(result.retiredAt)
  if (
    result.$unknown?.length ||
    result.artifactId !== artifactId ||
    result.retiredAt?.$unknown?.length ||
    deletedAt === null ||
    typeof result.replayed !== "boolean"
  )
    throw invalidResponse()
  return { conversation_id: conversationId, artifact_id: artifactId, deleted_at: deletedAt, replayed: result.replayed }
}
