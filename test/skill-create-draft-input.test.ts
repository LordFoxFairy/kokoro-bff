import assert from "node:assert/strict"
import test from "node:test"

import { parseSkillDraftInput, skillDraftCommandId } from "../dist/http/create-skill-draft-input.js"

test("CreateDraft accepts exactly the public three-field body", () => {
  assert.deepEqual(parseSkillDraftInput(Buffer.from('{"display_name":"Tea","summary":"Warm","tags":["tea"]}')), {
    displayName: "Tea",
    summary: "Warm",
    tags: ["tea"],
  })
})

test("CreateDraft rejects aliases, extra fields, and invalid tags", () => {
  for (const body of [
    '{"displayName":"Tea","summary":"Warm","tags":["tea"]}',
    '{"display_name":"Tea","summary":"Warm","tags":["tea"],"owner_id":"x"}',
    '{"display_name":"Tea","summary":"Warm","tags":[""]}',
  ]) {
    assert.throws(() => parseSkillDraftInput(Buffer.from(body)), /invalid_skill_request/u)
  }
})

test("command identity is stable and semantic scope changes it", () => {
  const first = skillDraftCommandId("tenant", "user", "key")
  assert.equal(first, "bff.skill.create_draft.v1.ddd59bb89c84c8f55284ddc827063babb4965d40bbb0311acbc97744aa408f2e")
  assert.equal(first, skillDraftCommandId("tenant", "user", "key"))
  assert.notEqual(first, skillDraftCommandId("tenant", "other", "key"))
})
