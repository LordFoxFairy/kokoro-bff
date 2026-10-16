import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { test } from "node:test"
import { load } from "js-yaml"

const contractUrl = new URL("../contract/openapi/v1/openapi.yaml", import.meta.url)

test("administrator identity reads are three bounded, tenant-scoped read projections", async () => {
  const document = load(await readFile(contractUrl, "utf8"))
  const expected = [
    ["/v1/admin/identity/members", "listAdminIdentityMembers", "AdminIdentityMembersResponse"],
    ["/v1/admin/identity/invitations", "listAdminIdentityInvitations", "AdminIdentityInvitationsResponse"],
    ["/v1/admin/identity/roles", "listAdminIdentityRoles", "AdminIdentityRolesResponse"],
  ]

  for (const [path, operationId, responseSchema] of expected) {
    const operation = document.paths?.[path]?.get
    assert.equal(operation?.operationId, operationId)
    assert.equal(operation?.["x-kokoro-owner"], "kokoro-bff")
    assert.equal(operation?.["x-kokoro-visibility"], "public")
    assert.equal(operation?.["x-kokoro-idempotency"], "none")
    assert.equal(operation?.["x-kokoro-permission"], "admin.identity.read")
    assert.deepEqual(operation?.parameters, [{ $ref: "#/components/parameters/AdminIdentityLimit" }, { $ref: "#/components/parameters/AdminIdentityCursor" }])
    assert.deepEqual(operation?.responses?.["200"]?.$ref, `#/components/responses/${responseSchema.replace("Response", "Success")}`)
    assert.deepEqual(Object.keys(operation?.responses ?? {}).sort(), ["200", "400", "401", "403", "404", "429", "502", "503"])
  }

  assert.deepEqual(document.components?.parameters?.AdminIdentityLimit?.schema, { type: "integer", minimum: 1, maximum: 100, default: 25 })
  assert.deepEqual(document.components?.parameters?.AdminIdentityCursor?.schema, { type: "string", minLength: 1, maxLength: 2048 })
  for (const name of ["AdminIdentityMembersResponse", "AdminIdentityInvitationsResponse", "AdminIdentityRolesResponse"]) {
    const response = document.components?.schemas?.[name]
    assert.equal(response?.additionalProperties, false)
    assert.deepEqual(response?.required, ["data", "meta"])
    assert.equal(response?.properties?.meta?.$ref, "#/components/schemas/AdminPageMeta")
  }
})
