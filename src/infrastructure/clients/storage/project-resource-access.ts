import { createHash, randomUUID } from "node:crypto"
import { toJson } from "@bufbuild/protobuf"
import { TimestampSchema } from "@bufbuild/protobuf/wkt"
import { createClient, ConnectError, Code, type Client, type Transport } from "@connectrpc/connect"
import { createConnectTransport } from "@connectrpc/connect-node"
import { StorageService, UploadPurpose, ScanState, AssetOrigin } from "../../../generated/storage-connect/kokoro/storage/v3/storage_pb.js"
import { ErrorCode, ErrorDetailSchema } from "../../../generated/storage-connect/kokoro/common/v1/common_pb.js"
import { ProjectResourceError } from "../../../application/project-resource.error.js"
import type { ProjectResourceContext } from "../../../application/project-resource.types.js"
import { MAX_VERIFIED_DOWNLOAD_BYTES, type ArtifactDownloadReference } from "./artifact-download-transfer.js"

export type ProjectResourceItem = Readonly<{
  asset_id: string
  filename: string
  mime_type: string
  size_bytes: string
  content_sha256: string
  scan_state: "clean"
}>
export type ProjectResourceDeletion = Readonly<{ asset_id: string; deleted_at: string; replayed: boolean }>
const identifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u
const hash = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex")

