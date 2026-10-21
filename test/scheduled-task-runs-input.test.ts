import assert from "node:assert/strict"
import test from "node:test"
import {
  parseScheduledRunsInput,
  decodeScheduledRunsCursor,
  encodeScheduledRunsCursor,
  isScheduledTaskRunsCandidate,
} from "../src/http/scheduled-task-runs-input.ts"
const request = (url: string, headers = {}) => ({ url, method: "GET", headers, rawHeaders: Object.entries(headers).flat() }) as never
const scope = { tenantId: "tenant", subjectId: "owner", taskId: null, limit: 20 },
  position = { orderKey: "2026-10-21T00:00:00.000000001Z", dispatchId: "😀" }
test("query default and strict current task selector", () => {
  assert.deepEqual(parseScheduledRunsInput(request("/v1/scheduled-task-runs")), { taskId: null, limit: 20, cursor: null })
  assert.equal(parseScheduledRunsInput(request("/v1/scheduled-task-runs?task_id=%E4%BB%BB%E5%8A%A1&limit=100")).taskId, "任务")
})
for (const query of [
  "?limit=0",
  "?limit=01",
  "?limit=1.0",
  "?limit=1&limit=2",
  "?task_id=a&%74ask_id=b",
  "?tenant_id=other",
  "?task_id=%FF",
  "?task_id=",
  "?",
  "?limit=1&&cursor=x",
  "?cursor=x#frag",
])
  test(`reject strict query ${query}`, () => assert.throws(() => parseScheduledRunsInput(request("/v1/scheduled-task-runs" + query))))
test("headers forbid identity-free commands and bodies", () => {
  for (const header of [{ "content-length": "1" }, { "transfer-encoding": "chunked" }, { "content-encoding": "identity" }, { "idempotency-key": "key" }])
    assert.throws(() => parseScheduledRunsInput(request("/v1/scheduled-task-runs", header)))
})
test("cursor binds tenant subject task limit sort and exact nanosecond position", () => {
  const cursor = encodeScheduledRunsCursor(position, scope)
  assert.deepEqual(decodeScheduledRunsCursor(cursor, scope), position)
  for (const changed of [{ tenantId: "other" }, { subjectId: "other" }, { taskId: "task" }, { limit: 10 }])
    assert.throws(() => decodeScheduledRunsCursor(cursor, { ...scope, ...changed }))
  for (const value of [cursor + "=", "str2_" + cursor.slice(5), "str1_" + Buffer.from('{"limit":20,"limit":20}').toString("base64url")])
    assert.throws(() => decodeScheduledRunsCursor(value, scope))
})
test("aliases are intercepted but never accepted, unrelated resource names untouched", () => {
  for (const path of [
    "/v1/%73cheduled-task-runs",
    "/v1//scheduled-task-runs",
    "http://bff/v1/scheduled-task-runs",
    "/v1/./scheduled-task-runs",
    "/v1/scheduled-task-runs/",
  ]) {
    assert.ok(isScheduledTaskRunsCandidate(request(path)))
    assert.throws(() => parseScheduledRunsInput(request(path)))
  }
  assert.equal(isScheduledTaskRunsCandidate(request("/v1/projects/name-scheduled-task-runs")), false)
})
test("cursor malformed UTF8 BOM duplicate escaped key and wrong sort cannot become authority", () => {
  const good = JSON.parse(Buffer.from(encodeScheduledRunsCursor(position, scope).slice(5), "base64url").toString())
  for (const bytes of [
    Buffer.from([0xff]),
    Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify(good))]),
    Buffer.from(JSON.stringify({ ...good, sort: "other" })),
    Buffer.from(JSON.stringify(good).replace('"limit":20', '"limit":20,"li\\u006dit":20')),
  ])
    assert.throws(() => decodeScheduledRunsCursor("str1_" + bytes.toString("base64url"), scope))
})
test("task_id maxLength counts Unicode code points as the public schema does", () => {
  const taskId = "😀".repeat(255)
  assert.equal(parseScheduledRunsInput(request("/v1/scheduled-task-runs?task_id=" + encodeURIComponent(taskId))).taskId, taskId)
  assert.throws(() => parseScheduledRunsInput(request("/v1/scheduled-task-runs?task_id=" + encodeURIComponent(taskId + "😀"))))
})
