import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import test from "node:test"
import { load } from "js-yaml"
import { fromJSONSchema } from "zod"

const source = await readFile(new URL("../contract/openapi/v1/openapi.yaml", import.meta.url), "utf8")
const document = load(source)
const inventory = JSON.parse(await readFile(new URL("../contract/tests/v1-operations.json", import.meta.url), "utf8")).operations
const path = "/v1/admin/identity/audit-events"
const operation = { method: "GET", path, operation_id: "listAdminIdentityAuditEvents" }
const hash = (value) => createHash("sha256").update(value).digest("hex")

test("Public29.1 adds one current-tenant administrator audit read with a closed safe page", () => {
  assert.equal(document.info.version, "29.1.0")
  assert.equal(inventory.length, 228)
  assert.deepEqual(inventory.at(-1), operation)
  const get = document.paths[path]?.get
  assert.equal(get?.operationId, operation.operation_id)
  assert.equal(get["x-kokoro-owner"], "kokoro-bff")
  assert.equal(get["x-kokoro-visibility"], "public")
  assert.equal(get["x-kokoro-idempotency"], "none")
  assert.equal(get["x-kokoro-permission"], "admin.identity.read")
  assert.deepEqual(get.parameters, [{ $ref: "#/components/parameters/AdminIdentityLimit" }, { $ref: "#/components/parameters/AdminIdentityCursor" }])
  assert.equal(get.requestBody, undefined)
  assert.deepEqual(Object.keys(get.responses).sort(), ["200", "400", "401", "403", "404", "429", "502", "503"])
  const schema = fromJSONSchema(
    JSON.parse(
      JSON.stringify({
        $ref: "#/components/schemas/AdminIdentityAuditEventsResponse",
        $defs: document.components.schemas,
      }).replaceAll("#/components/schemas/", "#/$defs/"),
    ),
  )
  const event = {
    id: "11111111-1111-4111-8111-111111111111",
    operation_id: "22222222-2222-4222-8222-222222222222",
    phase: "outcome_unknown",
    tenant_id: "tenant-admin",
    actor_id: null,
    client_id: null,
    method: "PUT",
    route: "/internal/v1/tenants/tenant-admin/members/member-1/roles",
    resource_type: "member",
    resource_id: "member-1",
    result_code: "UNKNOWN",
    request_id: "request-1",
    trace_id: null,
    created_at: "2026-11-13T00:00:00.000Z",
  }
  const page = { data: { items: [event], next_cursor: "opaque-cursor" }, meta: { request_id: "request-1" } }
  assert.equal(schema.safeParse(page).success, true)
  for (const extra of ["details", "body", "credentials", "before", "after"])
    assert.equal(schema.safeParse({ ...page, data: { ...page.data, items: [{ ...event, [extra]: {} }] } }).success, false, extra)
  assert.equal(schema.safeParse({ ...page, data: { ...page.data, total: 1 } }).success, false)
  assert.equal(schema.safeParse({ ...page, data: { ...page.data, next_cursor: "" } }).success, false)
  assert.equal(schema.safeParse({ ...page, data: { ...page.data, items: Array(101).fill(event) } }).success, false)
})

test("audit addition restores the complete unchanged Public29 parent and ordered 227 operations", async () => {
  const { restoreAdminIdentityAuditContract, adminIdentityAuditParentBaseline } = await import("../scripts/admin-identity-audit-public-contract.mjs")
  const parent = restoreAdminIdentityAuditContract(source)
  assert.equal(hash(parent), "45c54365e75a31684e1dbf841a0c68cd554bf022643919cac591c78ed4499509")
  const restored = adminIdentityAuditParentBaseline(inventory)
  assert.equal(restored.length, 227)
  assert.deepEqual(restored, inventory.slice(0, -1))
  assert.throws(() => restoreAdminIdentityAuditContract(source.replace("List current-tenant IAM audit events", "drift")))
  assert.throws(() => restoreAdminIdentityAuditContract(source.replace("ServiceAuthFailed", "Drift")))
  assert.throws(() => adminIdentityAuditParentBaseline([...inventory.slice(1), inventory[0]]))
  assert.throws(() => adminIdentityAuditParentBaseline([...inventory, operation]))
})
