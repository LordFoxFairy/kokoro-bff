import assert from "node:assert/strict"
import { commitAckRelay, relayEndpoints, waitFor } from "./fixtures/schema-evolution-relay.mjs"
import { test } from "node:test"
import { Pool } from "pg"
import { messageRegenerationDefinitions } from "../scripts/message-regeneration-schema-catalog.mjs"
import { evolveMessageRegenerationSchema } from "../scripts/evolve-message-regeneration-schema.mjs"
import { evolveMessageFinalAnswerSchema } from "../scripts/evolve-message-final-answer-schema.mjs"
import { evolveAgentFailureSchema } from "../scripts/evolve-agent-failure-schema.mjs"
import { loadCanonicalSchema } from "../scripts/apply-schema.mjs"
import { evolveMessagePartsSchema, messagePartsSchemaDefinitions } from "../scripts/evolve-message-parts-schema.mjs"

test("pure: extracts only the approved additive Message delta and rejects canonical table drift", async () => {
  const schema = await loadCanonicalSchema()
  const definitions = messagePartsSchemaDefinitions(schema)
  assert.deepEqual(
    definitions.columns.map(({ name }) => name),
    ["ordered_parts", "parts_format_version", "parts_public_sequence"],
  )
  assert.match(definitions.constraint, /^CONSTRAINT ck_bff_message_ordered_parts CHECK/u)
  assert.ok(!definitions.oldTable.includes("ordered_parts"))
  assert.ok(!definitions.oldTable.includes("parts_format_version"))
  assert.ok(!definitions.oldTable.includes("parts_public_sequence"))
  const regeneration = messageRegenerationDefinitions(schema)
  assert.equal(definitions.table, regeneration.prior)
  assert.deepEqual(definitions.currentTables, [regeneration.current, regeneration.currentWithFinal])
  assert.deepEqual(messagePartsSchemaDefinitions(schema.replace(regeneration.currentWithFinal, regeneration.prior)).currentTables, [])
  assert.deepEqual(messagePartsSchemaDefinitions(schema.replace(regeneration.currentWithFinal, regeneration.current)).currentTables, [regeneration.current])
  for (const changed of [
    schema.replace("ordered_parts JSONB,", "ordered_parts JSONB DEFAULT '[]',"),
    schema.replace("parts_format_version = 1", "parts_format_version >= 1"),
    schema.replace("  content TEXT NOT NULL,", "  content TEXT,"),
    schema.replace("origin TEXT NOT NULL DEFAULT 'normal'", "origin TEXT DEFAULT 'normal'"),
    schema.replace("parts_public_sequence>0", "parts_public_sequence>=0"),
    schema + "\n" + definitions.currentTables[1],
  ]) {
    assert.throws(() => messagePartsSchemaDefinitions(changed), /invalid_schema/u)
  }
})

test("pure: rejects malformed scope and modes with a sanitized closed result before any connection", async () => {
  for (const input of [
    {},
    {
      mode: "reset",
      databaseUrl: "postgres://127.0.0.1:1/x?schema=kokoro_bff",
    },
    {
      mode: "apply",
      databaseUrl: "postgres://127.0.0.1:1/postgres?schema=kokoro_bff",
    },
    { mode: "check", databaseUrl: "postgres://127.0.0.1:1/x?schema=public" },
    {
      mode: "apply",
      databaseUrl: "postgres://127.0.0.1:1/x?schema=kokoro_bff&options=-c%20search_path%3Dpublic",
    },
    {
      mode: "check",
      databaseUrl: "postgres://127.0.0.1:1/x?schema=kokoro_bff",
      timeoutMs: 20001,
    },
  ]) {
    const result = await evolveMessagePartsSchema(input)
    assert.equal(result.state, "invalid_request")
    assert.equal(result.code, "invalid_request")
    assert.deepEqual(Object.keys(result).sort(), ["cleanup", "code", "duration_ms", "state"])
  }
})

test("pure: an already canceled approved request retires before connecting", async () => {
  const abort = new AbortController()
  abort.abort()
  const result = await evolveMessagePartsSchema({
    mode: "apply",
    databaseUrl: "postgres://127.0.0.1:1/parts_canceled?schema=kokoro_bff",
    signal: abort.signal,
  })
  assert.equal(result.state, "unavailable")
  assert.ok(result.duration_ms < 500)
})

