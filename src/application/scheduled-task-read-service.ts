import { isDeepStrictEqual } from "node:util"
import type { ScheduledTaskOwnerScope, ScheduledTaskReadSnapshot } from "./ports/scheduled-task-repository.js"
import type { ScheduledTaskStateReader, ScheduledTaskSchedulingState } from "./ports/scheduled-task-state-reader.js"
import type { ScheduledTaskFact } from "../domain/scheduled-task/task.js"

export type ScheduledTaskReadOptions = Readonly<{ taskId?: string; revalidate?: () => Promise<void>; deadline?: number }>
export type ScheduledTaskCurrentView = Readonly<{ task: ScheduledTaskFact; state: ScheduledTaskSchedulingState; nextRunAt: Date | null }>
type Snapshots = { snapshots(scope: ScheduledTaskOwnerScope, signal: AbortSignal, taskId?: string): Promise<ScheduledTaskReadSnapshot[]> }
/** Bounded parallel reads; all rows or an explicit error, never a partially fresh list. */
export class ScheduledTaskReadService {
  public constructor(
    private readonly source: Snapshots,
    private readonly owner: ScheduledTaskStateReader,
  ) {}

  public async read(
    scope: ScheduledTaskOwnerScope,
    requestId: string,
    signal: AbortSignal,
    options: ScheduledTaskReadOptions = {},
  ): Promise<ScheduledTaskCurrentView[]> {
    const check = (): void => {
      signal.throwIfAborted()
      if (options.deadline !== undefined && performance.now() >= options.deadline) throw Error("scheduled_task_read_deadline")
    }
    check()
    const snapshots = await this.source.snapshots(scope, signal, options.taskId)
    check()
    const cancelled = new AbortController()
    const combined = AbortSignal.any([signal, cancelled.signal])
    const views: ScheduledTaskCurrentView[] = []
    let cursor = 0
    let failure: unknown
    const worker = async (): Promise<void> => {
      try {
        while (cursor < snapshots.length && !combined.aborted) {
          check()
          const index = cursor++
          const snapshot = snapshots[index]!
          if (!snapshot.projectAvailable && snapshot.task.projectId !== undefined && snapshot.task.enabled && snapshot.task.status === "active")
            throw Error("scheduled_task_project_unavailable")
          if (snapshot.deliveryStatus === null) throw Error("scheduled_task_delivery_missing")
          const current =
            snapshot.deliveryStatus === "succeeded"
              ? await this.owner.read(snapshot.task, scope, requestId, combined)
              : { state: snapshot.deliveryStatus === "failed" ? ("failed" as const) : ("pending" as const), nextRunAt: null }
          check()
          combined.throwIfAborted()
          views[index] = { task: snapshot.task, ...current }
        }
      } catch (error) {
        if (failure === undefined) failure = error
        cancelled.abort()
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, snapshots.length) }, worker))
    check()
    if (failure !== undefined) throw failure
    await options.revalidate?.()
    check()
    const after = await this.source.snapshots(scope, signal, options.taskId)
    check()
    if (!isDeepStrictEqual(snapshots, after)) throw Error("scheduled_task_read_changed")
    return views
  }
}
