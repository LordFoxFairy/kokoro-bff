import type { ScheduledTaskCreateInput, ScheduledTaskPatch } from "../ports/scheduled-task-repository.js"
import { isIanaTimezone, parseUtcTimestamp } from "../../domain/scheduled-task/task.js"

function instant(value: unknown, errorCode: string): Date | null {
  if (typeof value !== "string" || value.trim() === "") return null
  try {
    return parseUtcTimestamp(value.trim(), errorCode)
  } catch {
    return null
  }
}

export function scheduledCreateInput(json: Record<string, unknown>, projectId?: string): ScheduledTaskCreateInput | null {
  const title = typeof json.title === "string" ? json.title.trim() : ""
  const prompt = typeof json.prompt === "string" ? json.prompt.trim() : ""
  const frequency = json.frequency
  const time = typeof json.time === "string" ? json.time.trim() : ""
  const timezone = typeof json.timezone === "string" ? json.timezone.trim() : ""
  const nextRunAt = json.next_run_at === undefined ? new Date() : instant(json.next_run_at, "SCHEDULED_TASK_NEXT_RUN_INVALID")
  const expiresAt = json.expires_at === undefined
    ? undefined
    : json.expires_at === null
      ? null
      : instant(json.expires_at, "SCHEDULED_TASK_EXPIRES_INVALID")
  if (
    title === "" || prompt === "" || (frequency !== "daily" && frequency !== "weekly")
    || !/^([01]\d|2[0-3]):[0-5]\d$/u.test(time) || timezone === "" || !isIanaTimezone(timezone)
    || nextRunAt === null || expiresAt === null
  ) return null
  return {
    ...(projectId === undefined ? {} : { projectId }),
    title,
    prompt,
    frequency,
    time,
    timezone,
    nextRunAt,
    ...(expiresAt === undefined ? {} : { expiresAt }),
    autoApprove: typeof json.auto_approve === "boolean" ? json.auto_approve : false,
  }
}

export function scheduledPatchInput(json: Record<string, unknown>): ScheduledTaskPatch | null {
  const input: ScheduledTaskPatch = {}
  if (json.title !== undefined) {
    if (typeof json.title !== "string" || json.title.trim() === "") return null
    input.title = json.title.trim()
  }
  if (json.prompt !== undefined) {
    if (typeof json.prompt !== "string" || json.prompt.trim() === "") return null
    input.prompt = json.prompt.trim()
  }
  if (json.frequency !== undefined) {
    if (json.frequency !== "daily" && json.frequency !== "weekly") return null
    input.frequency = json.frequency
  }
  if (json.time !== undefined) {
    if (typeof json.time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/u.test(json.time)) return null
    input.time = json.time
  }
  if (json.timezone !== undefined) {
    if (typeof json.timezone !== "string" || json.timezone.trim() === "" || !isIanaTimezone(json.timezone.trim())) return null
    input.timezone = json.timezone.trim()
  }
  if (json.next_run_at !== undefined) {
    const nextRunAt = instant(json.next_run_at, "SCHEDULED_TASK_NEXT_RUN_INVALID")
    if (nextRunAt === null) return null
    input.nextRunAt = nextRunAt
  }
  if (json.expires_at !== undefined) {
    if (json.expires_at === null) {
      input.expiresAt = null
    } else {
      const expiresAt = instant(json.expires_at, "SCHEDULED_TASK_EXPIRES_INVALID")
      if (expiresAt === null) return null
      input.expiresAt = expiresAt
    }
  }
  if (json.auto_approve !== undefined) {
    if (typeof json.auto_approve !== "boolean") return null
    input.autoApprove = json.auto_approve
  }
  if (json.enabled !== undefined) {
    if (typeof json.enabled !== "boolean") return null
    input.enabled = json.enabled
  }
  if (json.status !== undefined) {
    if (json.status !== "active" && json.status !== "paused" && json.status !== "failed") return null
    input.status = json.status
  }
  return input
}
