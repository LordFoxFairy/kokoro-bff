import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { EventSchemas } from "@ag-ui/core"

import { createAgUiProjectionState, projectChatEvent } from "../dist/interfaces/http/agui/events.js"

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
})