const databaseUrl = process.env.KOKORO_TEST_POSTGRES_URL
const integration = databaseUrl ? test : test.skip

async function fixture() {
  let url
  try {
    url = new URL(databaseUrl)
  } catch {
    throw new Error("fixture URL must be valid")
  }
  const database = decodeURIComponent(url.pathname.slice(1))
  assert.match(database, /^kokoro_bff_parts_[0-9a-f]{32}$/u, "Root must provide a dedicated disposable parts fixture database")
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname), "fixture and ACK relay are loopback-only")
  assert.deepEqual(url.searchParams.getAll("schema"), ["kokoro_bff"])
  const pool = new Pool({
    connectionString: databaseUrl,
    options: "-c search_path=kokoro_bff -c timezone=UTC",
    max: 3,
  })
  try {
    assert.equal((await pool.query("SELECT current_database() AS name")).rows[0].name, database)
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM kokoro_bff.bff_message")).rows[0].count, 0, "fixture must start with no Message rows")
    assert.equal((await pool.query("SELECT to_regnamespace('message_parts_other_fixture') IS NULL AS absent")).rows[0].absent, true)
    const canonical = await loadCanonicalSchema()
    const definitions = messagePartsSchemaDefinitions(canonical)
    // This file owns this exact disposable empty database. Rebuild only its empty
    // Message fixture, so historical tests continue to exercise the true parts parent.
    assert.equal((await evolveMessagePartsSchema({ databaseUrl, mode: "check" })).state, "current")
    await pool.query("DROP TABLE kokoro_bff.bff_message")
    await pool.query(definitions.table)
    const indexes = [...canonical.matchAll(/^CREATE (?:UNIQUE )?INDEX IF NOT EXISTS [^\n]+\n  ON bff_message\s+[\s\S]*?;/gmu)].map((match) => match[0])
    for (const index of indexes) await pool.query(index)
    await pool.query("CREATE SCHEMA message_parts_other_fixture; CREATE TABLE message_parts_other_fixture.sentinel (value TEXT NOT NULL)")
    await pool.query("INSERT INTO message_parts_other_fixture.sentinel(value) VALUES ('other schema remains intact')")
    const other = async () => (await pool.query("SELECT to_jsonb(s) AS value,xmin::text AS xmin FROM message_parts_other_fixture.sentinel s")).rows
    const otherBefore = await other()
    const rows = async () =>
      (
        await pool.query(`SELECT to_jsonb(m)-'ordered_parts'-'parts_format_version'-'parts_public_sequence' AS value,xmin::text AS xmin
      FROM kokoro_bff.bff_message m ORDER BY message_id COLLATE "C"`)
      ).rows
    const dropParts = () =>
      pool.query(`ALTER TABLE kokoro_bff.bff_message DROP CONSTRAINT IF EXISTS ck_bff_message_ordered_parts,
      DROP COLUMN IF EXISTS ordered_parts,DROP COLUMN IF EXISTS parts_format_version,DROP COLUMN IF EXISTS parts_public_sequence`)
    const evolve = (mode = "apply", extra = {}) => evolveMessagePartsSchema({ databaseUrl, mode, ...extra })
    const close = async () => {
      try {
        await pool.query("DELETE FROM kokoro_bff.bff_message WHERE tenant_id='message_parts_evolution_fixture'")
        await dropParts()
        assert.equal((await evolve()).state, "updated")
        assert.equal((await evolveMessageRegenerationSchema({ databaseUrl, mode: "apply" })).state, "updated")
        assert.equal((await evolveMessageFinalAnswerSchema({ databaseUrl, mode: "apply" })).state, "updated")
        for (const index of indexes) await pool.query(index)
        assert.deepEqual(await other(), otherBefore)
        await pool.query("DROP TABLE message_parts_other_fixture.sentinel; DROP SCHEMA message_parts_other_fixture")
      } finally {
        await pool.end()
      }
    }
    return {
      pool,
      definitions,
      rows,
      other,
      otherBefore,
      dropParts,
      evolve,
      close,
    }
  } catch (error) {
    await pool.end()
    throw error
  }
}

