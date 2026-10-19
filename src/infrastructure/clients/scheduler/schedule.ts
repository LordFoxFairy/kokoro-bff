import type { ScheduledTaskFact } from "../../../domain/scheduled-task/task.js"

export type SchedulerScheduleInput = {
  name: string
  schedule?: string
  run_at?: string
  timezone: string
  url: string
  method: "POST"
  body: {
    tenant_id: string
    task_id: string
    task_revision: number
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

function trigger(task: ScheduledTaskFact): { schedule: string } | { run_at: string } {
  const match = /^(\d{2}):(\d{2})$/u.exec(task.time)
  if (match === null) throw new Error("SCHEDULE_LOCAL_TIME_INVALID")
  const hour = Number(match[1]),
    minute = Number(match[2])
  if (hour > 23 || minute > 59) throw new Error("SCHEDULE_LOCAL_TIME_INVALID")
  if (task.frequency === "daily") return { schedule: `${minute} ${hour} * * *` }
  if (task.frequency === "weekly" && task.weekdays !== undefined) return { schedule: `${minute} ${hour} * * ${task.weekdays.join(",")}` }
  if (task.frequency === "monthly" && task.monthDays !== undefined) return { schedule: `${minute} ${hour} ${task.monthDays.join(",")} * *` }
  if (task.frequency === "once" && task.runAt !== undefined && !Number.isNaN(task.runAt.getTime())) return { run_at: task.runAt.toISOString() }
  throw new Error("SCHEDULE_CALENDAR_INVALID")
}

export function buildSchedulerSchedule(task: ScheduledTaskFact, tenantId: string, ownerId: string, targetUrl: string): SchedulerScheduleInput {
  return {
    name: schedulerScheduleName(task.id),
    ...trigger(task),
    timezone: task.timezone,
    url: targetUrl,
    method: "POST",
    body: {
      tenant_id: tenantId,
      task_id: task.id,
      task_revision: task.revision,
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
