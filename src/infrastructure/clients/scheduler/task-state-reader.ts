import { isDeepStrictEqual } from "node:util"
import type { ScheduledTaskStateReader, ScheduledTaskCurrentState } from "../../../application/ports/scheduled-task-state-reader.js"
import type { ScheduledTaskOwnerScope } from "../../../application/ports/scheduled-task-repository.js"
import type { ScheduledTaskFact } from "../../../domain/scheduled-task/task.js"
import { decodeSchedulerCurrent, type SchedulerControlClient } from "./control-client.js"
import { buildSchedulerSchedule } from "./schedule.js"
import { canonicalSchedulerOccurrence } from "./dispatch-identity.js"

/** Bind the owner's live state to this exact product definition, not an old command ACK. */
export class SchedulerTaskStateReader implements ScheduledTaskStateReader {
  public constructor(
    private readonly client: Pick<SchedulerControlClient, "current"> | null,
    private readonly targetUrl: string | null,
  ) {}

  public async read(task: ScheduledTaskFact, scope: ScheduledTaskOwnerScope, requestId: string, signal: AbortSignal): Promise<ScheduledTaskCurrentState> {
    signal.throwIfAborted()
    if (this.client === null || this.targetUrl === null) throw Error("scheduler_current_unavailable")
    const expected = buildSchedulerSchedule(task, scope.tenantId, scope.subjectId, this.targetUrl)
    const attempt = await this.client.current(expected.name, { tenantId: scope.tenantId, requestId }, signal)
    signal.throwIfAborted()
    const current = decodeSchedulerCurrent(attempt)
    if (current === null) throw Error("scheduler_current_unavailable")
    for (const [key, value] of Object.entries(expected)) {
      if (key === "paused" && expected.run_at !== undefined && current.status === "exhausted") continue
      if (key === "run_at") {
        if (current.run_at === undefined || canonicalSchedulerOccurrence(current.run_at) !== canonicalSchedulerOccurrence(value as string))
          throw Error("scheduler_current_unavailable")
      } else if (!isDeepStrictEqual(Reflect.get(current, key), value)) throw Error("scheduler_current_unavailable")
    }
    if (
      (expected.run_at === undefined) !== (current.run_at === undefined) ||
      (expected.schedule === undefined) !== (current.schedule === undefined) ||
      current.paused !== (current.status === "paused")
    )
      throw Error("scheduler_current_unavailable")
    if (current.status !== "active") return { state: current.status, nextRunAt: null }
    if (
      current.next_due_at === null ||
      (current.run_at !== undefined && canonicalSchedulerOccurrence(current.next_due_at) !== canonicalSchedulerOccurrence(current.run_at))
    )
      throw Error("scheduler_current_unavailable")
    return { state: "active", nextRunAt: new Date(current.next_due_at) }
  }
}
