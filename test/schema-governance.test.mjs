import assert from "node:assert/strict"
import { test } from "node:test"

import {
  assertBlankDatabaseTables,
  loadCanonicalSchema,
} from "../scripts/apply-schema.mjs"

test("schema application reads the repository canonical schema", async () => {
  const schema = await loadCanonicalSchema()

  assert.match(schema, /CREATE TABLE IF NOT EXISTS bff_project/u)
  assert.match(schema, /CREATE TABLE IF NOT EXISTS bff_idempotency_receipt/u)
})

test("schema application rejects a non-empty public schema", () => {
  assert.doesNotThrow(() => assertBlankDatabaseTables([]))
  assert.throws(
    () => assertBlankDatabaseTables(["existing_table"]),
    /db:apply-schema requires a blank database; found tables: existing_table/u,
  )
})
