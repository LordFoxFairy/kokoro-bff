import { strictParseRawJson } from "../src/infrastructure/raw-json.ts"
import type { ScheduledRunsQuery } from "../src/application/scheduled-task-runs.types.ts"
import assert from "node:assert/strict"
import test from "node:test"
import { projectScheduledRuns as projectWithParser } from "../src/application/scheduled-task-run-projector.ts"
import { scheduledSourceEventDigest } from "../src/application/scheduled-source-event-digest.ts"
const projectScheduledRuns = (snapshot: unknown, q: ScheduledRunsQuery) => projectWithParser(snapshot, q, strictParseRawJson)
const query = () => ({
  tenantId: "tenant",
  subjectId: "owner",
  taskId: null,
  limit: 20,
  position: null,
  signal: new AbortController().signal,
  deadlineAt: performance.now() + 1000,
})
function row(status = "pending", unknownSeen = false) {
  return {
    sourceKind: "calendar",
    sourceObservedAt: null,
    dispatchId: "d",
    tenantId: "tenant",
    subjectId: "owner",
    taskId: "task",
    title: "",
    projectRef: null,
    taskRevision: "1",
    runId: "run",
    orderKey: "2026-10-21T00:00:00.000000001Z",
    status,
    unknownSeen,
    terminals: [] as unknown[],
  }
}
function terminal(payload = '{"status":"completed"}', type = "run.completed", optional: "missing" | "null" = "missing") {
  const raw = {
    chat_event_id: "event",
    session_id: "scheduled:task",
    run_id: "run",
    source_index: 0,
    ...(optional === "null" ? { chat_message_id: null } : {}),
    event_type: type,
    payload_json: payload,
    seq: 1,
    created_at: 1792540800000,
  }
  return {
    tenantId: "tenant",
    taskId: "task",
    sequence: "1",
    sourceEventId: "event",
    sourceRunId: "run",
    owner: "kokoro-agent",
    sourceDigest: scheduledSourceEventDigest(raw),
    occurredAt: new Date(raw.created_at).toISOString(),
    eventType: type,
    payload: raw,
  }
}
const page = (r: ReturnType<typeof row>, q = query()) => projectScheduledRuns({ taskExists: true, rows: [r] }, q)!
for (const [status, unknown, state] of [
  ["pending", false, "pending"],
  ["leased", true, "admission_unknown"],
  ["retryable", false, "pending"],
  ["admitted", true, "admitted"],
  ["failed", false, "dispatch_failed"],
] as const)
  test(`metadata ${status}/${unknown} is ${state}, never running`, () => assert.equal(page(row(status, unknown)).items[0]!.state, state))
for (const optional of ["missing", "null"] as const)
  for (const state of ["completed", "cancelled"])
    test(`terminal ${state} accepts ${optional} message ID`, () => {
      const r = row("terminal")
      r.terminals = [terminal(JSON.stringify({ status: state }), "run.completed", optional)]
      assert.equal(page(r).items[0]!.state, state)
      assert.equal(page(r).items[0]!.terminal_event_at, "2026-10-21T00:00:00.000Z")
    })
test("generated failure parser only admits exact published failure tuple", () => {
  const r = row("terminal")
  r.terminals = [terminal('{"status":"failed","code":"model_unavailable","retryable":true}', "run.failed")]
  assert.equal(page(r).items[0]!.state, "failed")
  for (const body of [
    '{"status":"failed","code":"internal_error","retryable":true}',
    '{"status":"failed","code":"new","retryable":false}',
    '{"status":"failed","code":"internal_error","retryable":false,"extra":1}',
  ]) {
    r.terminals = [terminal(body, "run.failed")]
    assert.throws(() => page(r))
  }
})
for (const payload of [
  '{"status":"completed","opaque":1.25}',
  '{"status":"completed","opaque":1e+10}',
  '{"status":"completed","opaque":90071992547409910000}',
  '{"status":"completed","opaque":-0}',
  '{"status":"completed","opaque":1e400}',
  '{"status":"completed","text":"123 1e400 \\"1.1\\"","nested":{"number":2.5}}',
])
  test(`opaque valid JSON numeric extras never become metadata: ${payload}`, () => {
    const r = row("terminal")
    r.terminals = [terminal(payload)]
    assert.equal(page(r).items[0]!.state, "completed")
    assert.deepEqual(Object.keys(page(r).items[0]!).sort(), [
      "project_ref",
      "run_id",
      "scheduled_for",
      "state",
      "task_id",
      "terminal_event_at",
      "title",
      "trigger_kind",
    ])
  })
