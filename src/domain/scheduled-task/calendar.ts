import { Temporal } from "@js-temporal/polyfill"
import { isIanaTimezone } from "./task.js"

export type ScheduledTaskFrequency = "daily" | "weekly" | "monthly" | "once"
export type ScheduledCalendar = {
  frequency: ScheduledTaskFrequency
  time: string
  timezone: string
  weekdays?: number[]
  monthDays?: number[]
  localDate?: string
  runAt?: Date
}

export const CALENDAR_FIELDS = ["frequency", "time", "timezone", "weekdays", "month_days", "local_date"] as const

function selectedDays(value: unknown, minimum: number, maximum: number): number[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > maximum - minimum + 1) return null
  if (value.some((day) => !Number.isInteger(day) || day < minimum || day > maximum) || new Set(value).size !== value.length) return null
  return (value as number[]).slice().sort((left, right) => left - right)
}

/** Parse a complete wall-clock rule. No host clock, inferred weekday or future check. */
export function calendarFromWire(input: Record<string, unknown>): ScheduledCalendar | null {
  const { frequency, time, timezone } = input
  if (typeof time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/u.test(time)) return null
  if (typeof timezone !== "string" || /^[+-]/u.test(timezone) || !isIanaTimezone(timezone)) return null
  const selectors = ["weekdays", "month_days", "local_date"]
  const allowed = frequency === "weekly" ? "weekdays" : frequency === "monthly" ? "month_days" : frequency === "once" ? "local_date" : undefined
  if (selectors.some((field) => field !== allowed && Object.hasOwn(input, field))) return null
  if (frequency === "daily") return { frequency, time, timezone }
  if (frequency === "weekly") {
    const weekdays = selectedDays(input.weekdays, 0, 6)
    return weekdays === null ? null : { frequency, time, timezone, weekdays }
  }
  if (frequency === "monthly") {
    const monthDays = selectedDays(input.month_days, 1, 31)
    return monthDays === null ? null : { frequency, time, timezone, monthDays }
  }
  if (frequency !== "once" || typeof input.local_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(input.local_date)) return null
  try {
    Temporal.PlainDate.from(input.local_date, { overflow: "reject" })
    return { frequency, time, timezone, localDate: input.local_date }
  } catch {
    return null
  }
}

/** Freeze a new rule, rejecting DST gaps rather than silently moving the user's time. */
export function freezeCalendar(rule: ScheduledCalendar): ScheduledCalendar {
  if (rule.frequency !== "once") return { ...rule }
  const local = Temporal.PlainDate.from(rule.localDate as string).toPlainDateTime(rule.time)
  const zoned = local.toZonedDateTime(rule.timezone, { disambiguation: "earlier" })
  if (!zoned.toPlainDateTime().equals(local)) throw new Error("SCHEDULED_TASK_LOCAL_TIME_GAP")
  return { ...rule, runAt: new Date(zoned.epochMilliseconds) }
}

export function calendarWire(rule: ScheduledCalendar): Record<string, unknown> {
  return {
    frequency: rule.frequency,
    time: rule.time,
    timezone: rule.timezone,
    ...(rule.weekdays === undefined ? {} : { weekdays: rule.weekdays }),
    ...(rule.monthDays === undefined ? {} : { month_days: rule.monthDays }),
    ...(rule.localDate === undefined ? {} : { local_date: rule.localDate }),
  }
}
