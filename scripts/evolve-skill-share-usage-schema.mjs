import { Client } from "pg"
import { randomUUID } from "node:crypto"
import { pathToFileURL } from "node:url"
import path from "node:path"
import { classifySkillShareUsageCatalog } from "./skill-share-usage-schema-catalog.mjs"

const TIMEOUT_MS = 10_000

const TABLES = ["bff_share", "bff_skill_usage_run_terminal", "bff_skill_usage_observation", "bff_skill_usage_coverage"]
async function readCatalog(client) {
  const relations = (
    await client.query(
      `SELECT c.relname AS table_name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='kokoro_bff' AND c.relkind='r' AND c.relname=ANY($1::text[]) ORDER BY c.relname`,
      [TABLES],
    )
  ).rows
  const catalog = {}
  for (const { table_name: table } of relations) {
    const columns = (
      await client.query(
        `SELECT a.attname AS name,format_type(a.atttypid,a.atttypmod) AS type,NOT a.attnotnull AS nullable,pg_get_expr(d.adbin,d.adrelid) AS default_value FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum WHERE n.nspname='kokoro_bff' AND c.relname=$1 AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`,
        [table],
      )
    ).rows
    const constraints = (
      await client.query(
        `SELECT con.conname AS name,con.contype,pg_get_constraintdef(con.oid,false) AS definition FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='kokoro_bff' AND c.relname=$1 AND con.contype <> 'n' ORDER BY con.conname`,
        [table],
      )
    ).rows
    const indexes = (
      await client.query(`SELECT indexname AS name,indexdef AS definition FROM pg_indexes WHERE schemaname='kokoro_bff' AND tablename=$1 ORDER BY indexname`, [
        table,
      ])
    ).rows
    catalog[table] = {
      columns: columns.map((row) => ({ name: row.name, type: row.type, nullable: row.nullable, default_value: row.default_value })),
      constraints: constraints.map((row) => ({ name: row.name, contype: row.contype, definition: row.definition })),
      indexes: indexes.map((row) => ({ name: row.name, definition: row.definition })),
    }
  }
  return catalog
}

