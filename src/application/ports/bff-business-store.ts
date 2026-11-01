import type { IdempotencyRepository } from "./idempotency-repository.js"

/** Minimal runtime port consumed by BFF routes; feature resources stay in named composition seams. */
export interface BffBusinessStore extends IdempotencyRepository {
  ready(): Promise<void>
  close(): Promise<void>
}
