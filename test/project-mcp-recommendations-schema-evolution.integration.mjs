import assert from "node:assert/strict"
import { test } from "node:test"
import pg from "pg"
import { loadCanonicalSchema } from "../scripts/apply-schema.mjs"
import {
  evolveProjectMcpRecommendationsSchema as evolve,
  projectMcpRecommendationsSchemaDefinitions as definitions,
} from "../scripts/evolve-project-mcp-recommendations-schema.mjs"
const databaseUrl = process.env.KOKORO_TEST_POSTGRES_URL
const integration = databaseUrl ? test : test.skip
test("named recommendation schema evolution is pinned to its exact parent and accepts no arbitrary DDL", async () => {
  const schema = await loadCanonicalSchema()
  assert.equal(definitions(schema).columns.length, 2)
  for (const changed of [
    schema.replace("mcp_recommendations_state_version INTEGER", "mcp_recommendations_state_version BIGINT"),
    schema.replace("ck_bff_project_mcp_refs CHECK", "ck_wrong CHECK"),
  ])
    assert.throws(() => definitions(changed), /invalid_schema/)
  assert.equal((await evolve({ mode: "drop", databaseUrl: "invalid" })).state, "invalid_request")
})
integration("real PG exact parent expand/current noop/drift rejection preserve existing rows/xmin and other owners", async () => {
  const url = new URL(databaseUrl)
  assert.match(url.pathname, /^\/kokoro_bff_mcp_recs_[0-9a-f]{32}$/u)
  const pool = new pg.Pool({ connectionString: databaseUrl, options: "-c search_path=kokoro_bff -c timezone=UTC", max: 2 })
  const base = definitions(await loadCanonicalSchema())
  const run = (mode = "apply", extra = {}) => evolve({ mode, databaseUrl, ...extra })
  const row = async () =>
    (
      await pool.query(
        "SELECT to_jsonb(p)-'recommended_mcp_refs'-'mcp_recommendations_state_version' AS value,xmin::text AS xmin FROM bff_project p WHERE project_id='recommendation_evolution_fixture'",
      )
    ).rows
  try {
    await pool.query("ALTER TABLE bff_project DROP COLUMN recommended_mcp_refs,DROP COLUMN mcp_recommendations_state_version")
    await pool.query(
      "INSERT INTO bff_project(project_id,tenant_id,owner_id,name,slug) VALUES('recommendation_evolution_fixture','evolution','owner','old','old')",
    )
    await pool.query(
      "CREATE SCHEMA recommendation_other_fixture;CREATE TABLE recommendation_other_fixture.sentinel(value TEXT NOT NULL);INSERT INTO recommendation_other_fixture.sentinel VALUES('preserve')",
    )
    const other = async () => (await pool.query("SELECT to_jsonb(s) AS value,xmin::text AS xmin FROM recommendation_other_fixture.sentinel s")).rows
    const old = await row(),
      sentinel = await other()
    assert.equal((await run("check")).state, "update_required")
    assert.equal((await run()).state, "updated")
    assert.deepEqual(await row(), old)
    assert.deepEqual(await other(), sentinel)
    const current = (
      await pool.query(
        "SELECT recommended_mcp_refs AS refs,mcp_recommendations_state_version AS version FROM bff_project WHERE project_id='recommendation_evolution_fixture'",
      )
    ).rows[0]
    assert.deepEqual(current, { refs: [], version: 1 })
    assert.equal((await run()).state, "current")
    assert.deepEqual(await row(), old)
    await assert.rejects(pool.query("UPDATE bff_project SET recommended_mcp_refs='{}'::jsonb WHERE project_id='recommendation_evolution_fixture'"))
    await assert.rejects(pool.query("UPDATE bff_project SET mcp_recommendations_state_version=0 WHERE project_id='recommendation_evolution_fixture'"))
    await pool.query("ALTER TABLE bff_project ADD COLUMN unexpected_recommendation_drift TEXT")
    assert.equal((await run()).state, "invalid_schema")
    await pool.query("ALTER TABLE bff_project DROP COLUMN unexpected_recommendation_drift")
    await pool.query("CREATE INDEX recommendation_drift ON bff_project(name)")
    assert.equal((await run()).state, "invalid_schema")
    await pool.query("DROP INDEX recommendation_drift")
    const aborted = new AbortController()
    aborted.abort()
    assert.equal((await run("apply", { signal: aborted.signal })).state, "unavailable")
    assert.equal((await run("check")).state, "current")
    assert.deepEqual(await other(), sentinel)
  } finally {
    await pool.query("DELETE FROM bff_project WHERE project_id='recommendation_evolution_fixture'")
    await pool.query("DROP TABLE IF EXISTS recommendation_other_fixture.sentinel;DROP SCHEMA IF EXISTS recommendation_other_fixture")
    await pool.end()
  }
})

