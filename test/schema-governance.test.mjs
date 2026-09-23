import assert from "node:assert/strict"
import { test } from "node:test"

import {
  assertBlankDatabaseTables,
  loadCanonicalSchema,
} from "../scripts/apply-schema.mjs"

test("schema application reads the repository canonical schema", async () => {
  const schema = await loadCanonicalSchema()

  assert.match(schema, /CREATE TABLE IF NOT EXISTS bff_project/u)
  assert.match(schema, /CREATE TABLE IF NOT EXISTS bff_project[\s\S]*?owner_id TEXT NOT NULL/u)
  assert.match(schema, /CREATE TABLE IF NOT EXISTS bff_scheduled_task/u)
  assert.match(schema, /CREATE TABLE IF NOT EXISTS bff_scheduled_task_outbox/u)
  assert.match(schema, /CREATE TABLE IF NOT EXISTS bff_idempotency_receipt/u)
  assert.match(schema, /CREATE TABLE IF NOT EXISTS bff_conversation/u)
  assert.match(schema, /CREATE TABLE IF NOT EXISTS bff_message/u)
  assert.match(schema, /CREATE TABLE IF NOT EXISTS bff_agent_cancellation_outbox/u)
  assert.match(schema, /conversation_dispatch_seq BIGINT NOT NULL/u)
  assert.match(schema, /UNIQUE \(tenant_id, conversation_id, conversation_dispatch_seq\)/u)
  assert.match(schema, /CREATE TABLE IF NOT EXISTS bff_share/u)
  assert.match(schema, /CREATE TABLE IF NOT EXISTS bff_agui_stream/u)
  assert.match(schema, /CREATE TABLE IF NOT EXISTS bff_agui_source_event/u)
  assert.match(schema, /CREATE TABLE IF NOT EXISTS bff_agui_event/u)
  assert.match(schema, /PRIMARY KEY \(tenant_id, session_id, source_owner, source_event_id\)/u)
  assert.match(schema, /UNIQUE \(tenant_id, session_id, source_owner, source_sequence\)/u)
  assert.equal(/FOREIGN KEY|REFERENCES/iu.test(schema), false)
})

test("canonical schema uses stable diagnostic names for indexes and constraints", async () => {
  const schema = await loadCanonicalSchema()

  assert.match(schema, /CREATE UNIQUE INDEX IF NOT EXISTS uq_bff_project_owner_slug\b[\s\S]*?\(tenant_id, owner_id, slug\)/u)
  assert.match(schema, /CREATE INDEX IF NOT EXISTS ix_bff_project_owner_list\b[\s\S]*?\(tenant_id, owner_id, created_at ASC, project_id ASC\)/u)
  assert.match(schema, /CREATE INDEX IF NOT EXISTS ix_bff_project_instruction_revision\b/u)
  assert.match(schema, /CREATE INDEX IF NOT EXISTS ix_bff_project_task_tenant_project\b/u)
  assert.match(schema, /CREATE INDEX IF NOT EXISTS ix_bff_scheduled_task_owner\b[\s\S]*?\(tenant_id, owner_id, created_at ASC, task_id ASC\)/u)
  assert.match(schema, /CONSTRAINT ck_bff_project_task_status CHECK/u)
  assert.match(schema, /CONSTRAINT ck_bff_scheduled_task_frequency CHECK/u)
  assert.match(schema, /CONSTRAINT ck_bff_scheduled_task_status CHECK/u)
  assert.match(schema, /CONSTRAINT ck_bff_scheduled_task_outbox_status CHECK/u)
  assert.match(schema, /CONSTRAINT uq_bff_scheduled_task_outbox_business UNIQUE/u)
  assert.match(schema, /CREATE UNIQUE INDEX IF NOT EXISTS uq_bff_share_active_conversation/u)
  assert.match(schema, /expires_at IS NOT NULL AND expires_at <= CURRENT_TIMESTAMP\(3\)/u)
  assert.match(schema, /CONSTRAINT ck_bff_conversation_deleted CHECK/u)
  assert.match(schema, /CONSTRAINT ck_bff_message_role CHECK/u)
  assert.match(schema, /CONSTRAINT ck_bff_agent_dispatch_sequence CHECK/u)
  assert.match(schema, /CONSTRAINT ck_bff_agent_cancellation_lease CHECK/u)
  assert.match(schema, /CREATE INDEX IF NOT EXISTS ix_bff_scheduled_task_outbox_ready/u)
  assert.doesNotMatch(schema, /CREATE (?:UNIQUE )?INDEX IF NOT EXISTS bff_[a-z0-9_]+_idx\b/iu)

  for (const line of schema.split("\n")) {
    if (/CREATE UNIQUE INDEX IF NOT EXISTS/iu.test(line)) assert.match(line, /\buq_[a-z0-9_]+\b/iu)
    if (/CREATE INDEX IF NOT EXISTS/iu.test(line)) assert.match(line, /\bix_[a-z0-9_]+\b/iu)
    if (/\bCHECK\s*\(/iu.test(line)) assert.match(line, /\bCONSTRAINT\s+ck_[a-z0-9_]+\b/iu)
    if (/\bCONSTRAINT\s+[^\s]+\s+UNIQUE\b/iu.test(line)) assert.match(line, /\bCONSTRAINT\s+uq_[a-z0-9_]+\b/iu)
  }
})

test("canonical schema uses millisecond precision for every database instant", async () => {
  const schema = await loadCanonicalSchema()

  assert.doesNotMatch(schema, /\bTIMESTAMPTZ\b(?!\s*\(\s*3\s*\))/iu)
  assert.doesNotMatch(schema, /\bCURRENT_TIMESTAMP\b(?!\s*\(\s*3\s*\))/iu)
})

test("schema application rejects a non-empty public schema", () => {
  assert.doesNotThrow(() => assertBlankDatabaseTables([]))
  assert.throws(
    () => assertBlankDatabaseTables(["existing_table"]),
    /db:apply-schema requires a blank database; found tables: existing_table/u,
  )
})
