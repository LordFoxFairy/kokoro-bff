import type { ScheduledTaskStatus } from "./task.js"
type Binding = Readonly<{
  executionActorId: string | null
  enabled: boolean
  status: ScheduledTaskStatus
}>

/** The native CAS actor confirms only their own executor; changing somebody else's definition first pauses it. */
export function scheduledExecutionBinding(
  current: Binding,
  actor: string,
  patch: Partial<Pick<Binding, "enabled" | "status">>,
  executionChanged: boolean,
): Binding {
  if (current.executionActorId !== null && current.executionActorId !== actor && executionChanged)
    return { executionActorId: null, enabled: false, status: "paused" }
  const enabled = patch.enabled ?? current.enabled
  return {
    executionActorId: current.executionActorId === null && patch.enabled === true ? actor : current.executionActorId,
    enabled,
    status: patch.status ?? (patch.enabled === true && !current.enabled ? "active" : current.status),
  }
}
export function scheduledRevisionPrecondition(value: unknown): number | null {
  if (typeof value !== "string" || !/^"[1-9][0-9]{0,15}"$/u.test(value)) return null
  const revision = Number(value.slice(1, -1))
  return Number.isSafeInteger(revision) && revision < Number.MAX_SAFE_INTEGER ? revision : null
}
