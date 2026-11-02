import { CALENDAR_FIELDS, calendarFromWire, calendarWire, freezeCalendar, type ScheduledCalendar } from "./calendar.js"
import { parseRssConditions, type RssConditionGroups } from "./rss-conditions.js"
export type ScheduledTrigger =
  | (ScheduledCalendar & { triggerKind: "calendar"; feedUrl?: never; conditions?: never })
  | {
      triggerKind: "rss"
      feedUrl: string
      conditions: RssConditionGroups
      frequency?: never
      time?: never
      timezone?: never
      weekdays?: never
      monthDays?: never
      localDate?: never
      runAt?: never
    }
export const TRIGGER_FIELDS = ["trigger_kind", "feed_url", "conditions", ...CALENDAR_FIELDS] as const
export function canonicalEpoch(value: unknown): string {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/u.test(value) || BigInt(value) > 9223372036854775807n) throw Error("rss_epoch_invalid")
  return value
}
export function parseRssFeedUrl(value: string): URL {
  const invalid = (): never => {
    throw new Error("rss_feed_url_invalid")
  }
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > 2048 || /[\s\x00-\x20\x7f\\]/u.test(value) || value.includes("#")) invalid()
  // Inspect authority syntax before URL normalization erases empty userinfo.
  const authority = /^https:\/\/([^/?#]*)/iu.exec(value)?.[1]
  if (!authority || authority.includes("@")) invalid()
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return invalid()
  }
  const hostname = url.hostname
  const labels = hostname.split(".")
  if (
    url.protocol !== "https:" ||
    (url.port !== "" && url.port !== "443") ||
    url.username ||
    url.password ||
    hostname.includes(":") ||
    hostname.length > 253 ||
    labels.length < 2 ||
    labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label))
  )
    invalid()
  const tld = labels.at(-1)!
  if (!/^[a-z]{2,63}$/u.test(tld) || ["localhost", "local", "internal", "invalid", "test", "example", "onion", "home", "lan", "arpa"].includes(tld)) invalid()
  return url
}

export function triggerFromWire(value: Record<string, unknown>): ScheduledTrigger | null {
  try {
    if (value.trigger_kind === "rss") {
      if (
        CALENDAR_FIELDS.some((key) => Object.hasOwn(value, key)) ||
        Object.hasOwn(value, "run_at") ||
        typeof value.feed_url !== "string" ||
        !Object.hasOwn(value, "conditions")
      )
        return null
      return { triggerKind: "rss", feedUrl: parseRssFeedUrl(value.feed_url).href, conditions: parseRssConditions(value.conditions) }
    }
    if (value.trigger_kind !== "calendar" || Object.hasOwn(value, "feed_url") || Object.hasOwn(value, "conditions")) return null
    const calendar = calendarFromWire(value)
    return calendar === null ? null : { ...freezeCalendar(calendar), triggerKind: "calendar" }
  } catch {
    return null
  }
}
export function triggerWire(value: ScheduledTrigger): Record<string, unknown> {
  return value.triggerKind === "rss"
    ? { trigger_kind: "rss", feed_url: value.feedUrl, conditions: value.conditions }
    : { trigger_kind: "calendar", ...calendarWire(value) }
}
