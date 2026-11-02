/** Current-owner read facts; no Agent execution command or output projection. */
export type RunPosition = Readonly<{ orderKey: string; dispatchId: string }>
export type ScheduledRunsIdentity = Readonly<{ tenantId: string; subjectId: string; signal: AbortSignal; deadlineAt: number }>
export type ScheduledRunsQuery = ScheduledRunsIdentity & Readonly<{ taskId: string | null; limit: number; position: RunPosition | null }>
export interface ScheduledTaskRunsReader {
  readSnapshot(query: ScheduledRunsQuery): Promise<unknown>
}
export type ScheduledRunState = "pending" | "admission_unknown" | "admitted" | "dispatch_failed" | "completed" | "cancelled" | "failed"
export type ScheduledRunItem = Readonly<{
  task_id: string
  title: string
  project_ref: string | null
  run_id: string
  trigger_kind: "calendar" | "rss"
  observed_at?: string
  scheduled_for: string | null
  state: ScheduledRunState
  terminal_event_at: string | null
}>
export type ScheduledRunCandidate = Readonly<{
  dispatchId: string
  tenantId: string
  subjectId: string
  taskId: string
  title: string
  projectRef: string | null
  taskRevision: string
  runId: string
  orderKey: string
  sourceKind: "calendar" | "rss"
  sourceObservedAt: string | null
  status: string
  unknownSeen: boolean
  terminals: readonly unknown[]
}>
export type ScheduledRunsPage = Readonly<{ items: readonly ScheduledRunItem[]; nextPosition: RunPosition | null }>
