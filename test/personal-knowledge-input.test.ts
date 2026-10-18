import assert from "node:assert/strict"
import { test } from "node:test"
import { KNOWLEDGE_ID_PATTERN, parsePersonalKnowledgeBody } from "../dist/http/personal-knowledge-input.js"
const fields = { name: " 名称 🌿 ", when_to_use: "汇报时", content: "第一行\n第二行" },
  encode = (v: unknown) => Buffer.from(JSON.stringify(v))
test("knowledge validates exact caller fields, original text and Unicode scalar boundaries", () => {
  assert.deepEqual(parsePersonalKnowledgeBody(encode({ expected_revision: 0, ...fields }), "replace"), { expectedRevision: 0, fields })
  for (const [key, max] of [
    ["name", 500],
    ["when_to_use", 500],
    ["content", 2000],
  ] as const) {
    assert.ok(parsePersonalKnowledgeBody(encode({ expected_revision: 1, ...fields, [key]: "🌿".repeat(max) }), "replace"))
    assert.equal(parsePersonalKnowledgeBody(encode({ expected_revision: 1, ...fields, [key]: "🌿".repeat(max + 1) }), "replace"), null)
  }
  for (const name of ["", " \r\n", "\u2003", "x\u0000", "\ud800"])
    assert.equal(parsePersonalKnowledgeBody(encode({ expected_revision: 0, ...fields, name }), "replace"), null)
})
test("knowledge CAS, usage and delete do not accept identity or ambiguous JSON", () => {
  const valid = { expected_revision: 0, ...fields }
  for (const value of [
    null,
    [],
    { ...valid, tenant_id: "other" },
    { ...valid, subject_id: "other" },
    { ...valid, extra: true },
    { ...valid, expected_revision: -1 },
    { ...valid, expected_revision: 1.5 },
    { ...valid, expected_revision: "0" },
    { ...valid, expected_revision: Number.MAX_SAFE_INTEGER + 1 },
  ])
    assert.equal(parsePersonalKnowledgeBody(encode(value), "replace"), null)
  for (const raw of [
    '{"expected_revision":0,"expected_revision":0,"name":"n","when_to_use":"w","content":"c"}',
    JSON.stringify(valid).replace('"expected_revision":0', '"expected_revision":0e0'),
    "{",
    "",
  ])
    assert.equal(parsePersonalKnowledgeBody(Buffer.from(raw), "replace"), null)
  assert.equal(parsePersonalKnowledgeBody(Buffer.from([0x7b, 0xff, 0x7d]), "replace"), null)
  assert.deepEqual(parsePersonalKnowledgeBody(encode({ expected_revision: 0, enabled: false }), "usage"), { expectedRevision: 0, enabled: false })
  assert.equal(parsePersonalKnowledgeBody(encode({ expected_revision: 0, enabled: 0 }), "usage"), null)
  assert.equal(parsePersonalKnowledgeBody(encode({ expected_revision: 0 }), "remove"), null)
  assert.deepEqual(parsePersonalKnowledgeBody(encode({ expected_revision: Number.MAX_SAFE_INTEGER }), "remove"), { expectedRevision: Number.MAX_SAFE_INTEGER })
  assert.ok(KNOWLEDGE_ID_PATTERN.test("01234567-89ab-4cde-8abc-0123456789ab"))
  assert.equal(KNOWLEDGE_ID_PATTERN.test("01234567-89AB-4cde-8abc-0123456789ab"), false)
})
