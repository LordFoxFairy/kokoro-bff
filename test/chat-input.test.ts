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
          selected_mcp_connection_ids: ["connection-b", "connection-a"],
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
        selectedMcpConnectionIds: ["connection-b", "connection-a"],
        projectRef: "project-body",
      },
    )
  })

  it("uses the trimmed query project when the body omits project_ref", () => {
    assert.deepEqual(parseMessageCreateRequest({ content: "hello" }, " project-query "), {
      content: "hello",
      projectRef: "project-query",
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

it("preserves exact ordered Skill refs and distinguishes omitted selection from []", () => {
  const empty = parseMessageCreateRequest({ content: "hello" }, undefined)
  assert.deepEqual(empty, { content: "hello" })
  assert.deepEqual(parseMessageCreateRequest({ content: "hello", selected_skill_source_refs: [] }, undefined), {
    content: "hello",
    selectedSkillSourceRefs: [],
  })
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

it("keeps omitted Skill selection distinct from explicit empty selection", () => {
  assert.equal(parseMessageCreateRequest({ content: "hello" }, undefined).selectedSkillSourceRefs, undefined)
  assert.deepEqual(parseMessageCreateRequest({ content: "hello", selected_skill_source_refs: [] }, undefined).selectedSkillSourceRefs, [])
})

it("preserves exact MCP Connection choice and rejects the former trace-only alias", () => {
  assert.deepEqual(parseMessageCreateRequest({ content: "hello", selected_mcp_connection_ids: [] }, undefined), {
    content: "hello",
    selectedMcpConnectionIds: [],
  })
  assert.equal(parseMessageCreateRequest({ content: "hello", mcp_servers: ["connection-1"] }, undefined), null)
  for (const value of [
    null,
    "x",
    [1],
    [true],
    [""],
    [" x"],
    ["x "],
    ["a\n"],
    ["a\r"],
    ["a\u2028"],
    ["https://host/mcp"],
    ["x", "x"],
    ["a".repeat(192)],
    Array.from({ length: 17 }, (_, i) => `c${i}`),
  ]) {
    assert.equal(parseMessageCreateRequest({ content: "hello", selected_mcp_connection_ids: value }, undefined), null, JSON.stringify(value))
  }
})

it("accepts only exact unique Custom API profile/version references without treating them as MCP IDs", () => {
  for (const profiles of [
    [],
    [{ profile_id: "profile-a", expected_state_version: 1 }],
    Array.from({ length: 32 }, (_, i) => ({ profile_id: `profile:${i}`, expected_state_version: 2147483647 })),
  ]) {
    assert.deepEqual(parseMessageCreateRequest({ content: "hello", selected_custom_api_profiles: profiles }, undefined), {
      content: "hello",
      selectedCustomApiProfiles: profiles,
    })
  }
  const profile = { profile_id: "profile-a", expected_state_version: 1 }
  for (const invalid of [
    null,
    "profile-a",
    ["profile-a"],
    [profile, { ...profile, expected_state_version: 2 }],
    [{ ...profile, value: "secret" }],
    [{ profile_id: "profile-a" }],
    ...[0, -1, 1.5, true, "1", 2147483648].map((expected_state_version) => [{ ...profile, expected_state_version }]),
    ...["", "x\n", " x", "x/1", "x".repeat(192)].map((profile_id) => [{ ...profile, profile_id }]),
    Array.from({ length: 33 }, (_, i) => ({ ...profile, profile_id: `p${i}` })),
  ]) {
    assert.equal(parseMessageCreateRequest({ content: "hello", selected_custom_api_profiles: invalid }, undefined), null, JSON.stringify(invalid))
  }
})
