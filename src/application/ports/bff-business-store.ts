import type { AgUiProjectionService } from "../agui/project-session-events.js"
import type { IdempotencyRepository } from "./idempotency-repository.js"
import type { BffApplicationServices } from "../services.js"

/** Runtime port consumed by BFF routes; PostgreSQL is one infrastructure implementation. */
export interface BffBusinessStore extends IdempotencyRepository {
  readonly services: BffApplicationServices
  readonly agUi: AgUiProjectionService
  ready(): Promise<void>
  close(): Promise<void>
}
