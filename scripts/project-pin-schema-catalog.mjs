import { createHash } from "node:crypto"
export function projectPinDefinitions(schema) {
  if (typeof schema !== "string") throw Error("invalid_schema")
  const blocks = [...schema.matchAll(/^-- PROJECT-PIN-SQL-BEGIN\n[\s\S]*?^-- PROJECT-PIN-SQL-END\n/gmu)]
  if (blocks.length !== 1 || createHash("sha256").update(blocks[0][0]).digest("hex") !== "3219715f8e399af28331f1aaa3a721c24bd8450a0e5da0f53eb8fdb575ded83d")
    throw Error("invalid_schema")
  return blocks[0][0]
}
async function catalog(query, relation) {
  const columns = (
    await query(
      `SELECT a.attname AS name,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull AS not_null,
    a.attidentity AS identity,a.attgenerated AS generated,pg_get_expr(d.adbin,d.adrelid) AS default_expression,
    n.nspname AS collation_schema,c.collname AS collation
    FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    LEFT JOIN pg_collation c ON c.oid=a.attcollation LEFT JOIN pg_namespace n ON n.oid=c.collnamespace
    WHERE a.attrelid=$1::regclass AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attname COLLATE "C"`,
      [relation],
    )
  ).rows
  const constraints = (
    await query(
      `SELECT contype AS type,convalidated AS validated,condeferrable AS deferrable,condeferred AS deferred,
    pg_get_constraintdef(oid,false) AS definition FROM pg_constraint WHERE conrelid=$1::regclass ORDER BY contype,pg_get_constraintdef(oid,false) COLLATE "C"`,
      [relation],
    )
  ).rows
  const indexes = (
    await query(
      `SELECT CASE WHEN i.indisprimary THEN 'PRIMARY' ELSE c.relname END AS name,i.indisprimary AS primary,i.indisunique AS unique,
    am.amname AS method,i.indisvalid AS valid,i.indisready AS ready,i.indnkeyatts AS keys_count,i.indnatts AS attributes_count,i.indoption::text AS options,
    ARRAY(SELECT pg_get_indexdef(i.indexrelid,k,false) FROM generate_series(1,i.indnkeyatts) k ORDER BY k) AS keys,
    pg_get_expr(i.indpred,i.indrelid) AS predicate FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_am am ON am.oid=c.relam
    WHERE i.indrelid=$1::regclass ORDER BY CASE WHEN i.indisprimary THEN 'PRIMARY' ELSE c.relname END COLLATE "C"`,
      [relation],
    )
  ).rows
  const guards = (
    await query(
      `SELECT c.relkind,c.relpersistence,c.relrowsecurity,c.relforcerowsecurity,
    EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal) AS triggers,
    EXISTS(SELECT 1 FROM pg_inherits i WHERE i.inhrelid=c.oid OR i.inhparent=c.oid) AS inheritance
    FROM pg_class c WHERE c.oid=$1::regclass`,
      [relation],
    )
  ).rows[0]
  return { columns, constraints, indexes, guards: { ...guards, relpersistence: relation.startsWith("pg_temp.") ? "p" : guards.relpersistence } }
}
export async function expectedProjectPinCatalog(query, definitions) {
  const temp = definitions
    .replace("CREATE TABLE IF NOT EXISTS bff_project_pin", "CREATE TEMP TABLE bff_project_pin_expected")
    .replace("\n);", "\n) ON COMMIT DROP;")
    .replaceAll("ON bff_project_pin (", "ON bff_project_pin_expected (")
  await query(temp)
  return catalog(query, "pg_temp.bff_project_pin_expected")
}
export async function inspectProjectPinCatalog(query, expected) {
  const found = (await query("SELECT to_regclass('kokoro_bff.bff_project_pin') AS relation")).rows[0]?.relation
  if (!found) return "missing"
  const actual = await catalog(query, "kokoro_bff.bff_project_pin")
  if (actual.guards.relkind !== "r" || actual.guards.triggers || actual.guards.inheritance || JSON.stringify(actual) !== JSON.stringify(expected))
    throw Error("invalid_schema")
  return "current"
}
