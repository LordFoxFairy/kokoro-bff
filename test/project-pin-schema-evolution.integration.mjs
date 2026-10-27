import assert from "node:assert/strict"
import { test } from "node:test"
import pg from "pg"
import { PostgresBffDatabase } from "../src/infrastructure/postgres/client.ts"
import { evolveProjectPinSchema as evolve } from "../scripts/evolve-project-pin-schema.mjs"
const databaseUrl = process.env.KOKORO_TEST_POSTGRES_URL
const integration = databaseUrl ? test : test.skip
integration("real PG exact additive pin installation rejects drift and preserves old Project rows", async () => {
  assert.match(new URL(databaseUrl).pathname, /^\/kokoro_bff_project_pin_[0-9a-f]{32}$/u)
  const pool = new pg.Pool({ connectionString: databaseUrl, options: "-c search_path=kokoro_bff -c timezone=UTC", max: 1 })
  const run = (mode = "check") => evolve({ mode, databaseUrl })
  try {
    const before = (await pool.query("SELECT project_id,to_jsonb(p) AS value,xmin::text AS xmin FROM bff_project p ORDER BY project_id")).rows
    await pool.query("DROP TABLE bff_project_pin")
    const readiness = { pool, connectRedis: async () => undefined, redis: { ping: async () => "PONG" } }
    await assert.rejects(() => PostgresBffDatabase.prototype.ready.call(readiness), /incomplete/)
    assert.equal((await run()).state, "update_required")
    assert.equal((await run("apply")).state, "updated")
    await PostgresBffDatabase.prototype.ready.call(readiness)
    assert.equal((await run("apply")).state, "current")
    assert.deepEqual((await pool.query("SELECT project_id,to_jsonb(p) AS value,xmin::text AS xmin FROM bff_project p ORDER BY project_id")).rows, before)
    await pool.query("ALTER TABLE bff_project_pin ADD COLUMN unwanted TEXT")
    assert.equal((await run()).state, "invalid_schema")
    await pool.query("ALTER TABLE bff_project_pin DROP COLUMN unwanted")
    assert.equal((await run()).state, "current")
    await pool.query("DROP INDEX ix_bff_project_pin_parent_cleanup")
    await pool.query("CREATE INDEX ix_bff_project_pin_parent_cleanup ON bff_project_pin USING brin (tenant_id,project_id)")
    assert.equal((await run()).state, "invalid_schema", "same-name same-key BRIN is not the canonical btree index")
    await pool.query("DROP INDEX ix_bff_project_pin_parent_cleanup")
    await pool.query("CREATE INDEX ix_bff_project_pin_parent_cleanup ON bff_project_pin (tenant_id,project_id)")
    assert.equal((await run()).state, "current")
    // The old source's required tables and Project columns remain unchanged.
    assert.equal(
      (await pool.query("SELECT to_regclass('bff_project') IS NOT NULL AND to_regclass('bff_conversation') IS NOT NULL AS old_ready")).rows[0].old_ready,
      true,
    )
  } finally {
    await pool.end()
  }
})
