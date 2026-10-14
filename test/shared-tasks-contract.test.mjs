import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import { load } from "js-yaml"

const spec = load(await readFile(new URL("../contract/openapi/v1/openapi.yaml", import.meta.url), "utf8"))
const resolveSchema = (schema) => (schema?.$ref ? spec.components.schemas[schema.$ref.split("/").at(-1)] : schema)
test("shared tasks additive public release registers one canonical GET with owner metadata", () => {
  assert.equal(spec.info.version, "15.3.0")
  const path = spec.paths["/v1/account/shared-tasks"]
  assert.ok(path, "canonical shared-tasks path must exist")
  assert.deepEqual(Object.keys(path), ["get"])
  const op = path.get
  assert.equal(op.operationId, "listOwnedSharedTasks")
  for (const [key, value] of Object.entries({ owner: "kokoro-bff", visibility: "public", stability: "beta", idempotency: "none", permission: "chat.read" }))
    assert.equal(op[`x-kokoro-${key}`], value)
})
test("shared tasks canonical success is closed and cannot expose share capability or request metadata", () => {
  const op = spec.paths["/v1/account/shared-tasks"]?.get
  assert.ok(op, "canonical GET required before response inspection")
  const envelope = resolveSchema(op.responses["200"].content["application/json"].schema)
  assert.equal(envelope.additionalProperties, false)
  assert.deepEqual(Object.keys(envelope.properties), ["data"])
  const data = resolveSchema(envelope.properties.data)
  assert.equal(data.additionalProperties, false)
  assert.deepEqual(Object.keys(data.properties).sort(), ["items", "next_cursor"])
  const item = resolveSchema(data.properties.items.items)
  assert.equal(item.additionalProperties, false)
  assert.deepEqual(Object.keys(item.properties).sort(), ["expires_at", "session_id", "shared_at", "title"])
  assert.deepEqual([...item.required].sort(), ["expires_at", "session_id", "shared_at", "title"])
})

test("shared tasks outer inverse restores complete committed15.2 and ordered145 inventory", async () => {
  const { restorePublic152SharedTasksContract, sharedTasksParentBaseline } = await import("../scripts/shared-tasks-public-contract.mjs")
  const { createHash } = await import("node:crypto")
  const source = await readFile(new URL("../contract/openapi/v1/openapi.yaml", import.meta.url), "utf8")
  const baseline = JSON.parse(await readFile(new URL("../contract/tests/v1-operations.json", import.meta.url), "utf8")).operations
  const sha = (v) => createHash("sha256").update(v).digest("hex")
  assert.equal(sha(restorePublic152SharedTasksContract(source)), "3214e32d273fbc514db1c1f2307f7855b623f1f613fb1da710cc51d23c41f453")
  assert.equal(sha(JSON.stringify(sharedTasksParentBaseline(baseline))), "6c0bb394736038b61c247a2a5f40ca8dee18850fbc45ad5bb114d0df0ab00f46")
  for (const [from, to] of [
    ["permission: chat.read", "permission: chat.write"],
    ["SharedTaskItem:", "SharedTaskItemChanged:"],
    ["session_authentication_required", "untrusted_code"],
    ["version: 15.3.0", "version: 15.3.1"],
    ["maxLength: 2048", "maxLength: 2049"],
  ]) {
    assert.notEqual(source.replace(from, to), source)
    assert.throws(() => restorePublic152SharedTasksContract(source.replace(from, to)))
  }
  for (const values of [
    baseline.slice(1),
    [...baseline, baseline[0]],
    [...baseline.slice(1), baseline[0]],
    baseline.map((x, i) => (i === 0 ? { ...x, operation_id: "changed" } : x)),
  ])
    assert.throws(() => sharedTasksParentBaseline(values))
})