async function catalog(pool) {
  return {
    columns: (
      await pool.query(`SELECT attname,format_type(atttypid,atttypmod) AS type,attnotnull,attidentity,attgenerated,
      pg_get_expr(d.adbin,d.adrelid,false) AS default_expression FROM pg_attribute a
      LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE a.attrelid='kokoro_bff.bff_message'::regclass AND a.attnum>0 AND NOT a.attisdropped ORDER BY attname COLLATE "C"`)
    ).rows,
    constraints: (
      await pool.query(`SELECT conname,contype,convalidated,condeferrable,condeferred,pg_get_constraintdef(oid,false) AS definition
      FROM pg_constraint WHERE conrelid='kokoro_bff.bff_message'::regclass ORDER BY conname COLLATE "C"`)
    ).rows,
    indexes: (
      await pool.query("SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='kokoro_bff' AND tablename='bff_message' ORDER BY indexname COLLATE \"C\"")
    ).rows,
  }
}

integration("PG: additive Message parts preserves retained rows/xmin, accepts physical column reordering, and rejects drift without repair", async () => {
  const f = await fixture()
  const { pool } = f
  try {
    await f.dropParts()
    await pool.query(
      `INSERT INTO kokoro_bff.bff_message(message_id,tenant_id,conversation_id,run_id,role,content,status,message_seq)
      VALUES ('parts_user','message_parts_evolution_fixture','parts_conversation','parts_run','user',$1,'completed',1),
             ('parts_assistant','message_parts_evolution_fixture','parts_conversation','parts_run','assistant',$2,'completed',2)`,
      ["原文 🦊\nkept", "公开回答 kept"],
    )
    const before = await f.rows()
    const indexes = (await catalog(pool)).indexes
    assert.equal((await f.evolve("check")).state, "update_required")
    assert.deepEqual(await f.rows(), before)
    assert.equal((await f.evolve()).state, "updated")
    assert.equal((await f.evolve()).state, "current")
    assert.equal((await f.evolve("check")).state, "current")
    assert.deepEqual(await f.rows(), before)
    assert.deepEqual((await catalog(pool)).indexes, indexes)
    assert.deepEqual(
      (await pool.query('SELECT ordered_parts,parts_format_version,parts_public_sequence FROM kokoro_bff.bff_message ORDER BY message_id COLLATE "C"')).rows,
      [
        {
          ordered_parts: null,
          parts_format_version: null,
          parts_public_sequence: null,
        },
        {
          ordered_parts: null,
          parts_format_version: null,
          parts_public_sequence: null,
        },
      ],
    )
    assert.equal(
      (
        await pool.query(`SELECT (SELECT attnum FROM pg_attribute WHERE attrelid='kokoro_bff.bff_message'::regclass AND attname='ordered_parts') >
      (SELECT attnum FROM pg_attribute WHERE attrelid='kokoro_bff.bff_message'::regclass AND attname='updated_at') AS appended`)
      ).rows[0].appended,
      true,
    )
    await assert.rejects(pool.query("UPDATE kokoro_bff.bff_message SET ordered_parts='[]'::jsonb WHERE message_id='parts_assistant'"), { code: "23514" })
    await assert.rejects(
      pool.query("UPDATE kokoro_bff.bff_message SET ordered_parts='[]'::jsonb,parts_format_version=1,parts_public_sequence=0 WHERE message_id='parts_user'"),
      { code: "23514" },
    )
    assert.deepEqual(await f.rows(), before)

    const drift = async (apply, undo) => {
      await pool.query(apply)
      try {
        const prior = await catalog(pool)
        const rowPrior = await f.rows()
        assert.equal((await f.evolve()).state, "invalid_schema")
        assert.deepEqual(await catalog(pool), prior)
        assert.deepEqual(await f.rows(), rowPrior)
        assert.deepEqual(await f.other(), f.otherBefore)
      } finally {
        await pool.query(undo)
      }
    }
    await drift("ALTER TABLE kokoro_bff.bff_message ADD COLUMN unapproved TEXT", "ALTER TABLE kokoro_bff.bff_message DROP COLUMN unapproved")
    await drift(
      "ALTER TABLE kokoro_bff.bff_message ADD CONSTRAINT ck_unapproved CHECK (length(content)>=0)",
      "ALTER TABLE kokoro_bff.bff_message DROP CONSTRAINT ck_unapproved",
    )
    await drift("ALTER TABLE kokoro_bff.bff_message ALTER COLUMN content DROP NOT NULL", "ALTER TABLE kokoro_bff.bff_message ALTER COLUMN content SET NOT NULL")
    await drift(
      "ALTER TABLE kokoro_bff.bff_message ALTER COLUMN ordered_parts SET DEFAULT '[]'::jsonb",
      "ALTER TABLE kokoro_bff.bff_message ALTER COLUMN ordered_parts DROP DEFAULT",
    )
    await drift(
      "ALTER TABLE kokoro_bff.bff_message ALTER COLUMN parts_format_version TYPE INTEGER",
      "ALTER TABLE kokoro_bff.bff_message ALTER COLUMN parts_format_version TYPE SMALLINT",
    )
    await drift(
      `ALTER TABLE kokoro_bff.bff_message DROP CONSTRAINT ck_bff_message_ordered_parts, ADD ${f.definitions.constraint} NOT VALID`,
      `ALTER TABLE kokoro_bff.bff_message DROP CONSTRAINT ck_bff_message_ordered_parts, ADD ${f.definitions.constraint}`,
    )
    await drift(
      `ALTER TABLE kokoro_bff.bff_message DROP CONSTRAINT ck_bff_message_ordered_parts, ADD CONSTRAINT ck_bff_message_ordered_parts CHECK (ordered_parts IS NULL OR TRUE)`,
      `ALTER TABLE kokoro_bff.bff_message DROP CONSTRAINT ck_bff_message_ordered_parts, ADD ${f.definitions.constraint}`,
    )
    await drift(
      "ALTER TABLE kokoro_bff.bff_message RENAME CONSTRAINT ck_bff_message_ordered_parts TO unexpected_parts_check",
      "ALTER TABLE kokoro_bff.bff_message RENAME CONSTRAINT unexpected_parts_check TO ck_bff_message_ordered_parts",
    )
    await drift("ALTER TABLE kokoro_bff.bff_message ENABLE ROW LEVEL SECURITY", "ALTER TABLE kokoro_bff.bff_message DISABLE ROW LEVEL SECURITY")
    for (const columns of [[f.definitions.columns[0]], f.definitions.columns]) {
      await f.dropParts()
      await pool.query(`ALTER TABLE kokoro_bff.bff_message ${columns.map(({ declaration }) => `ADD COLUMN ${declaration}`).join(", ")}`)
      const partial = await catalog(pool)
      const partialRows = await f.rows()
      assert.equal((await f.evolve()).state, "invalid_schema")
      assert.deepEqual(await catalog(pool), partial)
      assert.deepEqual(await f.rows(), partialRows)
    }
    await f.dropParts()
    const blocker = await pool.connect()
    try {
      await blocker.query("BEGIN; LOCK TABLE kokoro_bff.bff_message IN ACCESS SHARE MODE")
      const unavailable = await f.evolve("apply", { timeoutMs: 500 })
      assert.equal(unavailable.state, "unavailable")
      assert.ok(unavailable.duration_ms < 1500)
    } finally {
      await blocker.query("ROLLBACK")
      blocker.release()
    }
    assert.equal((await f.evolve("check")).state, "update_required")
    const canceled = new AbortController()
    canceled.abort()
    assert.equal((await f.evolve("apply", { signal: canceled.signal })).state, "unavailable")
    assert.equal((await f.evolve("check")).state, "update_required")
    assert.deepEqual(await f.other(), f.otherBefore)
  } finally {
    await f.close()
  }
})

