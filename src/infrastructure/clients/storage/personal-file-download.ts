import { createHash, randomUUID } from "node:crypto"
import { createClient, ConnectError, Code, type Client, type Transport } from "@connectrpc/connect"
import { createConnectTransport } from "@connectrpc/connect-node"
import { StorageService, UploadPurpose, ScanState } from "../../../generated/storage-connect/kokoro/storage/v2/storage_pb.js"
import { PersonalFileDownloadError, readPersonalFileBytes } from "./personal-file-download-transfer.js"

export type PersonalFileDownloadContext = Readonly<{ tenantId: string; subjectId: string; requestId: string }>
export type DownloadedPersonalFile = Readonly<{ bytes: Buffer; mimeType: string; filename: string }>

const MAX_FILE_BYTES = 1_048_576
const SHA256 = /^[0-9a-f]{64}$/u
const MIME = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/iu

export class PersonalFileDownloadClient {
  private readonly client: Client<typeof StorageService>
  private readonly headers: Record<string, string>

  public constructor(
    private readonly config: { baseUrl: string; secret: string; objectOrigin: string },
    context: PersonalFileDownloadContext,
    transport?: Transport,
    private readonly fetcher: typeof fetch = fetch,
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

  private async rpc<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    } catch (error) {
      if (error instanceof PersonalFileDownloadError) throw error
      if (error instanceof ConnectError && [Code.NotFound, Code.PermissionDenied].includes(error.code))
        throw new PersonalFileDownloadError("library_file_not_found", 404)
      if (
        error instanceof ConnectError &&
        [Code.FailedPrecondition, Code.InvalidArgument, Code.Internal, Code.Unimplemented, Code.Unknown, Code.DataLoss].includes(error.code)
      )
        throw new PersonalFileDownloadError("storage_response_invalid", 502)
      throw new PersonalFileDownloadError("storage_unavailable", 503, true)
    }
  }

  public async download(assetId: string, signal: AbortSignal): Promise<DownloadedPersonalFile> {
    const asset = await this.rpc(() => this.client.getAsset({ assetId }, { headers: this.headers, signal }))
    if (asset.assetId !== assetId || asset.uploadPurpose !== UploadPurpose.ASSET || asset.scanState !== ScanState.CLEAN)
      throw new PersonalFileDownloadError("library_file_not_found", 404)
    if (
      !SHA256.test(asset.contentSha256) ||
      asset.sizeBytes > BigInt(MAX_FILE_BYTES) ||
      asset.sizeBytes < 0n ||
      !MIME.test(asset.mimeType) ||
      asset.mimeType.length > 191 ||
      asset.filename.length === 0 ||
      asset.filename.length > 255 ||
      /[\u0000-\u001f\u007f/\\]/u.test(asset.filename)
    )
      throw new PersonalFileDownloadError("storage_response_invalid", 502)

    const commandId = randomUUID()
    const requestDigest = createHash("sha256")
      .update(JSON.stringify([assetId, asset.contentSha256]))
      .digest("hex")
    const reference = await this.rpc(() =>
      this.client.getDownloadReference(
        { command: { commandId, requestDigest }, assetId, contentSha256: asset.contentSha256 },
        { headers: this.headers, signal },
      ),
    )
    if (
      reference.assetId !== assetId ||
      reference.contentSha256 !== asset.contentSha256 ||
      reference.sizeBytes !== asset.sizeBytes ||
      reference.mimeType !== asset.mimeType ||
      reference.scanState !== ScanState.CLEAN ||
      reference.downloadReference?.expiresAt === undefined
    )
      throw new PersonalFileDownloadError("storage_response_invalid", 502)
    const signed = reference.downloadReference
    const expiry = signed.expiresAt
    if (expiry === undefined) throw new PersonalFileDownloadError("storage_response_invalid", 502)
    const expiresAt = Number(expiry.seconds) * 1000 + expiry.nanos / 1e6
    const bytes = await readPersonalFileBytes(
      { url: signed.url, method: signed.method, requiredHeaders: signed.requiredHeaders, expiresAt },
      Number(asset.sizeBytes),
      asset.contentSha256,
      this.config.objectOrigin,
      signal,
      this.fetcher,
    )
    return { bytes, mimeType: asset.mimeType, filename: asset.filename }
  }
}

export { PersonalFileDownloadError } from "./personal-file-download-transfer.js"
