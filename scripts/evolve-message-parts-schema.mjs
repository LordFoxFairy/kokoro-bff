import { createHash } from "node:crypto"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { performance } from "node:perf_hooks"
import { Client } from "pg"

import { assertBffSchemaUrl, loadCanonicalSchema } from "./apply-schema.mjs"

/** One named additive operation. No runtime pool, retries, migration ledger or caller DDL. */
export async function evolveMessagePartsSchema({ mode, databaseUrl, signal, timeoutMs = 20000 }) {
  const started = performance.now()
  const result = (state, code, cleanup = "complete") => ({
    state,
    code,
    cleanup,
    duration_ms: Math.ceil(performance.now() - started),
  })
  try {
    if (!["check", "apply"].includes(mode) || !Number.isInteger(timeoutMs) || timeoutMs < 500 || timeoutMs > 20000) throw new Error()
    assertBffSchemaUrl(databaseUrl)
    const database = decodeURIComponent(new URL(databaseUrl).pathname.slice(1))
    if (!database || ["postgres", "template0", "template1"].includes(database)) throw new Error()
  } catch {
    return result("invalid_request", "invalid_request")
  }
  const deadline = started + timeoutMs
  // Reserve finite time for socket retirement; every normal stage shares the remaining budget.
  const workDeadline = deadline - 250
  let client
  let transaction = false
  let commitSent = false
  let closed = false
  let broken = false
  let interrupt
  let outcome
  let rollbackFailed = false
  const destroy = () => {
    broken = true
    // pg 8.23 owns this exact connection. Hard retirement is needed when a peer withholds FIN/ACK.
    // Client.end alone may await that peer; no other pool/client/socket is touched.
    client?.connection?.stream?.destroy()
  }
  const onError = () => {
    destroy()
    interrupt?.()
  }
  const onEnd = () => {
    closed = true
    interrupt?.()
  }
  const remaining = () => {
    const value = Math.floor(workDeadline - performance.now())
    if (value <= 0 || signal?.aborted || broken) throw new Error("unavailable")
    return value
  }
  const within = async (start) => {
    const budget = remaining()
    let timer
    const abort = () => {
      destroy()
      interrupt?.()
    }
    const stopped = new Promise((_, reject) => {
      interrupt = () => reject(new Error("unavailable"))
      timer = setTimeout(abort, budget)
      signal?.addEventListener("abort", abort, { once: true })
    })
    try {
      return await Promise.race([
        Promise.resolve().then(() => {
          remaining()
          return start()
        }),
        stopped,
      ])
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener("abort", abort)
      interrupt = undefined
    }
  }
  const raw = (text, values) => within(() => client.query(text, values))
  const query = async (text, values) => {
    const budget = remaining()
    await raw("SELECT set_config('statement_timeout',$1,true),set_config('lock_timeout',$2,true)", [
      String(Math.min(5000, budget)),
      String(Math.min(2000, budget)),
    ])
    return raw(text, values)
  }
  try {
    const definitions = messagePartsSchemaDefinitions(await within(loadCanonicalSchema))
    client = new Client({
      connectionString: databaseUrl,
      connectionTimeoutMillis: Math.min(5000, remaining()),
      query_timeout: 0,
      options: "-c search_path=kokoro_bff -c timezone=UTC -c statement_timeout=5000 -c lock_timeout=2000 -c idle_in_transaction_session_timeout=5000",
      application_name: "kokoro-bff-message-parts-evolution",
    })
    client.on("error", onError)
    client.on("end", onEnd)
    await within(() => client.connect())
    const actual = await raw("SELECT current_database() AS name")
    if (actual.rows[0]?.name !== decodeURIComponent(new URL(databaseUrl).pathname.slice(1))) throw new Error("invalid_schema")
    await raw("BEGIN")
    transaction = true
    await query("SELECT pg_advisory_xact_lock(hashtext(current_database()),hashtext('kokoro_bff'))")
    await assertMessageRelation(query)
    await query(`LOCK TABLE kokoro_bff.bff_message IN ${mode === "apply" ? "ACCESS EXCLUSIVE" : "ACCESS SHARE"} MODE`)
    const expected = await expectedCatalog(query, definitions)
    const state = await inspectMessagePartsSchema(query, expected)
    if (mode === "check") {
      await raw("ROLLBACK")
      transaction = false
      outcome = result(state === "old" ? "update_required" : "current", "ok")
    } else {
      if (state === "old") {
        const additions = [...definitions.columns.map(({ declaration }) => `ADD COLUMN ${declaration}`), `ADD ${definitions.constraint}`]
        await query(`ALTER TABLE kokoro_bff.bff_message ${additions.join(", ")}`)
      }
      if ((await inspectMessagePartsSchema(query, expected)) !== "current") throw new Error("invalid_schema")
      // Check cancellation before dispatch; only an actually dispatched COMMIT is unknown.
      remaining()
      await within(() => {
        commitSent = true
        return client.query("COMMIT")
      })
      transaction = false
      outcome = result(state === "old" ? "updated" : "current", "ok")
    }
  } catch (error) {
    outcome = result(
      commitSent ? "unknown" : error?.message === "invalid_schema" ? "invalid_schema" : "unavailable",
      commitSent ? "commit_unknown" : error?.message === "invalid_schema" ? "invalid_schema" : "unavailable",
    )
    if (transaction && !commitSent && !broken) {
      try {
        await raw("ROLLBACK")
        transaction = false
      } catch {
        rollbackFailed = true
        destroy()
      }
    }
  } finally {
    if (client) {
      // A bounded terminal close is part of the operation, never an unawaited end promise.
      let ended
      const end = new Promise((resolve) => {
        ended = resolve
        if (closed) resolve()
        else client.once("end", resolve)
      })
      const budget = Math.max(1, Math.min(250, Math.floor(deadline - performance.now())))
      let forced = false
      const timer = setTimeout(
        () => {
          forced = true
          destroy()
        },
        Math.max(1, budget - 20),
      )
      try {
        void client.end().catch(destroy)
        let closeTimer
        const complete = await Promise.race([
          end.then(() => true),
          new Promise((resolve) => {
            closeTimer = setTimeout(() => resolve(false), budget)
          }),
        ])
        clearTimeout(closeTimer)
        if (!complete || forced) {
          destroy()
          if (commitSent) outcome = result("unknown", "commit_unknown", "failed")
          else if (["invalid_schema", "unavailable"].includes(outcome.state)) outcome = { ...outcome, cleanup: "failed" }
          else outcome = result("unavailable", "cleanup_failed", "failed")
        }
      } finally {
        clearTimeout(timer)
        client.removeListener("end", ended)
        // Keep the sanitized error listener until this retired connection's final close.
      }
    }
  }
  if (rollbackFailed && outcome.cleanup === "complete") outcome = { ...outcome, cleanup: "rollback_failed" }
  return { ...outcome, duration_ms: Math.ceil(performance.now() - started) }
}

