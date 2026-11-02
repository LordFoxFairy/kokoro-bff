import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { spawnSync } from "node:child_process"
import { test } from "node:test"
import { Pool } from "pg"
import { commitAckRelay, waitFor } from "./fixtures/schema-evolution-relay.mjs"
import { dispatchExecutionDefinitions } from "../scripts/dispatch-execution-schema-catalog.mjs"
import { evolveDispatchExecutionSchema } from "../scripts/evolve-dispatch-execution-schema.mjs"

const canonical = await readFile(new URL("../database/schema.sql", import.meta.url), "utf8")
test("pure: dispatch execution extracts exactly the two approved nullable columns and preserves its exact parent", () => {
  const d = dispatchExecutionDefinitions(canonical)
  assert.deepEqual(
    d.columns.map(({ name }) => name),
    ["execution_project_ref", "execution_context_retired_at"],
  )
  assert.ok(!d.oldTable.includes("execution_project_ref"))
  assert.ok(!d.oldTable.includes("execution_context_retired_at"))
  assert.equal(d.indexes.length, 3)
  for (const changed of [
    canonical.replace("execution_project_ref TEXT,", "execution_project_ref TEXT NOT NULL,"),
    canonical.replace("execution_context_retired_at TIMESTAMPTZ(3),", "execution_context_retired_at TIMESTAMP(3),"),
    canonical.replace("execution_project_ref TEXT,", "execution_project_ref TEXT DEFAULT 'direct',"),
    canonical.replace(d.table, d.table.replace("  payload JSONB NOT NULL,", "  payload JSONB,")),
    canonical.replace(d.indexes[1], d.indexes[1].replace("status = 'leased'", "status <> 'leased'")),
    canonical + "\n" + d.table,
  ])
    assert.throws(() => dispatchExecutionDefinitions(changed), /invalid_schema/u)
})

test("pure: dispatch execution rejects unsafe scope and modes before opening a connection", async () => {
  for (const input of [
    {},
    { mode: "reset", databaseUrl: "postgres://127.0.0.1:1/fixture?schema=kokoro_bff" },
    { mode: "apply", databaseUrl: "postgres://127.0.0.1:1/postgres?schema=kokoro_bff" },
    { mode: "check", databaseUrl: "postgres://127.0.0.1:1/fixture?schema=public" },
    { mode: "apply", databaseUrl: "postgres://127.0.0.1:1/fixture?schema=kokoro_bff&options=-c%20search_path%3Dpublic" },
    { mode: "check", databaseUrl: "postgres://127.0.0.1:1/fixture?schema=kokoro_bff", timeoutMs: 20001 },
  ]) {
    const result = await evolveDispatchExecutionSchema(input)
    assert.equal(result.state, "invalid_request")
    assert.equal(result.code, "invalid_request")
    assert.deepEqual(Object.keys(result).sort(), ["cleanup", "code", "duration_ms", "state"])
  }
  const abort = new AbortController()
  abort.abort()
  const result = await evolveDispatchExecutionSchema({ mode: "apply", databaseUrl: "postgres://127.0.0.1:1/fixture?schema=kokoro_bff", signal: abort.signal })
  assert.equal(result.state, "unavailable")
  assert.ok(result.duration_ms < 500)
})

test("pure: dispatch CLI rejects extra or unknown arguments without an implicit apply", () => {
  for (const args of [[], ["reset"], ["check", "apply"]]) {
    const run = spawnSync(process.execPath, [new URL("../scripts/evolve-dispatch-execution-schema.mjs", import.meta.url).pathname, ...args], {
      env: { KOKORO_BFF_POSTGRES_URL: "postgres://127.0.0.1:1/fixture?schema=kokoro_bff" },
      encoding: "utf8",
      timeout: 2000,
    })
    assert.equal(run.status, 2)
    assert.equal(run.stderr, "")
    const result = JSON.parse(run.stdout)
    assert.equal(result.operation, "dispatch_execution_schema_evolution")
    assert.equal(result.state, "invalid_request")
    assert.deepEqual(Object.keys(result).sort(), ["cleanup", "code", "duration_ms", "operation", "state"])
  }
})

