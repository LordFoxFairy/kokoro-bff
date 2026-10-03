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
    const startAndContent = projectChatEvent(
      {
        ...base,
        kind: "message.delta",
        payload: { segment_id: "message_1", delta: "Hello" },
      },
      state,
    )
    assert.deepEqual(
      startAndContent.map((event) => event.type),
      ["TEXT_MESSAGE_START", "TEXT_MESSAGE_CONTENT"],
    )
    assert.equal(startAndContent[1]?.messageId, "message_1")
    for (const event of startAndContent) assert.doesNotThrow(() => EventSchemas.parse(event))

    const next = projectChatEvent(
      {
        ...base,
        event_id: "evt_2",
        seq: 4,
        kind: "message.delta",
        payload: { segment_id: "message_1", delta: " world" },
      },
      state,
    )
    assert.deepEqual(
      next.map((event) => event.type),
      ["TEXT_MESSAGE_CONTENT"],
    )

    const end = projectChatEvent(
      {
        ...base,
        event_id: "evt_3",
        seq: 5,
        kind: "message.completed",
        payload: { segment_id: "message_1", content: "Hello world" },
      },
      state,
    )
    assert.deepEqual(
      end.map((event) => event.type),
      ["TEXT_MESSAGE_END"],
    )
  })

  it("keeps safe tool activity and replay metadata explicit without raw arguments", () => {
    const activity = {
      activity: "tool",
      activity_id: `act_${"a".repeat(64)}`,
      segment_id: `seg_${"b".repeat(64)}`,
      status: "running",
      display_code: "tool.execution",
    }
    const events = projectChatEvent(
      {
        ...base,
        kind: "activity.updated",
        payload: activity,
      },
      createAgUiProjectionState(),
    )
    assert.deepEqual(
      events.map((event) => event.type),
      ["CUSTOM"],
    )
    assert.equal(events[0]?.name, "kokoro.activity.updated")
    assert.deepEqual(events[0]?.value, activity)
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
    assert.throws(() => validateAgUiFrames([{ type: "RUN_STARTED", timestamp: "not-a-number" }]), /source response did not match its contract/u)
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
    assert.deepEqual(
      first.map((event) => event.type),
      ["TEXT_MESSAGE_START", "TEXT_MESSAGE_CONTENT"],
    )

    projectChatEvent(
      {
        ...base,
        event_id: "evt_run_a_terminal",
        run_id: "run_a",
        kind: "run.completed",
        payload: { status: "completed" },
      },
      state,
    )

    const continued = projectChatEvent(
      {
        ...runB,
        event_id: "evt_run_b_2",
        seq: runB.seq + 1,
        payload: { segment_id: "message_b", delta: " second" },
      },
      state,
    )
    assert.deepEqual(
      continued.map((event) => event.type),
      ["TEXT_MESSAGE_CONTENT"],
    )
  })
})

// R57: full owner interaction is one canonical CUSTOM, not a second item-resolution protocol.

function r57Waiting() {
  return {
    interaction_revision: 7,
    pause_revision: 7,
    pause_ref: "pause:run_hitl_1:7",
    phase: "waiting",
    groups: [
      {
        group_id: "group_tools",
        items: [
          {
            item_id: "item_approve",
            request_id: "request_tool_1",
            kind: "tool_approval",
            allowed_decisions: ["approve", "edit", "reject"],
            display: {
              name: "search",
              description: "Search approved index",
              editable: true,
              input_schema: { type: "object", properties: { query: { type: "string" } } },
              result_preview: null,
              truncated: null,
              source: null,
            },
          },
          {
            item_id: "item_edit",
            request_id: "request_tool_2",
            kind: "tool_approval",
            allowed_decisions: ["edit", "reject"],
            display: { name: "edit", description: "Edit parameters", editable: true, input_schema: { type: "object" } },
          },
          {
            item_id: "item_reject",
            request_id: "request_review_1",
            kind: "result_review",
            allowed_decisions: ["approve", "reject"],
            display: {
              name: "review",
              description: "Review result",
              editable: false,
              input_schema: { type: "object" },
              result_preview: "bounded result",
              truncated: false,
              source: "tool",
            },
          },
        ],
      },
      {
        group_id: "group_inputs",
        items: [
          {
            item_id: "item_respond",
            request_id: "request_question_1",
            kind: "ask_user_question",
            allowed_decisions: ["respond", "reject"],
            display: { name: "question", description: "Choose a region", editable: false, input_schema: { type: "object" } },
            validation: { code: "json_schema_invalid", instance_path: ["region", 0] },
          },
          {
            item_id: "item_submit",
            request_id: "request_input_1",
            kind: "input",
            allowed_decisions: ["submit"],
            display: { name: "form", description: "Confirm values", editable: true, input_schema: { type: "object" } },
          },
        ],
      },
    ],
    action_result: null,
  }
}
function r57Control() {
  return {
    kind: "run.resume",
    expected_pause_revision: 7,
    pause_ref: "pause:run_hitl_1:7",
    decisions: [
      { type: "approve", item_id: "item_approve" },
      { type: "edit", item_id: "item_edit", args: { count: 2, note: null } },
      { type: "reject", item_id: "item_reject" },
      { type: "respond", item_id: "item_respond", response: "continue" },
      { type: "submit", item_id: "item_submit", value: { confirmed: true, comment: null } },
    ],
  }
}

