import { isDeepStrictEqual } from "node:util"
import { createHash } from "node:crypto"
import { projectGrantParentSqlSha, restoreProjectGrantSchema } from "./project-grant-public-contract.mjs"

const oldTables = [
  "bff_project",
  "bff_scheduled_task",
  "bff_scheduled_agent_dispatch",
  "bff_scheduled_task_outbox",
  "bff_agent_dispatch_outbox",
  "bff_agui_stream",
  "bff_agui_source_event",
  "bff_agui_event",
  "bff_conversation_artifact",
]
const newTables = ["bff_project_grant", "bff_agui_source_cursor"]
const tables = [...oldTables, ...newTables].sort()
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value)
const invalid = (kind = "SCHEMA_UNKNOWN") => {
  throw Error(`PROJECT_COLLABORATION_${kind}`)
}

/** One named exact-parent evolution, not another canonical schema or a migration registry. */
export function projectCollaborationDefinitions(current) {
  const parent = restoreProjectGrantSchema(current)
  const block = (name) => {
    const found = current.match(new RegExp(`^-- ${name}-SQL-BEGIN\\n([\\s\\S]*?)^-- ${name}-SQL-END$`, "mu"))
    if (!found) return invalid()
    return found[1]
  }
  return {
    current,
    parent,
    parentSha: projectGrantParentSqlSha,
    oldTables,
    newTables,
    grant: block("PROJECT-GRANT"),
    scheduled: block("PROJECT-SCHEDULED-EXECUTION"),
    source: block("PROJECT-AGUI-SOURCE"),
  }
}
export function classifyProjectCollaborationCatalog(actual, parent, current) {
  if (isDeepStrictEqual(actual, current)) return "current"
  if (isDeepStrictEqual(actual, parent)) return "parent"
  return invalid()
}
export function legacyScheduledDispatchRevision(row, receipt) {
  const envelope = receipt?.response_body,
    snapshot = envelope?.snapshot,
    launch = snapshot?.launch,
    result = envelope?.response
  if (
    !record(envelope) ||
    envelope.schema_version !== 2 ||
    envelope.state !== "terminal" ||
    receipt.status !== 202 ||
    receipt.fingerprint !== row.request_digest ||
    envelope.claim_token !== null ||
    envelope.lease_until !== null ||
    envelope.retry_at !== null ||
    envelope.last_error_code !== null ||
    !record(snapshot) ||
    !Number.isSafeInteger(snapshot.taskRevision) ||
    snapshot.taskRevision < 1 ||
    typeof snapshot.schedule !== "string" ||
    !snapshot.schedule ||
    snapshot.tenantId !== row.tenant_id ||
    snapshot.taskId !== row.task_id ||
    snapshot.occurrence !== row.occurrence ||
    snapshot.idempotencyKey !== row.idempotency_key ||
    snapshot.actorId !== row.subject_id ||
    (row.owner_id != null && row.owner_id !== row.subject_id) ||
    !record(launch) ||
    launch.requestId !== row.request_id ||
    launch.identityAssertionRef !== row.identity_assertion_ref ||
    !isDeepStrictEqual(launch.body, row.payload) ||
    launch.receipt?.run_id !== row.run_id ||
    launch.receipt?.user_message_id !== row.user_message_id ||
    launch.receipt?.assistant_message_id !== row.assistant_message_id ||
    result?.status !== 202 ||
    result.body?.data?.task_id !== row.task_id ||
    result.body?.data?.run_id !== row.run_id
  )
    return invalid("DISPATCH_ORIGIN_INVALID")
  return snapshot.taskRevision
}
function tableSql(source, table) {
  const matches = [...source.matchAll(new RegExp(`^CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?^\\);`, "gmu"))]
  if (matches.length !== 1) return invalid()
  return matches[0][0]
}
function alters(block) {
  return [...block.matchAll(/^ALTER TABLE [\s\S]*?;/gmu)].map((match) => match[0])
}

