import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import test from "node:test"
import { load } from "js-yaml"
import {
  ARCHIVED_TASKS_OPERATIONS,
  ARCHIVED_TASKS_PATH_SOURCE,
  ARCHIVED_TASKS_SCHEMA_SOURCE,
  archivedTasksParentBaseline,
  restorePublic153ArchivedTasksContract,
} from "../scripts/archived-tasks-public-contract.mjs"
const source = await readFile(new URL("../contract/openapi/v1/openapi.yaml", import.meta.url), "utf8")
const spec = load(source)
const sha = (value) => createHash("sha256").update(value).digest("hex")
const inventory = Object.entries(spec.paths).flatMap(([path, item]) =>
  Object.entries(item)
    .filter(([method]) => ["get", "post", "patch", "put", "delete", "head", "options"].includes(method))
    .map(([method, operation]) => ({ method: method.toUpperCase(), path, operation_id: operation.operationId })),
)
const currentInventory = JSON.parse(await readFile(new URL("../contract/tests/v1-operations.json", import.meta.url), "utf8")).operations
const oldInventory = archivedTasksParentBaseline(currentInventory)
const resolve = (schema) => (schema.$ref ? spec.components.schemas[schema.$ref.split("/").at(-1)] : schema)

test("SET47 canonical150 restores complete15.3 bytes and ordered146 then original historical gates", () => {
  assert.equal(spec.info.version, "15.4.0")
  assert.equal(inventory.length, 150)
  assert.deepEqual(inventory.slice(0, 4), ARCHIVED_TASKS_OPERATIONS)
  assert.equal(sha(restorePublic153ArchivedTasksContract(source)), "694251d4f4c1bcc9a79ae4fd2d4c050c87a0a8af39bea0a9f0bed3a4dcae5ad5")
  assert.deepEqual(archivedTasksParentBaseline(inventory), oldInventory)
  assert.equal(sha(JSON.stringify(archivedTasksParentBaseline(inventory))), "e88eca53ec77f6b05cba05188b1a72445e5c7fad07657930a1d317d5f0cc2658")
})
test("SET47 list has only four safe fields and identity-bound bounded pagination", () => {
  const op = spec.paths["/v1/account/archived-tasks"].get
  assert.equal(op["x-kokoro-permission"], "chat.read")
  assert.equal(op["x-kokoro-idempotency"], "none")
  assert.deepEqual(
    op.parameters.map((x) => x.name),
    ["limit", "cursor"],
  )
  assert.deepEqual(op.parameters[0].schema, { type: "integer", minimum: 1, maximum: 100, default: 20 })
  assert.match(op.description, /Cursor binds tenant, subject and limit/)
  assert.match(op.description, /C UTF8 byte order/)
  const envelope = resolve(op.responses["200"].content["application/json"].schema)
  const data = resolve(envelope.properties.data),
    item = resolve(data.properties.items.items)
  for (const node of [envelope, data, item]) assert.equal(node.additionalProperties, false)
  assert.deepEqual(Object.keys(item.properties), ["session_id", "title", "archived_at", "project_ref"])
  assert.deepEqual(item.required, Object.keys(item.properties))
  assert.deepEqual(item.properties.title, { type: "string" })
  assert.deepEqual(item.properties.project_ref.type, ["string", "null"])
  assert.equal(data.properties.items.maxItems, 100)
})
test("SET47 explicit current archive-state read distinguishes null from failed or missing and preserves historical IDs", () => {
  const op = spec.paths["/v1/sessions/{session_id}/archive"].get
  assert.equal(op.operationId, "getSessionArchiveState")
  assert.equal(op["x-kokoro-permission"], "chat.read")
  assert.equal(op["x-kokoro-idempotency"], "none")
  assert.ok(op.responses["404"])
  assert.equal(op.requestBody, undefined)
  assert.deepEqual(
    op.parameters.map((x) => x.name),
    ["session_id"],
  )
  assert.deepEqual(op.parameters[0].schema, { type: "string", minLength: 1 })
  assert.match(op.parameters[0].description, /historical Unicode IDs/)
  assert.match(op.description, /Unknown failures never imply unarchived/)
  assert.deepEqual(resolve(op.responses["200"].content["application/json"].schema).properties.data.properties.archived_at.type, ["string", "null"])
})
test("SET47 both strict empty commands share write permission and replay semantics", () => {
  for (const action of ["archive", "restore"]) {
    const op = spec.paths[`/v1/sessions/{session_id}/${action}`].post
    for (const [key, value] of Object.entries({
      owner: "kokoro-bff",
      visibility: "public",
      stability: "beta",
      permission: "chat.write",
      idempotency: "required",
    }))
      assert.equal(op[`x-kokoro-${key}`], value)
    assert.equal(op.requestBody.required, true)
    assert.deepEqual(resolve(op.requestBody.content["application/json"].schema), { type: "object", additionalProperties: false, maxProperties: 0 })
    assert.deepEqual(
      op.parameters.map((x) => [x.name, x.in, x.required]),
      [
        ["session_id", "path", true],
        ["Idempotency-Key", "header", true],
      ],
    )
    assert.equal(op.parameters[1].schema.maxLength, 128)
    const data = resolve(op.responses["200"].content["application/json"].schema).properties.data
    assert.equal(data.additionalProperties, false)
    assert.deepEqual(Object.keys(data.properties), ["session_id", "archived_at"])
    assert.deepEqual(data.properties.archived_at.type, ["string", "null"])
    for (const semantic of [
      /Shared archive-state/,
      /fingerprint binds action and session_id/,
      /before receipt replay/,
      /Replays never write/,
      /Delete wins with 404/,
      /Run execution continue/,
    ])
      assert.match(op.description, semantic)
  }
})
test("SET47 every declared response has closed error tuples, no-store and request ID only in headers", () => {
  for (const added of ARCHIVED_TASKS_OPERATIONS) {
    const op = spec.paths[added.path][added.method.toLowerCase()]
    for (const [status, response] of Object.entries(op.responses)) {
      assert.equal(response.headers["Cache-Control"].schema.const, "no-store")
      assert.ok(response.headers["x-request-id"])
      const schema = resolve(response.content["application/json"].schema)
      assert.equal(schema.additionalProperties, false)
      assert.equal("meta" in schema.properties, false)
      if (status !== "200") {
        assert.deepEqual(Object.keys(schema.properties), ["error"])
        const error = schema.properties.error
        assert.equal(error.additionalProperties, false)
        assert.deepEqual(error.required, ["code", "message", "retryable"])
        assert.ok(error.properties.code.enum.length)
        assert.equal(error.properties.retryable.const, ["429", "503"].includes(status))
      }
    }
  }
})
test("SET47 inverse rejects added safety drift, duplicate blocks, removed commands and old API changes", () => {
  for (const [from, to] of [
    ["version: 15.4.0", "version: 15.4.1"],
    ["permission: chat.write", "permission: chat.read"],
    ["maxProperties: 0", "maxProperties: 1"],
    ["archive_state_conflict", "arbitrary_error"],
    ["No cancellation", "Cancel Run"],
    ["session_id ASC in PostgreSQL C", "session_id ASC in PostgreSQL locale"],
    ["operationId: listOwnedSharedTasks", "operationId: changedOldOperation"],
  ]) {
    assert.notEqual(source.replace(from, to), source)
    assert.throws(() => restorePublic153ArchivedTasksContract(source.replace(from, to)))
  }
  for (const altered of [
    source.replace(ARCHIVED_TASKS_PATH_SOURCE, ""),
    source + ARCHIVED_TASKS_PATH_SOURCE,
    source + ARCHIVED_TASKS_SCHEMA_SOURCE,
    source.replace(ARCHIVED_TASKS_SCHEMA_SOURCE, ""),
  ])
    assert.throws(() => restorePublic153ArchivedTasksContract(altered))
})
test("SET47 inventory inverse rejects missing duplicate reorder and old operation drift", () => {
  for (const altered of [
    inventory.slice(1),
    [...inventory, inventory[0]],
    [inventory[1], inventory[0], ...inventory.slice(2)],
    inventory.map((item, index) => (index === 4 ? { ...item, operation_id: "changed" } : item)),
    [...inventory.slice(0, 4), inventory[5], inventory[4], ...inventory.slice(6)],
  ])
    assert.throws(() => archivedTasksParentBaseline(altered))
})
test("SET47 schema inverse keeps lifecycle and canonical old SQL exactly unchanged", async () => {
  const schema = await readFile(new URL("../database/schema.sql", import.meta.url), "utf8")
  assert.equal(schema.split("  archived_at TIMESTAMPTZ(3),\n").length, 2)
  assert.match(schema, /status IN \('active', 'deleted'\)/)
  assert.match(schema, /archived_at DESC, conversation_id COLLATE "C" ASC/)
  assert.equal((schema.match(/CREATE INDEX IF NOT EXISTS ix_bff_conversation_owner(?:_project)?_unarchived_updated/gu) ?? []).length, 2)
  const restored = schema
    .replace("  archived_at TIMESTAMPTZ(3),\n", "")
    .replace(/-- SET47: organization state[^]*?(?=CREATE TABLE IF NOT EXISTS bff_message \()/u, "")
  assert.equal(sha(restored), "cb1b6810010bbdb9ac8f1c30e42ef0e59ef90670f3742b769d85521d750be421")
})
