import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { EventSchemas } from "@ag-ui/core"

import { createAgUiProjectionState, projectChatEvent } from "../dist/application/agui/project-chat-event.js"
import { validateAgUiFrames } from "../dist/application/agui/project-session-events.js"
import { agentEventList } from "../dist/infrastructure/clients/agent/projection.js"

const base = {
  event_id: "evt_1",
  seq: 3,
  session_id: "session_1",
  run_id: "run_1",
  timestamp: "2026-09-02T12:00:00.000Z",
}

describe("AG-UI projection", () => {
  it("uses the canonical start/content/end text lifecycle", () => {
    const state = createAgUiProjectionState()
    const startAndContent = projectChatEvent({
      ...base,
      kind: "message.delta",
      payload: { segment_id: "message_1", delta: "Hello" },
    }, state)
    assert.deepEqual(startAndContent.map((event) => event.type), ["TEXT_MESSAGE_START", "TEXT_MESSAGE_CONTENT"])
    assert.equal(startAndContent[1]?.messageId, "message_1")
    for (const event of startAndContent) assert.doesNotThrow(() => EventSchemas.parse(event))

    const next = projectChatEvent({
      ...base,
      event_id: "evt_2",
      seq: 4,
      kind: "message.delta",
      payload: { segment_id: "message_1", delta: " world" },
    }, state)
    assert.deepEqual(next.map((event) => event.type), ["TEXT_MESSAGE_CONTENT"])

    const end = projectChatEvent({
      ...base,
      event_id: "evt_3",
      seq: 5,
      kind: "message.completed",
      payload: { segment_id: "message_1", content: "Hello world" },
    }, state)
    assert.deepEqual(end.map((event) => event.type), ["TEXT_MESSAGE_END"])
  })

  it("keeps the tool lifecycle and replay metadata explicit", () => {
    const events = projectChatEvent({
      ...base,
      kind: "tool.invoked",
      payload: { segment_id: "message_1", tool_id: "tool_1", name: "search", args: { query: "AG-UI" } },
    }, createAgUiProjectionState())
    assert.deepEqual(events.map((event) => event.type), ["TOOL_CALL_START", "TOOL_CALL_ARGS"])
    assert.equal(events[0]?.metadata.kokoro.event_id, "evt_1")
    assert.equal(events[0]?.metadata.kokoro.seq, 3)
    for (const event of events) assert.doesNotThrow(() => EventSchemas.parse(event))
  })

  it("rejects malformed or cross-session Agent source events before persistence", () => {
    const source = {
      chat_event_id: "source_1",
      session_id: "session_other",
      run_id: "run_1",
      source_index: 0,
      event_type: "run.started",
      payload_json: "{}",
      seq: 1,
      created_at: 1,
    }
    assert.equal(agentEventList([source], "session_1"), null)
    assert.equal(agentEventList([{ ...source, session_id: "session_1", seq: 1.5 }], "session_1"), null)
    assert.equal(agentEventList([{ ...source, session_id: "session_1", source_index: undefined }], "session_1"), null)
    assert.deepEqual(agentEventList([{ ...source, session_id: "session_1" }], "session_1"), [{ ...source, session_id: "session_1" }])
  })

  it("rejects a non-canonical frame before the repository can persist it", () => {
    assert.throws(
      () => validateAgUiFrames([{ type: "RUN_STARTED", timestamp: "not-a-number" }]),
      /source response did not match its contract/u,
    )
  })

  it("persists the schema parser result rather than the unchecked input reference", () => {
    const input = {
      type: "RUN_STARTED",
      threadId: "session_schema_result",
      runId: "run_schema_result",
      timestamp: 1,
    } as const

    const [validated] = validateAgUiFrames([input])

    assert.notEqual(validated, input)
    assert.deepEqual(validated, EventSchemas.parse(input))
  })

  it("keeps open message state isolated when a different run reaches a terminal", () => {
    const state = createAgUiProjectionState()
    const runB = {
      ...base,
      event_id: "evt_run_b_1",
      run_id: "run_b",
      kind: "message.delta" as const,
      payload: { segment_id: "message_b", delta: "first" },
    }
    const first = projectChatEvent(runB, state)
    assert.deepEqual(first.map((event) => event.type), ["TEXT_MESSAGE_START", "TEXT_MESSAGE_CONTENT"])

    projectChatEvent({
      ...base,
      event_id: "evt_run_a_terminal",
      run_id: "run_a",
      kind: "run.completed",
      payload: { status: "completed" },
    }, state)

    const continued = projectChatEvent({
      ...runB,
      event_id: "evt_run_b_2",
      seq: runB.seq + 1,
      payload: { segment_id: "message_b", delta: " second" },
    }, state)
    assert.deepEqual(continued.map((event) => event.type), ["TEXT_MESSAGE_CONTENT"])
  })
})
