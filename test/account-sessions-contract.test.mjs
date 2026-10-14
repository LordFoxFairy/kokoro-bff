import { createHash } from "node:crypto"
import { restorePublic15AccountSessionContract, accountSessionParentBaseline } from "../scripts/account-session-public-contract.mjs"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import yaml from "js-yaml"

test("public account-session operations are present as authenticated owner projections", async () => {
  const spec = yaml.load(await readFile(new URL("../contract/openapi/v1/openapi.yaml", import.meta.url), "utf8"))
  assert.equal(spec.paths["/v1/account/sessions"]?.get?.operationId, "listAccountSessions")
  assert.equal(spec.paths["/v1/account/sessions/{session_id}"]?.delete?.operationId, "revokeAccountSession")
})

test("SET18 exact inverse preserves all committed public15.0 bytes and the original141 operations", async () => {
  const source = await readFile(new URL("../contract/openapi/v1/openapi.yaml", import.meta.url), "utf8")
  assert.equal(
    createHash("sha256").update(restorePublic15AccountSessionContract(source)).digest("hex"),
    "5f6b1178cb878718090ba65d6b0d563185078624af0d3d46a01e568af87264a4",
  )
  const baseline = JSON.parse(await readFile(new URL("../contract/tests/v1-operations.json", import.meta.url), "utf8")).operations
  assert.equal(baseline.length, 144)
  assert.equal(accountSessionParentBaseline(baseline).length, 141)
  assert.equal(
    createHash("sha256")
      .update(JSON.stringify(accountSessionParentBaseline(baseline)))
      .digest("hex"),
    "2e3219585f871e7b58372ead4ed7b236eec7f77ca2b05a3209b2bb8520b82377",
  )
  for (const operationId of ["websiteSetSkillInstallationEnabled", "listAccountSessions", "revokeAccountSession"]) {
    const entry = baseline.find((item) => item.operation_id === operationId)
    assert.throws(() => accountSessionParentBaseline(baseline.filter((item) => item !== entry)), /SET18/u)
    assert.throws(() => accountSessionParentBaseline([...baseline, entry]), /SET18/u)
    assert.throws(() => accountSessionParentBaseline(baseline.map((item) => (item === entry ? { ...item, method: "PATCH" } : item))), /SET18/u)
  }
  const retained = accountSessionParentBaseline(baseline)[0]
  assert.throws(() => accountSessionParentBaseline(baseline.map((item) => (item === retained ? { ...item, operation_id: "tampered" } : item))), /SET18/u)
  const reordered = [...baseline]
  const first = reordered.indexOf(retained)
  ;[reordered[first], reordered[first + 1]] = [reordered[first + 1], reordered[first]]
  assert.throws(() => accountSessionParentBaseline(reordered), /SET18/u)
  for (const mutation of [
    source.replace("operationId: listAccountSessions", "operationId: spoofed"),
    source.replace("iam:account-session.read", "iam:account-session.revoke"),
    source.replace("current_session:", "current_token:"),
    source.replace("version: 15.1.0", "version: 15.0.0"),
    source.replace("title: Kokoro Business API", "title: unauthorized old API change"),
  ])
    assert.throws(() => restorePublic15AccountSessionContract(mutation), /SET18/u)
  assert.throws(() => accountSessionParentBaseline(baseline.filter((item) => item.operation_id !== "revokeAccountSession")), /SET18/u)
})
test("public schemas expose no token/UA/IP/online inference and preserve established service admission errors", async () => {
  const spec = yaml.load(await readFile(new URL("../contract/openapi/v1/openapi.yaml", import.meta.url), "utf8"))
  assert.equal(spec.info.version, "15.1.0")
  assert.deepEqual(Object.keys(spec.components.schemas.AccountSession.properties), ["session_id", "created_at", "expires_at"])
  assert.equal(spec.components.schemas.AccountSession.additionalProperties, false)
  for (const [path, method, scope] of [
    ["/v1/account/sessions", "get", "iam:account-session.read"],
    ["/v1/account/sessions/{session_id}", "delete", "iam:account-session.revoke"],
  ]) {
    const op = spec.paths[path][method]
    assert.equal(op["x-kokoro-permission"], scope)
    assert.equal(op["x-kokoro-idempotency"], "none")
    assert.deepEqual(op.security, [{ serviceHeader: [], internalSecret: [], userBearer: [] }])
    assert.equal(op.requestBody, undefined)
  }
  assert.ok(spec.components.schemas.AccountSessionError403.properties.error.properties.code.enum.includes("service_auth_failed"))
})
