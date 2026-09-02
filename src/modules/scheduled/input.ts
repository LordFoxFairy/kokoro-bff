import type { ScheduledTaskCreateInput, ScheduledTaskPatch } from "./repository.js"

export function scheduledCreateInput(json: Record<string, unknown>, projectId?: string): ScheduledTaskCreateInput | null {
  const title = typeof json.title === "string" ? json.title.trim() : ""
  const prompt = typeof json.prompt === "string" ? json.prompt.trim() : ""
  const frequency = json.frequency
  const time = typeof json.time === "string" ? json.time.trim() : ""
  const timezone = typeof json.timezone === "string" ? json.timezone.trim() : ""
  const nextRunAt = typeof json.next_run_at === "string" && json.next_run_at.trim() !== ""
    ? json.next_run_at.trim()
    : new Date().toISOString()
  const expiresAt = json.expires_at === undefined ? undefined : typeof json.expires_at === "string" ? json.expires_at.trim() : null
  if (
    title === "" || prompt === "" || (frequency !== "daily" && frequency !== "weekly")
    || !/^([01]\d|2[0-3]):[0-5]\d$/u.test(time) || timezone === ""
    || Number.isNaN(Date.parse(nextRunAt)) || expiresAt === null
    || (expiresAt !== undefined && Number.isNaN(Date.parse(expiresAt)))
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
    if (typeof json.timezone !== "string" || json.timezone.trim() === "") return null
    input.timezone = json.timezone.trim()
  }
  if (json.next_run_at !== undefined) {
    if (typeof json.next_run_at !== "string" || Number.isNaN(Date.parse(json.next_run_at))) return null
    input.nextRunAt = json.next_run_at
  }
  if (json.expires_at !== undefined) {
    if (json.expires_at !== null && (typeof json.expires_at !== "string" || Number.isNaN(Date.parse(json.expires_at)))) return null
    input.expiresAt = json.expires_at
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