async function catalog(query, namespace) {
  const result = {}
  for (const name of tables) {
    const relation = `${namespace}.${name}`
    if (!(await query("SELECT to_regclass($1) IS NOT NULL AS present", [relation])).rows[0].present) {
      result[name] = null
      continue
    }
    const columns = (
      await query(
        // Compare live schema semantics, not heap slot order from prior additive
        // upgrades. Retired attribute slots cannot be read or written.
        `SELECT a.attname,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull,a.attidentity,a.attgenerated,
      pg_get_expr(d.adbin,d.adrelid) AS default_expression,n.nspname AS collation_schema,c.collname AS collation
      FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      LEFT JOIN pg_collation c ON c.oid=a.attcollation LEFT JOIN pg_namespace n ON n.oid=c.collnamespace
      WHERE a.attrelid=$1::regclass AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attname COLLATE "C"`,
        [relation],
      )
    ).rows
    const constraints = (
      await query(
        `SELECT conname,contype,convalidated,condeferrable,condeferred,conislocal,connoinherit,
      pg_get_constraintdef(oid,false) AS definition FROM pg_constraint WHERE conrelid=$1::regclass ORDER BY conname COLLATE "C"`,
        [relation],
      )
    ).rows
    const indexes = (
      await query(
        `SELECT c.relname,i.indisvalid,i.indisready,i.indisunique,i.indisprimary,i.indisexclusion,i.indnullsnotdistinct,
      pg_get_indexdef(i.indexrelid) AS definition,c.reloptions FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
      WHERE i.indrelid=$1::regclass ORDER BY c.relname COLLATE "C"`,
        [relation],
      )
    ).rows.map((row) => ({
      ...row,
      definition: row.definition.replace(/ ON (?:(?:pg_temp(?:_[0-9]+)?|kokoro_bff)\.)?(bff_[a-z_]+) /u, " ON OWNER.$1 "),
    }))
    const guards = (
      await query(
        `SELECT relkind,relpersistence,relrowsecurity,relforcerowsecurity,reloptions,
      EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=c.oid AND NOT tgisinternal) AS triggers,
      EXISTS(SELECT 1 FROM pg_policy WHERE polrelid=c.oid) AS policies,
      EXISTS(SELECT 1 FROM pg_inherits WHERE inhrelid=c.oid OR inhparent=c.oid) AS inheritance
      FROM pg_class c WHERE oid=$1::regclass`,
        [relation],
      )
    ).rows[0]
    result[name] = {
      columns,
      constraints,
      indexes,
      guards: {
        ...guards,
        relpersistence: namespace === "pg_temp" ? "p" : guards.relpersistence,
      },
    }
  }
  return result
}
async function expectedCatalog(query, definitions, current) {
  await query("SET LOCAL search_path TO pg_temp,pg_catalog")
  const selected = current ? tables : oldTables
  for (const name of selected) {
    await query(
      tableSql(current ? definitions.current : definitions.parent, name)
        .replace("CREATE TABLE IF NOT EXISTS", "CREATE TEMP TABLE")
        .replace(/\);$/u, ") ON COMMIT DROP;"),
    )
  }
  const source = current ? definitions.current : definitions.parent
  for (const match of source.matchAll(/^CREATE (?:UNIQUE )?INDEX IF NOT EXISTS [a-z_]+\s+ON (bff_[a-z_]+)\s+[^;]+;/gmu))
    if (selected.includes(match[1])) await query(match[0])
  if (current) for (const statement of [...alters(definitions.grant), ...alters(definitions.scheduled), ...alters(definitions.source)]) await query(statement)
  await query("SET LOCAL search_path TO pg_catalog")
  const result = await catalog(query, "pg_temp")
  await query(`DROP TABLE ${selected.map((name) => `pg_temp.${name}`).join(",")}`)
  return result
}
async function rejectRows(query, sql, values = [], kind = "SOURCE_ORIGIN_INVALID") {
  if ((await query(sql, values)).rows.length) invalid(kind)
}
/** Queued public frames originate in the immutable BFF dispatch, not Agent's source ledger. */
async function assertLegacyFrameOrigins(query) {
  let position = null
  while (true) {
    const rows = (
      await query(
        `SELECT frame.*,dispatch.outbox_id AS dispatch_outbox_id,dispatch.subject_id AS dispatch_subject,
      dispatch.actor_id AS dispatch_actor,dispatch.run_id AS dispatch_run,dispatch.conversation_dispatch_seq AS dispatch_sequence,
      dispatch.created_at AS dispatch_created_at,
      EXISTS(SELECT 1 FROM bff_agui_source_event source WHERE source.tenant_id=frame.tenant_id AND source.session_id=frame.session_id
        AND source.source_owner=frame.source_owner AND source.source_event_id=frame.source_event_id) AS has_source
      FROM bff_agui_event frame LEFT JOIN bff_agent_dispatch_outbox dispatch ON dispatch.tenant_id=frame.tenant_id
        AND dispatch.conversation_id=frame.session_id AND frame.source_event_id='dispatch_queued:'||dispatch.outbox_id
      WHERE ($1::text IS NULL OR (frame.tenant_id COLLATE "C",frame.session_id COLLATE "C",frame.public_sequence)>($1 COLLATE "C",$2 COLLATE "C",$3::bigint))
        AND NOT EXISTS(SELECT 1 FROM bff_agui_source_event source WHERE source.tenant_id=frame.tenant_id AND source.session_id=frame.session_id
          AND source.source_owner=frame.source_owner AND source.source_event_id=frame.source_event_id
          AND source.source_subject_id=frame.source_subject_id AND source.source_occurred_at=frame.source_occurred_at)
      ORDER BY frame.tenant_id COLLATE "C",frame.session_id COLLATE "C",frame.public_sequence LIMIT 128`,
        position ?? [null, null, null],
      )
    ).rows
    if (!rows.length) return
    for (const row of rows) {
      if (
        row.has_source ||
        row.source_owner !== "kokoro-bff" ||
        typeof row.dispatch_outbox_id !== "string" ||
        row.dispatch_subject !== row.source_subject_id ||
        row.dispatch_actor !== row.source_subject_id ||
        row.frame_index !== 0 ||
        row.event_type !== "CUSTOM" ||
        !/^[1-9][0-9]*$/u.test(row.dispatch_sequence)
      )
        invalid("SOURCE_ORIGIN_INVALID")
      const occurred = new Date(row.dispatch_created_at)
      const sourceId = "dispatch_queued:" + row.dispatch_outbox_id
      const cursor =
        "agui_" +
        createHash("sha256")
          .update(JSON.stringify([row.tenant_id, row.session_id, sourceId]))
          .digest("hex")
          .slice(0, 32)
      if (
        !Number.isFinite(occurred.getTime()) ||
        new Date(row.source_occurred_at).getTime() !== occurred.getTime() ||
        row.cursor !== cursor ||
        !isDeepStrictEqual(row.event_payload, {
          type: "CUSTOM",
          timestamp: occurred.getTime(),
          name: "kokoro.run.queued",
          value: { run_id: row.dispatch_run, dispatch_sequence: row.dispatch_sequence },
          metadata: {
            kokoro: {
              event_id: sourceId,
              seq: row.dispatch_sequence,
              session_id: row.session_id,
              run_id: row.dispatch_run,
              timestamp: occurred.toISOString(),
              source_owner: "kokoro-bff",
            },
          },
        })
      )
        invalid("SOURCE_ORIGIN_INVALID")
    }
    const last = rows.at(-1)
    position = [last.tenant_id, last.session_id, last.public_sequence]
  }
}
async function bindLegacyDispatches(query) {
  let after = ""
  while (true) {
    const rows = (
      await query(
        `SELECT dispatch.*,task.owner_id FROM bff_scheduled_agent_dispatch dispatch
      LEFT JOIN bff_scheduled_task task ON task.tenant_id=dispatch.tenant_id AND task.task_id=dispatch.task_id
      WHERE dispatch.dispatch_id COLLATE "C">$1 COLLATE "C" ORDER BY dispatch.dispatch_id COLLATE "C" LIMIT 128`,
        [after],
      )
    ).rows
    if (!rows.length) return
    for (const row of rows) {
      const receipt = (
        await query("SELECT fingerprint,status,response_body FROM bff_idempotency_receipt WHERE scope=$1", [
          JSON.stringify([row.tenant_id, "scheduler-dispatch:v1", row.idempotency_key]),
        ])
      ).rows[0]
      const revision = legacyScheduledDispatchRevision(row, receipt)
      await query("UPDATE bff_scheduled_agent_dispatch SET task_revision=$2 WHERE dispatch_id=$1", [row.dispatch_id, revision])
    }
    after = rows.at(-1).dispatch_id
  }
}
async function bindLegacySources(query) {
  // Facts without their old stream have no proved namespace; neither creator guesses nor a zero cursor can reconstruct it.
  for (const [table, column] of [
    ["bff_agui_source_event", "session_id"],
    ["bff_agui_event", "session_id"],
    ["bff_conversation_artifact", "conversation_id"],
  ])
    await rejectRows(
      query,
      `SELECT 1 FROM ${table} fact WHERE NOT EXISTS(SELECT 1 FROM bff_agui_stream stream WHERE stream.tenant_id=fact.tenant_id AND stream.session_id=fact.${column}) LIMIT 1`,
    )
  let position = null
  while (true) {
    const rows = (
      await query(
        `SELECT stream.*,conversation.owner_id FROM bff_agui_stream stream LEFT JOIN bff_conversation conversation
      ON conversation.tenant_id=stream.tenant_id AND conversation.conversation_id=stream.session_id
      WHERE ($1::text IS NULL OR (stream.tenant_id COLLATE "C",stream.session_id COLLATE "C")>($1 COLLATE "C",$2 COLLATE "C"))
      ORDER BY stream.tenant_id COLLATE "C",stream.session_id COLLATE "C" LIMIT 128`,
        position ?? [null, null],
      )
    ).rows
    if (!rows.length) return
    for (const row of rows) {
      const values = [row.tenant_id, row.session_id]
      const state = row.projection_state
      if (
        !record(state) ||
        Object.keys(state).length !== 1 ||
        !Array.isArray(state.text_message_ids) ||
        state.text_message_ids.some((item) => typeof item !== "string")
      )
        invalid("SOURCE_ORIGIN_INVALID")
      const subject = row.consumer_subject_id
      if (subject === null) {
        if (
          row.source_high_watermark !== "0" ||
          state.text_message_ids.length ||
          [row.expected_run_id, row.latest_run_id, row.terminal_run_id, row.latest_run_start_sequence].some((value) => value !== null)
        )
          invalid("SOURCE_ORIGIN_INVALID")
        await rejectRows(
          query,
          `SELECT 1 FROM bff_agui_source_event WHERE tenant_id=$1 AND session_id=$2 UNION ALL
          SELECT 1 FROM bff_agui_event WHERE tenant_id=$1 AND session_id=$2 UNION ALL
          SELECT 1 FROM bff_conversation_artifact WHERE tenant_id=$1 AND conversation_id=$2 UNION ALL
          SELECT 1 FROM bff_agent_dispatch_outbox WHERE tenant_id=$1 AND conversation_id=$2 UNION ALL
          SELECT 1 FROM bff_agui_run_process WHERE tenant_id=$1 AND session_id=$2 LIMIT 1`,
          values,
        )
        continue
      }
      if (typeof subject !== "string" || !subject.trim() || subject !== row.owner_id) invalid("SOURCE_ORIGIN_INVALID")
      await rejectRows(
        query,
        `SELECT 1 FROM bff_agent_dispatch_outbox WHERE tenant_id=$1 AND conversation_id=$2 AND (subject_id<>$3 OR actor_id<>$3)
        UNION ALL SELECT 1 FROM bff_agui_run_process WHERE tenant_id=$1 AND session_id=$2 AND subject_id<>$3
        UNION ALL SELECT 1 FROM bff_agui_source_event WHERE tenant_id=$1 AND session_id=$2 AND source_owner='kokoro-agent' AND source_sequence>$4::bigint LIMIT 1`,
        [...values, subject, row.source_high_watermark],
      )
      await query(
        `INSERT INTO bff_agui_source_cursor(tenant_id,session_id,source_owner,subject_id,source_high_watermark,projection_state)
        VALUES($1,$2,'kokoro-agent',$3,$4,$5::jsonb)`,
        [...values, subject, row.source_high_watermark, JSON.stringify(state)],
      )
      for (const [table, column] of [
        ["bff_agui_source_event", "session_id"],
        ["bff_agui_event", "session_id"],
        ["bff_conversation_artifact", "conversation_id"],
      ])
        await query(`UPDATE ${table} SET source_subject_id=$3 WHERE tenant_id=$1 AND ${column}=$2`, [...values, subject])
    }
    position = [rows.at(-1).tenant_id, rows.at(-1).session_id]
  }
}

