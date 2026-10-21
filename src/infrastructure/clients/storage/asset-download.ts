import { createHash, randomUUID } from "node:crypto"
import { createClient, ConnectError, Code, type Client, type Transport } from "@connectrpc/connect"
import { createConnectTransport } from "@connectrpc/connect-node"
import { StorageService, UploadPurpose, ScanState } from "../../../generated/storage-connect/kokoro/storage/v3/storage_pb.js"
import { assetDownloadRemaining, withinAssetDownloadBudget } from "../../../application/asset-download-budget.js"
import { AssetDownloadError } from "./asset-download.error.js"
import { readAssetBytes } from "./asset-download-transfer.js"
import type { AssetDownloadContext, DownloadedAsset } from "./asset-download.types.js"

const MAX_FILE_BYTES = 1_048_576
const SHA256 = /^[0-9a-f]{64}$/u
const MIME = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/iu

export class AssetDownloadClient {
  private readonly client: Client<typeof StorageService>
  private readonly headers: Record<string, string>

  public constructor(
    private readonly config: { baseUrl: string; secret: string; objectOrigin: string },
    private readonly context: AssetDownloadContext,
    transport?: Transport,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    if (
      !["personal", "project"].includes(context.scope.kind) ||
      (context.scope.kind === "personal" && context.scope.id !== context.subjectId) ||
      (context.scope.kind === "project" && !/^project_[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.test(context.scope.id))
    )
      throw new AssetDownloadError("storage_unavailable", 503, true)
    this.client = createClient(
      StorageService,
      transport ??
        createConnectTransport({
          baseUrl: config.baseUrl,
          httpVersion: "1.1",
          defaultTimeoutMs: 10_000,
          readMaxBytes: MAX_FILE_BYTES,
          writeMaxBytes: MAX_FILE_BYTES,
        }),
    )
    this.headers = {
      "x-kokoro-service": "web-bff",
      "x-kokoro-internal-secret": config.secret,
      "x-kokoro-tenant-id": context.tenantId,
      "x-kokoro-subject-id": context.subjectId,
      "x-kokoro-request-id": context.requestId,
      "x-kokoro-scope-kind": context.scope.kind,
      "x-kokoro-scope-id": context.scope.id,
    }
  }

  private missing(): AssetDownloadError {
    return new AssetDownloadError(this.context.scope.kind === "personal" ? "library_file_not_found" : "project_resource_not_found", 404)
  }

  private async rpc<T>(signal: AbortSignal, deadlineAt: number, operation: () => Promise<T>): Promise<T> {
    try {
      return await withinAssetDownloadBudget(signal, deadlineAt, operation)
    } catch (error) {
      try {
        assetDownloadRemaining(signal, deadlineAt)
      } catch {
        throw new AssetDownloadError("storage_unavailable", 503, true)
      }
      if (error instanceof AssetDownloadError) throw error
      if (error instanceof ConnectError) {
        if (error.code === Code.NotFound || (error.code === Code.PermissionDenied && this.context.scope.kind === "personal")) throw this.missing()
        if (error.code === Code.PermissionDenied || error.code === Code.Unauthenticated) throw new AssetDownloadError("storage_unavailable", 503, true)
        if ([Code.FailedPrecondition, Code.InvalidArgument, Code.Internal, Code.Unimplemented, Code.Unknown, Code.DataLoss].includes(error.code))
          throw new AssetDownloadError("storage_response_invalid", 502)
      }
      throw new AssetDownloadError("storage_unavailable", 503, true)
    }
  }

  public async download(assetId: string, signal: AbortSignal, deadlineAt: number): Promise<DownloadedAsset> {
    const options = () => ({ headers: this.headers, signal, timeoutMs: assetDownloadRemaining(signal, deadlineAt) })
    const asset = await this.rpc(signal, deadlineAt, () => this.client.getAsset({ assetId }, options()))
    if (asset.assetId !== assetId || asset.uploadPurpose !== UploadPurpose.ASSET || asset.scanState !== ScanState.CLEAN) throw this.missing()
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
      throw new AssetDownloadError("storage_response_invalid", 502)
    try {
      encodeURIComponent(asset.filename)
    } catch {
      throw new AssetDownloadError("storage_response_invalid", 502)
    }
    const commandId = randomUUID()
    const requestDigest = createHash("sha256")
      .update(JSON.stringify([assetId, asset.contentSha256]))
      .digest("hex")
    const reference = await this.rpc(signal, deadlineAt, () =>
      this.client.getDownloadReference({ command: { commandId, requestDigest }, assetId, contentSha256: asset.contentSha256 }, options()),
    )
    if (
      reference.assetId !== assetId ||
      reference.contentSha256 !== asset.contentSha256 ||
      reference.sizeBytes !== asset.sizeBytes ||
      reference.mimeType !== asset.mimeType ||
      reference.scanState !== ScanState.CLEAN ||
      reference.downloadReference?.expiresAt === undefined
    )
      throw new AssetDownloadError("storage_response_invalid", 502)
    const signed = reference.downloadReference
    const expiry = signed.expiresAt
    if (expiry === undefined) throw new AssetDownloadError("storage_response_invalid", 502)
    const bytes = await readAssetBytes(
      { url: signed.url, method: signed.method, requiredHeaders: signed.requiredHeaders, expiresAt: Number(expiry.seconds) * 1000 + expiry.nanos / 1e6 },
      Number(asset.sizeBytes),
      asset.contentSha256,
      this.config.objectOrigin,
      signal,
      deadlineAt,
      this.fetcher,
    )
    return { bytes, mimeType: asset.mimeType, filename: asset.filename }
  }
}
