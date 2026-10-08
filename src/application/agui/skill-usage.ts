const SOURCE_REF = /^skill:[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u

export type SkillUsageReadyFact = { kind: "ready"; runId: string; sourceRefs: string[] }
export type SkillUsageTerminalFact = { kind: "terminal"; runId: string; status: "completed" | "cancelled" | "failed" }
export type SkillUsageFact = SkillUsageReadyFact | SkillUsageTerminalFact
export type SkillUsageResult = { status: "unavailable" } | { status: "available"; successfulRunCount: string }

type EventLike = { kind: string; value?: unknown; payload?: unknown }

export function projectSkillUsageFacts(event: EventLike, runId: string): SkillUsageFact | undefined {
  if (runId.trim() === "") throw new Error("SKILL_USAGE_RUN_INVALID")
  if (event.kind === "activity.updated") {
    const value = event.value ?? event.payload
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined
    const activity = value as Record<string, unknown>
    if (activity.activity !== "skill" || activity.phase !== "ready") return undefined
    const refs = activity.source_refs
    if (!Array.isArray(refs) || refs.length === 0 || refs.length > 100 || refs.some((ref) => typeof ref !== "string" || !SOURCE_REF.test(ref))) {
      throw new Error("SKILL_USAGE_SOURCE_REFS_INVALID")
    }
    const sourceRefs = refs as string[]
    if (new Set(sourceRefs).size !== sourceRefs.length) throw new Error("SKILL_USAGE_SOURCE_REFS_INVALID")
    return { kind: "ready", runId, sourceRefs: [...sourceRefs] }
  }
  if (event.kind === "run.completed") {
    const payload = event.payload
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) throw new Error("SKILL_USAGE_TERMINAL_INVALID")
    const status = (payload as Record<string, unknown>).status
    if (status !== "completed" && status !== "cancelled") throw new Error("SKILL_USAGE_TERMINAL_INVALID")
    return { kind: "terminal", runId, status }
  }
  if (event.kind === "run.failed") return { kind: "terminal", runId, status: "failed" }
  return undefined
}

export function skillUsageResult(coverage: "unavailable" | "complete", count: bigint = 0n): SkillUsageResult {
  if (coverage === "unavailable") return { status: "unavailable" }
  if (count < 0n) throw new Error("SKILL_USAGE_COUNT_INVALID")
  return { status: "available", successfulRunCount: count.toString() }
}
