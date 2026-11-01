import type { ScheduledTaskFact } from "./task.js"
import type { RssFeedEntry } from "./rss-feed.js"
export type RssErrorCode =
  | "rss_feed_url_invalid"
  | "rss_feed_address_forbidden"
  | "rss_feed_dns_unavailable"
  | "rss_feed_dns_busy"
  | "rss_feed_unavailable"
  | "rss_feed_timeout"
  | "rss_feed_cancelled"
  | "rss_feed_response_invalid"
  | "rss_feed_too_large"
  | "feed_invalid"
  | "queue_full"
  | "launch_too_large"
  | "limit_reached"
export type RssFeedFacts = Readonly<{
  feedState: "initializing" | "active" | "backoff" | "limit_reached"
  lastCheckedAt: string | null
  nextCheckAt: string | null
  errorCode: RssErrorCode | null
}>
export type RssPollSummary = Readonly<{
  poll_id: string
  outcome: "baseline" | "enqueued" | "unchanged" | "not_due" | "backoff" | "limit_reached" | "ineligible"
  observed_count: number
  enqueued_count: number
}>
export type RssPollIdentity = Readonly<{
  tenantId: string
  subjectId: string
  taskId: string
  revision: number
  epoch: string
  projectId?: string
  scope: string
  digest: string
  requestId: string
  signal: AbortSignal
  deadlineAt: number
}>
export type RssPollLease = Readonly<{
  identity: RssPollIdentity
  token: string
  fence: string
  task: ScheduledTaskFact
  initialized: boolean
  seen: readonly string[]
  observedAt: string
  pollId: string
}>
export type RssFrozenLaunch = Readonly<{
  item: RssFeedEntry
  body: Record<string, unknown>
  runId: string
  dispatchId: string
  idempotencyKey: string
  identityAssertionRef: string
}>
