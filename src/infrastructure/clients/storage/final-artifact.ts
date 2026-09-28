import { createHash, randomUUID } from "node:crypto"
import { createClient, ConnectError, Code, type Client, type Transport } from "@connectrpc/connect"
import { createConnectTransport } from "@connectrpc/connect-node"
import { ArtifactKind, StorageService } from "../../../generated/storage-connect/kokoro/storage/v2/storage_pb.js"
import type { ArtifactAssociation } from "../../../application/ports/bff-business-store.js"
import { ProjectResourceError } from "../../../application/project-resource.error.js"
import type { ArtifactDownloadReference } from "./artifact-download-transfer.js"

const SHA256 = /^[0-9a-f]{64}$/u
const MIME = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/iu
const MAX_ARTIFACT_BYTES = 1_073_741_824n
const KINDS: Readonly<Record<number, ArtifactAssociation["sourceArtifactKind"]>> = {
  [ArtifactKind.DOCUMENT]: "document",
  [ArtifactKind.CODE]: "code",
  [ArtifactKind.IMAGE]: "image",
  [ArtifactKind.AUDIO]: "audio",
  [ArtifactKind.VIDEO]: "video",
  [ArtifactKind.DATA]: "data",
  [ArtifactKind.ARCHIVE]: "archive",
  [ArtifactKind.OTHER]: "other",
}

export type FinalArtifact = Readonly<{
  kind: "artifact"
  conversation_id: string
  artifact_id: string
  asset_id: string
  artifact_kind: ArtifactAssociation["sourceArtifactKind"]
  title: string
  filename: string
  mime_type: string
  size_bytes: string
  content_sha256: string
  source_run_id: string
  delivered_at: string
}>

export type FinalArtifactContext = Readonly<{ tenantId: string; subjectId: string; conversationId: string; requestId: string }>

/** Strict conversation-scoped consumer of Storage's FINAL+CLEAN-only owner RPCs. */
export class FinalArtifactClient {
  private readonly client: Client<typeof StorageService>
  private readonly headers: Record<string, string>

  public constructor(config: { baseUrl: string; secret: string }, context: FinalArtifactContext, transport?: Transport) {
    this.client = createClient(
      StorageService,
      transport ??
        createConnectTransport({
          baseUrl: config.baseUrl,
          httpVersion: "1.1",
          defaultTimeoutMs: 10_000,
          readMaxBytes: 1024 * 1024,
          writeMaxBytes: 1024 * 1024,
        }),
    )
    this.headers = {
      "x-kokoro-service": "web-bff",
      "x-kokoro-internal-secret": config.secret,
      "x-kokoro-tenant-id": context.tenantId,
      "x-kokoro-subject-id": context.subjectId,
      "x-kokoro-request-id": context.requestId,
      "x-kokoro-scope-kind": "conversation",
      "x-kokoro-scope-id": context.conversationId,
    }
  }

  private async rpc<T>(operation: () => Promise<T>, missingIsNotFound = false): Promise<T> {
    try {
      return await operation()
    } catch (error) {
      if (error instanceof ProjectResourceError) throw error
      if (error instanceof ConnectError && error.code === Code.NotFound) throw new ProjectResourceError("library_artifact_not_found", 404)
      if (missingIsNotFound && error instanceof ConnectError && error.code === Code.FailedPrecondition)
        throw new ProjectResourceError("library_artifact_not_found", 404)
      if (
        error instanceof ConnectError &&
        [Code.Unavailable, Code.DeadlineExceeded, Code.Canceled, Code.ResourceExhausted, Code.PermissionDenied, Code.Unauthenticated].includes(error.code)
      )
        throw new ProjectResourceError("storage_unavailable", 503, true)
      if (!(error instanceof ConnectError)) throw new ProjectResourceError("storage_unavailable", 503, true)
      throw new ProjectResourceError("storage_response_invalid", 502)
    }
  }

  public async get(association: ArtifactAssociation, signal: AbortSignal): Promise<FinalArtifact> {
    const result = await this.rpc(() => this.client.getFinalArtifact({ artifactId: association.artifactId }, { headers: this.headers, signal }))
    const item = result.item
    if (item === undefined) throw new ProjectResourceError("storage_response_invalid", 502)
    const kind = KINDS[item.kind]
    if (
      item.artifactId !== association.artifactId ||
      item.assetId !== association.sourceAssetId ||
      item.contentSha256 !== association.sourceContentSha256 ||
      item.sourceRunId !== association.runId ||
      kind === undefined ||
      kind !== association.sourceArtifactKind ||
      !SHA256.test(item.contentSha256) ||
      item.title.length === 0 ||
      item.title.length > 200 ||
      item.filename.length === 0 ||
      item.filename.length > 255 ||
      /[\u0000-\u001f\u007f/\\]/u.test(item.filename) ||
      !MIME.test(item.mimeType) ||
      item.mimeType.length > 191 ||
      item.sizeBytes < 0n ||
      item.sizeBytes > MAX_ARTIFACT_BYTES ||
      item.createdAt === undefined ||
      item.finalizedAt === undefined
    )
      throw new ProjectResourceError("storage_response_invalid", 502)
    return {
      kind: "artifact",
      conversation_id: association.conversationId,
      artifact_id: item.artifactId,
      asset_id: item.assetId,
      artifact_kind: kind,
      title: item.title,
      filename: item.filename,
      mime_type: item.mimeType,
      size_bytes: String(item.sizeBytes),
      content_sha256: item.contentSha256,
      source_run_id: item.sourceRunId,
      delivered_at: association.deliveredAt,
    }
  }

  public async downloadReference(item: FinalArtifact, signal: AbortSignal): Promise<ArtifactDownloadReference> {
    const commandId = randomUUID()
    const requestDigest = createHash("sha256")
      .update(JSON.stringify([item.artifact_id, item.asset_id, item.content_sha256]))
      .digest("hex")
    const result = await this.rpc(
      () =>
        this.client.getFinalArtifactDownloadReference(
          { command: { commandId, requestDigest }, artifactId: item.artifact_id },
          { headers: this.headers, signal },
        ),
      true,
    )
    const signed = result.downloadReference
    if (
      result.artifactId !== item.artifact_id ||
      result.assetId !== item.asset_id ||
      result.contentSha256 !== item.content_sha256 ||
      signed?.expiresAt === undefined
    )
      throw new ProjectResourceError("storage_response_invalid", 502)
    return {
      url: signed.url,
      method: signed.method,
      requiredHeaders: signed.requiredHeaders,
      expiresAt: Number(signed.expiresAt.seconds) * 1000 + signed.expiresAt.nanos / 1e6,
    }
  }
}