/** Owner-delegated access to ordinary Project Assets; never accepts caller-selected scope. */
export class ProjectResourceAccessClient {
  private readonly client: Client<typeof StorageService>
  private readonly headers: Record<string, string>
  public constructor(
    config: { baseUrl: string; secret: string },
    private readonly context: Omit<ProjectResourceContext, "key">,
    transport?: Transport,
  ) {
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
      "x-kokoro-scope-kind": "project",
      "x-kokoro-scope-id": context.projectId,
    }
  }
  private async read<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call()
    } catch (error) {
      if (error instanceof ProjectResourceError) throw error
      if (error instanceof ConnectError && error.code === Code.NotFound) throw new ProjectResourceError("project_resource_not_found", 404)
      if (
        error instanceof ConnectError &&
        [Code.InvalidArgument, Code.FailedPrecondition, Code.Internal, Code.DataLoss, Code.Unimplemented].includes(error.code)
      )
        throw new ProjectResourceError("storage_response_invalid", 502)
      throw new ProjectResourceError("storage_unavailable", 503, true)
    }
  }
  public async get(assetId: string, signal: AbortSignal): Promise<ProjectResourceItem> {
    if (!identifier.test(assetId)) throw new ProjectResourceError("invalid_project_resource", 400)
    const item = await this.read(() => this.client.getAsset({ assetId }, { headers: this.headers, signal }))
    if (item.assetId !== assetId || item.uploadPurpose !== UploadPurpose.ASSET || item.scanState !== ScanState.CLEAN)
      throw new ProjectResourceError("project_resource_not_found", 404)
    if (
      item.$unknown?.length ||
      ![AssetOrigin.UPLOADED, AssetOrigin.GENERATED].includes(item.origin) ||
      !/^[a-f0-9]{64}$/u.test(item.contentSha256) ||
      item.sizeBytes < 0n ||
      item.sizeBytes > 18446744073709551615n ||
      !/^[^\u0000-\u001f\u007f/\\]{1,255}$/u.test(item.filename) ||
      [".", ".."].includes(item.filename) ||
      item.mimeType.length > 191 ||
      !/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/iu.test(item.mimeType)
    )
      throw new ProjectResourceError("storage_response_invalid", 502)
    return {
      asset_id: assetId,
      filename: item.filename,
      mime_type: item.mimeType,
      size_bytes: String(item.sizeBytes),
      content_sha256: item.contentSha256,
      scan_state: "clean",
    }
  }
  public async downloadReference(item: ProjectResourceItem, signal: AbortSignal): Promise<ArtifactDownloadReference> {
    if (BigInt(item.size_bytes) > BigInt(MAX_VERIFIED_DOWNLOAD_BYTES)) throw new ProjectResourceError("project_resource_too_large", 413)
    const requestDigest = hash([
      "project-resource-download:v1",
      this.context.tenantId,
      this.context.subjectId,
      this.context.projectId,
      item.asset_id,
      item.content_sha256,
    ])
    const result = await this.read(() =>
      this.client.getDownloadReference(
        { command: { commandId: randomUUID(), requestDigest }, assetId: item.asset_id, contentSha256: item.content_sha256 },
        { headers: this.headers, signal },
      ),
    )
    const reference = result.downloadReference
    if (
      result.$unknown?.length ||
      result.assetId !== item.asset_id ||
      result.contentSha256 !== item.content_sha256 ||
      String(result.sizeBytes) !== item.size_bytes ||
      result.mimeType !== item.mime_type ||
      result.scanState !== ScanState.CLEAN ||
      reference?.expiresAt === undefined ||
      reference.$unknown?.length ||
      reference.expiresAt.nanos < 0 ||
      reference.expiresAt.nanos > 999999999
    )
      throw new ProjectResourceError("storage_response_invalid", 502)
    return {
      url: reference.url,
      method: reference.method,
      requiredHeaders: reference.requiredHeaders,
      expiresAt: Number(reference.expiresAt.seconds) * 1000 + reference.expiresAt.nanos / 1e6,
    }
  }
  public async delete(assetId: string, key: string, signal: AbortSignal): Promise<ProjectResourceDeletion> {
    if (!identifier.test(assetId) || !/^[\x21-\x7e]{1,191}$/u.test(key)) throw new ProjectResourceError("invalid_project_resource", 400)
    const identity = ["project-resource-delete:v1", this.context.tenantId, this.context.subjectId, this.context.projectId, assetId, key]
    const requestDigest = hash(identity)
    const command = { commandId: `project-resource-delete:${requestDigest}`, requestDigest }
    try {
      // Do not require GetAsset here: the original command must replay after deletion.
      const result = await this.client.deleteAsset({ command, assetId }, { headers: this.headers, signal })
      const at = result.deletedAt
      if (
        result.$unknown?.length ||
        result.assetId !== assetId ||
        typeof result.replayed !== "boolean" ||
        at === undefined ||
        at.seconds < -62135596800n ||
        at.seconds > 253402300799n ||
        at.nanos < 0 ||
        at.nanos > 999999999
      )
        throw new ProjectResourceError("storage_response_invalid", 502, true)
      const deletedAt = toJson(TimestampSchema, at)
      if (typeof deletedAt !== "string") throw new ProjectResourceError("storage_response_invalid", 502, true)
      return { asset_id: assetId, deleted_at: deletedAt, replayed: result.replayed }
    } catch (error) {
      if (error instanceof ProjectResourceError) throw error
      // Only the complete owner error profile can establish a terminal rejection.
      if (error instanceof ConnectError) {
        const details = error.findDetails(ErrorDetailSchema)
        const detail = details[0]
        if (
          details.length === 1 &&
          detail?.requestId === this.context.requestId &&
          error.metadata.get("x-request-id") === this.context.requestId &&
          error.metadata.get("x-kokoro-error-code") === ErrorCode[detail.code] &&
          error.metadata.get("x-kokoro-retryable") === String(detail.retryable) &&
          detail.retryable === false
        ) {
          if (error.code === Code.NotFound && detail.code === ErrorCode.NOT_FOUND) throw new ProjectResourceError("project_resource_not_found", 404)
          if (error.code === Code.AlreadyExists && [ErrorCode.COMMAND_DIGEST_MISMATCH, ErrorCode.CONFLICT].includes(detail.code))
            throw new ProjectResourceError("project_resource_conflict", 409)
        }
      }
      throw new ProjectResourceError("project_resource_delete_unknown", 503, true)
    }
  }
}
