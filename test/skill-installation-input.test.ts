import assert from "node:assert/strict"
import test from "node:test"
import { parseEnabledInput, parseInstallInput, parseInstallationList } from "../dist/http/skill-installation-input.js"
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