const BASE_TABLE_SHA256 = "e286ddaaa9976a2718fca228239cc2d610e3b64f99c8c949b72bdf5cc88b82b4"
const TARGET_TABLE_SHA256 = "4649e21e9e9b3007eefe3c092fa965ebb8f60db7d17ef9d669167c59d816f2df"
const PARTS_COLUMNS = ["ordered_parts", "parts_format_version", "parts_public_sequence"]
const PARTS_CONSTRAINT = "ck_bff_message_ordered_parts"

/** This named operation accepts only its approved canonical delta, not caller DDL. */
export function messagePartsSchemaDefinitions(schema) {
  if (typeof schema !== "string") throw new Error("invalid_schema")
  const tables = [...schema.matchAll(/^CREATE TABLE IF NOT EXISTS bff_message \([\s\S]*?^\);/gmu)]
  if (tables.length !== 1) throw new Error("invalid_schema")
  const table = tables[0][0]
  if (createHash("sha256").update(table).digest("hex") !== TARGET_TABLE_SHA256) throw new Error("invalid_schema")
  const constraints = [...table.matchAll(/  CONSTRAINT ck_bff_message_ordered_parts CHECK \([\s\S]*?\n  \),\n/gu)]
  if (constraints.length !== 1) throw new Error("invalid_schema")
  const constraint = constraints[0][0].slice(2, -2)
  let oldTable = table.replace(constraints[0][0], "")
  const columns = PARTS_COLUMNS.map((name) => {
    const lines = table.split("\n").filter((line) => line.startsWith(`  ${name} `))
    if (lines.length !== 1 || !lines[0].endsWith(",")) throw new Error("invalid_schema")
    oldTable = oldTable.replace(`${lines[0]}\n`, "")
    return { name, declaration: lines[0].slice(2, -1) }
  })
  if (createHash("sha256").update(oldTable).digest("hex") !== BASE_TABLE_SHA256) throw new Error("invalid_schema")
  return { table, oldTable, columns, constraint }
}

