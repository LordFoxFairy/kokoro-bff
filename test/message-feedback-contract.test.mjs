import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { test } from "node:test"
import { load } from "js-yaml"
import { restorePublic289MessageActionsContract, restoreMessageActionsSchema, messageActionsParentInventory } from "../scripts/project-pin-public-contract.mjs"
test("message actions preserve complete Public28.9 and expose only exact feedback preference operations", async () => {
  const raw = await readFile(new URL("../contract/openapi/v1/openapi.yaml", import.meta.url), "utf8"),
    spec = load(raw)
  const parent = restorePublic289MessageActionsContract(raw)
  assert.equal(createHash("sha256").update(parent).digest("hex"), "b438a749c919d24c4e0f1dadfdbcbbb11e0ac755f5785c543a661336c2cbb354")
  const path = spec.paths["/v1/sessions/{id}/messages/{messageId}/feedback"]
  assert.deepEqual(Object.keys(path), ["get", "put"])
  assert.equal(path.put["x-kokoro-idempotency"], "natural")
  assert.equal(spec.components.schemas.SetMessageFeedbackRequest.additionalProperties, false)
  assert.deepEqual(spec.components.schemas.SetMessageFeedbackRequest.properties.feedback.enum, ["up", "down", null])
  for (const changed of [
    raw + "\n",
    raw.replace("getMessageFeedback", "getOtherFeedback"),
    raw.replace("enum: [up, down, null]", "enum: [up, down]"),
    raw.replace("28.10.0", "28.11.0"),
  ])
    assert.throws(() => restorePublic289MessageActionsContract(changed), /drift/)
})

test("Message actions SQL and operation inventory inverse reject unrelated or partial child drift", async () => {
  const sql = await readFile(new URL("../database/schema.sql", import.meta.url), "utf8")
  const parent = restoreMessageActionsSchema(sql)
  assert.equal(createHash("sha256").update(parent).digest("hex"), "82b67bc5f8bb18deaa78821c9c4f59962f3d8ca5c986120544b84f9e9c8d13d0")
  for (const bad of [
    sql + "\n",
    sql.replace("feedback IN ('up', 'down')", "feedback IN ('up')"),
    sql.replace("origin TEXT NOT NULL DEFAULT 'normal'", "origin TEXT DEFAULT 'normal'"),
  ]) {
    assert.notEqual(bad, sql)
    assert.throws(() => restoreMessageActionsSchema(bad), /drift/)
  }
  const { operations } = JSON.parse(await readFile(new URL("../contract/tests/v1-operations.json", import.meta.url), "utf8"))
  assert.equal(messageActionsParentInventory(operations).length, 195)
  for (const bad of [
    operations.slice(0, -1),
    operations.map((item, i) => (i === 0 ? { ...item, path: "/wrong" } : item)),
    operations.map((item) => (item.operation_id === "setMessageFeedback" ? { ...item, method: "POST" } : item)),
  ])
    assert.throws(() => messageActionsParentInventory(bad), /drift/)
})
