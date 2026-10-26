import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { foldMessageParts, messagePartsContent, parseMessageParts } from "../dist/infrastructure/postgres/message-parts.js"

const runId = "run_ordered"
const tool = { activity: "tool", activity_id: `act_${"a".repeat(64)}`, segment_id: `seg_${"b".repeat(64)}`, status: "running", display_code: "tool.execution" }
const skill = {
  activity: "skill",
  activity_id: `act_${"c".repeat(64)}`,
  preflight_id: `spf_${"d".repeat(64)}`,
  source_refs: ["skill:revision_1"],
  phase: "ready",
}
const frame = (sequence, type, fields = {}, frameRun = runId) => ({
  publicSequence: sequence,
  frame: {
    type,
    ...fields,
    metadata: { kokoro: { event_id: `source_${sequence}`, seq: 1, session_id: "session_ordered", run_id: frameRun, timestamp: "2026-10-25T00:00:00.000Z" } },
  },
})
const fresh = () => parseMessageParts([], 1, "0")
const delta = (segmentId, content, kind = "replace") => ({ runId, segmentId, completed: false, kind, content })
const completed = (segmentId, content) => ({ runId, segmentId, completed: true, kind: "replace", content })
const text = (state, sequence, id, value) =>
  foldMessageParts(
    state,
    runId,
    [frame(sequence, "TEXT_MESSAGE_START", { messageId: id }), frame(sequence + 1, "TEXT_MESSAGE_CONTENT", { messageId: id, delta: value })],
    delta(id, value),
  )