async function readCatalog(query, relation) {
  const columns = (
    await query(
      `SELECT a.attname AS name,pg_catalog.format_type(a.atttypid,a.atttypmod) AS type,
              a.attnotnull AS not_null,a.attidentity AS identity,a.attgenerated AS generated,
              a.attislocal AS is_local,a.attinhcount AS inheritance_count,a.attstorage AS storage,a.attcompression AS compression,
              n.nspname AS collation_schema,c.collname AS collation,
              pg_catalog.pg_get_expr(d.adbin,d.adrelid,false) AS default_expression
         FROM pg_catalog.pg_attribute a
         LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
         LEFT JOIN pg_catalog.pg_collation c ON c.oid=a.attcollation
         LEFT JOIN pg_catalog.pg_namespace n ON n.oid=c.collnamespace
        WHERE a.attrelid=$1::regclass AND a.attnum>0 AND NOT a.attisdropped
        ORDER BY a.attname COLLATE "C"`,
      [relation],
    )
  ).rows
  const constraints = (
    await query(
      `SELECT conname AS name,contype AS type,convalidated AS validated,condeferrable AS deferrable,condeferred AS deferred,
              conislocal AS is_local,coninhcount AS inheritance_count,connoinherit AS no_inherit,
              pg_catalog.pg_get_constraintdef(oid,false) AS definition
         FROM pg_catalog.pg_constraint WHERE conrelid=$1::regclass ORDER BY conname COLLATE "C"`,
      [relation],
    )
  ).rows
  return { columns, constraints }
}

async function expectedCatalog(query, definitions) {
  const probe = definitions.table.replace("CREATE TABLE IF NOT EXISTS bff_message", "CREATE TEMP TABLE bff_message_parts_probe")
  await query(`${probe.slice(0, -1)} ON COMMIT DROP`)
  const catalog = await readCatalog(query, "pg_temp.bff_message_parts_probe")
  await query("DROP TABLE pg_temp.bff_message_parts_probe")
  catalog.constraints = catalog.constraints
    .map((constraint) => ({
      ...constraint,
      name: constraint.name.replace(/^bff_message_parts_probe_/u, "bff_message_"),
    }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  return catalog
}

async function assertMessageRelation(query) {
  const relation = (
    await query(`SELECT relkind,relpersistence,relispartition,relrowsecurity,relforcerowsecurity,
      EXISTS(SELECT 1 FROM pg_catalog.pg_inherits WHERE inhrelid=c.oid OR inhparent=c.oid) AS inherited
      FROM pg_catalog.pg_class c WHERE c.oid=to_regclass('kokoro_bff.bff_message')`)
  ).rows[0]
  if (
    !relation ||
    relation.relkind !== "r" ||
    relation.relpersistence !== "p" ||
    relation.relispartition ||
    relation.relrowsecurity ||
    relation.relforcerowsecurity ||
    relation.inherited
  )
    throw new Error("invalid_schema")
}

async function inspectMessagePartsSchema(query, expected) {
  await assertMessageRelation(query)
  const actual = await readCatalog(query, "kokoro_bff.bff_message")
  if (JSON.stringify(actual) === JSON.stringify(expected)) return "current"
  const old = {
    columns: expected.columns.filter(({ name }) => !PARTS_COLUMNS.includes(name)),
    constraints: expected.constraints.filter(({ name }) => name !== PARTS_CONSTRAINT),
  }
  if (JSON.stringify(actual) === JSON.stringify(old)) return "old"
  throw new Error("invalid_schema")
}

async function main() {
  const abort = new AbortController()
  const stop = () => abort.abort()
  process.once("SIGINT", stop)
  process.once("SIGTERM", stop)
  let result
  try {
    result = await evolveMessagePartsSchema({
      mode: process.argv.length === 3 ? process.argv[2] : null,
      databaseUrl: process.env.KOKORO_BFF_POSTGRES_URL,
      signal: abort.signal,
    })
  } finally {
    process.removeListener("SIGINT", stop)
    process.removeListener("SIGTERM", stop)
  }
  console.log(JSON.stringify({ operation: "message_parts_schema_evolution", ...result }))
  process.exitCode = ["updated", "current", "update_required"].includes(result.state)
    ? 0
    : result.state === "unknown"
      ? 4
      : result.state.startsWith("invalid_")
        ? 2
        : 3
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main()
