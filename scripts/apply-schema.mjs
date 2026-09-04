import { readFile } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"

import { Pool } from "pg"

const schemaUrl = new URL("../database/schema.sql", import.meta.url)

export async function loadCanonicalSchema() {
  const schema = await readFile(schemaUrl, "utf8")
  if (schema.trim() === "") throw new Error("database/schema.sql must not be empty")
  return schema
}

export function assertBlankDatabaseTables(tableNames) {
  if (tableNames.length === 0) return
  throw new Error(`db:apply-schema requires a blank database; found tables: ${tableNames.join(", ")}`)
}

async function main() {
  const databaseUrl = process.env.KOKORO_BFF_POSTGRES_URL?.trim()
  if (!databaseUrl) throw new Error("KOKORO_BFF_POSTGRES_URL is required")

  const schema = await loadCanonicalSchema()
  const pool = new Pool({ connectionString: databaseUrl, max: 1 })
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    const tables = await client.query(
      `SELECT tablename
       FROM pg_tables
       WHERE schemaname = 'public'
       ORDER BY tablename ASC`,
    )
    assertBlankDatabaseTables(tables.rows.map((row) => String(row.tablename)))
    await client.query(schema)
    await client.query("COMMIT")
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined)
    throw error
  } finally {
    client.release()
    await pool.end()
  }
  console.log("Applied database/schema.sql to a blank PostgreSQL database")
}

const invokedPath = process.argv[1] === undefined ? null : pathToFileURL(path.resolve(process.argv[1])).href
if (invokedPath === import.meta.url) await main()