describe("CHAT-ORDER Message parts codec/fold", () => {
  it("keeps real text/activity interleaving, fixes only the completed segment, and updates activity in its first slot", () => {
    const initial = fresh()
    let state = text(initial, 2, "first", "A")
    state = foldMessageParts(state, runId, [frame(4, "CUSTOM", { name: "kokoro.activity.updated", value: tool })])
    state = text(state, 5, "second", "B")
    state = foldMessageParts(state, runId, [frame(7, "CUSTOM", { name: "kokoro.activity.updated", value: { ...tool, status: "completed" } })])
    state = foldMessageParts(state, runId, [frame(8, "TEXT_MESSAGE_END", { messageId: "first" })], completed("first", "A!"))
    state = foldMessageParts(state, runId, [frame(9, "CUSTOM", { name: "kokoro.activity.updated", value: skill })])
    state = text(state, 10, "third", "C😀\n")
    state = foldMessageParts(state, runId, [
      frame(12, "CUSTOM", {
        name: "kokoro.activity.updated",
        value: {
          ...skill,
          preflight_id: `spf_${"f".repeat(64)}`,
          source_refs: ["skill:revision_2"],
          phase: "resolving",
        },
      }),
    ])
    assert.equal(messagePartsContent(state), "A!BC😀\n")
    assert.deepEqual(
      state.parts.map((part) => [part.kind, part.first_sequence]),
      [
        ["text", "2"],
        ["activity", "4"],
        ["text", "5"],
        ["activity", "9"],
        ["text", "10"],
      ],
    )
    assert.equal(state.parts[1].latest_sequence, "7")
    assert.equal(state.parts[1].activity.status, "completed")
    assert.equal(state.parts[0].completed, true)
    assert.equal(state.publicSequence, "12")
    assert.equal(state.parts[3].first_sequence, "9")
    assert.equal(state.parts[3].latest_sequence, "12")
    assert.equal(state.parts[3].activity.preflight_id, `spf_${"f".repeat(64)}`)
    assert.deepEqual(initial.parts, [])
    assert.equal(initial.publicSequence, "0")
  })

  it("retains a completed-only segment using its verified completion identity, without claiming final phase", () => {
    const state = foldMessageParts(
      fresh(),
      runId,
      [frame(1, "TEXT_MESSAGE_END", { messageId: "only_completed" })],
      completed("only_completed", "actual public text"),
    )
    assert.equal(messagePartsContent(state), "actual public text")
    assert.equal(state.parts[0].first_sequence, "1")
    assert.equal(state.parts[0].completed, true)
    assert.equal(Object.hasOwn(state.parts[0], "final"), false)
  })

  it("keeps legacy NULL distinct from a proven empty new Message and rejects partial-NULL/corrupt documents", () => {
    assert.equal(parseMessageParts(null, null, null), null)
    assert.equal(foldMessageParts(null, runId, [frame(2, "TEXT_MESSAGE_END", { messageId: "legacy" })], completed("legacy", "last segment")), null)
    for (const input of [
      [null, 1, "0"],
      [[], null, "0"],
      [[], 1, null],
      [[], 2, "0"],
      [[], 1, "01"],
      [{}, 1, "0"],
    ]) {
      assert.throws(() => parseMessageParts(...input), /AGUI_MESSAGE_PARTS_INVALID/u)
    }
  })

  it("rejects unsafe extra activity fields and scope, sequence, or segment drift without mutating the prior document", () => {
    const state = text(fresh(), 2, "first", "safe")
    const original = JSON.stringify(state)
    const invalid = [
      () => foldMessageParts(state, runId, [frame(4, "CUSTOM", { name: "kokoro.activity.updated", value: { ...tool, result: "PRIVATE_RESULT" } })]),
      () => foldMessageParts(state, runId, [frame(4, "TEXT_MESSAGE_END", { messageId: "wrong" })], completed("first", "not bound")),
      () => foldMessageParts(state, runId, [frame(4, "TEXT_MESSAGE_END", { messageId: "first" }, "foreign_run")], completed("first", "not bound")),
      () => foldMessageParts(state, runId, [frame(3, "TEXT_MESSAGE_END", { messageId: "first" })], completed("first", "stale")),
      () => foldMessageParts(state, runId, [frame(4, "TEXT_MESSAGE_CONTENT", { messageId: "missing", delta: "orphan" })], delta("missing", "orphan", "append")),
    ]
    for (const action of invalid) assert.throws(action, /AGUI_MESSAGE_PARTS_INVALID/u)
    assert.equal(JSON.stringify(state), original)
  })

  it("checks stored identities/provenance and refuses activity identity reuse or text reopening", () => {
    let state = text(fresh(), 1, "first", "text")
    state = foldMessageParts(state, runId, [frame(3, "CUSTOM", { name: "kokoro.activity.updated", value: tool })])
    for (const mutate of [
      (parts) => {
        parts[1].part_id = parts[0].part_id
      },
      (parts) => {
        parts[1].first_sequence = "1"
      },
      (parts) => {
        parts[1].latest_sequence = "99"
      },
      (parts) => {
        parts[0].secret = "PRIVATE"
      },
    ]) {
      const parts = structuredClone(state.parts)
      mutate(parts)
      assert.throws(() => parseMessageParts(parts, 1, state.publicSequence), /AGUI_MESSAGE_PARTS_INVALID/u)
    }
    assert.throws(
      () =>
        foldMessageParts(state, runId, [
          frame(4, "CUSTOM", { name: "kokoro.activity.updated", value: { ...tool, activity: "subagent", display_code: "subagent.execution" } }),
        ]),
      /AGUI_MESSAGE_PARTS_INVALID/u,
    )
    assert.throws(() => foldMessageParts(state, runId, [frame(4, "TEXT_MESSAGE_START", { messageId: "first" })]), /AGUI_MESSAGE_PARTS_INVALID/u)
  })

  it("does not retain raw tool arguments/results or unrelated private frame material", () => {
    const state = foldMessageParts(fresh(), runId, [
      frame(1, "TOOL_CALL_ARGS", { toolCallId: "raw", delta: "PRIVATE_ARGUMENT" }),
      frame(2, "TOOL_CALL_RESULT", { toolCallId: "raw", content: "PRIVATE_RESULT" }),
    ])
    assert.deepEqual(state.parts, [])
    assert.equal(JSON.stringify(state).includes("PRIVATE"), false)
    assert.equal(state.publicSequence, "2")
  })

  it("does not truncate a legal Unicode text to an HTTP read-page budget", () => {
    const body = "😀\n".repeat(220_000)
    const state = text(fresh(), 1, "large", body)
    assert.ok(Buffer.byteLength(body, "utf8") > 1024 * 1024)
    assert.equal(messagePartsContent(state), body)
    assert.equal(state.parts.length, 1)
  })

  it("preserves public text and existing activity through non-text and terminal frames, without fake progress/final facts", () => {
    let state = text(fresh(), 1, "first", "still present")
    state = foldMessageParts(state, runId, [frame(3, "CUSTOM", { name: "kokoro.activity.updated", value: tool }), frame(4, "RUN_ERROR", { runId })])
    assert.equal(messagePartsContent(state), "still present")
    assert.equal(state.parts.length, 2)
    assert.equal(state.parts[1].activity.status, "running")
    assert.equal(state.publicSequence, "4")
  })
})

for (const display_code of [
  "tool.execution",
  "tool.file.read",
  "tool.mcp.discover",
  "tool.mcp.describe",
  "tool.mcp.call",
  "tool.web.search",
  "tool.web.fetch",
]) {
  it(`Agent8 ordered parts retain ${display_code} across fold and strict persisted-document decode`, () => {
    const payload = { ...tool, display_code }
    const state = foldMessageParts(fresh(), runId, [frame(4, "CUSTOM", { name: "kokoro.activity.updated", value: payload })])
    const restored = parseMessageParts(JSON.parse(JSON.stringify(state.parts)), 1, state.publicSequence)
    assert.deepEqual(restored.parts, [
      { kind: "activity", part_id: `activity:${tool.activity_id}`, first_sequence: "4", latest_sequence: "4", activity: payload },
    ])
  })
}
for (const [activity, display_code] of [
  ["tool", "tool.file.write"],
  ["tool", "subagent.execution"],
  ["subagent", "tool.web.search"],
]) {
  it(`ordered parts reject ${activity}/${display_code} rather than replace it with generic execution`, () => {
    assert.throws(() => foldMessageParts(fresh(), runId, [frame(4, "CUSTOM", { name: "kokoro.activity.updated", value: { ...tool, activity, display_code } })]))
  })
}
