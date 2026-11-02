export type ScheduledTask = {
  id: string
  project_id?: string
  title: string
  prompt: string
  trigger_kind: "calendar" | "rss"
  feed_url?: string
  conditions?: import("../domain/scheduled-task/rss-conditions.js").RssConditionGroups
  frequency?: "daily" | "weekly" | "monthly" | "once"
  time?: string
  timezone?: string
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
export type ScheduledTaskDetails = ScheduledTask & {
  scheduling_state: "pending" | "active" | "paused" | "exhausted" | "failed"
  feed_state?: "initializing" | "active" | "backoff" | "limit_reached"
  last_checked_at?: string | null
  next_check_at?: string | null
  error_code?: string | null
}