// Task-owned loopback PostgreSQL protocol relay: suppress COMMIT replies, never log packet bodies or credentials.
async function lostCommitAckRelay(targetUrl) {
  const { createServer, connect } = await import("node:net")
  const target = new URL(targetUrl),
    upstream = { host: target.hostname, port: Number(target.port || 5432) }
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(upstream.host))
  const sockets = new Set()
  let commitSeen = false,
    blocked = 0
  const server = createServer((front) => {
    const back = connect(upstream)
    sockets.add(front)
    sockets.add(back)
    for (const socket of [front, back]) {
      socket.on("error", () => {
        front.destroy()
        back.destroy()
      })
      socket.on("close", () => sockets.delete(socket))
    }
    let pending = Buffer.alloc(0),
      startup = true,
      suppress = false
    front.on("data", (chunk) => {
      pending = Buffer.concat([pending, chunk])
      while (pending.length >= (startup ? 4 : 5)) {
        const length = pending.readInt32BE(startup ? 0 : 1) + (startup ? 0 : 1)
        if (length < (startup ? 8 : 5) || length > 1048576) {
          front.destroy()
          back.destroy()
          return
        }
        if (pending.length < length) return
        const packet = pending.subarray(0, length)
        pending = pending.subarray(length)
        if (!startup && packet[0] === 81 && packet.subarray(5).toString("utf8") === "COMMIT\0") {
          commitSeen = true
          suppress = true
        }
        back.write(packet)
        startup = false
      }
    })
    back.on("data", (chunk) => {
      if (suppress) blocked += chunk.length
      else front.write(chunk)
    })
    front.on("end", () => back.end())
    back.on("end", () => front.end())
  })
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const url = new URL(targetUrl)
  url.hostname = "127.0.0.1"
  url.port = String(server.address().port)
  url.searchParams.set("sslmode", "disable")
  return {
    url: url.toString(),
    seen: () => commitSeen && blocked > 0,
    close: async () => {
      for (const socket of sockets) socket.destroy()
      await new Promise((r) => server.close(r))
    },
  }
}
integration("real schema COMMIT ACK loss reports unknown and fresh check alone confirms current", async () => {
  const pool = new pg.Pool({ connectionString: databaseUrl, options: "-c search_path=kokoro_bff", max: 1 })
  let relay
  try {
    await pool.query("ALTER TABLE bff_project DROP COLUMN recommended_mcp_refs,DROP COLUMN mcp_recommendations_state_version")
    relay = await lostCommitAckRelay(databaseUrl)
    const outcome = await evolve({ mode: "apply", databaseUrl: relay.url, timeoutMs: 1000 })
    assert.equal(relay.seen(), true)
    assert.equal(outcome.state, "unknown")
    assert.equal(outcome.code, "commit_unknown")
    assert.equal((await evolve({ mode: "check", databaseUrl })).state, "current")
  } finally {
    if (relay) await relay.close()
    await pool.end()
  }
})
integration("real configuration lost COMMIT ACK is not success; independent GET only establishes current value", async () => {
  const { PostgresProjectRepository } = await import("../src/infrastructure/postgres/project-repository.ts")
  const direct = new pg.Pool({ connectionString: databaseUrl, options: "-c search_path=kokoro_bff", max: 1 })
  let relay, proxied
  const id = "recommendation_ack_loss_fixture"
  try {
    await direct.query("INSERT INTO bff_project(project_id,tenant_id,owner_id,name,slug) VALUES($1,'ack','owner','P',$1)", [id])
    relay = await lostCommitAckRelay(databaseUrl)
    proxied = new pg.Pool({ connectionString: relay.url, options: "-c search_path=kokoro_bff", max: 1 })
    const repository = new PostgresProjectRepository({ pool: proxied })
    const query = { tenantId: "ack", subjectId: "owner", projectId: id, signal: new AbortController().signal, deadlineAt: performance.now() + 700 }
    const recommendations = [{ kind: "provider", provider_key: "after-ack-loss" }]
    await assert.rejects(repository.replaceProjectMcpRecommendations({ ...query, expectedStateVersion: "1", recommendations }), /COMMIT_UNKNOWN/)
    assert.equal(relay.seen(), true)
    const current = await new PostgresProjectRepository({ pool: direct }).projectMcpRecommendations({ ...query, deadlineAt: performance.now() + 1000 })
    assert.equal(current.state_version, "2")
    assert.deepEqual(current.recommendations, recommendations)
    // No replay was sent and no immutable ACK was manufactured: this is only a current-state observation.
  } finally {
    if (proxied) await proxied.end()
    if (relay) await relay.close()
    await direct.query("DELETE FROM bff_project WHERE project_id=$1", [id])
    await direct.end()
  }
})
