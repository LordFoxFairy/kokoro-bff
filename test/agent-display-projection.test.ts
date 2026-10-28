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
