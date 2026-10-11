import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import * as projector from "../src/infrastructure/clients/platform/create-skill-draft-projector.ts"

const vectors = JSON.parse(
  readFileSync(
    new URL(
      "../contract/vendor/kokoro-platform/3fba81e37fbd23e40918fd838b8ecc9da9c9fb42/execution-operations/skill-product-request-vectors-v1.json",
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

test("Public13 current package admission requires CAS without rewriting immutable historical projection vectors", () => {
  for (const [method, fields] of [
    ["BeginSkillPackageUpload", { filename: "sample.zip", mime_type: "application/zip", size_bytes: "143", content_sha256: "a".repeat(64) }],
    [
      "CompleteSkillPackageUpload",
      { attempt_id: "attempt-1", upload_id: "upload-1", source_version_id: "OBJECT+/=", size_bytes: "143", content_sha256: "a".repeat(64) },
    ],
    ["ValidateSkillDraft", { attempt_id: "attempt-1" }],
  ] as const) {
    const request = { skill_id: { value: "skill-1" }, product_context: { subject_id: "user", owner_scope: { kind: "user", id: "user" } }, ...fields }
    const wire = { command_digest_version: "3.0.0", fq_method: `kokoro.platform.v1.SkillCatalogService/${method}`, tenant_ref: "tenant", request }
    assert.throws(() => projector.projectSkillProductCommand(JSON.stringify(wire), true), /CAS required/u)
    const historical = projector.projectSkillProductCommand(JSON.stringify(wire), false)
    const current = projector.projectSkillProductCommand(JSON.stringify({ ...wire, request: { ...request, expected_state_version: "9007199254740993" } }), true)
    assert.notEqual(historical.sha256, current.sha256)
    assert.equal(current.projection.command.expected_state_version, "9007199254740993")
  }
})

test("official initial draft is an initial command, not a stale-resource mutation", () => {
  const request = {
    product_context: { subject_id: "admin", owner_scope: { kind: "user", id: "admin" } },
    metadata: { display_name: "Official draft", summary: "", tags: [], metadata_json: "" },
  }
  const wire = {
    command_digest_version: "3.0.0",
    fq_method: "kokoro.platform.v1.SkillAdminService/CreateAdminSkillDraft",
    tenant_ref: "tenant",
    request,
  }
  const result = projector.projectSkillProductCommand(JSON.stringify(wire), true)
  assert.deepEqual(result.projection.command, {
    product_context: request.product_context,
    metadata: request.metadata,
  })
})

test("GitHub path inputs preserve the existing 256-character selector boundary before owner calls", async () => {
  const { parseSkillProductInput } = await import("../src/http/skill-product-input.js")
  const commit = "a".repeat(40)
  for (const path of ["", "a".repeat(256), "界".repeat(256)]) {
    const preview = { repository_url: "https://github.com/owner/repo", path }
    const selector = { owner: "owner", repository: "repo", commit, path }
    assert.deepEqual(parseSkillProductInput("github", Buffer.from(JSON.stringify(preview))), preview)
    assert.deepEqual(parseSkillProductInput("githubImport", Buffer.from(JSON.stringify(selector))), selector)
  }
  for (const path of ["a".repeat(257), "界".repeat(257), "/absolute", "a//b", "a/../b", "a/./b", "a\\b"]) {
    assert.throws(() => parseSkillProductInput("github", Buffer.from(JSON.stringify({ repository_url: "https://github.com/owner/repo", path }))))
    assert.throws(() => parseSkillProductInput("githubImport", Buffer.from(JSON.stringify({ owner: "owner", repository: "repo", commit, path }))))
  }
})
