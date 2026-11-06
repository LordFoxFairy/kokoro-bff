import assert from "node:assert/strict"
import { test } from "node:test"
import { parseAgentProcessPayload, sameAgentActivityIdentity } from "../src/infrastructure/clients/agent/process-state.js"
import { foldMessageParts, parseMessageParts } from "../src/infrastructure/postgres/message-parts.js"
const skill = {
  activity: "skill",
  activity_id: `act_${"a".repeat(64)}`,
  preflight_id: `spf_${"b".repeat(64)}`,
  source_refs: ["skill:pinned"],
  phase: "ready",
  display_skills: [{ source_ref: "skill:pinned", name: "Original package", virtual_path: "/.skills/cGlubmVk/SKILL.md", revision: "9007199254740993" }],
}
const tool = {
  activity: "tool",
  activity_id: `act_${"c".repeat(64)}`,
  segment_id: `seg_${"d".repeat(64)}`,
  status: "running",
  display_code: "tool.file.read",
  display_detail: { kind: "file", name: "report.md", virtual_path: "/workspace/report.md" },
}
const parse = (value: unknown) => parseAgentProcessPayload("activity", JSON.stringify(value))
test("future Skill package name/path/revision and file path survive the original process and ordered parts projection", () => {
  assert.deepEqual(parse(skill)?.value, skill)
  assert.deepEqual(parse(tool)?.value, tool)
  const state = foldMessageParts(parseMessageParts([], 1, "0"), "run", [
    {
      publicSequence: 1,
      frame: {
        type: "CUSTOM",
        name: "kokoro.activity.updated",
        value: skill,
        metadata: { kokoro: { event_id: "source", seq: 1, session_id: "session", run_id: "run", timestamp: "2026-10-28T00:00:00.000Z" } },
      },
    },
  ])
  assert.deepEqual(state.parts[0]?.kind === "activity" ? state.parts[0].activity : undefined, skill)
})
test("display rejects wrong source mount, unsafe paths, unknown revision and late path identity mutation", () => {
  for (const value of [
    { ...skill, phase: "loading" },
    { ...skill, source_refs: ["skill:other"] },
    { ...skill, display_skills: [{ ...skill.display_skills[0], virtual_path: "/.skills/other/SKILL.md" }] },
    { ...skill, display_skills: [{ ...skill.display_skills[0], revision: "9223372036854775808" }] },
    { ...tool, display_detail: { kind: "mcp_tool", name: "lookup", virtual_path: "/workspace/report.md" } },
    { ...tool, display_detail: { ...tool.display_detail, virtual_path: "/home/user/report.md" } },
    { ...tool, display_detail: { ...tool.display_detail, virtual_path: "/workspace/other.md" } },
  ])
    assert.throws(() => parse(value))
  const first = parse(tool),
    changed = parse({ ...tool, display_detail: { ...tool.display_detail, virtual_path: "/workspace/other/report.md" } })
  assert.ok(first?.kind === "activity.updated" && changed?.kind === "activity.updated")
  assert.equal(sameAgentActivityIdentity(first.value, changed.value), false)
  const legacy = { ...skill }
  delete (legacy as Partial<typeof skill>).display_skills
  assert.deepEqual(parse(legacy)?.value, legacy)
})

test("exact action title survives original ordered parts and remains immutable across completion", () => {
  const started = { ...tool, action_title: "读取项目运行时配置" }
  const finished = { ...started, status: "completed" }
  const first = parse(started),
    last = parse(finished),
    legacy = parse(tool),
    renamed = parse({ ...finished, action_title: "另一个动作" })
  assert.ok(
    first?.kind === "activity.updated" && last?.kind === "activity.updated" && legacy?.kind === "activity.updated" && renamed?.kind === "activity.updated",
  )
  assert.deepEqual(first.value, started)
  assert.equal(sameAgentActivityIdentity(first.value, last.value), true)
  assert.equal(sameAgentActivityIdentity(first.value, legacy.value), false)
  assert.equal(sameAgentActivityIdentity(first.value, renamed.value), false)
  const frames = [first.value, last.value].map((value, index) => ({
    publicSequence: index + 1,
    frame: {
      type: "CUSTOM",
      name: "kokoro.activity.updated",
      value,
      metadata: {
        kokoro: {
          event_id: `source-${index}`,
          seq: index + 1,
          session_id: "session",
          run_id: "run",
          timestamp: "2026-10-28T00:00:00.000Z",
        },
      },
    },
  }))
  const state = foldMessageParts(parseMessageParts([], 1, "0"), "run", frames)
  assert.equal(state.parts.length, 1)
  assert.deepEqual(state.parts[0]?.kind === "activity" ? state.parts[0].activity : undefined, finished)
})

test("action title validates UTF8 and text semantics without requiring titles on legacy activities", () => {
  for (const action_title of ["x".repeat(256), "😀".repeat(64), "读取配置"])
    assert.deepEqual(parse({ ...tool, action_title })?.value, {
      ...tool,
      action_title,
    })
  for (const action_title of [
    null,
    "",
    "x".repeat(257),
    "😀".repeat(65),
    " 配置",
    "配置 ",
    "配置\n文件",
    "隐\u200b藏",
    "\ud800",
    "token=abc",
    "读取 /Users/private/file",
  ]) {
    assert.throws(() => parse({ ...tool, action_title }), JSON.stringify(action_title))
  }
  assert.throws(() => parse({ ...skill, action_title: "读取技能" }))
  assert.deepEqual(parse(tool)?.value, tool)
})
