import assert from "node:assert/strict"
import { test } from "node:test"
import { scheduledExecutionBinding, scheduledRevisionPrecondition } from "../src/domain/scheduled-task/execution-binding.js"
const current = {
  executionActorId: "original",
  enabled: true,
  status: "active" as const,
}
test("cross-actor execution edit first pauses/clears binding, then explicit CAS enable accepts the editor's own delegation", () => {
  const paused = scheduledExecutionBinding(current, "editor", { enabled: true }, true)
  assert.deepEqual(paused, {
    executionActorId: null,
    enabled: false,
    status: "paused",
  })
  assert.deepEqual(scheduledExecutionBinding(paused, "editor", { enabled: true }, false), { executionActorId: "editor", enabled: true, status: "active" })
  assert.deepEqual(scheduledExecutionBinding(paused, "editor", {}, true), paused, "changing a paused definition does not silently enable")
})
test("the same executor's native CAS save retains their own delegation, and presentation edits never borrow or replace it", () => {
  assert.deepEqual(scheduledExecutionBinding(current, "original", {}, true), current)
  assert.deepEqual(scheduledExecutionBinding(current, "editor", {}, false), current)
  assert.deepEqual(scheduledExecutionBinding(current, "original", { enabled: false }, true), { ...current, enabled: false })
})
test("execution revision precondition is one exact quoted safe positive integer with room for its successor", () => {
  assert.equal(scheduledRevisionPrecondition('"42"'), 42)
  for (const invalid of [undefined, ['"1"'], "*", 'W/"1"', '"0"', '"01"', '"1","2"', '"9007199254740991"', '"9007199254740992"'])
    assert.equal(scheduledRevisionPrecondition(invalid), null)
})
