import type { Pool } from "pg"

import {
  PENDING_RECEIPT_STATUS,
  type IdempotencyRepository,
  type PersistentReceipt,
  type ReceiptClaim,
} from "../../modules/idempotency/repository.js"

export class PostgresIdempotencyRepository implements IdempotencyRepository {
  public constructor(private readonly pool: Pool) {}

  public async getReceipt(scope: string): Promise<PersistentReceipt | null> {
    const result = await this.pool.query<{ fingerprint: string; status: number; body: unknown }>(
      "SELECT fingerprint, status, response_body AS body FROM bff_idempotency_receipt WHERE scope = $1",
      [scope],
    )
    const row = result.rows[0]
    return row === undefined ? null : { fingerprint: row.fingerprint, status: row.status, body: row.body }
  }

  public async claimReceipt(scope: string, fingerprint: string): Promise<ReceiptClaim> {
    const result = await this.pool.query<{ fingerprint: string; status: number; body: unknown }>(
      `INSERT INTO bff_idempotency_receipt (scope, fingerprint, status, response_body)
       VALUES ($1, $2, $3, '{}'::jsonb)
       ON CONFLICT (scope) DO UPDATE
         SET fingerprint = EXCLUDED.fingerprint,
             status = EXCLUDED.status,
             response_body = '{}'::jsonb,
             created_at = CURRENT_TIMESTAMP
         WHERE bff_idempotency_receipt.status = $3
           AND bff_idempotency_receipt.created_at < CURRENT_TIMESTAMP - INTERVAL '60 seconds'
       RETURNING fingerprint, status, response_body AS body`,
      [scope, fingerprint, PENDING_RECEIPT_STATUS],
    )
    if (result.rows[0] !== undefined) return { claimed: true, receipt: null }
    return { claimed: false, receipt: await this.getReceipt(scope) }
  }

  public async putReceipt(scope: string, receipt: PersistentReceipt): Promise<void> {
    await this.pool.query(
      `INSERT INTO bff_idempotency_receipt (scope, fingerprint, status, response_body)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (scope) DO UPDATE
         SET status = EXCLUDED.status,
             response_body = EXCLUDED.response_body,
             created_at = CURRENT_TIMESTAMP
         WHERE bff_idempotency_receipt.status = $5
           AND bff_idempotency_receipt.fingerprint = EXCLUDED.fingerprint`,
      [scope, receipt.fingerprint, receipt.status, JSON.stringify(receipt.body), PENDING_RECEIPT_STATUS],
    )
  }

  public async releaseReceipt(scope: string, fingerprint: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM bff_idempotency_receipt
       WHERE scope = $1 AND fingerprint = $2 AND status = $3`,
      [scope, fingerprint, PENDING_RECEIPT_STATUS],
    )
  }
}
