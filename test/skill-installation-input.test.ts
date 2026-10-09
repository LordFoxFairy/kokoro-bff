import assert from "node:assert/strict"
import test from "node:test"
import { parseEnabledInput, parseInstallInput, parseInstallationList, parsePersonalSkillQuery } from "../dist/http/skill-installation-input.js"
import {
  installPersonalDigest,
  removePersonalDigest,
  setPersonalEnabledDigest,
} from "../dist/infrastructure/clients/platform/personal-installation-projector.js"
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
test("three owner command digests are independent and stable", () => {
  const values = [installPersonalDigest("t", "u", "skill:one"), setPersonalEnabledDigest("t", "u", "i", false), removePersonalDigest("t", "u", "i")]
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
