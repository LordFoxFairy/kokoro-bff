import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { readFile } from "node:fs/promises"
import { test } from "node:test"
import { Pool } from "pg"
import { applyCanonicalSchema, evolveProjectCollaborationSchema } from "../scripts/apply-schema.mjs"
import { projectCollaborationDefinitions } from "../scripts/project-collaboration-schema.mjs"
import { buildScheduledAgentLaunch, scheduledConversationId } from "../dist/infrastructure/clients/agent/launch.js"

// Root creates and reclaims this empty owned DB; this test alone installs the pinned parent instead of the current schema.
test("real PG exact-parent Project collaboration evolution preserves old executors, payloads and cursors and refuses unknown or mixed state", async (t) => {
  const raw = process.env.KOKORO_TEST_POSTGRES_URL
  assert.ok(raw, "Root-owned empty Project collaboration fixture URL is required")
  const url = new URL(raw)
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
  assert.match(url.pathname, /^\/kokoro_bff_project_collab_[0-9a-f]{32}$/u)
  assert.deepEqual(url.searchParams.getAll("schema"), ["kokoro_bff"])
  const pool = new Pool({ connectionString: raw, options: "-c search_path=kokoro_bff -c timezone=UTC", max: 2 })
  t.after(() => pool.end())
  assert.equal((await pool.query("SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='kokoro_bff' LIMIT 1")).rowCount, 0)
  const current = await readFile(new URL("../database/schema.sql", import.meta.url), "utf8")
  const parent = execFileSync("git", ["show", "d875e3bde8e9942118e9bb402df7a34ba55bf2f4:database/schema.sql"], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
  })
  assert.equal(projectCollaborationDefinitions(current).parent, parent)
  await applyCanonicalSchema(raw, parent)
  const tenant = "evolution-tenant",
    owner = "original-owner",
    task = "legacy-task",
    project = "project-legacy",
    conversation = "conv_legacy"
  await pool.query(
    "INSERT INTO bff_project(project_id,tenant_id,owner_id,name,slug,instruction) VALUES($1,$2,$3,'Original Project','original-project','Original instruction')",
    [project, tenant, owner],
  )
  await pool.query(
    `INSERT INTO bff_scheduled_task(task_id,tenant_id,project_id,owner_id,title,prompt,frequency,task_time,timezone,enabled,status,revision)
    VALUES($1,$2,$3,$4,'Original task','Original prompt','daily','08:00','UTC',true,'active',7)`,
    [task, tenant, project, owner],
  )
  const launch = buildScheduledAgentLaunch({
    identity: { namespace: tenant, userId: owner },
    requestId: "original-request",
    sessionId: scheduledConversationId(tenant, task),
    occurrenceIdentity: "a".repeat(64),
    content: "Original prompt",
    projectRef: project,
  })
  const occurrence = "2026-11-13T08:00:00.000000000Z",
    key = "original-callback",
    fingerprint = "b".repeat(64)
  const snapshot = {
    tenantId: tenant,
    taskId: task,
    occurrence,
    idempotencyKey: key,
    actorId: owner,
    taskRevision: 7,
    schedule: "original-schedule",
    launch: { requestId: "original-request", ...launch },
  }
  const envelope = {
    schema_version: 2,
    state: "terminal",
    claim_token: null,
    lease_until: null,
    retry_at: null,
    last_error_code: null,
    snapshot,
    response: { status: 202, body: { data: { task_id: task, run_id: launch.receipt.run_id } } },
  }
  await pool.query("INSERT INTO bff_idempotency_receipt(scope,fingerprint,status,response_body) VALUES($1,$2,202,$3::jsonb)", [
    JSON.stringify([tenant, "scheduler-dispatch:v1", key]),
    fingerprint,
    JSON.stringify(envelope),
  ])
  await pool.query(
    `INSERT INTO bff_scheduled_agent_dispatch(dispatch_id,tenant_id,task_id,occurrence,occurrence_order_key,subject_id,request_id,idempotency_key,request_digest,run_id,identity_assertion_ref,payload,user_message_id,assistant_message_id)
    VALUES('persisted-original-id',$1,$2,$3,$3,$4,'original-request',$5,$6,$7,$8,$9::jsonb,$10,$11)`,
    [
      tenant,
      task,
      occurrence,
      owner,
      key,
      fingerprint,
      launch.receipt.run_id,
      launch.identityAssertionRef,
      JSON.stringify(launch.body),
      launch.receipt.user_message_id,
      launch.receipt.assistant_message_id,
    ],
  )
  await pool.query(
    `INSERT INTO bff_scheduled_task_outbox(outbox_id,tenant_id,task_id,command_type,aggregate_revision,payload,actor_id,request_id,idempotency_key)
    VALUES('persisted-scheduler-command',$1,$2,'scheduler.register',7,'{"original":"immutable-command"}'::jsonb,$3,'original-request','same-key')`,
    [tenant, task, owner],
  )
  await pool.query("INSERT INTO bff_conversation(conversation_id,tenant_id,owner_id,project_ref,title) VALUES($1,$2,$3,$4,'Original conversation')", [
    conversation,
    tenant,
    owner,
    project,
  ])
  await pool.query(
    `INSERT INTO bff_agui_stream(tenant_id,session_id,consumer_subject_id,source_high_watermark,next_public_sequence,projection_state)
    VALUES($1,$2,$3,3,4,'{"text_message_ids":["original-text-message"]}'::jsonb)`,
    [tenant, conversation, owner],
  )
  for (const sequence of [1, 2, 3]) {
    const id = `source-${sequence}`,
      occurred = new Date(sequence * 1000).toISOString()
    await pool.query(
      "INSERT INTO bff_agui_source_event(tenant_id,session_id,source_owner,source_event_id,source_sequence,source_digest,source_occurred_at) VALUES($1,$2,'kokoro-agent',$3,$4,$5,$6)",
      [tenant, conversation, id, sequence, fingerprint, occurred],
    )
    await pool.query(
      `INSERT INTO bff_agui_event(tenant_id,session_id,public_sequence,cursor,source_owner,source_event_id,frame_index,event_type,event_payload,source_occurred_at)
      VALUES($1,$2,$3,$4,'kokoro-agent',$5,0,'CUSTOM',$6::jsonb,$7)`,
      [
        tenant,
        conversation,
        sequence,
        `agui_${String(sequence).padStart(32, "0")}`,
        id,
        JSON.stringify({ type: "CUSTOM", name: "original-safe-fact", value: { sequence } }),
        occurred,
      ],
    )
  }
  await pool.query(
    `INSERT INTO bff_conversation_artifact(tenant_id,conversation_id,artifact_id,run_id,source_event_id,source_sequence,source_digest,source_asset_id,source_artifact_kind,source_content_sha256,source_title,source_mime,source_size_bytes,delivered_at)
    VALUES($1,$2,'artifact-original','run-original','source-2',2,$3,'asset-original','document',$3,'Original output','text/plain',5,'1970-01-01T00:00:02Z')`,
    [tenant, conversation, fingerprint],
  )
  const definitions = projectCollaborationDefinitions(current)
  const legacyRows = async () =>
    Object.fromEntries(
      await Promise.all(
        definitions.oldTables.map(async (table) => [
          table,
          (await pool.query(`SELECT to_jsonb(row) AS value FROM ${table} row ORDER BY to_jsonb(row)::text`)).rows.map((r) => r.value),
        ]),
      ),
    )
  const before = await legacyRows()
  await pool.query("CREATE INDEX fixture_extra_index ON bff_project(name) INCLUDE(owner_id)")
  await assert.rejects(evolveProjectCollaborationSchema(raw, current), /PROJECT_COLLABORATION_SCHEMA_UNKNOWN/u)
  await pool.query("DROP INDEX fixture_extra_index")
  await pool.query("CREATE TABLE bff_project_grant(unrecognized integer)")
  await assert.rejects(evolveProjectCollaborationSchema(raw, current), /PROJECT_COLLABORATION_SCHEMA_UNKNOWN/u)
  await pool.query("DROP TABLE bff_project_grant")
  assert.deepEqual(await legacyRows(), before, "unknown and mixed metadata leave every original owner fact unchanged")
  await pool.query("UPDATE bff_agui_stream SET consumer_subject_id='unproved-other'")
  await assert.rejects(evolveProjectCollaborationSchema(raw, current), /PROJECT_COLLABORATION_SOURCE_ORIGIN_INVALID/u)
  assert.equal(
    (await pool.query("SELECT to_regclass('kokoro_bff.bff_project_grant') AS relation")).rows[0].relation,
    null,
    "origin failure rolls back all preceding ALTER/backfill",
  )
  await pool.query("UPDATE bff_agui_stream SET consumer_subject_id=$1", [owner])
  // An unknown/contradictory old receipt must not be replaced by the Task's current revision.
  await pool.query("UPDATE bff_idempotency_receipt SET response_body=jsonb_set(response_body,'{snapshot,taskRevision}','0')")
  await assert.rejects(evolveProjectCollaborationSchema(raw, current), /PROJECT_COLLABORATION_DISPATCH_ORIGIN_INVALID/u)
  await pool.query("UPDATE bff_idempotency_receipt SET response_body=$1::jsonb", [JSON.stringify(envelope)])
  assert.equal(await evolveProjectCollaborationSchema(raw, current), "evolved")
  const after = await legacyRows()
  const source = (await pool.query("SELECT * FROM bff_agui_source_cursor")).rows
  assert.equal(source.length, 1)
  assert.equal(source[0].subject_id, owner)
  assert.equal(source[0].source_high_watermark, "3")
  assert.deepEqual(source[0].projection_state, { text_message_ids: ["original-text-message"] })
  assert.equal(after.bff_scheduled_task[0].execution_actor_id, owner)
  assert.equal(after.bff_scheduled_agent_dispatch[0].task_revision, 7)
  for (const [table, rows] of Object.entries(after)) {
    for (const row of rows) {
      delete row.access_version
      delete row.execution_actor_id
      delete row.task_revision
      if (["bff_agui_source_event", "bff_agui_event", "bff_conversation_artifact"].includes(table)) {
        assert.equal(row.source_subject_id, owner)
        delete row.source_subject_id
      }
      if (table === "bff_agui_stream") Object.assign(row, { source_high_watermark: 3, projection_state: source[0].projection_state })
    }
    assert.deepEqual(rows, before[table], `${table}: original ID/owner/revision/prompt/plan/enabled/payload/cursor/public bytes preserved`)
  }
  const unchanged = await legacyRows()
  const sourceBeforeNoop = (await pool.query("SELECT to_jsonb(row) AS value FROM bff_agui_source_cursor row")).rows
  assert.equal(await evolveProjectCollaborationSchema(raw, current), "current")
  assert.deepEqual(await legacyRows(), unchanged)
  assert.deepEqual((await pool.query("SELECT to_jsonb(row) AS value FROM bff_agui_source_cursor row")).rows, sourceBeforeNoop)
})
