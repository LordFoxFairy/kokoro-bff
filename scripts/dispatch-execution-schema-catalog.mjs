import { createHash } from "node:crypto"

const COLUMNS = ["execution_project_ref", "execution_context_retired_at"]
const hash = (source) => createHash("sha256").update(source).digest("hex")

/** Only the approved canonical outbox delta; no caller DDL or history inference. */
export function dispatchExecutionDefinitions(schema) {
  if (typeof schema !== "string") throw Error("invalid_schema")
  const tables = [...schema.matchAll(/^CREATE TABLE IF NOT EXISTS bff_agent_dispatch_outbox \([\s\S]*?^\);/gmu)]
  if (tables.length !== 1 || hash(tables[0][0]) !== "91c462e8ddced91516b9ad3dfa2f54d1628240fbaa6d507994c84795ffc70ed5") throw Error("invalid_schema")
  const table = tables[0][0]
  let oldTable = table
  const columns = COLUMNS.map((name) => {
    const lines = table.split("\n").filter((line) => line.startsWith(`  ${name} `))
    if (lines.length !== 1 || !lines[0].endsWith(",")) throw Error("invalid_schema")
    oldTable = oldTable.replace(`${lines[0]}\n`, "")
    return { name, declaration: lines[0].slice(2, -1) }
  })
  if (hash(oldTable) !== "3e6e90bcf7a11a214842854554bc1df6644fa81b1abe466de77ddff3fa78cb5e") throw Error("invalid_schema")
  const indexes = [...schema.matchAll(/^CREATE (?:UNIQUE )?INDEX IF NOT EXISTS [^\n]+\n  ON bff_agent_dispatch_outbox\s+[\s\S]*?;/gmu)].map((match) => match[0])
  if (hash(JSON.stringify(indexes)) !== "3a687169beab51bfe8c76554a0f2772b2cd27416b2a0036d9c3e5ee0f520d70c") throw Error("invalid_schema")
  return { table, oldTable, columns, indexes }
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
  const indexes = (
    await query(
      `SELECT ci.relname AS name,i.indisvalid AS valid,i.indisready AS ready,pg_get_indexdef(i.indexrelid) AS definition
    FROM pg_index i JOIN pg_class ci ON ci.oid=i.indexrelid WHERE i.indrelid=$1::regclass ORDER BY ci.relname COLLATE "C"`,
      [relation],
    )
  ).rows
  const triggers = (
    await query(
      'SELECT tgname AS name, pg_get_triggerdef(oid) AS definition FROM pg_trigger WHERE tgrelid=$1::regclass AND NOT tgisinternal ORDER BY tgname COLLATE "C"',
      [relation],
    )
  ).rows
  const rules = (
    await query('SELECT rulename AS name,pg_get_ruledef(oid) AS definition FROM pg_rewrite WHERE ev_class=$1::regclass ORDER BY rulename COLLATE "C"', [
      relation,
    ])
  ).rows
  return { columns, constraints, indexes, triggers, rules }
}

export async function expectedDispatchExecutionCatalog(query, definitions) {
  const name = "bff_dispatch_execution_probe"
  const probe = definitions.table.replace("CREATE TABLE IF NOT EXISTS bff_agent_dispatch_outbox", `CREATE TEMP TABLE ${name}`)
  await query(`${probe.slice(0, -1)} ON COMMIT DROP`)
  for (const index of definitions.indexes) await query(index.replace(/ON bff_agent_dispatch_outbox\s/u, `ON pg_temp.${name} `))
  const catalog = await readCatalog(query, `pg_temp.${name}`)
  await query(`DROP TABLE pg_temp.${name}`)
  catalog.constraints = catalog.constraints
    .map((constraint) => ({
      ...constraint,
      name: constraint.name.replace(/^bff_dispatch_execution_probe_/u, "bff_agent_dispatch_outbox_"),
    }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  catalog.indexes = catalog.indexes
    .map((index) => ({
      ...index,
      name: index.name.replace(/^bff_dispatch_execution_probe_/u, "bff_agent_dispatch_outbox_"),
      definition: index.definition.replace(/ON pg_temp(?:_[0-9]+)?\.bff_dispatch_execution_probe\s/u, "ON kokoro_bff.bff_agent_dispatch_outbox "),
    }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  return catalog
}

export async function assertDispatchExecutionRelation(query) {
  const relation = (
    await query(`SELECT relkind,relpersistence,relispartition,relrowsecurity,relforcerowsecurity,reloptions,reloftype,
    EXISTS(SELECT 1 FROM pg_catalog.pg_inherits WHERE inhrelid=c.oid OR inhparent=c.oid) AS inherited
    FROM pg_catalog.pg_class c WHERE c.oid=to_regclass('kokoro_bff.bff_agent_dispatch_outbox')`)
  ).rows[0]
  if (
    !relation ||
    relation.relkind !== "r" ||
    relation.relpersistence !== "p" ||
    relation.relispartition ||
    relation.relrowsecurity ||
    relation.relforcerowsecurity ||
    relation.reloptions !== null ||
    relation.reloftype !== 0 ||
    relation.inherited
  )
    throw Error("invalid_schema")
}

export async function inspectDispatchExecutionCatalog(query, expected) {
  await assertDispatchExecutionRelation(query)
  const actual = await readCatalog(query, "kokoro_bff.bff_agent_dispatch_outbox")
  if (JSON.stringify(actual) === JSON.stringify(expected)) return "current"
  const old = { ...expected, columns: expected.columns.filter(({ name }) => !COLUMNS.includes(name)) }
  if (JSON.stringify(actual) === JSON.stringify(old)) return "missing"
  throw Error("invalid_schema")
}
