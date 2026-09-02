import type { ScheduledTask } from "../../contracts/index.js"

export type ScheduledTaskCreateInput = {
  projectId?: string
  title: string
  prompt: string
  frequency: "daily" | "weekly"
  time: string
  timezone: string
  nextRunAt: string
  expiresAt?: string
  autoApprove: boolean
}

export type ScheduledTaskPatch = Partial<{
  title: string
  prompt: string
  frequency: "daily" | "weekly"
  time: string
  timezone: string
  nextRunAt: string
  expiresAt: string | null
  autoApprove: boolean
  enabled: boolean
  status: "active" | "paused" | "failed"
}>

export type ScheduledTaskRecord = {
  task: ScheduledTask
  ownerId: string
}

/** Port consumed by the BFF application layer. It contains no SQL or driver types. */
export interface ScheduledTaskRepository {
  listScheduledTasks(tenantId: string): Promise<ScheduledTask[]>
  listScheduledTaskRecords(): Promise<Array<ScheduledTaskRecord & { tenantId: string }>>
  findScheduledTask(tenantId: string, taskId: string): Promise<ScheduledTask | null>
  findScheduledTaskRecord(tenantId: string, taskId: string): Promise<ScheduledTaskRecord | null>
  createScheduledTask(tenantId: string, ownerId: string, input: ScheduledTaskCreateInput, requestedTaskId?: string): Promise<ScheduledTask>
  updateScheduledTask(tenantId: string, taskId: string, input: ScheduledTaskPatch): Promise<ScheduledTask | null>
  deleteScheduledTask(tenantId: string, taskId: string): Promise<boolean>
}