/** Caller holds the owner advisory lock; this function never commits, retries, or invokes another owner. */
export async function evolveLockedProjectCollaboration(query, definitions) {
  const parent = await expectedCatalog(query, definitions, false)
  const target = await expectedCatalog(query, definitions, true)
  let actual = await catalog(query, "kokoro_bff")
  const state = classifyProjectCollaborationCatalog(actual, parent, target)
  const lockTables = [...(state === "current" ? tables : oldTables), "bff_idempotency_receipt", "bff_conversation", "bff_agui_run_process"].sort()
  await query(`LOCK TABLE ${lockTables.map((name) => `kokoro_bff.${name}`).join(",")} IN ACCESS EXCLUSIVE MODE`)
  actual = await catalog(query, "kokoro_bff")
  if (classifyProjectCollaborationCatalog(actual, parent, target) !== state) invalid()
  if (state === "current") return "current"
  await query("SET LOCAL search_path TO kokoro_bff,pg_catalog")
  await rejectRows(query, "SELECT 1 FROM bff_scheduled_task WHERE owner_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$' LIMIT 1", [], "EXECUTOR_INVALID")
  await query(definitions.grant)
  await query("ALTER TABLE bff_scheduled_task ADD COLUMN execution_actor_id TEXT")
  await query("UPDATE bff_scheduled_task SET execution_actor_id=owner_id")
  await query("ALTER TABLE bff_scheduled_agent_dispatch ADD COLUMN task_revision BIGINT")
  await bindLegacyDispatches(query)
  for (let statement of alters(definitions.scheduled)) {
    if (statement.includes("ADD COLUMN IF NOT EXISTS execution_actor_id")) continue
    statement = statement.replace("ADD COLUMN IF NOT EXISTS task_revision BIGINT NOT NULL", "ALTER COLUMN task_revision SET NOT NULL, ADD")
    // The canonical column clause carries its CHECK after ADD; retain that exact named constraint.
    statement = statement.replace("SET NOT NULL, ADD\n  CONSTRAINT", "SET NOT NULL, ADD CONSTRAINT")
    await query(statement)
  }
  await query(tableSql(definitions.current, "bff_agui_source_cursor"))
  for (const name of ["bff_agui_source_event", "bff_agui_event", "bff_conversation_artifact"])
    await query(`ALTER TABLE ${name} ADD COLUMN source_subject_id TEXT`)
  await bindLegacySources(query)
  await assertLegacyFrameOrigins(query)
  await rejectRows(
    query,
    `SELECT 1 FROM bff_conversation_artifact artifact WHERE NOT EXISTS(SELECT 1 FROM bff_agui_source_event source
    WHERE source.tenant_id=artifact.tenant_id AND source.session_id=artifact.conversation_id AND source.source_owner=artifact.source_owner
      AND source.source_event_id=artifact.source_event_id AND source.source_sequence=artifact.source_sequence AND source.source_digest=artifact.source_digest
      AND source.source_subject_id=artifact.source_subject_id) LIMIT 1`,
  )
  for (let statement of alters(definitions.source)) {
    statement = statement.replace("ADD COLUMN source_subject_id TEXT NOT NULL\n  CONSTRAINT", "ALTER COLUMN source_subject_id SET NOT NULL, ADD CONSTRAINT")
    await query(statement)
  }
  await query("SET LOCAL search_path TO pg_catalog")
  if (!isDeepStrictEqual(await catalog(query, "kokoro_bff"), target)) invalid()
  return "evolved"
}
