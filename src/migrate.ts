import { readFile } from "node:fs/promises"

import { Pool } from "pg"

const url = process.env.KOKORO_BFF_POSTGRES_URL
if (!url) throw new Error("KOKORO_BFF_POSTGRES_URL is required")

const pool = new Pool({ connectionString: url })
try {
  await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
  // Upgrade installations created before the scheduled-task owner became a
  // first-class fact. Existing rows stay replayable under an explicit
  // sentinel; newly created rows always receive the authenticated owner id.
  await pool.query("ALTER TABLE bff_scheduled_task ADD COLUMN IF NOT EXISTS owner_id TEXT")
  await pool.query("UPDATE bff_scheduled_task SET owner_id = 'unknown' WHERE owner_id IS NULL")
  await pool.query("ALTER TABLE bff_scheduled_task ALTER COLUMN owner_id SET DEFAULT 'unknown'")
  await pool.query("ALTER TABLE bff_scheduled_task ALTER COLUMN owner_id SET NOT NULL")
} finally {
  await pool.end()
}
