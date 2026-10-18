import type { ScheduledTask, ScheduledTaskDetails } from "../../contracts/index.js"
import type { ScheduledTaskFact } from "../../domain/scheduled-task/task.js"

/** Map the internal UTC Date aggregate to the public RFC 3339 wire contract. */
export function scheduledTaskResponse(task: ScheduledTaskFact): ScheduledTask {
  return {
    id: task.id,
    ...(task.projectId === undefined ? {} : { project_id: task.projectId }),
    title: task.title,
    prompt: task.prompt,
    frequency: task.frequency,
    time: task.time,
    timezone: task.timezone,
    next_run_at: task.nextRunAt?.toISOString() ?? null,
    ...(task.expiresAt === undefined ? {} : { expires_at: task.expiresAt.toISOString() }),
    auto_approve: task.autoApprove,
    enabled: task.enabled,
    status: task.status,
  }
}

/** A current read must not alter the representation saved in mutation receipts. */
export function scheduledTaskDetails(task: ScheduledTaskFact): ScheduledTaskDetails {
  return { ...scheduledTaskResponse(task), recurrence_anchor_at: task.recurrenceAnchorAt.toISOString() }
}
