import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import { load } from "js-yaml"

test("account profile public contract exposes the native-session read and existing CAS write", async () => {
  const source = await readFile(new URL("../contract/openapi/v1/openapi.yaml", import.meta.url), "utf8")
  const api = load(source)
  assert.equal(api.info.version, "28.18.0")
  const profile = api.paths["/v1/account/profile"]
  assert.deepEqual(Object.keys(profile), ["get", "patch"])
  assert.equal(profile.get.operationId, "readAccountProfile")
  assert.equal(profile.get["x-kokoro-permission"], "iam:account-profile.read")
  assert.equal(profile.get.requestBody, undefined)
  assert.deepEqual(profile.get.responses["200"].content["application/json"].schema, { $ref: "#/components/schemas/AccountProfileReadResponse" })
  assert.equal(profile.patch.operationId, "updateAccountProfile")
  assert.equal(profile.patch["x-kokoro-permission"], "iam:account-profile.write")
  const read = api.components.schemas.AccountProfileReadResponse
  assert.deepEqual(read.required, ["data"])
  assert.deepEqual(read.properties.data.required, ["subject", "name", "email", "email_verified"])
  assert.equal(read.additionalProperties, false)
})

test("account profile operation inventory keeps both methods and no duplicate operation ids", async () => {
  const inventory = JSON.parse(await readFile(new URL("../contract/tests/v1-operations.json", import.meta.url), "utf8")).operations
  const entries = inventory.filter((item) => item.path === "/v1/account/profile")
  assert.deepEqual(entries, [
    { method: "GET", path: "/v1/account/profile", operation_id: "readAccountProfile" },
    { method: "PATCH", path: "/v1/account/profile", operation_id: "updateAccountProfile" },
  ])
  assert.equal(new Set(inventory.map((item) => item.operation_id)).size, inventory.length)
})
