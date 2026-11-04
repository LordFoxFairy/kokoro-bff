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