test("pure: a relay URL cannot redirect the captured PostgreSQL upstream", () => {
  const endpoints = relayEndpoints("postgres://localhost:5442/kokoro_bff_parts_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa?schema=kokoro_bff")
  endpoints.proxyUrl.hostname = "127.0.0.1"
  endpoints.proxyUrl.port = "25000"
  endpoints.proxyUrl.searchParams.set("sslmode", "disable")
  assert.equal(endpoints.upstreamHost, "localhost")
  assert.equal(endpoints.upstreamPort, 5442)
  assert.equal(endpoints.proxyUrl.port, "25000")
})

integration("PG: a real lost COMMIT acknowledgement remains unknown and only a fresh check reconciles", async () => {
  const f = await fixture()
  let relay
  try {
    await f.dropParts()
    relay = await commitAckRelay(databaseUrl)
    let settled = false
    let operation = { state: "pending", code: null }
    const pending = evolveMessagePartsSchema({
      databaseUrl: relay.url,
      mode: "apply",
      timeoutMs: 3000,
    }).then((value) => {
      settled = true
      operation = { state: value.state, code: value.code }
      return value
    })
    try {
      await waitFor(() => {
        const observed = relay.observed()
        assert.equal(observed.connectionOverflow, false, "fixture relay must accept at most one client connection")
        return observed.commitSeen && observed.blockedBytes > 0
      })
    } catch {
      throw new Error(`fixture observation failed; sanitized=${JSON.stringify({ operation, relay: relay.observed() })}`)
    }
    assert.equal(settled, false)
    assert.equal(
      (
        await f.pool.query(
          "SELECT count(*)::int AS count FROM pg_attribute WHERE attrelid='kokoro_bff.bff_message'::regclass AND attname=ANY($1::text[]) AND NOT attisdropped",
          [["ordered_parts", "parts_format_version", "parts_public_sequence"]],
        )
      ).rows[0].count,
      3,
    )
    const unknown = await pending
    assert.equal(unknown.state, "unknown")
    assert.equal(unknown.code, "commit_unknown")
    assert.ok(unknown.duration_ms < 4500)
    assert.equal(relay.observed().connections, 1, "no unknown reapply/reconnect")
    assert.equal((await f.evolve("check")).state, "current")
    assert.deepEqual(await f.other(), f.otherBefore)
  } finally {
    await relay?.close()
    await f.close()
  }
})

