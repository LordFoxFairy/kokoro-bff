import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { parseMessageCreateRequest } from "../dist/application/chat/message-create-input.js"

describe("canonical MessageCreateRequest parsing", () => {
  it("normalizes every trimmed Chat semantic before admission", () => {
    assert.deepEqual(
      parseMessageCreateRequest(
        {
          content: "  hello  ",
          model: " default ",
          agent: " reviewer ",
          thinking: true,
          selected_skill_source_refs: ["skill:a", "skill:b"],
          mcp_servers: [" github "],
          project_ref: " project-body ",
        },
        " project-body ",
      ),
      {
        content: "hello",
        model: "default",
        agent: "reviewer",
        thinking: true,
        selectedSkillSourceRefs: ["skill:a", "skill:b"],
        mcpServers: ["github"],
        projectRef: "project-body",
      },
    )
  })

  it("uses the trimmed query project when the body omits project_ref", () => {
    assert.deepEqual(parseMessageCreateRequest({ content: "hello" }, " project-query "), {
      content: "hello",
      projectRef: "project-query",
      selectedSkillSourceRefs: [],
    })
  })

  it("rejects different body and query project references", () => {
    assert.equal(parseMessageCreateRequest({ content: "hello", project_ref: "project-body" }, "project-query"), null)
  })

  it("rejects additional properties, oversized content, and invalid optional values", () => {
    assert.equal(parseMessageCreateRequest({ content: "hello", extra: true }, undefined), null)
    assert.equal(parseMessageCreateRequest({ content: "x".repeat(100_001) }, undefined), null)
    assert.equal(parseMessageCreateRequest({ content: "hello", model: " " }, undefined), null)
    assert.equal(parseMessageCreateRequest({ content: "hello", pinned_skills: ["ok", 7] }, undefined), null)
    assert.equal(parseMessageCreateRequest({ content: "hello", mcp_servers: [""] }, undefined), null)
    assert.equal(parseMessageCreateRequest({ content: "hello", thinking: "yes" }, undefined), null)
  })
})

it("preserves exact ordered Skill refs and normalizes omitted selection to []", () => {
  const empty = parseMessageCreateRequest({ content: "hello" }, undefined)
  assert.deepEqual(empty, { content: "hello", selectedSkillSourceRefs: [] })
  assert.deepEqual(empty, parseMessageCreateRequest({ content: "hello", selected_skill_source_refs: [] }, undefined))
  assert.deepEqual(parseMessageCreateRequest({ content: "hello", selected_skill_source_refs: ["skill:b", "skill:a"] }, undefined), {
    content: "hello",
    selectedSkillSourceRefs: ["skill:b", "skill:a"],
  })
})

it("rejects Skill aliases, whitespace, line endings, Unicode, duplicates and oversize selections", () => {
  for (const value of [
    null,
    "skill:a",
    ["a"],
    ["skill:skill:a"],
    ["skill:a\n"],
    ["skill:a\r"],
    ["skill:a\r\n"],
    ["skill:a\u2028"],
    ["skill:中"],
    [" skill:a"],
    ["skill:a "],
    ["skill:a", "skill:a"],
    ["skill:"],
    ["skill:" + "a".repeat(192)],
    Array.from({ length: 17 }, (_, i) => `skill:a${i}`),
  ]) {
    assert.equal(parseMessageCreateRequest({ content: "hello", selected_skill_source_refs: value }, undefined), null, JSON.stringify(value))
  }
  assert.equal(parseMessageCreateRequest({ content: "hello", pinned_skills: [] }, undefined), null)
})
