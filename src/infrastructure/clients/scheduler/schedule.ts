import type { ScheduledTaskFact } from "../../../domain/scheduled-task/task.js"

export type SchedulerScheduleInput = {
  name: string
  schedule: string
  timezone: string
  url: string
  method: "POST"
  body: {
    tenant_id: string
    task_id: string
    project_id?: string
    owner_id: string
    prompt: string
    auto_approve: boolean
    timezone: string
  }
  retry: { max_attempts: number; backoff_seconds: number; max_backoff_seconds: number; max_retry_window_seconds: number }
  misfire_policy: "fire_once"
  catch_up_limit: 1
  overlap_policy: "forbid"
  paused: boolean
}

export function schedulerScheduleName(taskId: string): string {
  return `kokoro.scheduled.${taskId.replace(/[^a-zA-Z0-9._-]/gu, "-")}`.toLowerCase().slice(0, 64)
}

function weekdayInTimezone(instant: Date, timezone: string): number {
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" }).format(instant)
  const index = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday)
  if (index < 0) throw new Error("SCHEDULE_WEEKDAY_INVALID")
  return index
}

function localSchedule(task: ScheduledTaskFact): string {
  const match = /^(\d{2}):(\d{2})$/u.exec(task.time)
  if (match === null) throw new Error("SCHEDULE_LOCAL_TIME_INVALID")
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) throw new Error("SCHEDULE_LOCAL_TIME_INVALID")
  if (task.frequency === "daily") return `${minute} ${hour} * * *`
  if (Number.isNaN(task.nextRunAt.getTime())) throw new Error("SCHEDULE_NEXT_RUN_INVALID")
  return `${minute} ${hour} * * ${weekdayInTimezone(task.nextRunAt, task.timezone)}`
}

export function buildSchedulerSchedule(task: ScheduledTaskFact, tenantId: string, ownerId: string, targetUrl: string): SchedulerScheduleInput {
  return {
    name: schedulerScheduleName(task.id),
    schedule: localSchedule(task),
    timezone: task.timezone,
    url: targetUrl,
    method: "POST",
    body: {
      tenant_id: tenantId,
      task_id: task.id,
      ...(task.projectId === undefined ? {} : { project_id: task.projectId }),
      owner_id: ownerId,
      prompt: task.prompt,
      auto_approve: task.autoApprove,
      timezone: task.timezone,
    },
    retry: { max_attempts: 3, backoff_seconds: 30, max_backoff_seconds: 300, max_retry_window_seconds: 3600 },
    misfire_policy: "fire_once",
    catch_up_limit: 1,
    overlap_policy: "forbid",
    paused: !task.enabled || task.status !== "active",
  }
}
