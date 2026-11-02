import { restoreFinalAnswerSchema } from "../scripts/message-final-answer-schema.mjs"
import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { test } from "node:test"
import pg from "pg"
import { messageRegenerationDefinitions } from "../scripts/message-regeneration-schema-catalog.mjs"
import { messageFeedbackDefinitions } from "../scripts/message-feedback-schema-catalog.mjs"
import { evolveMessageFeedbackSchema } from "../scripts/evolve-message-feedback-schema.mjs"
import { evolveMessageRegenerationSchema as evolve } from "../scripts/evolve-message-regeneration-schema.mjs"
const url = process.env.KOKORO_TEST_POSTGRES_URL
const integration = url ? test : test.skip
integration("real PG additive Message regeneration evolution preserves old user and assistant row identities/xmin", { timeout: 30000 }, async () => {
  assert.match(new URL(url).pathname, /^\/kokoro_bff_regen_evo_[0-9a-f]{32}$/u)
  const pool = new pg.Pool({ connectionString: url, options: "-c search_path=kokoro_bff -c timezone=UTC", max: 2 })
  try {
    assert.equal((await pool.query("SELECT to_regclass('kokoro_bff.bff_message') AS relation")).rows[0].relation, null)
    const canonical = restoreFinalAnswerSchema(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8")),
      defs = messageRegenerationDefinitions(canonical)
    const prior = canonical.replace(defs.current, defs.prior).replace(messageFeedbackDefinitions(canonical) + "\n", "")
    assert.equal(createHash("sha256").update(prior).digest("hex"), "82b67bc5f8bb18deaa78821c9c4f59962f3d8ca5c986120544b84f9e9c8d13d0")
    await pool.query("CREATE SCHEMA kokoro_bff")
    await pool.query(prior)
    const tenant = "evo_" + randomUUID()
    await pool.query("INSERT INTO bff_conversation(conversation_id,tenant_id,owner_id,title) VALUES('evo-session',$1,'owner','old')", [tenant])
    await pool.query(
      "INSERT INTO bff_message(message_id,tenant_id,conversation_id,role,content,status,message_seq) VALUES('old-user',$1,'evo-session','user','question','completed',1),('old-answer',$1,'evo-session','assistant','answer','completed',2)",
      [tenant],
    )
    const original = (await pool.query("SELECT to_jsonb(m) AS row,xmin::text AS xmin FROM bff_message m ORDER BY message_seq")).rows
    assert.equal((await evolve({ mode: "check", databaseUrl: url })).state, "update_required")
    assert.equal((await evolve({ mode: "apply", databaseUrl: url })).state, "updated")
    assert.equal((await evolve({ mode: "apply", databaseUrl: url })).state, "current")
    assert.equal((await evolveMessageFeedbackSchema({ mode: "apply", databaseUrl: url })).state, "updated")
    const after = (
      await pool.query(
        "SELECT to_jsonb(m)-'origin'-'regenerated_from_message_id'-'regeneration_user_message_id' AS row,xmin::text AS xmin FROM bff_message m ORDER BY message_seq",
      )
    ).rows
    assert.deepEqual(after, original)
    await pool.query("ALTER TABLE bff_message ADD COLUMN unexpected TEXT")
    assert.equal((await evolve({ mode: "check", databaseUrl: url })).state, "invalid_schema")
    await pool.query("ALTER TABLE bff_message DROP COLUMN unexpected")
    assert.equal((await evolve({ mode: "check", databaseUrl: url })).state, "current")
    await assert.rejects(pool.query("UPDATE bff_message SET origin='regeneration_input' WHERE message_id='old-user'"), /regeneration/)
  } finally {
    await pool.end()
  }
})
