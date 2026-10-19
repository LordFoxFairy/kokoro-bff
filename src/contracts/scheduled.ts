export type ScheduledTask = {
  id: string
  project_id?: string
  title: string
  prompt: string
  frequency: "daily" | "weekly" | "monthly" | "once"
  time: string
  timezone: string
  weekdays?: number[]
  month_days?: number[]
  local_date?: string
  next_run_at: string | null
  expires_at?: string
  auto_approve: boolean
  enabled: boolean
  status: "active" | "paused" | "failed"
}

/** Current rule read, separate from the immutable mutation response snapshot. */
export type ScheduledTaskDetails = ScheduledTask & { scheduling_state: "pending" | "active" | "paused" | "exhausted" | "failed" }
