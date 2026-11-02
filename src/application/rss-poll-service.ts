import type { RssPollRepository } from "./ports/rss-poll-repository.js"
import type { RssFeedEntry } from "../domain/scheduled-task/rss-feed.js"
import type { RssErrorCode, RssFrozenLaunch, RssPollIdentity, RssPollLease } from "../domain/scheduled-task/rss-poll.types.js"
import { matchesRssConditions } from "../domain/scheduled-task/rss-conditions.js"
const CODES: readonly string[] = [
  "rss_feed_url_invalid",
  "rss_feed_address_forbidden",
  "rss_feed_dns_unavailable",
  "rss_feed_dns_busy",
  "rss_feed_unavailable",
  "rss_feed_timeout",
  "rss_feed_cancelled",
  "rss_feed_response_invalid",
  "rss_feed_too_large",
  "feed_invalid",
  "launch_too_large",
]
export class RssPollService {
  public constructor(
    private readonly dependencies: Readonly<{
      repository: RssPollRepository
      read: (input: Readonly<{ url: string; signal: AbortSignal }>) => Promise<Uint8Array>
      parse: (value: Uint8Array) => readonly RssFeedEntry[]
      freezeLaunch: (input: Readonly<{ lease: RssPollLease; entry: RssFeedEntry }>) => RssFrozenLaunch
    }>,
  ) {}
  public async poll(input: RssPollIdentity) {
    input.signal.throwIfAborted()
    if (performance.now() >= input.deadlineAt - 2000) throw Error("rss_poll_deadline")
    const claim = await this.dependencies.repository.claim(input)
    if (claim.outcome !== "claimed") return claim
    try {
      return await this.runClaimed(input, claim.lease)
    } catch (error) {
      // Cleanup is supervised and uses only the remaining parent budget.
      await this.dependencies.repository.release(claim.lease).catch(() => undefined)
      throw error
    }
  }
  private async runClaimed(input: RssPollIdentity, lease: RssPollLease) {
    input.signal.throwIfAborted()
    if (performance.now() >= input.deadlineAt - 2000) throw Error("rss_poll_deadline")
    if (lease.task.triggerKind !== "rss") throw Error("rss_poll_invalid")
    const cancellation = new AbortController()
    const signal = AbortSignal.any([input.signal, cancellation.signal])
    let timer: ReturnType<typeof setTimeout> | undefined
    let cancel: (() => void) | undefined
    let entries: readonly RssFeedEntry[] = [],
      launches: readonly RssFrozenLaunch[] = [],
      error: RssErrorCode | null = null
    try {
      const stopped = new Promise<never>((_, reject) => {
        cancel = () => reject(Error("rss_feed_cancelled"))
        signal.addEventListener("abort", cancel, { once: true })
        timer = setTimeout(
          () => {
            reject(Error("rss_feed_timeout"))
            cancellation.abort()
          },
          Math.max(0, Math.min(10000, input.deadlineAt - performance.now() - 2000)),
        )
      })
      const bytes = await Promise.race([this.dependencies.read({ url: lease.task.feedUrl, signal }), stopped])
      signal.throwIfAborted()
      try {
        entries = this.dependencies.parse(bytes)
      } catch {
        throw Error("feed_invalid")
      }
      const known = new Set(lease.seen)
      if (lease.initialized)
        launches = entries
          .filter((entry) => !known.has(entry.identity) && matchesRssConditions(entry, lease.task.triggerKind === "rss" ? lease.task.conditions : []))
          .map((entry) => this.dependencies.freezeLaunch({ lease, entry }))
    } catch (cause) {
      if (input.signal.aborted) throw Error("rss_poll_cancelled")
      const code = cause instanceof Error ? cause.message : "feed_invalid"
      error = (CODES.includes(code) ? code : "feed_invalid") as RssErrorCode
      entries = []
      launches = []
    } finally {
      clearTimeout(timer)
      if (cancel) signal.removeEventListener("abort", cancel)
      cancellation.abort()
    }
    input.signal.throwIfAborted()
    if (performance.now() >= input.deadlineAt) throw Error("rss_poll_deadline")
    const summary = await this.dependencies.repository.settle({ lease, entries, launches, error })
    return { outcome: "terminal" as const, summary }
  }
}
