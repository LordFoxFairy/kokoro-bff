import assert from "node:assert/strict"
import test from "node:test"
import * as projector from "../src/infrastructure/clients/platform/create-skill-draft-projector.ts"

test("Product command projector is available to the BFF", () => {
  assert.equal(typeof (projector as Record<string, unknown>).projectSkillProductCommand, "function")
})

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

test("publication expectation is required and closed for personal and official publish, without changing audience edits", async () => {
  const { parseSkillProductInput } = await import("../src/http/skill-product-input.js")
  const base = { audience: "owner", expected_state_version: "5" }
  const current = { current_version_id: "old-version", state_version: "9007199254740993" }
  for (const operation of ["publish", "officialPublish"] as const) {
    const extra = operation === "officialPublish" ? { publisher: { kind: "user", id: "publisher" } } : {}
    for (const expected_publication of [null, current]) {
      const body = { ...base, ...extra, expected_publication }
      assert.deepEqual(parseSkillProductInput(operation, Buffer.from(JSON.stringify(body))), body)
    }
    assert.throws(() => parseSkillProductInput(operation, Buffer.from(JSON.stringify({ ...base, ...extra }))))
    for (const expected_publication of [
      false,
      {},
      { ...current, unknown: true },
      { ...current, current_version_id: "bad id" },
      ...["0", "01", "9223372036854775807", 1].map((state_version) => ({ ...current, state_version })),
    ]) {
      assert.throws(() => parseSkillProductInput(operation, Buffer.from(JSON.stringify({ ...base, ...extra, expected_publication }))))
    }
    const duplicate = JSON.stringify({ ...base, ...extra, expected_publication: current }).replace(
      '"current_version_id":"old-version"',
      '"current_version_id":"old-version","current_version_id":"other"',
    )
    assert.throws(() => parseSkillProductInput(operation, Buffer.from(duplicate)))
  }
  assert.deepEqual(parseSkillProductInput("audience", Buffer.from(JSON.stringify(base))), base)
  assert.throws(() => parseSkillProductInput("audience", Buffer.from(JSON.stringify({ ...base, expected_publication: null }))))
})

test("both publication command digests match the fixed owner vectors and reject missing expectations", async () => {
  const { readFile } = await import("node:fs/promises")
  const vectors = JSON.parse(
    await readFile(
      new URL(
        "../contract/vendor/kokoro-platform/f29428f6e6d23e9f35642fe3de5463472bc1f873/execution-operations/skill-publication-precondition-v1.vectors.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ).vectors
  assert.equal(vectors.length, 8)
  for (const vector of vectors) {
    const actual = projector.projectSkillProductCommand(JSON.stringify(vector.request), true)
    assert.deepEqual(actual.projection, vector.canonical, vector.id)
    assert.equal(actual.sha256, vector.sha256, vector.id)
    const missing = structuredClone(vector.request)
    delete missing.request.expected_publication
    assert.throws(() => projector.projectSkillProductCommand(JSON.stringify(missing), true), /publication expectation required/u)
    for (const expected_publication of [
      { absent: false },
      { absent: true, current: {} },
      { current: { current_version_id: { value: "old" }, state_version: "9223372036854775807" } },
    ]) {
      assert.throws(() =>
        projector.projectSkillProductCommand(JSON.stringify({ ...vector.request, request: { ...vector.request.request, expected_publication } }), true),
      )
    }
  }
})

test("personal series deletion requires the exact confirmation snapshot and rejects self-reported identity", async () => {
  const { parseSkillProductInput } = await import("../src/http/skill-product-input.js")
  const current = { current_version_id: "current-revision", state_version: "9007199254740993" }
  for (const expected_publication of [null, current]) {
    const body = { expected_state_version: "9007199254740993", expected_publication }
    assert.deepEqual(parseSkillProductInput("deleteSeries", Buffer.from(JSON.stringify(body))), body)
    for (const extra of [{ tenant_id: "other" }, { subject_id: "other" }, { reason: "irrelevant" }]) {
      assert.throws(() => parseSkillProductInput("deleteSeries", Buffer.from(JSON.stringify({ ...body, ...extra }))))
    }
  }
  for (const body of [
    {},
    { expected_state_version: "1" },
    { expected_publication: null },
    { expected_state_version: "0", expected_publication: null },
    { expected_state_version: "9223372036854775807", expected_publication: null },
    { expected_state_version: 1, expected_publication: null },
    { expected_state_version: "1", expected_publication: {} },
  ])
    assert.throws(() => parseSkillProductInput("deleteSeries", Buffer.from(JSON.stringify(body))))
  assert.throws(() =>
    parseSkillProductInput("deleteSeries", Buffer.from('{"expected_state_version":"1","expected_publication":null,"expected_publication":null}')),
  )
})

test("personal series delete digest matches the fixed owner vectors and binds actor, tenant and confirmation", async () => {
  const { readFile } = await import("node:fs/promises")
  const { projectDeletePersonalSkillSeries } = await import("../src/infrastructure/clients/platform/delete-personal-skill-series-projector.js")
  const vectors = JSON.parse(
    await readFile(
      new URL("../contract/vendor/kokoro-platform/f29428f6e6d23e9f35642fe3de5463472bc1f873/execution-operations/skill-series-delete-v1.json", import.meta.url),
      "utf8",
    ),
  ).vectors
  for (const vector of vectors) {
    const v = vector.input
    const input = {
      tenant: v.tenantId,
      user: v.subjectId,
      skillId: v.skillId,
      expectedStateVersion: v.expectedStateVersion,
      expectedPublication:
        v.expectedPublication === null
          ? null
          : { current_version_id: v.expectedPublication.currentVersionId, state_version: v.expectedPublication.stateVersion },
    }
    assert.equal(projectDeletePersonalSkillSeries(input).sha256, vector.sha256)
    assert.notEqual(projectDeletePersonalSkillSeries({ ...input, user: "different" }).sha256, vector.sha256)
  }
})