integration("PG: the approved parts to regeneration to final chain is current without rewriting retained facts", async () => {
  const f = await fixture()
  try {
    await f.dropParts()
    const failure = f.definitions.oldTable.match(/CONSTRAINT ck_bff_message_agent_failure CHECK \([\s\S]*?\n  \)/u)[0]
    await f.pool.query(`ALTER TABLE kokoro_bff.bff_message DROP CONSTRAINT ck_bff_message_agent_failure,
      ADD ${failure.replace(", 'model_settlement_pending'", "")}`)
    assert.equal((await f.evolve("check")).state, "invalid_schema", "agent-failure is an exact prerequisite, not a compatible arbitrary old CHECK")
    assert.equal((await evolveAgentFailureSchema({ databaseUrl, mode: "apply" })).state, "updated")
    await f.pool.query(`INSERT INTO kokoro_bff.bff_message(message_id,tenant_id,conversation_id,run_id,role,content,status,message_seq)
      VALUES ('chain_user','message_parts_evolution_fixture','chain_conversation','chain_run','user','kept 原文','completed',1)`)
    const before = (await f.pool.query("SELECT to_jsonb(m) AS value,xmin::text AS xmin FROM kokoro_bff.bff_message m")).rows
    assert.equal((await f.evolve("check")).state, "update_required")
    assert.equal((await f.evolve()).state, "updated")
    assert.equal((await evolveMessageRegenerationSchema({ databaseUrl, mode: "apply" })).state, "updated")
    assert.equal((await f.evolve("check")).state, "current")
    assert.equal((await f.evolve()).state, "current")
    assert.equal((await evolveMessageFinalAnswerSchema({ databaseUrl, mode: "apply" })).state, "updated")
    assert.equal((await f.evolve("check")).state, "current")
    assert.equal((await f.evolve()).state, "current")
    const after = (
      await f.pool.query(`SELECT to_jsonb(m)-'ordered_parts'-'parts_format_version'-'parts_public_sequence'-'origin'
      -'regenerated_from_message_id'-'regeneration_user_message_id'-'final_segment_id' AS value,xmin::text AS xmin FROM kokoro_bff.bff_message m`)
    ).rows
    assert.deepEqual(after, before)
    await f.pool.query("ALTER TABLE kokoro_bff.bff_message ADD COLUMN unknown_descendant TEXT")
    assert.equal((await f.evolve("check")).state, "invalid_schema")
    await f.pool.query("ALTER TABLE kokoro_bff.bff_message DROP COLUMN unknown_descendant")
  } finally {
    // Start cleanup from an exact approved parent; close restores the full canonical descendants.
    await f.pool.query("DELETE FROM kokoro_bff.bff_message WHERE tenant_id='message_parts_evolution_fixture'")
    await f.pool.query("DROP TABLE kokoro_bff.bff_message")
    await f.pool.query(f.definitions.table)
    await f.close()
  }
})
