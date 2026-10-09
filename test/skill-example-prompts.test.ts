import assert from "node:assert/strict"
import test from "node:test"
import { parseSkillExamplePrompts } from "../dist/infrastructure/clients/platform/skill-example-prompts.js"

import { parseCreatePersonalSkillVersionInput } from "../dist/http/create-personal-skill-version-input.js"
import { parseSkillDraftInput } from "../dist/http/create-skill-draft-input.js"

const parsers = [
  ["CreateDraft", parseSkillDraftInput],
  ["CreateVersion", parseCreatePersonalSkillVersionInput],
] as const

const body = (examplePrompts?: unknown): Buffer =>
  Buffer.from(
    JSON.stringify({
      display_name: "Tea",
      summary: "Warm",
      tags: ["tea"],
      ...(examplePrompts === undefined ? {} : { example_prompts: examplePrompts }),
    }),
  )

for (const [name, parse] of parsers) {
  test(`${name} keeps example prompt presence, order, duplicates and original text`, () => {
    assert.deepEqual(parse(body()), { displayName: "Tea", summary: "Warm", tags: ["tea"] })
    assert.deepEqual(parse(body([])), { displayName: "Tea", summary: "Warm", tags: ["tea"], examplePrompts: [] })
    assert.deepEqual(parse(body(["  first\nline  ", "same", "same"])), {
      displayName: "Tea",
      summary: "Warm",
      tags: ["tea"],
      examplePrompts: ["  first\nline  ", "same", "same"],
    })
  })

  test(`${name} rejects every closed example prompt boundary before owner dispatch`, () => {
    const invalid: unknown[] = [
      null,
      {},
      [""],
      [" \n\t "],
      ["\u0000"],
      ["\ud800"],
      ["x".repeat(1001)],
      Array.from({ length: 11 }, (_, index) => String(index)),
      [...Array.from({ length: 8 }, () => "é".repeat(1000)), "é".repeat(192) + "a"],
      [1],
      [["nested"]],
    ]
    for (const value of invalid) assert.throws(() => parse(body(value)), /invalid_skill_request/u, JSON.stringify(value))
  })

  test(`${name} rejects duplicate JSON members and malformed UTF-8`, () => {
    assert.throws(
      () => parse(Buffer.from('{"display_name":"Tea","summary":"Warm","tags":[],"example_prompts":[],"example_prompts":["other"]}')),
      /invalid_skill_request/u,
    )
    assert.throws(() => parse(Buffer.from([0xc3, 0x28])), /invalid_skill_request/u)
  })
}

test("direct example validator rejects trailing high surrogate and preserves scalar/UTF8 boundaries", () => {
  for (const value of [
    ["\ud800"],
    ["tail\ud800"],
    ["\udc00"],
    ["\u0000"],
    ["😀".repeat(1001)],
    [...Array.from({ length: 8 }, () => "é".repeat(1000)), "é".repeat(192) + "a"],
  ])
    assert.throws(() => parseSkillExamplePrompts(value), /skill_example_prompts_invalid/u)
  for (const value of [[], ["😀".repeat(1000)], [...Array.from({ length: 8 }, () => "é".repeat(1000)), "é".repeat(192)], ["  original\n", "same", "same"]])
    assert.deepEqual(parseSkillExamplePrompts(value), value)
})

test("both command projectors bind presence, original order and content", async () => {
  const { projectCreateSkillDraft } = await import("../dist/infrastructure/clients/platform/create-skill-draft-projector.js")
  const { projectCreatePersonalSkillVersion } = await import("../dist/infrastructure/clients/platform/create-personal-skill-version-projector.js")
  for (const [method, project] of [
    ["CreateSkillDraft", projectCreateSkillDraft],
    ["CreateSkillVersion", projectCreatePersonalSkillVersion],
  ] as const) {
    const raw = (prompts?: string[]) =>
      JSON.stringify({
        command_digest_version: "3.0.0",
        fq_method: `kokoro.platform.v1.SkillCatalogService/${method}`,
        tenant_ref: "tenant",
        request: {
          owner_scope: { kind: "user", id: "user" },
          product_context: { subject_id: "user", owner_scope: { kind: "user", id: "user" } },
          ...(method === "CreateSkillVersion" ? { base_skill_id: { value: "base" } } : {}),
          metadata: { display_name: "Tea", summary: "Warm", tags: [], metadata_json: "e30", ...(prompts === undefined ? {} : { example_prompts: prompts }) },
        },
      })
    const absent = project(raw(), true)
    const empty = project(raw([]), true)
    assert.notEqual(absent.sha256, empty.sha256)
    assert.notEqual(project(raw(["a", "b"]), true).sha256, project(raw(["b", "a"]), true).sha256)
    assert.deepEqual((empty.projection.command as { metadata: unknown }).metadata, {
      display_name: "Tea",
      summary: "Warm",
      tags: [],
      metadata_json: "e30",
      example_prompts: [],
    })
  }
})

test("both BFF projectors reproduce all accepted fixed owner example canonical vectors within BFF metadata bytes", async () => {
  const { readFile } = await import("node:fs/promises")
  const { createHash } = await import("node:crypto")
  const { projectCreateSkillDraft } = await import("../dist/infrastructure/clients/platform/create-skill-draft-projector.js")
  const { projectCreatePersonalSkillVersion } = await import("../dist/infrastructure/clients/platform/create-personal-skill-version-projector.js")
  const vectors = JSON.parse(
    await readFile(
      new URL(
        "../contract/vendor/kokoro-platform/84262b664275229c62370d49f51ad5e276116148/execution-operations/skill-example-prompts-v1.vectors.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ).vectors
  let checked = 0
  for (const vector of vectors.filter((v: { outcome: string }) => v.outcome === "accept")) {
    const wire = JSON.parse(Buffer.from(vector.rawBase64, "base64").toString("utf8"))
    const metadata = wire.request.metadata
    // BFF forwards fixed {} metadata bytes and its public array, not raw owner message JSON.
    metadata.metadata_json = "e30"
    if (Object.hasOwn(metadata, "example_prompts")) metadata.example_prompts = metadata.example_prompts.prompts ?? []
    const expected = Buffer.from(vector.canonicalBase64, "base64").toString("utf8").replace('"metadata_json":"AAH_"', '"metadata_json":"e30"')
    const project = vector.id.startsWith("CreateSkillDraft/") ? projectCreateSkillDraft : projectCreatePersonalSkillVersion
    const result = project(JSON.stringify(wire), true)
    assert.equal(Buffer.from(result.canonical).toString("utf8"), expected, vector.id)
    assert.equal(result.sha256, createHash("sha256").update(expected).digest("hex"), vector.id)
    checked += 1
  }
  assert.equal(checked, 20)
})

test("direct examples rejects undefined, sparse and non-string values", () => {
  for (const value of [undefined, null, {}, Array(1), [1], [["nested"]]]) assert.throws(() => parseSkillExamplePrompts(value), /skill_example_prompts_invalid/u)
})
