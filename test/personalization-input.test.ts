import assert from "node:assert/strict"
import { test } from "node:test"
import { parsePersonalizationBody } from "../dist/http/personalization-input.js"

const fields = { nickname: " 昵称 🌿 ", occupation: "职业", about: "第一行\n第二行", instructions: "保留原文" }
const encode = (value: unknown): Buffer => Buffer.from(JSON.stringify(value))

test("R257 personalization input preserves exact four fields and a required safe CAS", () => {
  assert.deepEqual(parsePersonalizationBody(encode({ expected_revision: 0, ...fields })), { expectedRevision: 0, fields })
  assert.deepEqual(parsePersonalizationBody(encode({ expected_revision: Number.MAX_SAFE_INTEGER, ...fields }))?.expectedRevision, Number.MAX_SAFE_INTEGER)
  assert.deepEqual(parsePersonalizationBody(encode({ expected_revision: 1, nickname: "", occupation: "", about: "", instructions: "" }))?.fields, {
    nickname: "",
    occupation: "",
    about: "",
    instructions: "",
  })
})

test("R257 personalization input counts scalar values at each inclusive boundary", () => {
  for (const [key, limit] of [
    ["nickname", 128],
    ["occupation", 256],
    ["about", 2000],
    ["instructions", 8000],
  ] as const) {
    const exact = { expected_revision: 0, ...fields, [key]: "🌿".repeat(limit) }
    assert.ok(parsePersonalizationBody(encode(exact)), key)
    assert.equal(parsePersonalizationBody(encode({ ...exact, [key]: "🌿".repeat(limit + 1) })), null, key)
  }
})

test("R257 personalization input rejects absent extra identity invalid types and lossy raw JSON", () => {
  const valid = { expected_revision: 0, ...fields }
  for (const key of Object.keys(valid)) {
    const missing: Record<string, unknown> = { ...valid }
    delete missing[key]
    assert.equal(parsePersonalizationBody(encode(missing)), null, key)
  }
  for (const value of [
    null,
    [],
    "text",
    { ...valid, tenant_id: "other" },
    { ...valid, owner_id: "other" },
    { ...valid, subject_id: "other" },
    { ...valid, extra: true },
    { ...valid, nickname: null },
    { ...valid, about: 1 },
    { ...valid, expected_revision: -1 },
    { ...valid, expected_revision: 0.5 },
    { ...valid, expected_revision: "0" },
    { ...valid, expected_revision: Number.MAX_SAFE_INTEGER + 1 },
    { ...valid, instructions: "\u0000" },
    { ...valid, nickname: "\ud800" },
    { ...valid, occupation: "\udfff" },
  ])
    assert.equal(parsePersonalizationBody(encode(value)), null)
  const raw = JSON.stringify(valid)
  for (const malformed of [
    raw.replace('"expected_revision":0', '"expected_revision":0,"expected_revision":0'),
    raw.replace('"expected_revision":0', '"expected_revision":-0'),
    raw.replace('"expected_revision":0', '"expected_revision":0e0'),
    raw.replace('"expected_revision":0', '"expected_revision":0.0'),
    raw + " true",
    "{",
    "",
  ])
    assert.equal(parsePersonalizationBody(Buffer.from(malformed)), null)
  assert.equal(parsePersonalizationBody(Buffer.from([0x7b, 0xff, 0x7d])), null)
})
