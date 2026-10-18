export type ScheduledTask = {
  id: string
  project_id?: string
  title: string
  prompt: string
  frequency: "daily" | "weekly"
  time: string
  timezone: string
  next_run_at: string | null
  expires_at?: string
  auto_approve: boolean
  enabled: boolean
  status: "active" | "paused" | "failed"
}

/** Current rule read, separate from the immutable mutation response snapshot. */
export type ScheduledTaskDetails = ScheduledTask & { recurrence_anchor_at: string }
