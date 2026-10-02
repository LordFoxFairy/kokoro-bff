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
const SAFE_FAILURE_CODES = [
  "token_budget_exceeded",
  "recursion_limit_exceeded",
  "assembly_failed",
  "enqueue_failed",
  "dispatch_exhausted",
  "contract_incompatible",
  "internal_error",
  "model_unavailable",
  "dependency_unavailable",
  "model_access_denied",
]
const RETRYABLE_FAILURE_CODES = ["model_unavailable", "dependency_unavailable"]

function inspectMessageRoleConstraint(schema) {
  const start = schema.indexOf("CREATE TABLE IF NOT EXISTS bff_message")
  const end = schema.indexOf("CREATE TABLE IF NOT EXISTS", start + 1)
  const message = start >= 0 && end > start ? schema.slice(start, end) : ""
  return /role TEXT NOT NULL CONSTRAINT ck_bff_message_role CHECK \(role IN \('user', 'assistant'\)\),/u.test(message)
    ? []
    : ["ck_bff_message_role must allow exactly user and assistant"]
}

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
  assert.match(schema, /admission_unknown_seen BOOLEAN NOT NULL DEFAULT FALSE/u)
  assert.match(schema, /admitted_at TIMESTAMPTZ\(3\)/u)
  const scheduledOutbox = schema.match(/CREATE TABLE IF NOT EXISTS bff_scheduled_task_outbox \([\s\S]*?\n\);/u)?.[0] ?? ""
  const agentDispatchOutbox = schema.match(/CREATE TABLE IF NOT EXISTS bff_agent_dispatch_outbox \([\s\S]*?\n\);/u)?.[0] ?? ""
  assert.doesNotMatch(scheduledOutbox, /admission_unknown_seen|admitted_at/u)
  assert.match(agentDispatchOutbox, /admission_unknown_seen BOOLEAN NOT NULL DEFAULT FALSE/u)
  assert.match(agentDispatchOutbox, /admitted_at TIMESTAMPTZ\(3\)/u)
  assert.match(agentDispatchOutbox, /status IN \('pending', 'leased', 'retryable', 'admitted', 'terminal', 'failed'\)/u)
  assert.doesNotMatch(agentDispatchOutbox, /status IN \([^)]*'succeeded'/u)
  assert.match(schema, /UNIQUE \(tenant_id, conversation_id, conversation_dispatch_seq\)/u)
  assert.match(schema, /CREATE TABLE IF NOT EXISTS bff_share/u)
  assert.match(schema, /CREATE TABLE IF NOT EXISTS bff_agui_stream/u)
  assert.match(schema, /CREATE TABLE IF NOT EXISTS bff_agui_source_event/u)
  assert.match(schema, /CREATE TABLE IF NOT EXISTS bff_conversation_artifact/u)
  assert.match(schema, /PRIMARY KEY \(tenant_id, conversation_id, artifact_id\)/u)
  assert.match(schema, /UNIQUE \(tenant_id, conversation_id, source_owner, source_event_id\)/u)
  assert.match(schema, /ix_bff_conversation_artifact_library[\s\S]*?\(tenant_id, delivered_at DESC, conversation_id ASC, artifact_id ASC\)/u)
  assert.match(schema, /ix_bff_conversation_artifact_snapshot[\s\S]*?\(tenant_id, conversation_id, delivered_at DESC, artifact_id ASC\)/u)
  assert.match(schema, /source_title TEXT NOT NULL/u)
  assert.match(schema, /source_mime TEXT NOT NULL/u)
  assert.match(schema, /source_size_bytes BIGINT NOT NULL/u)
  assert.match(schema, /CREATE TABLE IF NOT EXISTS bff_agui_event/u)
  assert.match(schema, /PRIMARY KEY \(tenant_id, session_id, source_owner, source_event_id\)/u)
  assert.match(schema, /UNIQUE \(tenant_id, session_id, source_owner, source_sequence\)/u)
  assert.equal(/FOREIGN KEY|REFERENCES/iu.test(schema), false)
})

