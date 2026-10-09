import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import * as projector from "../src/infrastructure/clients/platform/create-skill-draft-projector.ts"

const vectors = JSON.parse(
  readFileSync(
    new URL(
      "../contract/vendor/kokoro-platform/6d2a3bd005d483f036efaa1b6990b5c620024bc3/execution-operations/skill-product-request-vectors-v1.json",
      import.meta.url,
    ),
    "utf8",
  ),
)
test("formal Product command consumer exists before Public9 adapters", () => {
  assert.equal(typeof (projector as Record<string, unknown>).projectSkillProductCommand, "function")
})
for (const vector of vectors.vectors) {
  test(`formal Product vector ${vector.id}`, () => {
    const project = (projector as unknown as { projectSkillProductCommand: (raw: Uint8Array) => { canonical: Uint8Array; sha256: string } })
      .projectSkillProductCommand
    assert.equal(typeof project, "function")
    const raw = Buffer.from(vector.rawBase64, "base64")
    if (vector.outcome !== "accept") assert.throws(() => project(raw))
    else {
      const result = project(raw)
      assert.equal(Buffer.from(result.canonical).toString("base64"), vector.canonicalBase64)
      assert.equal(result.sha256, vector.sha256)
    }
  })
}

import { parseSkillDraftInput } from "../src/http/create-skill-draft-input.js"
import { parseCompleteSkillPackageInput } from "../src/http/complete-skill-package-input.js"
test("Public9 create category and complete immutable version/CAS are preserved", () => {
  assert.deepEqual(
    parseSkillDraftInput(Buffer.from(JSON.stringify({ display_name: "X", summary: "", tags: [], example_prompts: [], category_keys: ["programming"] })))
      .categoryKeys,
    ["programming"],
  )
  const result = parseCompleteSkillPackageInput(
    Buffer.from(
      JSON.stringify({
        attempt_id: "a",
        upload_id: "u",
        content_sha256: "a".repeat(64),
        size_bytes: 10,
        source_version_id: "OPAQUE+/=",
        expected_state_version: "9007199254740993",
      }),
    ),
  )
  assert.equal(result.sourceVersionId, "OPAQUE+/=")
  assert.equal(result.expectedStateVersion, "9007199254740993")
})
