import type { ScheduledTaskOutboxCommand } from "../../domain/scheduled-task/outbox.js"
import type { ScheduledTaskNextProjection } from "./scheduled-task-outbox-repository.js"

export type ScheduledTaskOutboxDeliveryResult =
  { outcome: "succeeded"; projection: ScheduledTaskNextProjection } | { outcome: "retryable"; errorCode: string } | { outcome: "failed"; errorCode: string }

/** Port for one external Scheduler command attempt. */
export interface ScheduledTaskOutboxDeliveryPort {
  deliver(command: ScheduledTaskOutboxCommand): Promise<ScheduledTaskOutboxDeliveryResult>
}
