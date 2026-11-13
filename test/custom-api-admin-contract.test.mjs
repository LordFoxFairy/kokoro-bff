import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import { load } from "js-yaml"
import { fromJSONSchema } from "zod"
const source = await readFile(new URL("../contract/openapi/v1/openapi.yaml", import.meta.url), "utf8")
const spec = load(source)
const operations = JSON.parse(await readFile(new URL("../contract/tests/v1-operations.json", import.meta.url), "utf8")).operations
const methods = [
  ["/v1/admin/custom-apis", "get", "listAdminCustomApis"],
  ["/v1/admin/custom-apis/{profile_id}", "get", "getAdminCustomApi"],
  ["/v1/admin/custom-apis/{profile_id}/quarantine", "post", "quarantineAdminCustomApi"],
  ["/v1/admin/custom-apis/{profile_id}/restore", "post", "restoreAdminCustomApi"],
  ["/v1/admin/custom-apis/{profile_id}/revoke", "post", "revokeAdminCustomApi"],
  ["/v1/admin/custom-apis/{profile_id}/audit-events", "get", "listAdminCustomApiAuditEvents"],
]
const schema = (name) =>
  fromJSONSchema(
    JSON.parse(JSON.stringify({ $ref: `#/components/schemas/${name}`, $defs: spec.components.schemas }).replaceAll("#/components/schemas/", "#/$defs/")),
  )
test("Public29 adds exactly six native admin operations with closed safe command/profile/ACK/audit schemas", () => {
  assert.equal(spec.info.version, "29.0.0")
  assert.equal(operations.length, 227)
  for (const [path, method, id] of methods) {
    const op = spec.paths[path]?.[method]
    assert.equal(op?.operationId, id)
    assert.equal(op["x-kokoro-permission"], "platform.admin")
    assert.equal(op["x-kokoro-idempotency"], method === "post" ? "required" : "none")
    assert.ok(op.responses["502"])
  }
  const input = schema("AdminCustomApiCommand")
  assert.equal(input.safeParse({ expected_state_version: "2147483646", reason_code: "security_review" }).success, true)
  for (const version of ["0", "03", "2147483647", 3])
    assert.equal(input.safeParse({ expected_state_version: version, reason_code: "security_review" }).success, false)
  assert.equal(input.safeParse({ expected_state_version: "3", reason_code: "security_review", actor_id: "forged" }).success, false)
  assert.equal(spec.components.schemas.AdminCustomApiProfile.properties.instructions, undefined)
  assert.equal(spec.components.schemas.AdminCustomApiAck.properties.name, undefined)
  assert.equal(spec.components.schemas.AdminCustomApiAck.required.includes("replayed"), true)
})
test("independent admin inverse restores exact complete 221 child before the original B10/217 parent proof", async () => {
  const { restoreCustomApiAdminContract, customApiAdminParentBaseline } = await import("../scripts/custom-api-admin-public-contract.mjs")
  const parent = restoreCustomApiAdminContract(source)
  assert.equal(createHash("sha256").update(parent).digest("hex"), "f7e327f8281e7f65845dc24c0a226734ce3b0f4d16c7255a6b3beee8a7f04a3d")
  assert.equal(customApiAdminParentBaseline(operations).length, 221)
  assert.throws(() => restoreCustomApiAdminContract(source.replace("getAdminCustomApi", "forgedAdminCustomApi")), /drift/)
  assert.throws(() => restoreCustomApiAdminContract(source.replace("getProjectAccess", "forgedProjectAccess")), /drift/)
  assert.throws(() => customApiAdminParentBaseline(operations.map((op) => (op.operation_id === "getAdminCustomApi" ? { ...op, method: "POST" } : op))), /drift/)
})
