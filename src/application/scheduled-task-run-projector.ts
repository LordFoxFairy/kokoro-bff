import { zChatEvent } from "../generated/agent-http/zod.gen.js"
import { parseAgentFailure } from "../generated/agent-http/failure-profile.gen.js"
import { scheduledSourceEventDigest } from "./scheduled-source-event-digest.js"
import type { ScheduledRunCandidate, ScheduledRunItem, ScheduledRunsPage, ScheduledRunsQuery } from "./scheduled-task-runs.types.js"

const invalid = (): never => {
  throw new Error("SCHEDULED_RUNS_INVALID")
}
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value)
const exact = (value: Record<string, unknown>, keys: string) => Object.keys(value).sort().join() === keys
const text = (value: unknown, max = 255): value is string =>
  typeof value === "string" && value.length > 0 && Array.from(value).length <= max && Buffer.from(value).toString("utf8") === value
export function validRunOrder(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{9}Z$/u.test(value)) return false
  const milliseconds = value.slice(0, 23) + "Z"
  const parsed = new Date(milliseconds)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === milliseconds
}
export function compareRunPositions(a: { orderKey: string; dispatchId: string }, b: { orderKey: string; dispatchId: string }): number {
  return Buffer.compare(Buffer.from(a.orderKey), Buffer.from(b.orderKey)) || Buffer.compare(Buffer.from(a.dispatchId), Buffer.from(b.dispatchId))
}
function terminal(row: ScheduledRunCandidate, strictParseRawJson: (value: string) => unknown): Pick<ScheduledRunItem, "state" | "terminal_event_at"> {
  if (row.terminals.length !== 1) return invalid()
  const source = row.terminals[0]
  if (!record(source) || !exact(source, "eventType,occurredAt,owner,payload,sequence,sourceDigest,sourceEventId,sourceRunId,taskId,tenantId")) return invalid()
  if (
    source.owner !== "kokoro-agent" ||
    source.tenantId !== row.tenantId ||
    source.taskId !== row.taskId ||
    source.sourceRunId !== row.runId ||
    !text(source.sourceEventId, 65536) ||
    typeof source.sequence !== "string" ||
    !/^[1-9][0-9]*$/u.test(source.sequence) ||
    !Number.isSafeInteger(Number(source.sequence)) ||
    typeof source.sourceDigest !== "string" ||
    !/^[a-f0-9]{64}$/u.test(source.sourceDigest)
  )
    return invalid()
  const parsed = zChatEvent.safeParse(source.payload)
  if (!parsed.success) return invalid()
  const raw = parsed.data
  if (
    !record(source.payload) ||
    Buffer.byteLength(JSON.stringify(source.payload)) > 65536 ||
    raw.run_id !== row.runId ||
    raw.session_id !== `scheduled:${row.taskId}` ||
    raw.chat_event_id !== source.sourceEventId ||
    raw.seq !== Number(source.sequence) ||
    raw.event_type !== source.eventType ||
    scheduledSourceEventDigest(source.payload) !== source.sourceDigest ||
    Buffer.byteLength(raw.payload_json) > 16384 ||
    Buffer.from(raw.payload_json).toString("utf8") !== raw.payload_json
  )
    return invalid()
  const instant = new Date(raw.created_at)
  if (!Number.isFinite(instant.getTime()) || instant.toISOString() !== source.occurredAt || !/^\d{4}-.*\.\d{3}Z$/u.test(instant.toISOString())) return invalid()
  // Validate original JSON grammar before masking only numeric tokens outside strings.
  // Opaque numeric extras are ignored, never used as identity, time or public metadata.
  const body: unknown = JSON.parse(raw.payload_json)
  const structural = raw.payload_json.replace(/"(?:[^"\\]|\\[\s\S])*"|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/gu, (token) =>
    token.startsWith('"') ? token : "0",
  )
  strictParseRawJson(structural)
  if (!record(body)) return invalid()
  if (raw.event_type === "run.failed") {
    if (!parseAgentFailure(body)) return invalid()
    return { state: "failed", terminal_event_at: instant.toISOString() }
  }
  if (raw.event_type !== "run.completed" || (body.status !== "completed" && body.status !== "cancelled")) return invalid()
  return { state: body.status, terminal_event_at: instant.toISOString() }
}
function project(row: ScheduledRunCandidate, strictParseRawJson: (value: string) => unknown): ScheduledRunItem {
  const base = { task_id: row.taskId, title: row.title, project_ref: row.projectRef, run_id: row.runId, scheduled_for: row.orderKey }
  if (row.status === "terminal") return { ...base, ...terminal(row, strictParseRawJson) }
  if (row.terminals.length !== 0) return invalid()
  if (["pending", "leased", "retryable"].includes(row.status))
    return { ...base, state: row.unknownSeen ? "admission_unknown" : "pending", terminal_event_at: null }
  if (row.status === "admitted") return { ...base, state: "admitted", terminal_event_at: null }
  if (row.status === "failed" && !row.unknownSeen) return { ...base, state: "dispatch_failed", terminal_event_at: null }
  return invalid()
}
export function projectScheduledRuns(snapshot: unknown, query: ScheduledRunsQuery, strictParseRawJson: (value: string) => unknown): ScheduledRunsPage | null {
  if (
    !record(snapshot) ||
    !exact(snapshot, "rows,taskExists") ||
    typeof snapshot.taskExists !== "boolean" ||
    !Array.isArray(snapshot.rows) ||
    snapshot.rows.length > query.limit + 1 ||
    Buffer.byteLength(JSON.stringify(snapshot)) > 1048576
  )
    return invalid()
  if (query.taskId !== null && !snapshot.taskExists) {
    if (snapshot.rows.length !== 0) return invalid()
    return null
  }
  const rows: ScheduledRunCandidate[] = [],
    seenDispatches = new Set<string>(),
    seenRuns = new Set<string>()
  for (const value of snapshot.rows) {
    if (
      !record(value) ||
      !exact(value, "dispatchId,orderKey,projectRef,runId,status,subjectId,taskId,taskRevision,tenantId,terminals,title,unknownSeen") ||
      !text(value.dispatchId, 1024) ||
      !text(value.taskId) ||
      !text(value.runId) ||
      value.tenantId !== query.tenantId ||
      value.subjectId !== query.subjectId ||
      (query.taskId !== null && value.taskId !== query.taskId) ||
      typeof value.title !== "string" ||
      Buffer.from(value.title).toString("utf8") !== value.title ||
      (value.projectRef !== null && !text(value.projectRef, 1048576)) ||
      typeof value.taskRevision !== "string" ||
      !/^[1-9][0-9]*$/u.test(value.taskRevision) ||
      !validRunOrder(value.orderKey) ||
      typeof value.status !== "string" ||
      typeof value.unknownSeen !== "boolean" ||
      !Array.isArray(value.terminals) ||
      value.terminals.length > 2
    )
      return invalid()
    const row = value as unknown as ScheduledRunCandidate
    if (
      seenDispatches.has(row.dispatchId) ||
      seenRuns.has(row.runId) ||
      (query.position && compareRunPositions(row, query.position) >= 0) ||
      (rows.length && compareRunPositions(rows[rows.length - 1]!, row) <= 0)
    )
      return invalid()
    seenDispatches.add(row.dispatchId)
    seenRuns.add(row.runId)
    rows.push(row)
  }
  // Validate the L+1 lookahead as well; a bad terminal must never be silently skipped.
  const projected = rows.map((row) => project(row, strictParseRawJson)),
    last = rows[query.limit - 1]
  return {
    items: projected.slice(0, query.limit),
    nextPosition: rows.length > query.limit && last ? { orderKey: last.orderKey, dispatchId: last.dispatchId } : null,
  }
}
