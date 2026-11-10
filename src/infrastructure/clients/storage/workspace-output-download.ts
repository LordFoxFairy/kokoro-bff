import { createHash, randomUUID } from "node:crypto"
import { Code, ConnectError, createClient } from "@connectrpc/connect"
import { createConnectTransport } from "@connectrpc/connect-node"
import { ProjectResourceError } from "../../../application/project-resource.error.js"
import type { RequestContext } from "../../../domain/request-context.js"
import type { WorkspaceOutputVersion } from "../../../generated/agent-http/types.gen.js"
import { ScanState, StorageService } from "../../../generated/storage-connect/kokoro/storage/v3/storage_pb.js"
import { spoolVerifiedArtifact, type VerifiedArtifactSpool } from "./artifact-download-transfer.js"

/** Selects no Storage asset itself: the caller must resolve a published exact Agent version. */
export async function readWorkspaceOutputBytes(
  storage: { baseUrl: string; secret: string; objectOrigin: string },
  context: RequestContext,
  conversationId: string,
  file: WorkspaceOutputVersion,
  signal: AbortSignal,
): Promise<VerifiedArtifactSpool> {
  const client = createClient(
    StorageService,
    createConnectTransport({
      baseUrl: storage.baseUrl,
      httpVersion: "1.1",
      defaultTimeoutMs: 5_000,
      readMaxBytes: 64 * 1024,
      writeMaxBytes: 64 * 1024,
    }),
  )
  signal.throwIfAborted()
  const { namespace, userId } = context.identity
  let result
  try {
    result = await client.getDownloadReference(
      {
        command: {
          commandId: randomUUID(),
          requestDigest: createHash("sha256")
            .update(JSON.stringify([conversationId, file.version_id, file.asset_id, file.content_sha256]))
            .digest("hex"),
        },
        assetId: file.asset_id,
        contentSha256: file.content_sha256,
      },
      {
        signal,
        headers: {
          "x-kokoro-service": "web-bff",
          "x-kokoro-internal-secret": storage.secret,
          "x-kokoro-tenant-id": namespace,
          "x-kokoro-subject-id": userId,
          "x-kokoro-request-id": context.requestId,
          "x-kokoro-scope-kind": "conversation",
          "x-kokoro-scope-id": conversationId,
        },
      },
    )
  } catch (error) {
    if (error instanceof ConnectError && [Code.NotFound, Code.FailedPrecondition].includes(error.code))
      throw new ProjectResourceError("workspace_output_not_found", 404)
    if (error instanceof ConnectError && [Code.InvalidArgument, Code.Unimplemented, Code.DataLoss].includes(error.code))
      throw new ProjectResourceError("storage_response_invalid", 502)
    throw new ProjectResourceError("storage_unavailable", 503, true)
  }
  const reference = result.downloadReference
  if (
    result.$unknown?.length ||
    reference?.$unknown?.length ||
    !reference?.expiresAt ||
    result.assetId !== file.asset_id ||
    result.contentSha256 !== file.content_sha256 ||
    result.mimeType !== file.mime_type ||
    result.sizeBytes !== BigInt(file.size_bytes) ||
    result.scanState !== ScanState.CLEAN
  )
    throw new ProjectResourceError("storage_response_invalid", 502)
  return spoolVerifiedArtifact(
    {
      url: reference.url,
      method: reference.method,
      requiredHeaders: reference.requiredHeaders,
      expiresAt: Number(reference.expiresAt.seconds) * 1000 + reference.expiresAt.nanos / 1e6,
    },
    file.size_bytes,
    file.content_sha256,
    storage.objectOrigin,
    signal,
  )
}
