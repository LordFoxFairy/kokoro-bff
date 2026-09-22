import { createHash } from "node:crypto"

type JsonScalar = null | boolean | number | string
type JsonValue = JsonScalar | JsonValue[] | { [key: string]: JsonValue }

function canonicalScalar(value: JsonScalar): string {
  if (typeof value === "number" && !Number.isFinite(value)) throw new Error("Scheduler canonical JSON requires a finite JSON number")
  const encoded = JSON.stringify(Object.is(value, -0) ? 0 : value)
  if (encoded === undefined) throw new Error("Scheduler canonical JSON requires a JSON value")
  return encoded
}

export function canonicalSchedulerJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") return canonicalScalar(value)
  if (Array.isArray(value)) return `[${value.map((item) => canonicalSchedulerJson(item)).join(",")}]`
  if (typeof value !== "object" || value === undefined) throw new Error("Scheduler canonical JSON requires a JSON value")
  const record = value as Record<string, unknown>
  const entries = Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalSchedulerJson(record[key])}`)
  return `{${entries.join(",")}}`
}

export function canonicalSchedulerOccurrence(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/u.exec(value)
  if (match === null) throw new Error("Scheduler occurrence must be an RFC3339Nano UTC instant")
  const [, year, month, day, hour, minute, second, fraction = ""] = match
  const numericYear = Number(year)
  const numericMonth = Number(month)
  const numericDay = Number(day)
  const numericHour = Number(hour)
  const numericMinute = Number(minute)
  const numericSecond = Number(second)
  const leapYear = numericYear % 4 === 0 && (numericYear % 100 !== 0 || numericYear % 400 === 0)
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][numericMonth - 1]
  if (daysInMonth === undefined || numericDay < 1 || numericDay > daysInMonth || numericHour > 23 || numericMinute > 59 || numericSecond > 59)
    throw new Error("Scheduler occurrence must be an RFC3339Nano UTC instant")
  const normalizedFraction = fraction.replace(/0+$/u, "")
  return `${year}-${month}-${day}T${hour}:${minute}:${second}${normalizedFraction === "" ? "" : `.${normalizedFraction}`}Z`
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

export function schedulerDispatchScope(tenantId: string, idempotencyKey: string): string {
  return JSON.stringify([tenantId, "scheduler-dispatch:v1", idempotencyKey])
}

export function schedulerDispatchDigest(input: { tenantId: string; schedule: string; occurrence: string; body: unknown }): string {
  return sha256(canonicalSchedulerJson([input.tenantId, input.schedule, canonicalSchedulerOccurrence(input.occurrence), input.body]))
}

export function schedulerOccurrenceIdentity(input: { tenantId: string; schedule: string; occurrence: string }): string {
  return sha256(canonicalSchedulerJson([input.tenantId, input.schedule, canonicalSchedulerOccurrence(input.occurrence)]))
}

export function schedulerJsonValue(value: unknown): JsonValue {
  canonicalSchedulerJson(value)
  return value as JsonValue
}
