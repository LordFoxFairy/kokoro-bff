import { withoutFinalAnswerColumn } from "./message-final-answer-schema.mjs"
import { createHash } from "node:crypto"
const hash = (value) => createHash("sha256").update(value).digest("hex")
export function messageRegenerationDefinitions(schema) {
  const published = schema.match(/^CREATE TABLE IF NOT EXISTS bff_message \([\s\S]*?^\);/mu)?.[0]
  const table = published && withoutFinalAnswerColumn(published)
  if (!table || hash(table) !== "b798b18ac37cbafdfb18538927c51073ac8c7d4ec338e0a752c19be6c1c437ad") throw Error("invalid_schema")
  const columns = table.match(/^  -- MESSAGE-REGENERATION-COLUMNS-BEGIN\n([\s\S]*?)^  -- MESSAGE-REGENERATION-COLUMNS-END\n/mu)
  const constraint = table.match(/^  -- MESSAGE-REGENERATION-CONSTRAINT-BEGIN\n([\s\S]*?)^  -- MESSAGE-REGENERATION-CONSTRAINT-END\n/mu)
  if (!columns || !constraint) throw Error("invalid_schema")
  const prior = table.replace(columns[0], "").replace(constraint[0], "")
  if (hash(prior) !== "4649e21e9e9b3007eefe3c092fa965ebb8f60db7d17ef9d669167c59d816f2df") throw Error("invalid_schema")
  const additions = columns[1]
    .trim()
    .split("\n")
    .map((line) => line.trim().replace(/,$/u, ""))
  if (additions.length !== 3) throw Error("invalid_schema")
  return {
    current: table,
    prior,
    ...(published === table ? {} : { currentWithFinal: published }),
    alter: `ALTER TABLE kokoro_bff.bff_message ${additions.map((value) => "ADD COLUMN " + value).join(", ")}, ADD ${constraint[1].trim().replace(/,$/u, "")}`,
  }
}
async function catalog(query, relation, temp) {
  const columns = (
    await query(
      `SELECT a.attname AS name,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull AS not_null,pg_get_expr(d.adbin,d.adrelid) AS default_value FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=$1::regclass AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attname COLLATE "C"`,
      [relation],
    )
  ).rows
  const constraints = (
    await query(
      `SELECT c.conname AS name,c.contype AS kind,pg_get_constraintdef(c.oid,false) AS definition,c.convalidated AS validated,c.condeferrable AS deferrable,c.condeferred AS deferred FROM pg_constraint c WHERE c.conrelid=$1::regclass`,
      [relation],
    )
  ).rows
    .map((row) => ({
      ...row,
      name: temp ? (["n", "p"].includes(row.kind) ? row.name.replace(temp, "bff_message") : row.name.replace(temp + "_", "")) : row.name,
    }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  const guards = (
    await query(
      `SELECT c.relkind,c.relrowsecurity,c.relforcerowsecurity,EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal) AS triggers,EXISTS(SELECT 1 FROM pg_inherits i WHERE i.inhrelid=c.oid OR i.inhparent=c.oid) AS inheritance FROM pg_class c WHERE c.oid=$1::regclass`,
      [relation],
    )
  ).rows[0]
  return { columns, constraints, guards }
}
export async function expectedMessageRegenerationCatalog(query, definitions, prefix = "bff_message_regen_") {
  const result = {}
  for (const [kind, source] of [
    ["prior", definitions.prior],
    ["current", definitions.current],
    ...(definitions.currentWithFinal ? [["final", definitions.currentWithFinal]] : []),
  ]) {
    const name = prefix + kind
    const sql = source
      .replace("CREATE TABLE IF NOT EXISTS bff_message", `CREATE TEMP TABLE ${name}`)
      .replaceAll("CONSTRAINT ", `CONSTRAINT ${name}_`)
      .replace(/\);$/u, ") ON COMMIT DROP;")
    await query(sql)
    result[kind] = await catalog(query, "pg_temp." + name, name)
  }
  return result
}
export async function inspectMessageRegenerationCatalog(query, expected) {
  const current = await catalog(query, "kokoro_bff.bff_message")
  if (JSON.stringify(current) === JSON.stringify(expected.current) || (expected.final && JSON.stringify(current) === JSON.stringify(expected.final)))
    return "current"
  if (JSON.stringify(current) === JSON.stringify(expected.prior)) return "missing"
  throw Error("invalid_schema")
}
