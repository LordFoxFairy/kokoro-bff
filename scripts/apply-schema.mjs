import { readFile } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"

import { Pool } from "pg"

const schemaUrl = new URL("../database/schema.sql", import.meta.url)
const OWNER_SCHEMA = "kokoro_bff"

export async function loadCanonicalSchema() {
  const schema = await readFile(schemaUrl, "utf8")
  if (schema.trim() === "") throw new Error("database/schema.sql must not be empty")
  return schema
}

export function assertEmptyOwnerSchema(objectNames) {
  if (objectNames.length === 0) return
  throw new Error(`db:apply-schema requires an empty kokoro_bff schema; found objects: ${objectNames.join(", ")}`)
}

export function assertBffSchemaUrl(databaseUrl) {
  const url = new URL(databaseUrl)
  const targets = url.searchParams.getAll("schema")
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    targets.length !== 1 || targets[0] !== OWNER_SCHEMA ||
    [...url.searchParams.keys()].some((key) => ["options", "search_path"].includes(key.toLowerCase())) ||
    url.hash !== ""
  ) throw new Error("KOKORO_BFF_POSTGRES_URL must target the kokoro_bff schema without connection options")
}

export async function applyCanonicalSchema(databaseUrl, schema) {
  assertBffSchemaUrl(databaseUrl)
  const pool = new Pool({ connectionString: databaseUrl, max: 1, options: `-c search_path=${OWNER_SCHEMA} -c timezone=UTC` })
  let client
  try {
    client = await pool.connect()
    await client.query("BEGIN")
    await client.query("SELECT pg_advisory_xact_lock(hashtext(current_database()), hashtext($1))", [OWNER_SCHEMA])
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${OWNER_SCHEMA}`)
    await client.query(`SET LOCAL search_path TO ${OWNER_SCHEMA}`)
    const target = await client.query("SELECT current_schema() AS name")
    if (target.rows[0]?.name !== OWNER_SCHEMA) throw new Error("BFF owner schema search_path is invalid")
    const objects = await client.query(
      `SELECT DISTINCT pg_describe_object(d.classid, d.objid, d.objsubid) AS name
       FROM pg_depend d
       JOIN pg_namespace n ON d.refclassid = 'pg_namespace'::regclass AND d.refobjid = n.oid
       WHERE n.nspname = $1
       ORDER BY name`,
      [OWNER_SCHEMA],
    )
    assertEmptyOwnerSchema(objects.rows.map((row) => String(row.name)))
    await client.query(schema)
    const installed = await client.query(
      `SELECT to_regclass('kokoro_bff.bff_project') IS NOT NULL AS project,
              to_regclass('kokoro_bff.bff_agui_event') IS NOT NULL AS agui,
              to_regclass('kokoro_bff.ix_bff_project_owner_list') IS NOT NULL AS project_index`,
    )
    if (!installed.rows[0]?.project || !installed.rows[0]?.agui || !installed.rows[0]?.project_index) {
      throw new Error("BFF canonical schema installation is incomplete")
    }
    await client.query("COMMIT")
  } catch (error) {
    await client?.query("ROLLBACK").catch(() => undefined)
    throw error
  } finally {
    client?.release()
    await pool.end()
  }
}

async function main() {
  const databaseUrl = process.env.KOKORO_BFF_POSTGRES_URL?.trim()
  if (!databaseUrl) throw new Error("KOKORO_BFF_POSTGRES_URL is required")
  await applyCanonicalSchema(databaseUrl, await loadCanonicalSchema())
  console.log("Applied database/schema.sql to an empty kokoro_bff schema")
}

const invokedPath = process.argv[1] === undefined ? null : pathToFileURL(path.resolve(process.argv[1])).href
if (invokedPath === import.meta.url) await main()
