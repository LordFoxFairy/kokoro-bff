import type { ScheduledTaskFact } from "../../domain/scheduled-task/task.js"
import type { ScheduledTaskOwnerScope } from "./scheduled-task-repository.js"

export type ScheduledTaskSchedulingState = "pending" | "active" | "paused" | "exhausted" | "failed"
export type ScheduledTaskCurrentState = Readonly<{ state: "active" | "paused" | "exhausted"; nextRunAt: Date | null }>
export interface ScheduledTaskStateReader {
  read(task: ScheduledTaskFact, scope: ScheduledTaskOwnerScope, requestId: string, signal: AbortSignal): Promise<ScheduledTaskCurrentState>
}