const databaseUrl = process.env.KOKORO_TEST_POSTGRES_URL
const integration = databaseUrl ? test : test.skip
async function fixture() {
  const url = new URL(databaseUrl)
  assert.match(decodeURIComponent(url.pathname.slice(1)), /^kokoro_bff_dispatch_evo_[0-9a-f]{32}$/u)
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
  assert.deepEqual(url.searchParams.getAll("schema"), ["kokoro_bff"])
  const pool = new Pool({ connectionString: databaseUrl, options: "-c search_path=kokoro_bff -c timezone=UTC", max: 3 })
  try {
    assert.equal((await pool.query("SELECT current_database() AS name")).rows[0].name, decodeURIComponent(url.pathname.slice(1)))
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM kokoro_bff.bff_agent_dispatch_outbox")).rows[0].count, 0)
    const definitions = dispatchExecutionDefinitions(canonical)
    const evolve = (mode = "apply", extra = {}) => evolveDispatchExecutionSchema({ databaseUrl, mode, ...extra })
    assert.equal((await evolve("check")).state, "current")
    const dropColumns = () =>
      pool.query("ALTER TABLE kokoro_bff.bff_agent_dispatch_outbox DROP COLUMN execution_project_ref,DROP COLUMN execution_context_retired_at")
    const rows = async () =>
      (
        await pool.query(`SELECT to_jsonb(d)-'execution_project_ref'-'execution_context_retired_at' AS value,xmin::text AS xmin
      FROM kokoro_bff.bff_agent_dispatch_outbox d ORDER BY outbox_id COLLATE "C"`)
      ).rows
    const catalog = async () =>
      (
        await pool.query(`SELECT kind,name,value FROM (
      SELECT 'column' AS kind,a.attname AS name,jsonb_build_array(format_type(a.atttypid,a.atttypmod),a.attnotnull,pg_get_expr(d.adbin,d.adrelid)) AS value
      FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE a.attrelid='kokoro_bff.bff_agent_dispatch_outbox'::regclass AND a.attnum>0 AND NOT a.attisdropped
      UNION ALL SELECT 'constraint',conname,to_jsonb(pg_get_constraintdef(oid)) FROM pg_constraint WHERE conrelid='kokoro_bff.bff_agent_dispatch_outbox'::regclass
      UNION ALL SELECT 'index',indexname,to_jsonb(indexdef) FROM pg_indexes WHERE schemaname='kokoro_bff' AND tablename='bff_agent_dispatch_outbox'
      ) metadata ORDER BY kind,name COLLATE "C"`)
      ).rows
    return {
      pool,
      definitions,
      evolve,
      dropColumns,
      rows,
      catalog,
      close: async () => {
        try {
          await pool.query("DELETE FROM kokoro_bff.bff_agent_dispatch_outbox WHERE tenant_id='dispatch_execution_fixture'")
          await pool.query(
            "ALTER TABLE kokoro_bff.bff_agent_dispatch_outbox DROP COLUMN IF EXISTS execution_project_ref,DROP COLUMN IF EXISTS execution_context_retired_at",
          )
          assert.equal((await evolve()).state, "updated")
        } finally {
          await pool.end()
        }
      },
    }
  } catch (error) {
    await pool.end()
    throw error
  }
}