test("canonical Message failure columns use the complete nullable-pair CHECK", async () => {
  const schema = await loadCanonicalSchema()
  const start = schema.indexOf("CREATE TABLE IF NOT EXISTS bff_message")
  const end = schema.indexOf("CREATE TABLE IF NOT EXISTS", start + 1)
  const message = start >= 0 && end > start ? schema.slice(start, end) : ""

  assert.match(message, /agent_failure_code TEXT(?:,|\n)/u)
  assert.match(message, /agent_failure_retryable BOOLEAN(?:,|\n)/u)
  assert.doesNotMatch(message, /agent_failure_(?:code|retryable)[^,\n]*\bDEFAULT\b/iu)
  assert.match(message, /CONSTRAINT ck_bff_message_agent_failure CHECK/u)
  assert.match(message, /agent_failure_code IS NULL\s+AND agent_failure_retryable IS NULL/u)
  assert.match(message, /agent_failure_code IS NOT NULL\s+AND agent_failure_retryable IS NOT NULL/u)
  const codeLists = [...message.matchAll(/agent_failure_code IN \(([^)]*)\)/gu)].map((match) => [
    ...match[1].matchAll(/'([a-z_]+)'/gu),
  ].map((code) => code[1]))
  assert.deepEqual(codeLists, [SAFE_FAILURE_CODES, RETRYABLE_FAILURE_CODES])
  assert.equal(new Set(codeLists[0]).size, SAFE_FAILURE_CODES.length)
  for (const broken of [
    message.replace("'model_access_denied'", "'model_access_denied', 'unexpected_failure'"),
    message.replace("'internal_error'", "'internal_error', 'internal_error'"),
  ]) {
    assert.notEqual(broken, message)
    const [brokenCodes] = [...broken.matchAll(/agent_failure_code IN \(([^)]*)\)/gu)].map((match) => [
      ...match[1].matchAll(/'([a-z_]+)'/gu),
    ].map((code) => code[1]))
    assert.notDeepEqual(brokenCodes, SAFE_FAILURE_CODES)
  }
  assert.match(message, /agent_failure_retryable = FALSE\s+OR\s+agent_failure_code IN/u)
  assert.match(message, /role = 'assistant'/u)
  assert.match(message, /status = 'failed'/u)
  assert.match(message, /run_id IS NOT NULL/u)
  assert.match(message, /length\(btrim\(run_id\)\) > 0/u)
})

