import type { ScheduledTaskOutboxCommand } from "../../domain/scheduled-task/outbox.js"

export type ScheduledTaskOutboxDeliveryResult =
  | { outcome: "succeeded" }
  | { outcome: "retryable"; errorCode: string }
  | { outcome: "failed"; errorCode: string }

/** Port for one external Scheduler command attempt. */
export interface ScheduledTaskOutboxDeliveryPort {
  deliver(command: ScheduledTaskOutboxCommand): Promise<ScheduledTaskOutboxDeliveryResult>
}