export async function evolveSkillShareUsageSchema({ databaseUrl, mode, signal }) {
  if (!databaseUrl || !["check", "apply"].includes(mode)) return { state: "invalid_request" }
  const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: TIMEOUT_MS, query_timeout: TIMEOUT_MS, statement_timeout: TIMEOUT_MS })
  let committed = false
  let commitAttempted = false
  try {
    signal?.throwIfAborted()
    await client.connect()
    await client.query("BEGIN")
    await client.query("SET LOCAL search_path TO kokoro_bff, pg_catalog, pg_temp")
    await client.query("SET LOCAL lock_timeout TO '2s'")
    await client.query("SET LOCAL statement_timeout TO '10s'")
    await client.query("SELECT pg_advisory_xact_lock(hashtext(current_database()), hashtext('kokoro_bff'))")
    const scope = await client.query(
      `SELECT current_schema() AS current_schema,
              to_regclass('pg_temp.bff_share') AS share_shadow,
              to_regclass('pg_temp.bff_skill_usage_run_terminal') AS terminal_shadow,
              to_regclass('pg_temp.bff_skill_usage_observation') AS observation_shadow,
              to_regclass('pg_temp.bff_skill_usage_coverage') AS coverage_shadow`,
    )
    if (scope.rows[0]?.current_schema !== "kokoro_bff" || Object.entries(scope.rows[0]).some(([name, value]) => name.endsWith("_shadow") && value !== null)) {
      throw new Error("schema_scope_invalid")
    }
    const beforeState = classifySkillShareUsageCatalog(await readCatalog(client))
    if (beforeState === "drift") throw new Error("schema_catalog_drift")
    if (mode === "apply" && beforeState === "old") {
      await client.query(
        `ALTER TABLE bff_share ADD COLUMN resource_kind TEXT NOT NULL DEFAULT 'conversation', ADD COLUMN creator_subject_id TEXT, ADD COLUMN skill_source_ref TEXT; ALTER TABLE bff_share ALTER COLUMN conversation_id DROP NOT NULL; ALTER TABLE bff_share DROP CONSTRAINT ck_bff_share_identity; ALTER TABLE bff_share ADD CONSTRAINT ck_bff_share_identity CHECK (length(btrim(tenant_id)) > 0); ALTER TABLE bff_share ADD CONSTRAINT ck_bff_share_bounded_identity CHECK (char_length(tenant_id)<=255 AND (creator_subject_id IS NULL OR char_length(creator_subject_id)<=255) AND (skill_source_ref IS NULL OR char_length(skill_source_ref)<=197)); ALTER TABLE bff_share ADD CONSTRAINT ck_bff_share_resource CHECK ((resource_kind='conversation' AND conversation_id IS NOT NULL AND length(btrim(conversation_id))>0 AND creator_subject_id IS NULL AND skill_source_ref IS NULL) OR (resource_kind='skill_revision' AND conversation_id IS NULL AND creator_subject_id IS NOT NULL AND length(btrim(creator_subject_id))>0 AND skill_source_ref IS NOT NULL AND length(btrim(skill_source_ref))>0)); DROP INDEX uq_bff_share_active_conversation; CREATE UNIQUE INDEX uq_bff_share_active_conversation ON bff_share(tenant_id,conversation_id) WHERE revoked_at IS NULL AND resource_kind='conversation'; CREATE UNIQUE INDEX uq_bff_share_active_skill_revision ON bff_share(tenant_id,creator_subject_id,skill_source_ref) WHERE revoked_at IS NULL AND resource_kind='skill_revision'; DROP INDEX ix_bff_share_active_lookup; CREATE INDEX ix_bff_share_active_lookup ON bff_share(share_id,tenant_id,conversation_id) WHERE revoked_at IS NULL AND resource_kind='conversation'; CREATE INDEX ix_bff_share_active_skill_lookup ON bff_share(share_id,tenant_id,skill_source_ref) WHERE revoked_at IS NULL AND resource_kind='skill_revision'; CREATE TABLE bff_skill_usage_run_terminal (tenant_id TEXT NOT NULL,run_id TEXT NOT NULL,session_id TEXT NOT NULL,status TEXT NOT NULL,source_owner TEXT NOT NULL,source_event_id TEXT NOT NULL,source_sequence BIGINT NOT NULL,source_digest TEXT NOT NULL,source_occurred_at TIMESTAMPTZ(3) NOT NULL,observed_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),PRIMARY KEY(tenant_id,run_id),CONSTRAINT ck_bff_skill_usage_terminal_status CHECK(status IN ('completed','cancelled','failed')),CONSTRAINT ck_bff_skill_usage_terminal_identity CHECK(length(btrim(tenant_id))>0 AND length(btrim(run_id))>0 AND length(btrim(session_id))>0 AND source_owner='kokoro-agent' AND length(btrim(source_event_id))>0 AND source_sequence>0 AND source_digest~'^[0-9a-f]{64}$')); CREATE TABLE bff_skill_usage_observation (tenant_id TEXT NOT NULL,run_id TEXT NOT NULL,source_ref TEXT NOT NULL,session_id TEXT NOT NULL,ready_source_owner TEXT NOT NULL,ready_source_event_id TEXT NOT NULL,ready_source_sequence BIGINT NOT NULL,ready_source_digest TEXT NOT NULL,ready_source_occurred_at TIMESTAMPTZ(3) NOT NULL,counted_at TIMESTAMPTZ(3),PRIMARY KEY(tenant_id,run_id,source_ref),CONSTRAINT ck_bff_skill_usage_observation_identity CHECK(length(btrim(tenant_id))>0 AND length(btrim(run_id))>0 AND length(btrim(session_id))>0 AND source_ref~'^skill:[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$' AND ready_source_owner='kokoro-agent' AND length(btrim(ready_source_event_id))>0 AND ready_source_sequence>0 AND ready_source_digest~'^[0-9a-f]{64}$')); CREATE INDEX ix_bff_skill_usage_observation_counted ON bff_skill_usage_observation(tenant_id,source_ref,run_id) WHERE counted_at IS NOT NULL; CREATE TABLE bff_skill_usage_coverage (tenant_id TEXT PRIMARY KEY,status TEXT NOT NULL DEFAULT 'unavailable',checkpoint_id TEXT,checkpoint_at TIMESTAMPTZ(3),CONSTRAINT ck_bff_skill_usage_coverage_status CHECK(status IN ('unavailable','complete')),CONSTRAINT ck_bff_skill_usage_coverage_checkpoint CHECK((status='unavailable' AND checkpoint_id IS NULL AND checkpoint_at IS NULL) OR (status='complete' AND checkpoint_id IS NOT NULL AND length(btrim(checkpoint_id))>0 AND checkpoint_at IS NOT NULL)))`,
      )
    }
    const afterState = classifySkillShareUsageCatalog(await readCatalog(client))
    if (mode === "apply" && afterState !== "current") throw new Error("target_catalog_invalid")
    signal?.throwIfAborted()
    if (mode === "apply") commitAttempted = true
    await client.query(mode === "apply" ? "COMMIT" : "ROLLBACK")
    committed = mode === "apply"
    return { state: mode === "apply" ? (beforeState === "current" ? "current" : "updated") : beforeState === "current" ? "current" : "update_required" }
  } catch (error) {
    if (!committed) await client.query("ROLLBACK").catch(() => undefined)
    return { state: commitAttempted || signal?.aborted ? "unknown" : "unavailable" }
  } finally {
    await client.end().catch(() => undefined)
  }
}

async function main() {
  const mode = process.argv[2]
  const abort = new AbortController()
  const stop = () => abort.abort()
  process.once("SIGINT", stop)
  process.once("SIGTERM", stop)
  const result = await evolveSkillShareUsageSchema({ databaseUrl: process.env.KOKORO_BFF_POSTGRES_URL, mode, signal: abort.signal })
  console.log(JSON.stringify({ operation: "skill_share_usage_schema_evolution", request_id: randomUUID(), ...result }))
  process.exitCode =
    result.state === "updated" || result.state === "current" || result.state === "update_required"
      ? 0
      : result.state === "invalid_request"
        ? 2
        : result.state === "unknown"
          ? 4
          : 3
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main()
