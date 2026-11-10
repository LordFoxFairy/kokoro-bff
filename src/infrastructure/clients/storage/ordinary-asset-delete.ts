import { toJson } from "@bufbuild/protobuf"
import { TimestampSchema } from "@bufbuild/protobuf/wkt"
import { ConnectError } from "@connectrpc/connect"
import { ErrorCode, ErrorDetailSchema } from "../../../generated/storage-connect/kokoro/common/v1/common_pb.js"
import type { DeleteAssetResponse } from "../../../generated/storage-connect/kokoro/storage/v3/storage_pb.js"

export type AssetDeletionReceipt = Readonly<{ asset_id: string; deleted_at: string; replayed: boolean }>

export function assetDeletionReceipt(result: DeleteAssetResponse, assetId: string): AssetDeletionReceipt | null {
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
    return null
  const deletedAt = toJson(TimestampSchema, at)
  return typeof deletedAt === "string" ? { asset_id: assetId, deleted_at: deletedAt, replayed: result.replayed } : null
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
