import { createHash } from "node:crypto"

const table = "bff_personalization"
const columns = ["tenant_id", "owner_id", "nickname", "occupation", "about", "instructions", "revision", "created_at", "updated_at"]
const checks = {
  ck_bff_personalization_scope: "tenant_id<>''andowner_id<>''",
  ck_bff_personalization_nickname: "char_lengthnickname<=128",
  ck_bff_personalization_occupation: "char_lengthoccupation<=256",
  ck_bff_personalization_about: "char_lengthabout<=2000",
  ck_bff_personalization_instructions: "char_lengthinstructions<=8000",
  ck_bff_personalization_revision: "revision>=1andrevision<=9007199254740991",
}
function requireSchema(valid) {
  if (!valid) throw new Error("invalid_schema")
}
function expression(value) {
  return value.replace(/'(\d+)'::bigint/gu, "$1").replace(/'(?:[^']|'')*'|::(?:text|bigint)|[\s()]|[A-Z]+/gu, (token) => {
    if (token.startsWith("'")) return token
    return token.startsWith("::") || /^[\s()]+$/u.test(token) ? "" : token.toLowerCase()
  })
}

/** Extract only this canonical statement; no caller SQL, extra statements or migration copy. */
export function extractPersonalizationCreate(schema) {
  const blocks = [...schema.matchAll(/^CREATE TABLE IF NOT EXISTS bff_personalization \(\n([\s\S]*?)^\);[ \t]*$/gmu)]
  requireSchema(
    blocks.length === 1 && [...schema.matchAll(/\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:kokoro_bff\.)?bff_personalization\b/giu)].length === 1,
  )
  const body = blocks[0][1]
  requireSchema(!/[;"$]|--|\/\*/u.test(body))
  const lines = body
    .trim()
    .split(/\n/u)
    .map((line) => line.trim().replace(/,$/u, ""))
  requireSchema(lines.length === columns.length + 1 + Object.keys(checks).length)
  columns.forEach((name, index) => {
    const type = index < 6 ? "TEXT" : index === 6 ? "BIGINT" : "TIMESTAMPTZ(3)"
    const defaultClause = index > 6 ? " DEFAULT CURRENT_TIMESTAMP(3)" : ""
    requireSchema(lines[index] === `${name} ${type} NOT NULL${defaultClause}`)
  })
  requireSchema(lines[9] === "CONSTRAINT pk_bff_personalization PRIMARY KEY (tenant_id, owner_id)")
  for (const [index, [name, expected]] of Object.entries(checks).entries()) {
    const line = lines[index + 10]
    requireSchema(line.startsWith(`CONSTRAINT ${name} CHECK (`) && line.endsWith(")"))
    requireSchema(expression(line.slice(`CONSTRAINT ${name} CHECK `.length)) === expected)
  }
  return blocks[0][0].replace("CREATE TABLE IF NOT EXISTS bff_personalization", "CREATE TABLE kokoro_bff.bff_personalization")
}

/** A semantic snapshot of this owner, not an oracle for unrelated historical schema drift. */
export async function oldOwnerCatalogDigest(query) {
  const result = await query(`
    SELECT 'relation' AS kind, c.relname AS name,
           jsonb_build_array(c.relkind,c.relpersistence,c.relrowsecurity,c.relforcerowsecurity,c.relispartition,c.reloptions,c.relacl) AS value
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='kokoro_bff' AND c.relname NOT IN ('bff_personalization','pk_bff_personalization')
    UNION ALL
    SELECT 'column',c.relname||':'||a.attnum,
           jsonb_build_array(a.attname,a.atttypid,a.atttypmod,a.attnotnull,a.attidentity,a.attgenerated,pg_get_expr(d.adbin,d.adrelid))
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
      LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
     WHERE n.nspname='kokoro_bff' AND c.relname NOT IN ('bff_personalization','pk_bff_personalization')
    UNION ALL
    SELECT 'constraint',c.relname||':'||k.conname,to_jsonb(pg_get_constraintdef(k.oid))
      FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='kokoro_bff' AND c.relname<>'bff_personalization'
    UNION ALL
    SELECT 'index',indexname,to_jsonb(indexdef) FROM pg_indexes
     WHERE schemaname='kokoro_bff' AND tablename<>'bff_personalization'
    UNION ALL
    SELECT 'trigger',c.relname||':'||t.tgname,to_jsonb(pg_get_triggerdef(t.oid))
      FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='kokoro_bff' AND c.relname<>'bff_personalization'
    UNION ALL
    SELECT 'rule',tablename||':'||rulename,to_jsonb(definition) FROM pg_rules
     WHERE schemaname='kokoro_bff' AND tablename<>'bff_personalization'
    ORDER BY kind,name`)
  return createHash("sha256").update(JSON.stringify(result.rows)).digest("hex")
}

/** Called only inside the operation's owner advisory transaction lock. */
export async function inspectPersonalizationCatalog(query) {
  const base = await query(
    `SELECT c.relname,c.relkind,c.relpersistence
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='kokoro_bff' AND c.relname=ANY($1::text[])`,
    [["bff_project", "bff_conversation", "bff_scheduled_task", "bff_idempotency_receipt", "bff_agui_event"]],
  )
  requireSchema(base.rows.length === 5 && base.rows.every((row) => row.relkind === "r" && row.relpersistence === "p"))
  // Even an otherwise empty target may invoke privileged DDL event hooks: never run them implicitly.
  requireSchema((await query("SELECT 1 FROM pg_event_trigger WHERE evtenabled<>'D' LIMIT 1")).rows.length === 0)
  const target = await query(
    `SELECT c.oid,c.relkind,c.relpersistence,c.relispartition,c.relrowsecurity,c.relforcerowsecurity,c.reloptions,c.reloftype,
      EXISTS(SELECT 1 FROM pg_inherits i WHERE i.inhrelid=c.oid OR i.inhparent=c.oid) AS inherited,
      EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid=c.oid) AS triggered,
      EXISTS(SELECT 1 FROM pg_rewrite r WHERE r.ev_class=c.oid) AS ruled
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='kokoro_bff' AND c.relname=$1`,
    [table],
  )
  if (target.rows.length === 0) {
    const collisions = await query(`SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
      WHERE n.nspname='kokoro_bff' AND t.typname IN ('bff_personalization','_bff_personalization')
      UNION ALL SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='kokoro_bff' AND c.relname='pk_bff_personalization'`)
    requireSchema(collisions.rows.length === 0)
    return "legacy"
  }
  const relation = target.rows[0]
  requireSchema(
    relation.relkind === "r" &&
      relation.relpersistence === "p" &&
      !relation.relispartition &&
      !relation.relrowsecurity &&
      !relation.relforcerowsecurity &&
      !relation.inherited &&
      !relation.triggered &&
      !relation.ruled &&
      relation.reloptions === null &&
      relation.reloftype === 0,
  )
  await query("LOCK TABLE kokoro_bff.bff_personalization IN ACCESS SHARE MODE")
  // Re-observe all table flags after locking; an earlier catalog read alone is not a DDL fence.
  const locked = await query(`SELECT c.oid,c.relkind,c.relpersistence,c.relispartition,c.relrowsecurity,c.relforcerowsecurity,c.reloptions,c.reloftype,
      EXISTS(SELECT 1 FROM pg_inherits i WHERE i.inhrelid=c.oid OR i.inhparent=c.oid) AS inherited,
      EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid=c.oid) AS triggered,
      EXISTS(SELECT 1 FROM pg_rewrite r WHERE r.ev_class=c.oid) AS ruled
    FROM pg_class c WHERE c.oid='kokoro_bff.bff_personalization'::regclass`)
  requireSchema(JSON.stringify(locked.rows[0]) === JSON.stringify(relation))
  const attributes = await query(
    `SELECT a.attnum,a.attname,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull,a.attidentity,a.attgenerated,
      a.attisdropped,a.attinhcount,a.attislocal,a.attcollation=(SELECT t.typcollation FROM pg_type t WHERE t.oid=a.atttypid) AS default_collation,
      pg_get_expr(d.adbin,d.adrelid) AS default_expression
    FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE a.attrelid=$1 AND a.attnum>0 ORDER BY a.attnum`,
    [relation.oid],
  )
  requireSchema(attributes.rows.length === columns.length)
  attributes.rows.forEach((row, index) => {
    requireSchema(
      row.attnum === index + 1 &&
        row.attname === columns[index] &&
        row.attnotnull &&
        !row.attisdropped &&
        row.attidentity === "" &&
        row.attgenerated === "" &&
        row.attinhcount === 0 &&
        row.attislocal &&
        row.default_collation &&
        row.type === (index < 6 ? "text" : index === 6 ? "bigint" : "timestamp(3) with time zone") &&
        (index < 7 ? row.default_expression === null : expression(row.default_expression ?? "") === "current_timestamp3"),
    )
  })
  const constraints = await query(
    `SELECT conname,contype,convalidated,conenforced,condeferrable,condeferred,connoinherit,conislocal,coninhcount,
      conkey,pg_get_expr(conbin,conrelid) AS expression
    FROM pg_constraint WHERE conrelid=$1 ORDER BY conname`,
    [relation.oid],
  )
  // PG18 catalogs canonical NOT NULL as constraints too; validate them, never discard them.
  const notNull = constraints.rows.filter((constraint) => constraint.contype === "n")
  requireSchema(constraints.rows.length === 16 && notNull.length === columns.length)
  requireSchema(JSON.stringify(notNull.map((constraint) => constraint.conkey?.[0]).sort((a, b) => a - b)) === "[1,2,3,4,5,6,7,8,9]")
  for (const constraint of constraints.rows) {
    requireSchema(
      constraint.convalidated &&
        constraint.conenforced &&
        !constraint.condeferrable &&
        !constraint.condeferred &&
        constraint.conislocal &&
        constraint.coninhcount === 0,
    )
    if (constraint.contype === "n") {
      requireSchema(constraint.conkey.length === 1 && !constraint.connoinherit && constraint.expression === null)
    } else if (constraint.contype === "p") {
      requireSchema(constraint.conname === "pk_bff_personalization" && JSON.stringify(constraint.conkey) === "[1,2]")
    } else {
      requireSchema(
        constraint.contype === "c" &&
          !constraint.connoinherit &&
          Object.hasOwn(checks, constraint.conname) &&
          expression(constraint.expression ?? "") === checks[constraint.conname],
      )
    }
  }
  const indexes = await query(
    `SELECT i.indisprimary,i.indisunique,i.indisvalid,i.indisready,i.indislive,i.indnkeyatts,i.indnatts,
      i.indkey::text,i.indoption::text,
      i.indcollation::text = array_to_string(ARRAY(SELECT a.attcollation FROM unnest(i.indkey) WITH ORDINALITY k(num,n) JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.num ORDER BY k.n),' ') AS matching_collation,i.indexprs IS NULL AS no_expression,i.indpred IS NULL AS no_predicate,c.relname,am.amname,
      ARRAY(SELECT o.opcdefault FROM unnest(i.indclass) WITH ORDINALITY k(oid,n) JOIN pg_opclass o ON o.oid=k.oid ORDER BY k.n) AS default_classes
    FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_am am ON am.oid=c.relam WHERE i.indrelid=$1`,
    [relation.oid],
  )
  requireSchema(indexes.rows.length === 1)
  const index = indexes.rows[0]
  requireSchema(
    index.relname === "pk_bff_personalization" &&
      index.amname === "btree" &&
      index.indisprimary &&
      index.indisunique &&
      index.indisvalid &&
      index.indisready &&
      index.indislive &&
      index.indnkeyatts === 2 &&
      index.indnatts === 2 &&
      index.indkey === "1 2" &&
      index.indoption === "0 0" &&
      index.matching_collation &&
      index.no_expression &&
      index.no_predicate &&
      JSON.stringify(index.default_classes) === "[true,true]",
  )
  return "current"
}
