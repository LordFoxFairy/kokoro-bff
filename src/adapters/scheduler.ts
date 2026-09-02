import type { ScheduledTask } from "../contracts/index.js"

export type SchedulerJob = {
  name: string
  schedule: string
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
  retry: { max_attempts: number; backoff_seconds: number }
  misfire_policy: "fire_once"
  paused: boolean
}

export function schedulerJobName(taskId: string): string {
  // Scheduler names are deployment-global. The task id is already generated
  // by the BFF and contains only the allowed UUID alphabet.
  return `kokoro.scheduled.${taskId.replace(/[^a-zA-Z0-9._-]/gu, "-")}`.toLowerCase().slice(0, 64)
}

function utcSchedule(task: ScheduledTask): string {
  const nextRun = new Date(task.next_run_at)
  if (Number.isNaN(nextRun.getTime())) throw new Error("SCHEDULE_NEXT_RUN_INVALID")
  const minute = nextRun.getUTCMinutes()
  const hour = nextRun.getUTCHours()
  if (task.frequency === "daily") return `${minute} ${hour} * * *`
  return `${minute} ${hour} * * ${nextRun.getUTCDay()}`
}

export function buildSchedulerJob(task: ScheduledTask, tenantId: string, ownerId: string, targetUrl: string): SchedulerJob {
  return {
    name: schedulerJobName(task.id),
    schedule: utcSchedule(task),
    url: targetUrl,
    method: "POST",
    body: {
      tenant_id: tenantId,
      task_id: task.id,
      ...(task.project_id === undefined ? {} : { project_id: task.project_id }),
      owner_id: ownerId,
      prompt: task.prompt,
      auto_approve: task.auto_approve,
      timezone: task.timezone,
    },
    retry: { max_attempts: 3, backoff_seconds: 30 },
    misfire_policy: "fire_once",
    paused: !task.enabled || task.status !== "active",
  }
}
