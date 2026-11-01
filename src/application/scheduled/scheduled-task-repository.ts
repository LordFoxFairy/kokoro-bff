import type { ScheduledTaskOutboxStatus } from "../../domain/scheduled-task/outbox.js"
import type { ScheduledTaskFact, ScheduledTaskStatus } from "../../domain/scheduled-task/task.js"
import type { ScheduledCalendar } from "../../domain/scheduled-task/calendar.js"

export type ScheduledTaskMutationLineage = {
  tenantId: string
  actorId: string
  requestId: string
  idempotencyKey: string
}

export type ScheduledTaskOwnerScope = Readonly<{
  tenantId: string
  subjectId: string
}>

export type ScheduledTaskCreateInput = ScheduledCalendar & {
  projectId?: string
  title: string
  prompt: string
  expiresAt?: Date
  autoApprove: boolean
}

export type ScheduledTaskPatch = Partial<{
  title: string
  prompt: string
  expiresAt: Date | null
  autoApprove: boolean
  enabled: boolean
  status: ScheduledTaskStatus
}> &
  Partial<ScheduledCalendar>

export type ScheduledTaskRecord = {
  task: ScheduledTaskFact
  ownerId: string
}

export type ScheduledTaskReadSnapshot = Readonly<{ task: ScheduledTaskFact; deliveryStatus: ScheduledTaskOutboxStatus | null; projectAvailable: boolean }>

/** Port consumed by the BFF application layer. It contains no SQL or driver types. */
export interface ScheduledTaskRepository {
  readScheduledTaskSnapshots(scope: ScheduledTaskOwnerScope, signal: AbortSignal, taskId?: string): Promise<ScheduledTaskReadSnapshot[]>
  listScheduledTasks(scope: ScheduledTaskOwnerScope): Promise<ScheduledTaskFact[]>
  findScheduledTask(scope: ScheduledTaskOwnerScope, taskId: string): Promise<ScheduledTaskFact | null>
  /** Internal Scheduler callback lookup; never exposed as a user-resource query. */
  findScheduledTaskRecord(tenantId: string, taskId: string): Promise<ScheduledTaskRecord | null>
  /** Fact mutation and its Scheduler command are committed in one local transaction. */
  createScheduledTask(
    scope: ScheduledTaskOwnerScope,
    input: ScheduledTaskCreateInput,
    requestedTaskId: string | undefined,
    lineage: ScheduledTaskMutationLineage,
  ): Promise<ScheduledTaskFact>
  updateScheduledTask(
    scope: ScheduledTaskOwnerScope,
    taskId: string,
    input: ScheduledTaskPatch,
    lineage: ScheduledTaskMutationLineage,
  ): Promise<ScheduledTaskFact | null>
  deleteScheduledTask(scope: ScheduledTaskOwnerScope, taskId: string, lineage: ScheduledTaskMutationLineage): Promise<boolean>
}
