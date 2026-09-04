import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { parseMessageCreateRequest } from "../dist/application/chat/message-create-input.js"

describe("canonical MessageCreateRequest parsing", () => {
  it("normalizes every trimmed Chat semantic before admission", () => {
    assert.deepEqual(parseMessageCreateRequest({
      content: "  hello  ",
      model: " default ",
      agent: " reviewer ",
      thinking: true,
      pinned_skills: [" skill-a ", "skill-b"],
      mcp_servers: [" github "],
      project_ref: " project-body ",
    }, " project-query "), {
      content: "hello",
      model: "default",
      agent: "reviewer",
      thinking: true,
      pinnedSkills: ["skill-a", "skill-b"],
      mcpServers: ["github"],
      projectRef: "project-body",
    })
  })

  it("uses the trimmed query project when the body omits project_ref", () => {
    assert.deepEqual(parseMessageCreateRequest({ content: "hello" }, " project-query "), {
      content: "hello",
      projectRef: "project-query",
    })
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