for (const phase of ["waiting", "resuming", "active", "terminal"] as const) {
  it(`R57 AG-UI publishes one complete ${phase} interaction revision and never a Run terminal`, () => {
    const payload = {
      ...r57Waiting(),
      interaction_revision: 8,
      phase,
      groups: phase === "active" || phase === "terminal" ? [] : r57Waiting().groups,
      action_result: phase === "resuming" ? { command_id: "command_resume_1", pause_revision: 7, kind: "accepted" } : null,
    }
    const frames = projectChatEvent({ ...base, kind: "interaction.state", payload } as never, createAgUiProjectionState())
    assert.equal(frames.length, 1, "every full revision must emit exactly one atomic public frame")
    assert.equal(frames[0].type, "CUSTOM")
    assert.equal(frames[0].name, "kokoro.interaction.state")
    assert.deepEqual(frames[0].value, payload)
    assert.deepEqual(frames[0].metadata.kokoro, base)
    assert.doesNotThrow(() => EventSchemas.parse(frames[0]))
    assert.ok(frames.every((frame) => frame.type !== "RUN_FINISHED" && frame.type !== "RUN_ERROR"))
  })
}
it("R57 AG-UI retains absent versus null display keys and business input-schema null", () => {
  const payload = r57Waiting()
  payload.groups[1].items[1].display.input_schema = { type: "object", properties: { comment: { default: null } } }
  const frames = projectChatEvent({ ...base, kind: "interaction.state", payload } as never, createAgUiProjectionState())
  assert.equal(frames.length, 1)
  const actual = frames[0].value as ReturnType<typeof r57Waiting>
  assert.deepEqual(actual, payload)
  assert.equal(Object.hasOwn(actual.groups[0].items[0].display, "result_preview"), true)
  assert.equal(Object.hasOwn(actual.groups[1].items[1].display, "result_preview"), false)
})

it("R123 projects the complete safe Todo table with original metadata", () => {
  const todo = {
    todos: [
      { content: "first", status: "pending" },
      { content: "done", status: "completed" },
    ],
  }
  const [todoFrame] = projectChatEvent({ ...base, kind: "todo.updated", payload: todo }, createAgUiProjectionState())
  assert.deepEqual(todoFrame, { type: "CUSTOM", timestamp: Date.parse(base.timestamp), name: "kokoro.todo.updated", value: todo, metadata: { kokoro: base } })
  assert.doesNotThrow(() => EventSchemas.parse(todoFrame))
})

it("R123 projects compact safe activity without raw fields or assistant identity substitution", () => {
  const activity = {
    activity: "tool",
    activity_id: `act_${"a".repeat(64)}`,
    segment_id: `seg_${"b".repeat(64)}`,
    status: "failed",
    display_code: "tool.execution",
  }
  const [activityFrame] = projectChatEvent({ ...base, event_id: "evt_2", seq: 4, kind: "activity.updated", payload: activity }, createAgUiProjectionState())
  assert.deepEqual(activityFrame, {
    type: "CUSTOM",
    timestamp: Date.parse(base.timestamp),
    name: "kokoro.activity.updated",
    value: activity,
    metadata: { kokoro: { ...base, event_id: "evt_2", seq: 4 } },
  })
  assert.doesNotThrow(() => EventSchemas.parse(activityFrame))
  for (const forbiddenField of ["args", "result", "name", "description", "error", "tool_id", "subagent_id"]) {
    assert.equal(Object.hasOwn(activityFrame.value, forbiddenField), false)
  }
  assert.equal(JSON.stringify(activityFrame.value).includes("assistant_identity_canary"), false)
  assert.equal(Object.hasOwn(activityFrame, "messageId"), false)
})
