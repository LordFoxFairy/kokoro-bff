import assert from "node:assert/strict"
import { test } from "node:test"
import { messageFeedbackId } from "../src/application/chat/message-feedback-input.js"
import { parseMessageFeedbackInput } from "../src/http/routes/message-feedback.js"
test("feedback input is one strict preference, not self-asserted identity or a command", () => {
  for (const feedback of ["up", "down", null]) assert.equal(parseMessageFeedbackInput(Buffer.from(JSON.stringify({ feedback }))), feedback)
  for (const body of [
    "{}",
    "[]",
    "null",
    '{"feedback":"up","feedback":"down"}',
    '{"feedback":"up","actor":"other"}',
    '{"feedback":true}',
    '{"feedback":"up"} trailing',
    '\uFEFF{"feedback":"up"}',
  ])
    assert.throws(() => parseMessageFeedbackInput(Buffer.from(body)), /request_invalid/)
  assert.throws(() => parseMessageFeedbackInput(Buffer.from([0xff])), /request_invalid/)
  for (const id of ["message", "消息/😀"]) assert.equal(messageFeedbackId(id), true)
  for (const id of ["", "x".repeat(257), "x\u0000", "\ud800"]) assert.equal(messageFeedbackId(id), false)
})
