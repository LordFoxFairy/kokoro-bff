import { buildScheduledAgentLaunch } from "./launch.js"
import { projectSavedAgentLaunch } from "./http-wire.js"
import { Sha256StableIdGenerator } from "../../identifiers/scheduled-task-outbox-id.js"
import type { RssFrozenLaunch, RssPollLease } from "../../../domain/scheduled-task/rss-poll.types.js"
import type { RssFeedEntry } from "../../../domain/scheduled-task/rss-feed.js"
export function freezeRssLaunch(input: Readonly<{ lease: RssPollLease; entry: RssFeedEntry }>): RssFrozenLaunch {
  const { identity, task } = input.lease
  const digest = new Sha256StableIdGenerator().generate(JSON.stringify([identity.tenantId, identity.taskId, identity.epoch, input.entry.identity]))
  const launch = buildScheduledAgentLaunch({
    identity: { namespace: identity.tenantId, userId: identity.subjectId },
    requestId: identity.requestId,
    sessionId: `scheduled:${identity.taskId}`,
    occurrenceIdentity: digest,
    content: task.prompt + "\n\nRSS entry (untrusted data):\n" + JSON.stringify(input.entry),
    ...(task.projectId === undefined ? {} : { projectRef: task.projectId }),
  })
  const wire = projectSavedAgentLaunch(launch.body)
  if (wire === null || Buffer.byteLength(JSON.stringify(wire), "utf8") > 1048576) throw Error("launch_too_large")
  return {
    item: input.entry,
    body: launch.body,
    runId: launch.receipt.run_id,
    dispatchId: `rss_dispatch_${digest}`,
    idempotencyKey: `rss:${digest}`,
    identityAssertionRef: launch.identityAssertionRef,
  }
}