for (const payload of [
  '{"status":"completed","sta\\u0074us":"cancelled"}',
  '{"status":"completed","opaque":{"x":1,"x":2}}',
  '{"status":"completed","x":01}',
  '{"status":"completed","x":1.}',
  '{"status":"completed","x":NaN}',
  '{"status":"unknown"}',
  "{}",
])
  test(`bad terminal JSON is unavailable: ${payload}`, () => {
    const r = row("terminal")
    r.terminals = [terminal(payload)]
    assert.throws(() => page(r))
  })
test("terminal identity digest timestamp and generated wire are independently enforced", () => {
  for (const patch of [
    { tenantId: "other" },
    { taskId: "other" },
    { sourceRunId: "other" },
    { sourceEventId: "other" },
    { sequence: "2" },
    { sourceDigest: "0".repeat(64) },
    { occurredAt: "2026-10-21T00:00:00.001Z" },
    { owner: "other" },
    { payload: { ...terminal().payload, unknown: "bad" } },
  ]) {
    const r = row("terminal")
    r.terminals = [{ ...terminal(), ...patch }]
    assert.throws(() => page(r))
  }
  const r = row("terminal")
  for (const terminals of [[], [terminal(), terminal()]]) {
    r.terminals = terminals
    assert.throws(() => page(r))
  }
  for (const status of ["pending", "admitted", "failed"]) {
    const r = row(status)
    r.terminals = [terminal()]
    assert.throws(() => page(r))
  }
  assert.throws(() => page(row("failed", true)))
})
test("strict byte bounds fail whole page, not truncation", () => {
  const r = row("terminal")
  r.terminals = [terminal(JSON.stringify({ status: "completed", text: "é".repeat(8200) }))]
  assert.throws(() => page(r))
  r.terminals = [null]
  assert.throws(() => page(r))
  assert.throws(() => page({ ...row(), title: "x".repeat(1048577) }))
})
test("L+1 and cursor compare all nine decimals in UTF8 C order", () => {
  const q = { ...query(), limit: 1 },
    first = row(),
    second = { ...row(), dispatchId: "b", runId: "run2", orderKey: "2026-10-21T00:00:00.000000000Z" }
  const result = projectScheduledRuns({ taskExists: true, rows: [first, second] }, q)!
  assert.deepEqual(result.nextPosition, { orderKey: first.orderKey, dispatchId: "d" })
  assert.equal(projectScheduledRuns({ taskExists: true, rows: [second] }, { ...q, position: result.nextPosition })!.items[0]!.run_id, "run2")
  assert.throws(() => projectScheduledRuns({ taskExists: true, rows: [first] }, { ...q, position: result.nextPosition }))
  assert.throws(() => projectScheduledRuns({ taskExists: true, rows: [second, first] }, q))
  assert.throws(() => projectScheduledRuns({ taskExists: true, rows: [first, { ...second, status: "terminal" }] }, q))
})
test("public task and run ID maxLength keeps255 Unicode code points", () => {
  const taskId = "😀".repeat(255),
    r = { ...row(), taskId, runId: taskId }
  assert.equal(page(r).items[0]!.task_id, taskId)
  assert.throws(() => page({ ...r, taskId: taskId + "😀" }))
})
