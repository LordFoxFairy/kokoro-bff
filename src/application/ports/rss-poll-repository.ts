import type { RssPollIdentity, RssPollLease, RssPollSummary, RssFrozenLaunch, RssErrorCode } from "../../domain/scheduled-task/rss-poll.types.js"
import type { RssFeedEntry } from "../../domain/scheduled-task/rss-feed.js"
export type RssPollClaim =
  | Readonly<{ outcome: "claimed"; lease: RssPollLease }>
  | Readonly<{ outcome: "terminal"; summary: RssPollSummary }>
  | Readonly<{ outcome: "conflict" | "pending" }>
export interface RssPollRepository {
  release(lease: RssPollLease): Promise<void>
  claim(input: RssPollIdentity): Promise<RssPollClaim>
  settle(
    input: Readonly<{ lease: RssPollLease; entries: readonly RssFeedEntry[]; launches: readonly RssFrozenLaunch[]; error: RssErrorCode | null }>,
  ): Promise<RssPollSummary>
}
