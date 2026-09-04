import type { ScheduledTaskFact, ScheduledTaskFrequency, ScheduledTaskStatus } from "../../domain/scheduled-task/task.js"

export type ScheduledTaskMutationLineage = {
  tenantId: string
  actorId: string
  requestId: string
  idempotencyKey: string
}

export type ScheduledTaskCreateInput = {
  projectId?: string
  title: string
  prompt: string
  frequency: ScheduledTaskFrequency
  time: string
  timezone: string
  nextRunAt: Date
  expiresAt?: Date
  autoApprove: boolean
}

export type ScheduledTaskPatch = Partial<{
  title: string
  prompt: string
  frequency: ScheduledTaskFrequency
  time: string
  timezone: string
  nextRunAt: Date
  expiresAt: Date | null
  autoApprove: boolean
  enabled: boolean
  status: ScheduledTaskStatus
}>

export type ScheduledTaskRecord = {
  task: ScheduledTaskFact
  ownerId: string
}

/** Port consumed by the BFF application layer. It contains no SQL or driver types. */
export interface ScheduledTaskRepository {
  listScheduledTasks(tenantId: string): Promise<ScheduledTaskFact[]>
  findScheduledTask(tenantId: string, taskId: string): Promise<ScheduledTaskFact | null>
  findScheduledTaskRecord(tenantId: string, taskId: string): Promise<ScheduledTaskRecord | null>
  /** Fact mutation and its Scheduler command are committed in one local transaction. */
  createScheduledTask(
    tenantId: string,
    ownerId: string,
    input: ScheduledTaskCreateInput,
    requestedTaskId: string | undefined,
    lineage: ScheduledTaskMutationLineage,
  ): Promise<ScheduledTaskFact>
  updateScheduledTask(
    tenantId: string,
    taskId: string,
    input: ScheduledTaskPatch,
    lineage: ScheduledTaskMutationLineage,
  ): Promise<ScheduledTaskFact | null>
  deleteScheduledTask(tenantId: string, taskId: string, lineage: ScheduledTaskMutationLineage): Promise<boolean>
}
