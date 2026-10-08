import assert from "node:assert/strict"
import test from "node:test"
import { Pool } from "pg"
import { classifySkillShareUsageCatalog, skillShareUsageCatalogFixtures } from "../scripts/skill-share-usage-schema-catalog.mjs"
import { evolveSkillShareUsageSchema } from "../scripts/evolve-skill-share-usage-schema.mjs"

function clone(value) {
  return structuredClone(value)
}
test("R353 catalog accepts only the fixed old and complete target states", () => {
  assert.equal(classifySkillShareUsageCatalog(clone(skillShareUsageCatalogFixtures.old)), "old")
  assert.equal(classifySkillShareUsageCatalog(clone(skillShareUsageCatalogFixtures.current)), "current")
  const mutations = []
  const partial = clone(skillShareUsageCatalogFixtures.current)
  delete partial.bff_skill_usage_observation
  mutations.push(partial)
  const extra = clone(skillShareUsageCatalogFixtures.current)
  extra.bff_share.indexes.push({ name: "unexpected_index", definition: "CREATE INDEX unexpected_index ON bff_share USING btree (url)" })
  mutations.push(extra)
  const nullable = clone(skillShareUsageCatalogFixtures.current)
  nullable.bff_share.columns.find((row) => row.name === "conversation_id").nullable = false
  mutations.push(nullable)
  const precision = clone(skillShareUsageCatalogFixtures.current)
  precision.bff_share.columns.find((row) => row.name === "created_at").type = "timestamp with time zone"
  mutations.push(precision)
  const defaultDrift = clone(skillShareUsageCatalogFixtures.current)
  defaultDrift.bff_share.columns.find((row) => row.name === "created_at").default_value = "CURRENT_TIMESTAMP(3) + '1 second'::interval"
  mutations.push(defaultDrift)
  const regex = clone(skillShareUsageCatalogFixtures.current)
  regex.bff_skill_usage_observation.constraints.find((row) => row.name === "ck_bff_skill_usage_observation_identity").definition =
    regex.bff_skill_usage_observation.constraints
      .find((row) => row.name === "ck_bff_skill_usage_observation_identity")
      .definition.replace("[A-Za-z0-9]", "[a-za-z0-9]")
  mutations.push(regex)
  const grouping = clone(skillShareUsageCatalogFixtures.current)
  grouping.bff_skill_usage_coverage.constraints.find((row) => row.name === "ck_bff_skill_usage_coverage_checkpoint").definition =
    "CHECK (((status = 'unavailable'::text) OR (checkpoint_id IS NULL)) AND (checkpoint_at IS NULL))"
  mutations.push(grouping)
  const foreignKey = clone(skillShareUsageCatalogFixtures.current)
  foreignKey.bff_share.constraints.push({ name: "unexpected_fk", contype: "f", definition: "FOREIGN KEY (tenant_id) REFERENCES tenant(id)" })
  mutations.push(foreignKey)
  for (const mutation of mutations) assert.equal(classifySkillShareUsageCatalog(mutation), "drift")
})

test("R353 catalog preserves literal whitespace, parentheses and exact native definitions", () => {
  const constraint = clone(skillShareUsageCatalogFixtures.current)
  constraint.bff_share.constraints.find((row) => row.name === "ck_bff_share_url").definition += " OR TRUE"
  assert.equal(classifySkillShareUsageCatalog(constraint), "drift")
  const index = clone(skillShareUsageCatalogFixtures.current)
  index.bff_share.indexes.find((row) => row.name === "ix_bff_share_active_lookup").definition = index.bff_share.indexes
    .find((row) => row.name === "ix_bff_share_active_lookup")
    .definition.replace("conversation_id", "url")
  assert.equal(classifySkillShareUsageCatalog(index), "drift")
  const literal = clone(skillShareUsageCatalogFixtures.current)
  literal.bff_share.indexes.find((row) => row.name === "ix_bff_share_active_lookup").definition += " /* a b */"
  assert.equal(classifySkillShareUsageCatalog(literal), "drift")
})

const url = process.env.KOKORO_TEST_POSTGRES_URL
const integration = url ? test : test.skip
integration("R353 expands fixed old catalog, preserves rows, replays current and rejects native drift", async () => {
  const pool = new Pool({ connectionString: url })
  const client = await pool.connect()
  try {
    await client.query(`DROP TABLE bff_skill_usage_observation,bff_skill_usage_run_terminal,bff_skill_usage_coverage;
      DROP INDEX ix_bff_share_active_skill_lookup,uq_bff_share_active_skill_revision,ix_bff_share_active_lookup,uq_bff_share_active_conversation;
      ALTER TABLE bff_share DROP CONSTRAINT ck_bff_share_resource,DROP CONSTRAINT ck_bff_share_bounded_identity,DROP CONSTRAINT ck_bff_share_identity;
      ALTER TABLE bff_share ADD CONSTRAINT ck_bff_share_identity CHECK(length(btrim(tenant_id))>0 AND length(btrim(conversation_id))>0);
      ALTER TABLE bff_share ALTER COLUMN conversation_id SET NOT NULL;
      ALTER TABLE bff_share DROP COLUMN skill_source_ref,DROP COLUMN creator_subject_id,DROP COLUMN resource_kind;
      CREATE UNIQUE INDEX uq_bff_share_active_conversation ON bff_share(tenant_id,conversation_id) WHERE revoked_at IS NULL;
      CREATE INDEX ix_bff_share_active_lookup ON bff_share(share_id,tenant_id,conversation_id) WHERE revoked_at IS NULL`)
    await client.query(
      "INSERT INTO bff_share(share_id,tenant_id,conversation_id,url) VALUES('shr_legacy','tenant_legacy','conversation_legacy','/v1/shared/shr_legacy')",
    )
    assert.deepEqual(await evolveSkillShareUsageSchema({ databaseUrl: url, mode: "check", signal: new AbortController().signal }), { state: "update_required" })
    assert.deepEqual(await evolveSkillShareUsageSchema({ databaseUrl: url, mode: "apply", signal: new AbortController().signal }), { state: "updated" })
    assert.deepEqual((await client.query("SELECT resource_kind,conversation_id,url FROM bff_share WHERE share_id='shr_legacy'")).rows[0], {
      resource_kind: "conversation",
      conversation_id: "conversation_legacy",
      url: "/v1/shared/shr_legacy",
    })
    assert.deepEqual(await evolveSkillShareUsageSchema({ databaseUrl: url, mode: "apply", signal: new AbortController().signal }), { state: "current" })
    await client.query("ALTER TABLE bff_share RENAME CONSTRAINT ck_bff_share_url TO ck_bff_share_url_drift")
    assert.deepEqual(await evolveSkillShareUsageSchema({ databaseUrl: url, mode: "check", signal: new AbortController().signal }), { state: "unavailable" })
    assert.equal((await client.query("SELECT count(*)::text AS count FROM bff_share WHERE share_id='shr_legacy'")).rows[0].count, "1")
    await client.query("ALTER TABLE bff_share RENAME CONSTRAINT ck_bff_share_url_drift TO ck_bff_share_url")
  } finally {
    client.release()
    await pool.end()
  }
})
