import { readFile } from "node:fs/promises"

import { Pool } from "pg"

const url = process.env.KOKORO_BFF_POSTGRES_URL
if (!url) throw new Error("KOKORO_BFF_POSTGRES_URL is required")

const pool = new Pool({ connectionString: url })
try {
  await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
} finally {
  await pool.end()
}
