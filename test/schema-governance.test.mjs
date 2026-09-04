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
  assert.match(schema, /CREATE TABLE IF NOT EXISTS bff_agui_stream/u)
  assert.match(schema, /CREATE TABLE IF NOT EXISTS bff_agui_source_event/u)
  assert.match(schema, /CREATE TABLE IF NOT EXISTS bff_agui_event/u)
  assert.match(schema, /PRIMARY KEY \(tenant_id, session_id, source_owner, source_event_id\)/u)
  assert.match(schema, /UNIQUE \(tenant_id, session_id, source_owner, source_sequence\)/u)
  assert.equal(/FOREIGN KEY|REFERENCES/iu.test(schema), false)
})

test("schema application rejects a non-empty public schema", () => {
  assert.doesNotThrow(() => assertBlankDatabaseTables([]))
  assert.throws(
    () => assertBlankDatabaseTables(["existing_table"]),
    /db:apply-schema requires a blank database; found tables: existing_table/u,
  )
})
