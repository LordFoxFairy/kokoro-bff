import { CALENDAR_FIELDS, calendarFromWire, freezeCalendar } from "../../domain/scheduled-task/calendar.js"
import type { ScheduledTaskCreateInput, ScheduledTaskPatch } from "../ports/scheduled-task-repository.js"
import { parseUtcTimestamp } from "../../domain/scheduled-task/task.js"

const CREATE_FIELDS = new Set(["project_id", "title", "prompt", ...CALENDAR_FIELDS, "expires_at", "auto_approve"])
const PATCH_FIELDS = new Set(["title", "prompt", ...CALENDAR_FIELDS, "expires_at", "auto_approve", "enabled", "status"])

function exactProjectReference(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value
}

function instant(value: unknown, errorCode: string): Date | null {
  if (typeof value !== "string" || value.trim() === "") return null
  try {
    return parseUtcTimestamp(value.trim(), errorCode)
  } catch {
    return null
  }
}

export function scheduledCreateInput(json: Record<string, unknown>, projectId?: string): ScheduledTaskCreateInput | null {
  if (Object.keys(json).some((key) => !CREATE_FIELDS.has(key))) return null
  if (Object.hasOwn(json, "project_id") && !exactProjectReference(json.project_id)) return null
  if (Object.hasOwn(json, "auto_approve") && typeof json.auto_approve !== "boolean") return null
  if (projectId !== undefined && !exactProjectReference(projectId)) return null
  const projectReference = projectId ?? (typeof json.project_id === "string" ? json.project_id : undefined)
  const title = typeof json.title === "string" ? json.title.trim() : ""
  const prompt = typeof json.prompt === "string" ? json.prompt.trim() : ""
  const calendar = calendarFromWire(json)
  if (calendar === null) return null
  let rule
  try {
    rule = freezeCalendar(calendar)
  } catch {
    return null
  }
  const expiresAt = json.expires_at === undefined ? undefined : json.expires_at === null ? null : instant(json.expires_at, "SCHEDULED_TASK_EXPIRES_INVALID")
  if (title === "" || prompt === "" || expiresAt === null) return null
  return {
    ...(projectReference === undefined ? {} : { projectId: projectReference }),
    title,
    prompt,
    ...rule,
    ...(expiresAt === undefined ? {} : { expiresAt }),
    autoApprove: typeof json.auto_approve === "boolean" ? json.auto_approve : false,
  }
}

export function scheduledPatchInput(json: Record<string, unknown>): ScheduledTaskPatch | null {
  if (Object.keys(json).some((key) => !PATCH_FIELDS.has(key))) return null
  const input: ScheduledTaskPatch = {}
  if (json.title !== undefined) {
    if (typeof json.title !== "string" || json.title.trim() === "") return null
    input.title = json.title.trim()
  }
  if (json.prompt !== undefined) {
    if (typeof json.prompt !== "string" || json.prompt.trim() === "") return null
    input.prompt = json.prompt.trim()
  }
  if (CALENDAR_FIELDS.some((field) => Object.hasOwn(json, field))) {
    const calendar = calendarFromWire(json)
    if (calendar === null) return null
    try {
      Object.assign(input, freezeCalendar(calendar))
    } catch {
      return null
    }
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
