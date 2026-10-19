import assert from "node:assert/strict"
import test from "node:test"
import { parseEnabledInput, parseInstallInput, parseInstallationList, parsePersonalSkillQuery } from "../dist/http/skill-installation-input.js"
import { installSkillDigest, removeSkillDigest, setSkillEnabledDigest } from "../dist/infrastructure/clients/platform/skill-installation-projector.js"
test("installation inputs preserve exact source and optional filter presence", () => {
  assert.deepEqual(parseInstallInput(Buffer.from('{"source_ref":"skill:one"}')), { sourceRef: "skill:one" })
  assert.deepEqual(parseEnabledInput(Buffer.from('{"enabled":false}')), { enabled: false })
  assert.deepEqual(parseInstallationList("/v1/skill-installations?enabled=false&installed=true&limit=1&cursor=x"), {
    enabled: false,
    installed: true,
    limit: 1,
    cursor: "x",
  })
})
test("install and enabled commands reject duplicate keys and invalid UTF-8", () => {
  for (const [parse, raw] of [
    [parseInstallInput, '{"source_ref":"skill:one","source_ref":"skill:two"}'],
    [parseEnabledInput, '{"enabled":true,"enabled":false}'],
  ] as const) {
    assert.throws(() => parse(Buffer.from(raw)), /invalid_skill_installation_request/u)
    assert.throws(() => parse(Buffer.from([0xff])), /invalid_skill_installation_request/u)
  }
})
test("three owner command digests are independent and stable", () => {
  const values = [installSkillDigest("t", "u", "skill:one"), setSkillEnabledDigest("t", "u", "i", false), removeSkillDigest("t", "u", "i")]
  assert.equal(new Set(values).size, 3)
  for (const value of values) assert.match(value, /^[a-f0-9]{64}$/u)
})

test("installation source filter maps all three formal kinds across cursor pages", () => {
  assert.deepEqual(parseInstallationList("/v1/skill-installations"), {})
  for (const sourceKind of ["personal", "official", "third_party"]) {
    assert.deepEqual(parseInstallationList(`/v1/skill-installations?source_kind=${sourceKind}&cursor=opaque&limit=1`), {
      sourceKind,
      cursor: "opaque",
      limit: 1,
    })
  }
  for (const value of ["", "all", "github", "PERSONAL", "personal&source_kind=official"]) {
    assert.throws(() => parseInstallationList(`/v1/skill-installations?source_kind=${value}`), /invalid_skill_installation_request/u)
  }
})

test("P4 personal query preserves literal scalars, trims once and rejects presence violations", () => {
  assert.deepEqual(parseInstallationList("/v1/skill-installations"), {})
  for (const query of ["%_\\😀", "😀".repeat(1024), "\u0000", "Straße"])
    assert.equal(parseInstallationList("/v1/skill-installations?" + new URLSearchParams({ query: "  " + query + "  " })).query, query)
  for (const query of ["", " ", "😀".repeat(1025)])
    assert.throws(() => parseInstallationList("/v1/skill-installations?" + new URLSearchParams({ query })), /invalid_skill_installation_request/u)
  assert.throws(() => parseInstallationList("/v1/skill-installations?query=x&query=y"), /invalid_skill_installation_request/u)
})

test("P4 query Unicode scalar and cursor negative boundaries are exact", () => {
  for (const query of ["\ud800", "\udfff", "x\ud800y"]) assert.throws(() => parsePersonalSkillQuery(query), /invalid_skill_installation_request/u)
  for (const cursor of ["a+b", "a/b", " ", "x".repeat(4097)])
    assert.throws(() => parseInstallationList("/v1/skill-installations?" + new URLSearchParams({ cursor })), /invalid_skill_installation_request/u)
  assert.equal(parsePersonalSkillQuery("  😀  "), "😀")
})

test("explicit update requires two exact pins and rejects ambiguous raw JSON", async () => {
  const { parseUpdateInput } = await import("../dist/http/skill-installation-input.js")
  const valid = { expected_source_ref: "skill:one", source_ref: "skill:two" }
  for (const value of [valid, { source_ref: "skill:two", expected_source_ref: "skill:one" }])
    assert.deepEqual(parseUpdateInput(Buffer.from(JSON.stringify(value))), { expectedSourceRef: "skill:one", sourceRef: "skill:two" })
  for (const raw of [
    "{}",
    '{"source_ref":"skill:two"}',
    '{"expected_source_ref":null,"source_ref":"skill:two"}',
    '{"expected_source_ref":"skill:one","source_ref":"skill:two","tenant_id":"forged"}',
    '{"expected_source_ref":"skill:one","source_ref":"skill:two","source_ref":"skill:three"}',
    '{"expected_source_ref":"skill:one","source_ref":"skill:two\\n"}',
  ])
    assert.throws(() => parseUpdateInput(Buffer.from(raw)), /invalid_skill_installation_request/u)
  assert.throws(() => parseUpdateInput(Buffer.from([0xff])), /invalid_skill_installation_request/u)
  assert.throws(() => parseUpdateInput(Buffer.alloc(65_537, 32)), /request_body_too_large/u)
})

test("update digest matches the owner vector and binds both pins without changing the key identity", async () => {
  const { updateSkillDigest } = await import("../dist/infrastructure/clients/platform/skill-installation-projector.js")
  const { installationCommandId } = await import("../dist/http/skill-installation-input.js")
  assert.equal(updateSkillDigest("t", "u", "i", "skill:one", "skill:two"), "ca0ed33c69bd4fd4d1580cb74934f0aeaa5aa0cb3aaf0e8b6233a5336d7f040a")
  assert.notEqual(updateSkillDigest("t", "u", "i", "skill:three", "skill:two"), updateSkillDigest("t", "u", "i", "skill:one", "skill:two"))
  assert.notEqual(updateSkillDigest("t", "u", "i", "skill:one", "skill:three"), updateSkillDigest("t", "u", "i", "skill:one", "skill:two"))
  assert.notEqual(installationCommandId("update", "t", "u", "i", "key"), installationCommandId("install", "t", "u", "i", "key"))
})
