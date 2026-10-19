import { restoreClosureMainContract, closureMainBaseline } from "../scripts/verify-closure-integration-contract.mjs"
import { restorePublic153ArchivedTasksContract, archivedTasksParentBaseline } from "../scripts/archived-tasks-public-contract.mjs"
import { restorePublic152SharedTasksContract, sharedTasksParentBaseline } from "../scripts/shared-tasks-public-contract.mjs"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import test from "node:test"
import { restorePublic151AccountProfileContract, accountProfileParentBaseline } from "../scripts/account-profile-public-contract.mjs"
const currentSource = restoreClosureMainContract(await readFile(new URL("../contract/openapi/v1/openapi.yaml", import.meta.url), "utf8"))
const currentBaseline = closureMainBaseline(JSON.parse(await readFile(new URL("../contract/tests/v1-operations.json", import.meta.url), "utf8")).operations)
const source = restorePublic152SharedTasksContract(restorePublic153ArchivedTasksContract(currentSource))
const baseline = sharedTasksParentBaseline(archivedTasksParentBaseline(currentBaseline))
const digest = (value) => createHash("sha256").update(value).digest("hex")
test("profile additive release restores exact complete15.1 bytes and144 operations", () => {
  assert.equal(digest(restorePublic151AccountProfileContract(source)), "5972f7be07a0117d8ee036fa4e742da7942b3c864d009c2847e70e69112a747d")
  assert.equal(accountProfileParentBaseline(baseline).length, 144)
})
test("profile metadata, request, closed ACK, errors and response headers cannot drift", () => {
  for (const [from, to] of [
    ["iam:account-profile.write", "iam:account-profile.read"],
    ["Update current Product user display name", "Changed"],
    ["expected_name:", "expected_old:"],
    ["AccountProfileError409:", "AccountProfileError410:"],
    ["account_profile_conflict", "session_forbidden"],
    ["Validated delta seconds from1 through86400.", "unbounded"],
    ["  version: 15.2.0", "  version: 15.2.1"],
  ])
    assert.throws(() => {
      const value = source.replace(from, to)
      if (value === source) throw new Error("test mutation missed")
      const parent = restorePublic151AccountProfileContract(value)
      assert.notEqual(parent, value)
    }, from)
})
test("inventory duplicate, omitted, extra, reordered and changed prior operations fail", () => {
  for (const list of [
    baseline.slice(1),
    [...baseline, baseline[0]],
    [...baseline.slice(1), baseline[0]],
    baseline.map((x, i) => (i === 0 ? { ...x, operation_id: "changed" } : x)),
    baseline.map((x) => (x.operation_id === "updateAccountProfile" ? { ...x, method: "POST" } : x)),
  ])
    assert.throws(() => accountProfileParentBaseline(list))
})
