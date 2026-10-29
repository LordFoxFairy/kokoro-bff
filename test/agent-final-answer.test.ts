import assert from "node:assert/strict"
import { test } from "node:test"
import { mapAgentEvent } from "../src/infrastructure/clients/agent/projection.js"
import { createAgUiProjectionState, projectChatEvent } from "../src/application/agui/project-chat-event.js"
const event = (payload: unknown) =>
  mapAgentEvent({
    chat_event_id: "terminal",
    session_id: "session",
    run_id: "run",
    chat_message_id: null,
    event_type: "run.completed",
    payload_json: JSON.stringify(payload),
    seq: 4,
    created_at: 4000,
  })
test("successful final answer preserves the public segment identity through the existing AG-UI terminal", () => {
  const source = event({
    status: "completed",
    final_message_id: "public-answer",
    token_usage: { input_tokens: 3, output_tokens: 5 },
  })
  assert.equal(source.payload.final_segment_id, "public-answer")
  const [frame] = projectChatEvent(source, createAgUiProjectionState())
  assert.deepEqual(frame?.result, { final_segment_id: "public-answer" })
  assert.equal(frame?.type, "RUN_FINISHED")
})
test("legacy absence and cancellation stay absent rather than guessing the last text", () => {
  for (const status of ["completed", "cancelled"]) {
    const source = event({ status })
    assert.equal(Object.hasOwn(source.payload, "final_segment_id"), false)
    const [frame] = projectChatEvent(source, createAgUiProjectionState())
    assert.deepEqual(frame?.result, status === "cancelled" ? { status: "cancelled" } : undefined)
  }
})
test("malformed owner terminal facts are rejected before projection", () => {
  for (const payload of [
    {},
    { status: "running" },
    { status: "cancelled", final_message_id: "answer" },
    { status: "completed", final_message_id: null },
    { status: "completed", token_usage: null },
    { status: "completed", final_message_id: "" },
    { status: "completed", final_segment_id: "native" },
    {
      status: "completed",
      token_usage: { input_tokens: -1, output_tokens: 1 },
    },
  ])
    assert.throws(() => event(payload))
})

import { foldMessageParts, parseMessageParts } from "../src/infrastructure/postgres/message-parts.js"
import { messageRendering } from "../src/infrastructure/postgres/message-parts-read.js"
const terminalFrame = projectChatEvent(event({ status: "completed", final_message_id: "public-answer" }), createAgUiProjectionState())[0]!
const textPart = {
  kind: "text",
  part_id: "text:public-answer",
  segment_id: "public-answer",
  first_sequence: "1",
  latest_sequence: "2",
  text: "Answer",
  completed: true,
}
test("durable terminal requires the exact completed text and matching terminal frame before advancing revision", () => {
  const state = parseMessageParts([textPart], 1, "2")
  const update = {
    runId: "run",
    kind: "complete" as const,
    finalSegmentId: "public-answer",
  }
  const frames = [{ publicSequence: 3, frame: terminalFrame }]
  assert.equal(foldMessageParts(state, "run", frames, update)?.publicSequence, "3")
  for (const wrong of [null, parseMessageParts([], 1, "2"), parseMessageParts([{ ...textPart, completed: false }], 1, "2")])
    assert.throws(() => foldMessageParts(wrong, "run", frames, update))
  assert.throws(() => foldMessageParts(state, "other-run", frames, update))
  assert.throws(() =>
    foldMessageParts(state, "run", frames, {
      ...update,
      finalSegmentId: "prior-prose",
    }),
  )
  assert.throws(() => foldMessageParts(state, "run", [], update))
  assert.equal(state?.publicSequence, "2")
  assert.equal(foldMessageParts(parseMessageParts([{ ...textPart, text: "" }], 1, "2"), "run", frames, update)?.parts.length, 1)
})
test("private rendering records proven final identity at the same parts revision and leaves legacy absent", () => {
  const scope = {
    tenantId: "tenant",
    subjectId: "owner",
    conversationId: "session",
    messageId: "message",
    runId: "run",
    projectRef: null,
    requestedProjectRef: null,
    scope: "all" as const,
  }
  assert.equal(messageRendering(scope, "3", null, "message", "public-answer").final_segment_id, "public-answer")
  assert.equal(Object.hasOwn(messageRendering(scope, "2", null), "final_segment_id"), false)
})
