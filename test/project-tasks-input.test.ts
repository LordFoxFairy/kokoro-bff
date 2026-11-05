import assert from "node:assert/strict"
import test from "node:test"
import { parseProjectTaskInput, parseProjectTaskWriteHeaders } from "../src/http/routes/project-tasks.js"

const revision = `ptask_${"A".repeat(43)}`
const key = ["Idempotency-Key", "write:task"]
const json = ["Content-Type", "application/json"]

test("task titles normalize Unicode scalar length and reject ambiguous or extra input", () => {
  const title = "😀".repeat(160)
  assert.deepEqual(parseProjectTaskInput("POST", Buffer.from(JSON.stringify({ title }))), { title })
  assert.deepEqual(parseProjectTaskInput("POST", Buffer.from('{"title":"  task  "}')), { title: "task" })
  for (const raw of [
    JSON.stringify({ title: `${title}😀` }), '{"title":"\\u0000a"}', '{"title":"\\ud800"}',
    '{"title":"one","title":"two"}', '{"title":"ok","status":"todo"}', '{"title":"  "}',
  ]) assert.equal(parseProjectTaskInput("POST", Buffer.from(raw)), null)
  assert.deepEqual(parseProjectTaskInput("PATCH", Buffer.from('{"status":"in_progress"}')), { status: "in_progress" })
  for (const raw of ['{}', '{"status":"finished"}', '{"title":null}', '{"revision":"ignored"}'])
    assert.equal(parseProjectTaskInput("PATCH", Buffer.from(raw)), null)
})

test("task preconditions require a single strong quoted revision and one exact idempotency key", () => {
  assert.deepEqual(parseProjectTaskWriteHeaders("PATCH", [...key, ...json, "If-Match", `"${revision}"`]),
    { kind: "ok", key: "write:task", revision })
  assert.deepEqual(parseProjectTaskWriteHeaders("DELETE", key), { kind: "missing-precondition" })
  for (const headers of [
    ["If-Match", revision], ["If-Match", "*"], ["If-Match", `W/"${revision}"`],
    ["If-Match", `"${revision}"`, "if-match", `"${revision}"`],
    ["If-Match", `"${revision}"`, "Idempotency-Key", "again"],
    ["If-Match", `"${revision}"`, ...json],
  ]) assert.deepEqual(parseProjectTaskWriteHeaders("DELETE", [...key, ...headers]), { kind: "invalid" })
  assert.deepEqual(parseProjectTaskWriteHeaders("POST", [...key, ...json, "If-Match", `"${revision}"`]), { kind: "invalid" })
})
