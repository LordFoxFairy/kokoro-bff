import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { test } from "node:test"
import pg from "pg"

import {
  applyCanonicalSchema,
  assertEmptyOwnerSchema,
  assertBffSchemaUrl,
  loadCanonicalSchema,
} from "../scripts/apply-schema.mjs"

const { Client } = pg

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

test("schema application rejects a non-empty BFF owner schema", () => {
  assert.doesNotThrow(() => assertEmptyOwnerSchema([]))
  assert.throws(
    () => assertEmptyOwnerSchema(["existing_table"]),
    /db:apply-schema requires an empty kokoro_bff schema; found objects: existing_table/u,
  )
})

test("schema installer accepts only a URL targeting the fixed BFF owner schema", () => {
  assert.doesNotThrow(() => assertBffSchemaUrl("postgresql://localhost/app?schema=kokoro_bff"))
  for (const url of [
    "postgresql://localhost/app",
    "postgresql://localhost/app?schema=public",
    "postgresql://localhost/app?schema=kokoro_iam",
    "postgresql://localhost/app?schema=kokoro_bff&schema=kokoro_bff",
    "postgresql://localhost/app?schema=kokoro_bff&options=-c%20search_path%3Dpublic",
  ]) assert.throws(() => assertBffSchemaUrl(url), /kokoro_bff schema/u, url)
})

const adminUrl = process.env.KOKORO_TEST_POSTGRES_ADMIN_URL
const databaseTest = adminUrl ? test : test.skip

databaseTest("owner schema install coexists with other schemas and rolls back on SQL failure", async () => {
  const name = `kokoro_bff_schema_${randomUUID().replaceAll("-", "")}`
  const admin = new Client({ connectionString: adminUrl })
  const target = new URL(adminUrl)
  target.pathname = `/${name}`
  target.search = ""
  target.searchParams.set("schema", "kokoro_bff")
  const databaseUrl = target.toString()
  let created = false
  let client
  try {
    await admin.connect()
    await admin.query(`CREATE DATABASE ${name}`)
    created = true
    await assert.rejects(
      applyCanonicalSchema(databaseUrl, "CREATE TABLE bff_partial (id integer); SELECT 1 / 0"),
      /division by zero/u,
    )
    client = new Client({ connectionString: databaseUrl })
    await client.connect()
    assert.equal((await client.query("SELECT count(*)::int AS count FROM pg_namespace WHERE nspname = 'kokoro_bff'")).rows[0].count, 0)
    await client.query("CREATE SCHEMA kokoro_bff")
    await client.query("CREATE COLLATION kokoro_bff.owner_guard (provider = libc, locale = 'C')")
    await assert.rejects(applyCanonicalSchema(databaseUrl, await loadCanonicalSchema()), /empty kokoro_bff schema/u)
    await client.query("DROP COLLATION kokoro_bff.owner_guard")
    await client.query("CREATE TABLE public.other_owner_guard (id integer)")
    await client.query("CREATE SCHEMA kokoro_iam")
    await client.query("CREATE TABLE kokoro_iam.other_owner_guard (id integer)")
    await applyCanonicalSchema(databaseUrl, await loadCanonicalSchema())
    const bffTables = await client.query("SELECT count(*)::int AS count FROM pg_tables WHERE schemaname = 'kokoro_bff'")
    assert.ok(bffTables.rows[0].count >= 10)
    assert.equal((await client.query("SELECT count(*)::int AS count FROM pg_tables WHERE schemaname = 'public' AND tablename = 'other_owner_guard'")).rows[0].count, 1)
    assert.equal((await client.query("SELECT count(*)::int AS count FROM pg_tables WHERE schemaname = 'kokoro_iam' AND tablename = 'other_owner_guard'")).rows[0].count, 1)
    await assert.rejects(applyCanonicalSchema(databaseUrl, await loadCanonicalSchema()), /empty kokoro_bff schema/u)
    await assert.rejects(applyCanonicalSchema(databaseUrl.replace("schema=kokoro_bff", "schema=public"), await loadCanonicalSchema()), /kokoro_bff schema/u)
  } finally {
    try {
      await client?.end()
    } finally {
      try {
        if (created) await admin.query(`DROP DATABASE ${name} WITH (FORCE)`)
      } finally {
        await admin.end()
      }
    }
  }
})
