import type { PostgresScheduledTaskRepository } from "../../infrastructure/postgres/scheduled-task-repository.js"

export const SCHEDULED_TASK_SNAPSHOTS = Symbol("SCHEDULED_TASK_SNAPSHOTS")
export const SCHEDULED_TASK_CALLBACK_LOOKUP = Symbol("SCHEDULED_TASK_CALLBACK_LOOKUP")

export type ScheduledTaskCallbackLookup = Readonly<{ findRecord: PostgresScheduledTaskRepository["findScheduledTaskRecord"] }>
