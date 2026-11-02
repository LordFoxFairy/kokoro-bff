import assert from "node:assert/strict"
import { test } from "node:test"
import { parseProjectPinInput, parseProjectPinQuery, encodeProjectPinCursor } from "../src/http/project-pin-input.ts"

test("pin input is only a real boolean and list/filter cursors bind exact admitted identity", () => {
  assert.equal(parseProjectPinInput(Buffer.from('{"is_pinned":true}')), true)
  assert.equal(parseProjectPinInput(Buffer.from('{"is_pinned":false}')), false)
  for (const body of ["{}", '{"is_pinned":null}', '{"is_pinned":"true"}', '{"is_pinned":true,"subject_id":"other"}', '{"is_pinned":true,"is_pinned":false}'])
    assert.throws(() => parseProjectPinInput(Buffer.from(body)))
  const scope = { tenantId: "tenant", subjectId: "subject" }
  assert.deepEqual(parseProjectPinQuery(new URLSearchParams(), scope), { projectId: null, limit: 50, position: null })
  assert.deepEqual(parseProjectPinQuery(new URLSearchParams("project_id=project"), scope), { projectId: "project", limit: 1, position: null })
  const position = { pinnedAt: "2026-10-27T00:00:00.000Z", projectId: "project" }
  const cursor = encodeProjectPinCursor(position, scope, 50)
  assert.deepEqual(parseProjectPinQuery(new URLSearchParams({ cursor }), scope).position, position)
  for (const q of [
    "project_id=project&limit=1",
    "project_id=project&cursor=bad",
    "limit=0",
    "limit=101",
    "limit=01",
    "cursor=",
    "limit=50&limit=50",
    "tenant_id=other",
  ])
    assert.throws(() => parseProjectPinQuery(new URLSearchParams(q), scope))
  assert.throws(() => parseProjectPinQuery(new URLSearchParams({ cursor }), { ...scope, subjectId: "other" }))
})
