import { scheduledSourceEventDigest } from "./scheduled-source-event-digest.js"
import { projectScheduledRuns } from "./scheduled-task-run-projector.js"
import type { ScheduledRunsPage, ScheduledRunsQuery, ScheduledTaskRunsReader } from "./scheduled-task-runs.types.js"

/** Both snapshots use the caller's one entry deadline; no IAM call holds a SQL lease. */
export async function listScheduledTaskRuns(
  reader: ScheduledTaskRunsReader,
  query: ScheduledRunsQuery,
  revalidate: () => Promise<void>,
  parseStrictJson: (value: string) => unknown,
): Promise<ScheduledRunsPage | null> {
  const active = () => {
    if (query.signal.aborted || performance.now() >= query.deadlineAt) throw new Error("SCHEDULED_RUNS_RETIRED")
  }
  const bounded = async <T>(work: () => Promise<T>): Promise<T> => {
    active()
    let stop!: () => void
    const retired = new Promise<never>((_, reject) => {
      stop = () => reject(new Error("SCHEDULED_RUNS_RETIRED"))
    })
    const timer = setTimeout(stop, Math.max(0, query.deadlineAt - performance.now()))
    query.signal.addEventListener("abort", stop, { once: true })
    try {
      const result = await Promise.race([
        Promise.resolve().then(() => {
          active()
          return work()
        }),
        retired,
      ])
      active()
      return result
    } finally {
      clearTimeout(timer)
      query.signal.removeEventListener("abort", stop)
    }
  }
  const first = await bounded(() => reader.readSnapshot(query))
  const page = projectScheduledRuns(first, query, parseStrictJson)
  await bounded(revalidate)
  const second = await bounded(() => reader.readSnapshot(query))
  projectScheduledRuns(second, query, parseStrictJson)
  if (scheduledSourceEventDigest(first as Record<string, unknown>) !== scheduledSourceEventDigest(second as Record<string, unknown>))
    throw new Error("SCHEDULED_RUNS_CHANGED")
  active()
  return page
}
