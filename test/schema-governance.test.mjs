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

test("canonical schema uses stable diagnostic names for indexes and constraints", async () => {
  const schema = await loadCanonicalSchema()

  assert.match(schema, /CREATE UNIQUE INDEX IF NOT EXISTS uq_bff_project_tenant_slug\b/u)
  assert.match(schema, /CREATE INDEX IF NOT EXISTS ix_bff_project_instruction_revision\b/u)
  assert.match(schema, /CREATE INDEX IF NOT EXISTS ix_bff_project_task_tenant_project\b/u)
  assert.match(schema, /CREATE INDEX IF NOT EXISTS ix_bff_scheduled_task_tenant\b/u)
  assert.match(schema, /CONSTRAINT ck_bff_project_task_status CHECK/u)
  assert.match(schema, /CONSTRAINT ck_bff_scheduled_task_frequency CHECK/u)
  assert.match(schema, /CONSTRAINT ck_bff_scheduled_task_status CHECK/u)
  assert.doesNotMatch(schema, /CREATE (?:UNIQUE )?INDEX IF NOT EXISTS bff_[a-z0-9_]+_idx\b/iu)

  for (const line of schema.split("\n")) {
    if (/CREATE UNIQUE INDEX IF NOT EXISTS/iu.test(line)) assert.match(line, /\buq_[a-z0-9_]+\b/iu)
    if (/CREATE INDEX IF NOT EXISTS/iu.test(line)) assert.match(line, /\bix_[a-z0-9_]+\b/iu)
    if (/\bCHECK\s*\(/iu.test(line)) assert.match(line, /\bCONSTRAINT\s+ck_[a-z0-9_]+\b/iu)
    if (/\bCONSTRAINT\s+[^\s]+\s+UNIQUE\b/iu.test(line)) assert.match(line, /\bCONSTRAINT\s+uq_[a-z0-9_]+\b/iu)
  }
})

test("schema application rejects a non-empty public schema", () => {
  assert.doesNotThrow(() => assertBlankDatabaseTables([]))
  assert.throws(
    () => assertBlankDatabaseTables(["existing_table"]),
    /db:apply-schema requires a blank database; found tables: existing_table/u,
  )
})
