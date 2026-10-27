import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { test } from "node:test"
test("canonical pin relation is one minimal subject association and restores the original whole owner schema", async () => {
  const sql = await readFile(new URL("../database/schema.sql", import.meta.url), "utf8")
  assert.match(sql, /CREATE TABLE IF NOT EXISTS bff_project_pin \(/u)
  const { restoreProjectPinSchema } = await import("../scripts/project-pin-public-contract.mjs")
  assert.equal(createHash("sha256").update(restoreProjectPinSchema(sql)).digest("hex"), "70f6933f3bf0542d4c8babc6ced7ab7f4c128c0cc0a570ab195309850373e993")
  const block = sql.match(/-- PROJECT-PIN-SQL-BEGIN\n[\s\S]*?-- PROJECT-PIN-SQL-END\n/u)?.[0]
  assert.match(block, /PRIMARY KEY \(tenant_id, subject_id, project_id\)/u)
  assert.equal((block.match(/CREATE INDEX/gu) || []).length, 2)
  assert.doesNotMatch(block, /FOREIGN KEY|REFERENCES|updated_at|deleted_at|revision|is_pinned|receipt/iu)
  assert.throws(() => restoreProjectPinSchema(sql.replace("name TEXT NOT NULL", "name TEXT")))
})

test("pin schema operator accepts only its exact canonical target and rejects requests before any connection", async () => {
  const { projectPinDefinitions } = await import("../scripts/project-pin-schema-catalog.mjs")
  const { evolveProjectPinSchema } = await import("../scripts/evolve-project-pin-schema.mjs")
  const sql = await readFile(new URL("../database/schema.sql", import.meta.url), "utf8")
  assert.match(projectPinDefinitions(sql), /bff_project_pin/)
  assert.throws(() => projectPinDefinitions(sql.replace("pinned_at TIMESTAMPTZ(3)", "pinned_at TEXT")))
  assert.equal((await evolveProjectPinSchema({ mode: "drop", databaseUrl: "invalid" })).state, "invalid_request")
})

test("catalog equality includes the actual index access method, not just identical index keys", async () => {
  const { projectPinDefinitions, expectedProjectPinCatalog, inspectProjectPinCatalog } = await import("../scripts/project-pin-schema-catalog.mjs")
  const sql = await readFile(new URL("../database/schema.sql", import.meta.url), "utf8")
  const query = async (statement, values = []) => {
    const temporary = String(values[0]).startsWith("pg_temp.")
    if (statement.includes("to_regclass('kokoro_bff.bff_project_pin')")) return { rows: [{ relation: "bff_project_pin" }] }
    if (statement.includes("FROM pg_index")) {
      // Emulate a driver projection: an unselected AM field cannot magically
      // appear in returned rows. The real-PG test also exercises this case.
      const accessMethod = statement.includes("am.amname") ? { method: temporary ? "btree" : "brin" } : {}
      return {
        rows: [
          {
            name: "ix_bff_project_pin_parent_cleanup",
            primary: false,
            unique: false,
            valid: true,
            ready: true,
            keys_count: 2,
            attributes_count: 2,
            options: "0 0",
            keys: ["tenant_id", "project_id"],
            predicate: null,
            ...accessMethod,
          },
        ],
      }
    }
    if (statement.includes("FROM pg_class c WHERE"))
      return {
        rows: [{ relkind: "r", relpersistence: temporary ? "t" : "p", relrowsecurity: false, relforcerowsecurity: false, triggers: false, inheritance: false }],
      }
    return { rows: [] }
  }
  const expected = await expectedProjectPinCatalog(query, projectPinDefinitions(sql))
  await assert.rejects(() => inspectProjectPinCatalog(query, expected), /invalid_schema/)
})
