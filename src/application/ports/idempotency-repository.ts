export type PersistentReceipt = {
  fingerprint: string
  status: number
  body: unknown
}

export type ReceiptClaim = {
  claimed: boolean
  receipt: PersistentReceipt | null
}

export interface IdempotencyRepository {
  getReceipt(scope: string): Promise<PersistentReceipt | null>
  claimReceipt(scope: string, fingerprint: string): Promise<ReceiptClaim>
  putReceipt(scope: string, receipt: PersistentReceipt): Promise<void>
  releaseReceipt(scope: string, fingerprint: string): Promise<void>
}

// Internal-only marker. It is never exposed as an HTTP response status.
export const PENDING_RECEIPT_STATUS = 102
