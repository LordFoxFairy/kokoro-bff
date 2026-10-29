import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { test } from "node:test"
import pg from "pg"
import { applyCanonicalSchema } from "../scripts/apply-schema.mjs"
import { messageRegenerationDefinitions } from "../scripts/message-regeneration-schema-catalog.mjs"
import { evolveMessageRegenerationSchema } from "../scripts/evolve-message-regeneration-schema.mjs"
import { messageFinalAnswerDefinitions } from "../scripts/message-final-answer-schema.mjs"
import { evolveMessageFinalAnswerSchema as evolve } from "../scripts/evolve-message-final-answer-schema.mjs"

const url = process.env.KOKORO_TEST_POSTGRES_URL
const integration = url ? test : test.skip
integration("final answer fresh schema and named additive evolution preserve original rows and reject drift", { timeout: 30000 }, async () => {
  assert.match(new URL(url).pathname, /^\/kokoro_bff_final_[0-9a-f]{32}$/u)
  const pool = new pg.Pool({ connectionString: url, max: 1, options: "-c search_path=kokoro_bff -c timezone=UTC" })
  try {
    assert.equal((await pool.query("SELECT to_regclass('kokoro_bff.bff_message') AS installed")).rows[0].installed, null)
    const schema = await readFile(new URL("../database/schema.sql", import.meta.url), "utf8")
    await applyCanonicalSchema(url, schema)
    assert.equal((await evolve({ mode: "check", databaseUrl: url })).state, "current")
    // Only this named, initially empty fixture database is reset between fresh and prior-schema cases.
    await pool.query("DROP SCHEMA kokoro_bff CASCADE")
    await pool.query("CREATE SCHEMA kokoro_bff")
    const defs = messageFinalAnswerDefinitions(schema)
    await pool.query(schema.replace(defs.current, () => defs.prior))
    await pool.query(
      "INSERT INTO bff_message(message_id,tenant_id,conversation_id,role,content,status,message_seq) VALUES('old','tenant','session','assistant','Old answer','completed',1)",
    )
    const original = (await pool.query("SELECT to_jsonb(m) AS data,xmin::text AS xmin FROM bff_message m")).rows
    assert.equal((await evolve({ mode: "check", databaseUrl: url })).state, "update_required")
    assert.equal((await evolve({ mode: "apply", databaseUrl: url })).state, "updated")
    assert.equal((await evolve({ mode: "apply", databaseUrl: url })).state, "current")
    assert.deepEqual((await pool.query("SELECT to_jsonb(m)-'final_segment_id' AS data,xmin::text AS xmin FROM bff_message m")).rows, original)
    await assert.rejects(pool.query("UPDATE bff_message SET final_segment_id='invented' WHERE message_id='old'"), /ck_bff_message_final_answer/)
    await pool.query("ALTER TABLE bff_message ADD COLUMN unexpected TEXT")
    assert.equal((await evolve({ mode: "check", databaseUrl: url })).state, "invalid_schema")
    await pool.query("ALTER TABLE bff_message DROP COLUMN unexpected")
    assert.equal((await evolve({ mode: "check", databaseUrl: url })).state, "current")
    assert.equal((await evolveMessageRegenerationSchema({ mode: "check", databaseUrl: url })).state, "current")
    // The prior named operation must remain usable before final-answer activation.
    await pool.query("DROP SCHEMA kokoro_bff CASCADE")
    await pool.query("CREATE SCHEMA kokoro_bff")
    const regen = messageRegenerationDefinitions(schema)
    await pool.query(schema.replace(defs.current, () => regen.prior))
    assert.equal((await evolveMessageRegenerationSchema({ mode: "check", databaseUrl: url })).state, "update_required")
    assert.equal((await evolveMessageRegenerationSchema({ mode: "apply", databaseUrl: url })).state, "updated")
    assert.equal((await evolve({ mode: "apply", databaseUrl: url })).state, "updated")
    assert.equal((await evolveMessageRegenerationSchema({ mode: "check", databaseUrl: url })).state, "current")
  } finally {
    await pool.end()
  }
})