test("canonical Message role CHECK allows exactly user and assistant and detects system drift", async () => {
  const schema = await loadCanonicalSchema()

  assert.deepEqual(inspectMessageRoleConstraint(schema), [])
  const withSystem = schema.replace(
    "role IN ('user', 'assistant')",
    "role IN ('user', 'assistant', 'system')",
  )
  assert.notEqual(withSystem, schema)
  assert.notDeepEqual(inspectMessageRoleConstraint(withSystem), [])
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
    const interactionColumns = await client.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema='kokoro_bff' AND table_name='bff_agui_run_interaction' ORDER BY ordinal_position`,
    )
    assert.deepEqual(interactionColumns.rows.map(({ column_name }) => column_name), [
      "tenant_id", "session_id", "run_id", "subject_id", "projection_schema_version", "interaction_revision", "pause_revision", "pause_ref", "phase", "groups",
      "action_command_id", "action_pause_revision", "action_kind", "interaction_digest", "source_owner", "source_event_id", "source_sequence", "source_digest",
      "source_occurred_at", "public_sequence", "public_cursor", "created_at", "updated_at",
    ])
    const interactionKey = await client.query(
      `SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
        WHERE conrelid='kokoro_bff.bff_agui_run_interaction'::regclass AND contype='p'`,
    )
    assert.deepEqual(interactionKey.rows, [{ definition: "PRIMARY KEY (tenant_id, session_id, run_id)" }])
    const failureColumns = await client.query(
      `SELECT column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_schema = 'kokoro_bff'
          AND table_name = 'bff_message'
          AND column_name IN ('agent_failure_code', 'agent_failure_retryable')
        ORDER BY column_name`,
    )
    assert.deepEqual(failureColumns.rows, [
      { column_name: "agent_failure_code", data_type: "text", is_nullable: "YES", column_default: null },
      { column_name: "agent_failure_retryable", data_type: "boolean", is_nullable: "YES", column_default: null },
    ])
    const failureConstraint = await client.query(
      `SELECT pg_get_constraintdef(oid) AS definition
         FROM pg_constraint
        WHERE connamespace = 'kokoro_bff'::regnamespace
          AND conrelid = 'kokoro_bff.bff_message'::regclass
          AND conname = 'ck_bff_message_agent_failure'`,
    )
    assert.equal(failureConstraint.rowCount, 1)

    let failureSequence = 0
    const insertFailure = async ({ code, retryable, role = "assistant", status = "failed", runId = "run_failure" }) => {
      failureSequence += 1
      return client.query(
        `INSERT INTO kokoro_bff.bff_message
           (message_id, tenant_id, conversation_id, run_id, role, content, status, message_seq,
            agent_failure_code, agent_failure_retryable)
         VALUES ($1, 'tenant_failure_check', 'conversation_failure_check', $2, $3, '', $4, $5, $6, $7)`,
        [`message_failure_${failureSequence}`, runId, role, status, failureSequence, code, retryable],
      )
    }
    const expectFailureCheck = async (candidate) => {
      await assert.rejects(
        insertFailure(candidate),
        (error) => error?.code === "23514" && error?.constraint === "ck_bff_message_agent_failure",
      )
    }

    await insertFailure({ code: null, retryable: null, role: "user", status: "completed", runId: null })
    let roleSequence = 10_000
    const insertPlainRole = async (role) => {
      roleSequence += 1
      return client.query(
        `INSERT INTO kokoro_bff.bff_message
           (message_id, tenant_id, conversation_id, run_id, role, content, status, message_seq,
            agent_failure_code, agent_failure_retryable)
         VALUES ($1, 'tenant_role_check', 'conversation_role_check', NULL, $2, '', 'completed', $3, NULL, NULL)`,
        [`message_role_${roleSequence}`, role, roleSequence],
      )
    }
    await insertPlainRole("user")
    await insertPlainRole("assistant")
    await assert.rejects(
      insertPlainRole("system"),
      (error) => error?.code === "23514" && error?.constraint === "ck_bff_message_role",
    )
    for (const code of SAFE_FAILURE_CODES) await insertFailure({ code, retryable: false })
    for (const code of RETRYABLE_FAILURE_CODES) await insertFailure({ code, retryable: true })
    for (const code of SAFE_FAILURE_CODES.filter((candidate) => !RETRYABLE_FAILURE_CODES.includes(candidate))) {
      await expectFailureCheck({ code, retryable: true })
    }
    await expectFailureCheck({ code: "unknown", retryable: false })
    await expectFailureCheck({ code: "", retryable: false })
    await expectFailureCheck({ code: "  ", retryable: false })
    await expectFailureCheck({ code: null, retryable: false })
    await expectFailureCheck({ code: "internal_error", retryable: null })
    await expectFailureCheck({ code: "internal_error", retryable: false, role: "user" })
    for (const status of ["pending", "streaming", "completed"]) {
      await expectFailureCheck({ code: "internal_error", retryable: false, status })
    }
    for (const runId of [null, "", "  "]) await expectFailureCheck({ code: "internal_error", retryable: false, runId })

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

test("full interaction projection has one run key and explicit revision, locator, action, provenance and cursor constraints", async () => {
  const schema = await loadCanonicalSchema()
  const block = schema.match(/CREATE TABLE IF NOT EXISTS bff_agui_run_interaction \([\s\S]*?\n\);/u)?.[0]
  assert.ok(block)
  assert.equal((schema.match(/CREATE TABLE IF NOT EXISTS bff_agui_run_interaction\b/gu) ?? []).length, 1)
  assert.match(block, /PRIMARY KEY \(tenant_id, session_id, run_id\)/u)
  for (const name of ["identity", "version", "revision", "locator", "phase", "groups", "action", "resuming", "validation", "digest", "source", "public"]) {
    assert.ok(block.includes("CONSTRAINT ck_bff_agui_run_interaction_" + name + " CHECK"), name)
  }
  assert.match(block, /interaction_revision BETWEEN 1 AND 9007199254740991/u)
  assert.match(block, /pause_revision BETWEEN 0 AND interaction_revision/u)
  assert.match(block, /pause_revision = 0 AND pause_ref IS NULL/u)
  assert.match(block, /action_command_id IS NULL AND action_pause_revision IS NULL AND action_kind IS NULL/u)
  assert.match(block, /action_pause_revision IS NOT NULL AND action_pause_revision BETWEEN 1 AND pause_revision/u)
  assert.match(block, /source_owner = 'kokoro-agent'/u)
  assert.doesNotMatch(block, /FOREIGN KEY|REFERENCES|checkpoint|lease_token/iu)
  assert.doesNotMatch(schema, /CREATE (?:UNIQUE )?INDEX[^;]*ON bff_agui_run_interaction/iu)
})
