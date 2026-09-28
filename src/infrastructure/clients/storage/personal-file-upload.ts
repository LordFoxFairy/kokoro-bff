import { createClient, ConnectError, Code, type Client, type Transport } from "@connectrpc/connect"
import { createConnectTransport } from "@connectrpc/connect-node"
import { StorageService, UploadPurpose, UploadState, ScanState } from "../../../generated/storage-connect/kokoro/storage/v2/storage_pb.js"
import { ProjectResourceError } from "../../../application/project-resource.error.js"
import { PersonalFileError } from "../../../application/personal-file-upload.error.js"
import type {
  PersonalFileContext,
  PersonalFileInput,
  PersonalFileStorage,
  PersonalFileStorageRecord,
  PersonalFileTransfer,
} from "../../../application/personal-file-upload.types.js"
import { putStorageBytes } from "./transfer.js"

export class PersonalFileUploadClient implements PersonalFileStorage {
  private readonly client: Client<typeof StorageService>
  private readonly headers: Record<string, string>

  constructor(
    private readonly config: { baseUrl: string; secret: string; objectOrigin: string },
    context: Omit<PersonalFileContext, "key">,
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
      "x-kokoro-scope-kind": "personal",
      "x-kokoro-scope-id": context.subjectId,
    }
  }

  private async rpc<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call()
    } catch (error) {
      if (error instanceof PersonalFileError) throw error
      if (error instanceof ConnectError && [Code.AlreadyExists, Code.FailedPrecondition].includes(error.code))
        throw new PersonalFileError("idempotency_conflict", 409)
      if (error instanceof ConnectError && [Code.InvalidArgument, Code.Internal, Code.Unimplemented, Code.Unknown].includes(error.code))
        throw new PersonalFileError("storage_response_invalid", 502)
      throw new PersonalFileError("storage_unavailable", 503, true)
    }
  }

  private requireCleanScan(state: ScanState): "clean" {
    if (state === ScanState.INFECTED) throw new PersonalFileError("library_file_infected", 422)
    if (state === ScanState.PENDING || state === ScanState.UNKNOWN) throw new PersonalFileError("library_file_scan_pending", 503, true)
    if (state !== ScanState.CLEAN) throw new PersonalFileError("storage_response_invalid", 502)
    return "clean"
  }

  async createUpload(commandId: string, digest: string, input: PersonalFileInput, signal: AbortSignal) {
    return this.rpc(async () => {
      const result = await this.client.createUpload(
        {
          command: { commandId, requestDigest: digest },
          filename: input.filename,
          mimeType: input.mimeType,
          sizeBytes: BigInt(input.bytes.length),
          contentSha256: input.sha256,
          uploadPurpose: UploadPurpose.ASSET,
        },
        { headers: this.headers, signal },
      )
      const ref = result.uploadReference
      if (!result.uploadId || !ref?.expiresAt) throw new PersonalFileError("storage_response_invalid", 502)
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

  async getUploadStatus(uploadId: string, signal: AbortSignal): ReturnType<PersonalFileStorage["getUploadStatus"]> {
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
      if (result.uploadId !== uploadId || state === null) throw new PersonalFileError("storage_response_invalid", 502)
      return { state, assetId: result.assetId ?? null, sha256: result.expectedSha256, sizeBytes: String(result.expectedSizeBytes), mimeType: result.mimeType }
    })
  }

  async put(reference: PersonalFileTransfer, input: PersonalFileInput, signal: AbortSignal): Promise<void> {
    try {
      await putStorageBytes(reference, input.bytes, input.mimeType, this.config.objectOrigin, signal)
    } catch (error) {
      if (error instanceof ProjectResourceError)
        throw new PersonalFileError(
          error.status === 502 ? "storage_response_invalid" : "storage_unavailable",
          error.status === 502 ? 502 : 503,
          error.status !== 502,
        )
      throw new PersonalFileError("storage_unavailable", 503, true)
    }
  }

  async completeUpload(commandId: string, digest: string, uploadId: string, input: PersonalFileInput, signal: AbortSignal) {
    return this.rpc(async () => {
      const result = await this.client.completeUpload(
        { command: { commandId, requestDigest: digest }, uploadId, contentSha256: input.sha256, sizeBytes: BigInt(input.bytes.length) },
        { headers: this.headers, signal },
      )
      if (result.uploadId !== uploadId || !result.assetId) throw new PersonalFileError("storage_response_invalid", 502)
      return { assetId: result.assetId, scanState: this.requireCleanScan(result.scanState) }
    })
  }

  async getAsset(_uploadId: string, assetId: string, input: PersonalFileInput, signal: AbortSignal): Promise<PersonalFileStorageRecord> {
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
        throw new PersonalFileError("storage_response_invalid", 502)
      return {
        asset_id: assetId,
        filename: result.filename,
        mime_type: result.mimeType,
        size_bytes: String(result.sizeBytes),
        content_sha256: result.contentSha256,
        scan_state: this.requireCleanScan(result.scanState),
      }
    })
  }
}
