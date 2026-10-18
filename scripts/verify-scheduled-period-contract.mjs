import { createHash } from "node:crypto"
import { load } from "js-yaml"
// Release inverse only; this frozen old block is never a runtime schema or decoder.
const parentBlock =
  "    ScheduledTask:\n      type: object\n      required: [id, title, prompt, frequency, time, timezone, next_run_at, auto_approve, enabled, status]\n      properties:\n        id: { type: string }\n        project_id: { type: string }\n        title: { type: string }\n        prompt: { type: string }\n        frequency:\n          type: string\n          enum: [daily, weekly]\n        time: { type: string }\n        timezone: { type: string }\n        next_run_at: { type: [string, 'null'], format: date-time }\n        expires_at: { type: string, format: date-time }\n        auto_approve: { type: boolean }\n        enabled: { type: boolean }\n        status:\n          type: string\n          enum: [active, paused, failed]\n    ScheduledTaskDetails:\n      allOf:\n        - $ref: '#/components/schemas/ScheduledTask'\n      type: object\n      required: [recurrence_anchor_at]\n      properties:\n        recurrence_anchor_at: { type: string, format: date-time }\n    ScheduledTaskDetailResponse:\n      type: object\n      required: [data, meta]\n      properties:\n        data:\n          type: object\n          required: [task]\n          properties:\n            task: { $ref: '#/components/schemas/ScheduledTaskDetails' }\n        meta: { $ref: '#/components/schemas/RequestMeta' }\n    ScheduledTaskResponse:\n      type: object\n      required: [data, meta]\n      properties:\n        data:\n          type: object\n          required: [task]\n          properties:\n            task: { $ref: '#/components/schemas/ScheduledTask' }\n        meta: { $ref: '#/components/schemas/RequestMeta' }\n    ScheduledTaskListResponse:\n      type: object\n      required: [data, meta]\n      properties:\n        data:\n          type: object\n          required: [tasks]\n          properties:\n            tasks:\n              type: array\n              items: { $ref: '#/components/schemas/ScheduledTaskDetails' }\n        meta: { $ref: '#/components/schemas/RequestMeta' }\n    CreateScheduledTaskRequest:\n      type: object\n      required: [title, prompt, frequency, time, timezone]\n      additionalProperties: false\n      properties:\n        project_id:\n          type: string\n          minLength: 1\n          pattern: '^\\S(?:[\\s\\S]*\\S)?(?![\\s\\S])'\n          description: Exact nonempty visible Project ID or slug; leading and trailing whitespace are rejected, not trimmed.\n        title: { type: string }\n        prompt: { type: string }\n        frequency:\n          type: string\n          enum: [daily, weekly]\n        time: { type: string }\n        timezone: { type: string }\n        recurrence_anchor_at: { type: string, format: date-time }\n        expires_at: { type: string, format: date-time }\n        auto_approve: { type: boolean }\n    ScheduledTaskPatchRequest:\n      type: object\n      additionalProperties: false\n      properties:\n        title: { type: string }\n        prompt: { type: string }\n        frequency:\n          type: string\n          enum: [daily, weekly]\n        time: { type: string }\n        timezone: { type: string }\n        recurrence_anchor_at: { type: string, format: date-time }\n        expires_at: { type: [string, 'null'], format: date-time }\n        auto_approve: { type: boolean }\n        enabled: { type: boolean }\n        status:\n          type: string\n          enum: [active, paused, failed]\n"
const blockDigest = "a4fbfdc00adbec0fb782cd1ae8956b5beb4964455f160fdc0cb4d559b7c624e4"
const parentDigest = "e4c1b3b1d327994dd5e903bfb3b3a075ded24446c0173a0f1c15a75cab92ae80"
const digest = (value) => createHash("sha256").update(value).digest("hex")
export function restorePublic162ScheduledPeriodContract(source) {
  if (!/^  version: 17\.0\.0$/mu.test(source)) return source
  const start = source.indexOf("    ScheduledTaskWeekdays:\n")
  const end = source.indexOf("    McpConnectionProjection:\n", start)
  if (start < 0 || end < 0 || digest(source.slice(start, end)) !== blockDigest) throw Error("Scheduled period current block drift")
  const parent = (source.slice(0, start) + parentBlock + source.slice(end)).replace("  version: 17.0.0", "  version: 16.2.0")
  if (digest(parent) !== parentDigest) throw Error("Scheduled period complete Public16.2 parent inverse drift")
  return parent
}
export function inspectScheduledPeriodContract(source) {
  const errors = []
  try {
    if (load(source).info.version !== "17.0.0") throw Error("Scheduled period current version drift")
    restorePublic162ScheduledPeriodContract(source)
  } catch (error) {
    errors.push(error.message)
  }
  return errors
}
