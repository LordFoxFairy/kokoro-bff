import { toJson } from "@bufbuild/protobuf"
import { TimestampSchema, type Timestamp } from "@bufbuild/protobuf/wkt"
import { ConnectError } from "@connectrpc/connect"
import { ErrorCode, ErrorDetailSchema } from "../../../generated/storage-connect/kokoro/common/v1/common_pb.js"
import type { DeleteAssetResponse } from "../../../generated/storage-connect/kokoro/storage/v3/storage_pb.js"

export type AssetDeletionReceipt = Readonly<{ asset_id: string; deleted_at: string; replayed: boolean }>

/** Decode a bounded owner deletion timestamp. */
export function storageDeletionTimestamp(at: Timestamp | undefined): string | null {
  if (at === undefined || at.seconds < -62135596800n || at.seconds > 253402300799n || at.nanos < 0 || at.nanos > 999999999) return null
  const iso = toJson(TimestampSchema, at)
  return typeof iso === "string" ? iso : null
}

export function assetDeletionReceipt(result: DeleteAssetResponse, assetId: string): AssetDeletionReceipt | null {
  if (result.$unknown?.length || result.assetId !== assetId || typeof result.replayed !== "boolean") return null
  const deletedAt = storageDeletionTimestamp(result.deletedAt)
  return deletedAt === null ? null : { asset_id: assetId, deleted_at: deletedAt, replayed: result.replayed }
}

export function assetDeletionError(error: ConnectError, requestId: string) {
  const details = error.findDetails(ErrorDetailSchema)
  const detail = details[0]
  return details.length === 1 &&
    detail?.requestId === requestId &&
    error.metadata.get("x-request-id") === requestId &&
    error.metadata.get("x-kokoro-error-code") === ErrorCode[detail.code] &&
    error.metadata.get("x-kokoro-retryable") === String(detail.retryable)
    ? detail
    : null
}
