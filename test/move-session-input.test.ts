import assert from "node:assert/strict"
import { test } from "node:test"

import { isCanonicalMoveSessionId, parseMoveSessionInput, singleMoveSessionKey } from "../dist/http/move-session-input.js"

const conversationId = "conv_12345678-1234-1234-1234-123456789abc"
const projectId = "project_12345678-1234-1234-1234-123456789abc"

test("Move accepts only canonical Conversation IDs and exactly one printable key", () => {
  assert.equal(isCanonicalMoveSessionId(conversationId), true)
  for (const invalid of ["session_slug", "conv_", conversationId.toUpperCase(), `${conversationId} `]) assert.equal(isCanonicalMoveSessionId(invalid), false)
  assert.equal(singleMoveSessionKey(["Idempotency-Key", "move-key"]), "move-key")
  for (const raw of [
    [],
    ["Idempotency-Key", ""],
    ["Idempotency-Key", "move key"],
    ["Idempotency-Key", "two,keys"],
    ["Idempotency-Key", "x".repeat(129)],
    ["Idempotency-Key", "one", "idempotency-key", "two"],
  ])
    assert.equal(singleMoveSessionKey(raw), null)
})

test("Move body is closed and preserves the null/direct versus canonical Project distinction", () => {
  assert.deepEqual(parseMoveSessionInput(Buffer.from('{"target_project_id":null}')), { targetProjectId: null })
  assert.deepEqual(parseMoveSessionInput(Buffer.from(JSON.stringify({ target_project_id: projectId }))), { targetProjectId: projectId })
  for (const invalid of [
    "{}",
    "null",
    "[]",
    '{"target_project_id":"project_slug"}',
    '{"target_project_id":""}',
    '{"target_project_id":42}',
    '{"target_project_id":null,"project_ref":"alias"}',
    '{"target_project_id":null,"target_project_id":"' + projectId + '"}',
  ])
    assert.equal(parseMoveSessionInput(Buffer.from(invalid)), null, invalid)
  assert.equal(parseMoveSessionInput(Buffer.from([0xff])), null)
})
