import { toJson } from "@bufbuild/protobuf"
import { TimestampSchema } from "@bufbuild/protobuf/wkt"
import type { ProjectResourcePage, ProjectResourcePageInput } from "../../../application/project-resource-list.types.js"
import { createClient, ConnectError, Code, type Client, type Transport } from "@connectrpc/connect"
import { createConnectTransport } from "@connectrpc/connect-node"
import { StorageService, UploadPurpose, UploadState, ScanState, AssetOrigin } from "../../../generated/storage-connect/kokoro/storage/v2/storage_pb.js"
import { ProjectResourceError } from "../../../application/project-resource.error.js"
import type {
  ProjectResourceContext,
  ProjectResourceInput,
  ProjectResourceStorage,
  ProjectResource,
  StorageTransfer,
} from "../../../application/project-resource.types.js"
import { putStorageBytes } from "./transfer.js"

export class StorageUploadClient implements ProjectResourceStorage {
  private readonly client: Client<typeof StorageService>
  private readonly headers: Record<string, string>
  constructor(
    private readonly config: { baseUrl: string; secret: string; objectOrigin: string },
    context: Omit<ProjectResourceContext, "key">,
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
  private async rpc<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call()
    } catch (error) {
      if (error instanceof ProjectResourceError) throw error
      const conflict = error instanceof ConnectError && [Code.AlreadyExists, Code.FailedPrecondition].includes(error.code)
      throw new ProjectResourceError(conflict ? "storage_upload_conflict" : "storage_unavailable", conflict ? 409 : 503, !conflict)
    }
  }
  private requireCleanScan(state: ScanState): "clean" {
    if (state === ScanState.INFECTED) throw new ProjectResourceError("resource_file_infected", 422)
    if (state === ScanState.PENDING || state === ScanState.UNKNOWN) throw new ProjectResourceError("resource_scan_pending", 503, true)
    if (state !== ScanState.CLEAN) throw new ProjectResourceError("storage_response_invalid", 502)
    return "clean"
  }
  async createUpload(commandId: string, requestDigest: string, input: ProjectResourceInput, signal: AbortSignal) {
    return this.rpc(async () => {
      const result = await this.client.createUpload(
        {
          command: { commandId, requestDigest },
          filename: input.filename,
          mimeType: input.mimeType,
          sizeBytes: BigInt(input.bytes.length),
          contentSha256: input.sha256,
          uploadPurpose: UploadPurpose.ASSET,
        },
        { headers: this.headers, signal },
      )
      const ref = result.uploadReference
      if (!result.uploadId || !ref?.expiresAt) throw new ProjectResourceError("storage_response_invalid", 502)
      return {
        uploadId: result.uploadId,
        reference: {
          url: ref.url,
          method: ref.method,
          headers: ref.requiredHeaders,
          expiresAt: Number(ref.expiresAt.seconds) * 1000 + ref.expiresAt.nanos / 1e6,
        },
      }
    })
  }
  async getUploadStatus(uploadId: string, signal: AbortSignal): ReturnType<ProjectResourceStorage["getUploadStatus"]> {
    return this.rpc(async () => {
      const result = await this.client.getUploadStatus({ uploadId }, { headers: this.headers, signal })
      const state =
        result.state === UploadState.PENDING
          ? "pending"
          : result.state === UploadState.COMPLETED
            ? "completed"
            : result.state === UploadState.ABORTED
              ? "aborted"
              : null
      if (result.uploadId !== uploadId || state === null) throw new ProjectResourceError("storage_response_invalid", 502)
      return { state, assetId: result.assetId ?? null, sha256: result.expectedSha256, sizeBytes: String(result.expectedSizeBytes), mimeType: result.mimeType }
    })
  }
  async put(reference: StorageTransfer, input: ProjectResourceInput, signal: AbortSignal): Promise<void> {
    await putStorageBytes(reference, input.bytes, input.mimeType, this.config.objectOrigin, signal)
  }
  async completeUpload(commandId: string, requestDigest: string, uploadId: string, input: ProjectResourceInput, signal: AbortSignal) {
    return this.rpc(async () => {
      const result = await this.client.completeUpload(
        { command: { commandId, requestDigest }, uploadId, contentSha256: input.sha256, sizeBytes: BigInt(input.bytes.length) },
        { headers: this.headers, signal },
      )
      if (result.uploadId !== uploadId || !result.assetId) throw new ProjectResourceError("storage_response_invalid", 502)
      return { assetId: result.assetId, scanState: this.requireCleanScan(result.scanState) }
    })
  }
  async getAsset(uploadId: string, assetId: string, input: ProjectResourceInput, signal: AbortSignal): Promise<ProjectResource> {
    return this.rpc(async () => {
      const result = await this.client.getAsset({ assetId, contentSha256: input.sha256 }, { headers: this.headers, signal })
      if (
        result.assetId !== assetId ||
        result.contentSha256 !== input.sha256 ||
        result.sizeBytes !== BigInt(input.bytes.length) ||
        result.mimeType !== input.mimeType ||
        result.filename !== input.filename ||
        result.uploadPurpose !== UploadPurpose.ASSET
      )
        throw new ProjectResourceError("storage_response_invalid", 502)
      return {
        upload_id: uploadId,
        asset_id: assetId,
        filename: result.filename,
        mime_type: result.mimeType,
        size_bytes: String(result.sizeBytes),
        content_sha256: result.contentSha256,
        scan_state: this.requireCleanScan(result.scanState),
      }
    })
  }
  async listAssets(input: ProjectResourcePageInput, signal: AbortSignal): Promise<ProjectResourcePage> {
    try {
      const page = await this.client.listAssets(input, { headers: this.headers, signal })
      if (
        page.items.length > input.limit ||
        (page.nextCursor !== undefined && (!/^[\x21-\x7e]{1,4096}$/u.test(page.nextCursor) || page.nextCursor === input.cursor || page.items.length === 0))
      ) {
        throw new ProjectResourceError("storage_response_invalid", 502)
      }
      const ids = new Set<string>()
      const items = page.items.map((item) => {
        const timestamp = item.createdAt
        if (
          !/^[^\x00-\x1f\x7f]{1,191}$/u.test(item.assetId) ||
          ids.has(item.assetId) ||
          !/^[^\x00-\x1f\x7f/\\]{1,255}$/u.test(item.filename) ||
          [".", ".."].includes(item.filename) ||
          item.mimeType.length > 191 ||
          !/^[\w.+-]+\/[\w.+-]+$/u.test(item.mimeType) ||
          !/^[0-9a-f]{64}$/u.test(item.contentSha256) ||
          item.sizeBytes < 0n ||
          item.sizeBytes > 18446744073709551615n ||
          item.uploadPurpose !== UploadPurpose.ASSET ||
          item.scanState !== ScanState.CLEAN ||
          ![AssetOrigin.UPLOADED, AssetOrigin.GENERATED].includes(item.origin) ||
          timestamp === undefined ||
          timestamp.seconds < -62135596800n ||
          timestamp.seconds > 253402300799n ||
          timestamp.nanos < 0 ||
          timestamp.nanos > 999999999
        )
          throw new ProjectResourceError("storage_response_invalid", 502)
        ids.add(item.assetId)
        const createdAt = toJson(TimestampSchema, timestamp)
        if (typeof createdAt !== "string") throw new ProjectResourceError("storage_response_invalid", 502)
        return {
          asset_id: item.assetId,
          filename: item.filename,
          mime_type: item.mimeType,
          size_bytes: String(item.sizeBytes),
          content_sha256: item.contentSha256,
          scan_state: "clean" as const,
          created_at: createdAt,
        }
      })
      return { items, next_cursor: page.nextCursor ?? null }
    } catch (error) {
      if (error instanceof ProjectResourceError) throw error
      if (error instanceof ConnectError && error.code === Code.InvalidArgument) throw new ProjectResourceError("invalid_project_resource_page", 400)
      if (
        signal.aborted ||
        (error instanceof ConnectError &&
          [Code.Unavailable, Code.DeadlineExceeded, Code.Canceled, Code.Unauthenticated, Code.PermissionDenied, Code.ResourceExhausted].includes(error.code))
      ) {
        throw new ProjectResourceError("storage_unavailable", 503, true)
      }
      throw new ProjectResourceError("storage_response_invalid", 502)
    }
  }
  async abortUpload(commandId: string, requestDigest: string, uploadId: string, signal: AbortSignal): Promise<void> {
    await this.rpc(() =>
      this.client.abortUpload({ command: { commandId, requestDigest }, uploadId, reason: "bff_project_upload_failed" }, { headers: this.headers, signal }),
    )
  }
}