integration("PG: dispatch expands exact old shape without row/xmin changes, rejects partial and drift, and bounds locks/cancellation", async () => {
  const f = await fixture()
  const sentinelSchema = "dispatch_execution_other_fixture"
  try {
    assert.equal((await f.pool.query("SELECT to_regnamespace($1) IS NULL AS absent", [sentinelSchema])).rows[0].absent, true)
    await f.pool.query("CREATE SCHEMA dispatch_execution_other_fixture;CREATE TABLE dispatch_execution_other_fixture.sentinel(value TEXT)")
    await f.pool.query("INSERT INTO dispatch_execution_other_fixture.sentinel(value) VALUES ('kept')")
    const sentinel = async () => (await f.pool.query("SELECT value,xmin::text AS xmin FROM dispatch_execution_other_fixture.sentinel")).rows
    const sentinelBefore = await sentinel()
    await f.dropColumns()
    await f.pool.query(
      `INSERT INTO kokoro_bff.bff_agent_dispatch_outbox
      (outbox_id,tenant_id,conversation_id,conversation_dispatch_seq,subject_id,actor_id,request_id,idempotency_key,request_digest,
       run_id,user_message_id,assistant_message_id,identity_assertion_ref,payload)
      VALUES ('dispatch_old','dispatch_execution_fixture','conversation',1,'subject','actor','request','key',$1,'run','user','assistant','identity',$2)`,
      ["a".repeat(64), { launch: { trace_only: "not execution authority" } }],
    )
    const before = await f.rows()
    assert.equal((await f.evolve("check")).state, "update_required")
    assert.deepEqual(await f.rows(), before)
    assert.equal((await f.evolve()).state, "updated")
    assert.equal((await f.evolve()).state, "current")
    assert.equal((await f.evolve("check")).state, "current")
    assert.deepEqual(await f.rows(), before)
    assert.deepEqual((await f.pool.query("SELECT execution_project_ref,execution_context_retired_at FROM kokoro_bff.bff_agent_dispatch_outbox")).rows, [
      { execution_project_ref: null, execution_context_retired_at: null },
    ])
    const drift = async (apply, undo) => {
      await f.pool.query(apply)
      try {
        const catalog = await f.catalog()
        const retained = await f.rows()
        assert.equal((await f.evolve("check")).state, "invalid_schema")
        assert.equal((await f.evolve()).state, "invalid_schema")
        assert.deepEqual(await f.catalog(), catalog)
        assert.deepEqual(await f.rows(), retained)
        assert.deepEqual(await sentinel(), sentinelBefore)
      } finally {
        await f.pool.query(undo)
      }
    }
    await drift("ALTER TABLE bff_agent_dispatch_outbox ADD COLUMN unexpected TEXT", "ALTER TABLE bff_agent_dispatch_outbox DROP COLUMN unexpected")
    await drift(
      "ALTER TABLE bff_agent_dispatch_outbox ALTER COLUMN execution_project_ref SET DEFAULT 'direct'",
      "ALTER TABLE bff_agent_dispatch_outbox ALTER COLUMN execution_project_ref DROP DEFAULT",
    )
    await drift(
      "ALTER TABLE bff_agent_dispatch_outbox ALTER COLUMN execution_context_retired_at TYPE TIMESTAMP(3)",
      "ALTER TABLE bff_agent_dispatch_outbox ALTER COLUMN execution_context_retired_at TYPE TIMESTAMPTZ(3)",
    )
    await drift(
      "ALTER TABLE bff_agent_dispatch_outbox ADD CONSTRAINT unexpected_check CHECK (attempt_count>=0)",
      "ALTER TABLE bff_agent_dispatch_outbox DROP CONSTRAINT unexpected_check",
    )
    await drift("ALTER TABLE bff_agent_dispatch_outbox ENABLE ROW LEVEL SECURITY", "ALTER TABLE bff_agent_dispatch_outbox DISABLE ROW LEVEL SECURITY")
    await drift("ALTER INDEX ix_bff_agent_dispatch_ready RENAME TO unexpected_index", "ALTER INDEX unexpected_index RENAME TO ix_bff_agent_dispatch_ready")
    await drift(
      "CREATE RULE unexpected_rule AS ON INSERT TO bff_agent_dispatch_outbox DO INSTEAD NOTHING",
      "DROP RULE unexpected_rule ON bff_agent_dispatch_outbox",
    )
    await drift(
      `CREATE FUNCTION kokoro_bff.dispatch_fixture_trigger() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RETURN NEW; END';
       CREATE TRIGGER unexpected_trigger BEFORE UPDATE ON bff_agent_dispatch_outbox FOR EACH ROW EXECUTE FUNCTION kokoro_bff.dispatch_fixture_trigger()`,
      "DROP TRIGGER unexpected_trigger ON bff_agent_dispatch_outbox;DROP FUNCTION kokoro_bff.dispatch_fixture_trigger()",
    )
    for (const column of f.definitions.columns) {
      await f.dropColumns()
      await f.pool.query(`ALTER TABLE bff_agent_dispatch_outbox ADD COLUMN ${column.declaration}`)
      const partial = await f.catalog()
      assert.equal((await f.evolve()).state, "invalid_schema")
      assert.deepEqual(await f.catalog(), partial)
      await f.pool.query(`ALTER TABLE bff_agent_dispatch_outbox DROP COLUMN ${column.name}`)
      assert.equal((await f.evolve()).state, "updated")
    }
    await f.dropColumns()
    const beforeWait = await f.rows()
    const blocker = await f.pool.connect()
    try {
      await blocker.query("BEGIN;LOCK TABLE kokoro_bff.bff_agent_dispatch_outbox IN ACCESS SHARE MODE")
      const timeout = await f.evolve("apply", { timeoutMs: 500 })
      assert.equal(timeout.state, "unavailable")
      assert.ok(timeout.duration_ms < 1500)
      const abort = new AbortController()
      const timer = setTimeout(() => abort.abort(), 60)
      try {
        assert.equal((await f.evolve("apply", { signal: abort.signal, timeoutMs: 1500 })).state, "unavailable")
      } finally {
        clearTimeout(timer)
      }
    } finally {
      await blocker.query("ROLLBACK")
      blocker.release()
    }
    assert.equal((await f.evolve("check")).state, "update_required")
    assert.deepEqual(await f.rows(), beforeWait)
    assert.deepEqual(await sentinel(), sentinelBefore)
  } finally {
    try {
      await f.pool.query("DROP TABLE IF EXISTS dispatch_execution_other_fixture.sentinel;DROP SCHEMA IF EXISTS dispatch_execution_other_fixture")
    } finally {
      await f.close()
    }
  }
})

integration("PG: dispatch lost COMMIT ACK is unknown and fresh check reconciles without retrying", async () => {
  const f = await fixture()
  let relay
  try {
    await f.dropColumns()
    relay = await commitAckRelay(databaseUrl)
    const pending = evolveDispatchExecutionSchema({ mode: "apply", databaseUrl: relay.url, timeoutMs: 2500 })
    await waitFor(() => relay.observed().commitSeen && relay.observed().blockedBytes > 0)
    const result = await pending
    assert.equal(result.state, "unknown")
    assert.equal(result.code, "commit_unknown")
    assert.ok(result.duration_ms < 3500)
    assert.equal((await f.evolve("check")).state, "current")
    await waitFor(() => relay.observed().sockets === 0)
    assert.equal(relay.observed().connections, 1)
    assert.equal(relay.observed().connectionOverflow, false)
  } finally {
    if (relay) await relay.close()
    await f.close()
  }
})
