import type { ScheduledTaskCurrentView } from "../scheduled-task-read-service.js"
import type { ScheduledTask, ScheduledTaskDetails } from "../../contracts/index.js"
import type { ScheduledTaskFact } from "../../domain/scheduled-task/task.js"

/** Map the internal UTC Date aggregate to the public RFC 3339 wire contract. */
export function scheduledTaskResponse(task: ScheduledTaskFact): ScheduledTask {
  return {
    id: task.id,
    ...(task.projectId === undefined ? {} : { project_id: task.projectId }),
    title: task.title,
    prompt: task.prompt,
    trigger_kind: task.triggerKind,
    ...(task.triggerKind === "rss"
      ? { feed_url: task.feedUrl, conditions: task.conditions }
      : {
          frequency: task.frequency,
          time: task.time,
          timezone: task.timezone,
          ...(task.weekdays === undefined ? {} : { weekdays: task.weekdays.slice() }),
          ...(task.monthDays === undefined ? {} : { month_days: task.monthDays.slice() }),
          ...(task.localDate === undefined ? {} : { local_date: task.localDate }),
        }),
    next_run_at: null,
    ...(task.expiresAt === undefined ? {} : { expires_at: task.expiresAt.toISOString() }),
    auto_approve: task.autoApprove,
    enabled: task.enabled,
    status: task.status,
  }
}

/** A current read must not alter the representation saved in mutation receipts. */
export function scheduledTaskDetails({ task, state, nextRunAt, feed }: ScheduledTaskCurrentView): ScheduledTaskDetails {
  return {
    ...scheduledTaskResponse(task),
    scheduling_state: state,
    next_run_at: task.triggerKind === "rss" ? null : (nextRunAt?.toISOString() ?? null),
    ...(feed === undefined
      ? {}
      : { feed_state: feed.feedState, last_checked_at: feed.lastCheckedAt, next_check_at: feed.nextCheckAt, error_code: feed.errorCode }),
  }
}
