import type { AgUiProjectionService } from "../agui/project-session-events.js"
import type { AgUiProjectionConsumerRepository } from "../agui/ports/agui-projection-repository.js"
import type { IdempotencyRepository } from "./idempotency-repository.js"
import type { BffApplicationServices } from "../services.js"
import type { ScheduledTaskOutboxRepository } from "./scheduled-task-outbox-repository.js"
import type { AgentDispatchOutboxRepository } from "./agent-dispatch-outbox-repository.js"
import type { AgentCancellationOutboxRepository } from "./agent-cancellation-outbox-repository.js"
import type { SchedulerDispatchReceiptRepository } from "./scheduler-dispatch-receipt-repository.js"

/** Runtime port consumed by BFF routes; PostgreSQL is one infrastructure implementation. */
export interface BffBusinessStore extends IdempotencyRepository {
  readonly services: BffApplicationServices
  readonly agUi: AgUiProjectionService
  /** Durable source-consumer control plane exposed by the live store. */
  readonly agUiConsumers?: AgUiProjectionConsumerRepository
  /** Present on the live PostgreSQL composition; test route seams may omit it. */
  readonly scheduledTaskOutbox?: ScheduledTaskOutboxRepository
  /** Durable Chat -> Agent command queue owned by the live BFF store. */
  readonly agentDispatchOutbox?: AgentDispatchOutboxRepository
  /** Durable compensation queue for Agent runs whose owning conversation was deleted. */
  readonly agentCancellationOutbox?: AgentCancellationOutboxRepository
  /** Scheduler event-protocol receipt state; separate from public mutation receipts. */
  readonly schedulerDispatchReceipts?: SchedulerDispatchReceiptRepository
  ready(): Promise<void>
  close(): Promise<void>
}
