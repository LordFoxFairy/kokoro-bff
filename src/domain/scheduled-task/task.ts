export type ScheduledTaskFrequency = "daily" | "weekly"
export type ScheduledTaskStatus = "active" | "paused" | "failed"

/**
 * ScheduledTask's internal aggregate representation.
 *
 * Instant fields are Date values after the HTTP/JSON boundary.  The local
 * wall-clock rule remains a string paired with an IANA timezone; it is not
 * converted to a server-local timezone.
 */
export type ScheduledTaskFact = {
  id: string
  projectId?: string
  title: string
  prompt: string
  frequency: ScheduledTaskFrequency
  time: string
  timezone: string
  nextRunAt: Date
  expiresAt?: Date
  autoApprove: boolean
  enabled: boolean
  status: ScheduledTaskStatus
  revision: number
}

export function utcDate(value: Date, errorCode: string): Date {
  if (Number.isNaN(value.getTime())) throw new Error(errorCode)
  return new Date(value.getTime())
}

/** Parse an offset-bearing RFC 3339 instant and normalize it to UTC. */
export function parseUtcTimestamp(value: string, errorCode: string): Date {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime()) || !/(?:Z|[+-]\d{2}:\d{2})$/u.test(value.trim())) throw new Error(errorCode)
  return utcDate(parsed, errorCode)
}

/** Validate a user-supplied IANA timezone without consulting the host clock. */
export function isIanaTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format()
    return true
  } catch {
    return false
  }
}
