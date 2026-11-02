import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { test } from "node:test"
import pg from "pg"
import { PostgresProjectRepository } from "../src/infrastructure/postgres/project-repository.ts"
const databaseUrl = process.env.KOKORO_TEST_POSTGRES_URL
const integration = databaseUrl ? test : test.skip
integration("real PG recommendation CAS/no-op/retained refs/owner/delete fences leave receipts untouched", async () => {
  const url = new URL(databaseUrl)
  assert.match(url.pathname, /^\/kokoro_bff_mcp_recs_[0-9a-f]{32}$/u, "dedicated task database required")
  const pool = new pg.Pool({ connectionString: databaseUrl, options: "-c search_path=kokoro_bff -c timezone=UTC", max: 4 })
  const repository = new PostgresProjectRepository({ pool })
  const projectId = `project_${randomUUID()}`,
    tenantId = "recommendation_fixture",
    subjectId = "owner"
  const query = () => ({ projectId, tenantId, subjectId, signal: new AbortController().signal, deadlineAt: performance.now() + 5000 })
  try {
    await pool.query("INSERT INTO bff_project(project_id,tenant_id,owner_id,name,slug) VALUES($1,$2,$3,'Project',$1)", [projectId, tenantId, subjectId])
    const read = () => repository.projectMcpRecommendations(query())
    assert.deepEqual(await read(), { project_id: projectId, recommendations: [], state_version: "1" })
    const receipts = async () => (await pool.query("SELECT count(*)::int AS n FROM bff_idempotency_receipt")).rows[0].n
    const count = await receipts()
    const refs = [
      { kind: "custom_api", profile_id: "api" },
      { kind: "mcp_connector", connector_id: "connector" },
      { kind: "provider", provider_key: "provider" },
    ]
    const change = await repository.replaceProjectMcpRecommendations({ ...query(), expectedStateVersion: "1", recommendations: refs })
    assert.equal(change.data.state_version, "2")
    const row = async () => (await pool.query("SELECT to_jsonb(p) AS value,xmin::text AS xmin FROM bff_project p WHERE project_id=$1", [projectId])).rows[0]
    const before = await row()
    assert.equal((await repository.replaceProjectMcpRecommendations({ ...query(), expectedStateVersion: "2", recommendations: refs })).data.state_version, "2")
    assert.deepEqual(await row(), before, "same-value conditional PUT must not UPDATE xmin/time/version")
    assert.equal(
      (await repository.replaceProjectMcpRecommendations({ ...query(), expectedStateVersion: "1", recommendations: refs })).kind,
      "precondition_failed",
    )
    const race = await Promise.all(
      [[], [{ kind: "provider", provider_key: "other" }]].map((recommendations) =>
        repository.replaceProjectMcpRecommendations({ ...query(), expectedStateVersion: "2", recommendations }),
      ),
    )
    assert.equal(race.filter((x) => x.kind === "replaced").length, 1)
    assert.equal(race.filter((x) => x.kind === "precondition_failed").length, 1)
    assert.equal((await read()).state_version, "3")
    assert.equal(await repository.projectMcpRecommendations({ ...query(), subjectId: "other" }), null)
    assert.equal(await repository.projectMcpRecommendations({ ...query(), tenantId: "other" }), null)
    assert.equal(await repository.projectMcpRecommendations({ ...query(), projectId: "not-canonical-slug" }), null)
    assert.equal(
      (await repository.replaceProjectMcpRecommendations({ ...query(), subjectId: "other", expectedStateVersion: "3", recommendations: [] })).kind,
      "not_found",
    )
    await pool.query("UPDATE bff_project SET mcp_recommendations_state_version=2147483647 WHERE project_id=$1", [projectId])
    const max = await read()
    assert.equal(
      (await repository.replaceProjectMcpRecommendations({ ...query(), expectedStateVersion: max.state_version, recommendations: max.recommendations })).kind,
      "replaced",
    )
    const different = max.recommendations.length ? [] : refs
    assert.equal(
      (await repository.replaceProjectMcpRecommendations({ ...query(), expectedStateVersion: max.state_version, recommendations: different })).kind,
      "precondition_failed",
    )
    const blocker = await pool.connect()
    try {
      await blocker.query("BEGIN")
      await blocker.query("SELECT 1 FROM bff_project WHERE project_id=$1 FOR UPDATE", [projectId])
      const pending = repository.replaceProjectMcpRecommendations({ ...query(), expectedStateVersion: max.state_version, recommendations: [] })
      await blocker.query("UPDATE bff_project SET deleted_at=now() WHERE project_id=$1", [projectId])
      await blocker.query("COMMIT")
      assert.equal((await pending).kind, "not_found")
    } finally {
      await blocker.query("ROLLBACK")
      blocker.release()
    }
    assert.equal(await read(), null)
    assert.equal(await receipts(), count, "natural configuration writes must not claim command receipts")
  } finally {
    await pool.query("DELETE FROM bff_project WHERE project_id=$1 AND tenant_id=$2", [projectId, tenantId])
    await pool.end()
  }
})
integration("real PG cancellation retires the exact locked writer without late updates", async () => {
  const pool = new pg.Pool({ connectionString: databaseUrl, options: "-c search_path=kokoro_bff", max: 3 })
  const id = `project_${randomUUID()}`,
    repository = new PostgresProjectRepository({ pool }),
    blocker = await pool.connect()
  try {
    await pool.query("INSERT INTO bff_project(project_id,tenant_id,owner_id,name,slug) VALUES($1,'cancel','owner','P',$1)", [id])
    await blocker.query("BEGIN")
    await blocker.query("SELECT 1 FROM bff_project WHERE project_id=$1 FOR UPDATE", [id])
    const controller = new AbortController()
    const pending = repository.replaceProjectMcpRecommendations({
      projectId: id,
      tenantId: "cancel",
      subjectId: "owner",
      signal: controller.signal,
      deadlineAt: performance.now() + 2000,
      expectedStateVersion: "1",
      recommendations: [{ kind: "provider", provider_key: "x" }],
    })
    const rejected = assert.rejects(pending)
    await new Promise((r) => setTimeout(r, 20))
    controller.abort()
    await rejected
    await blocker.query("COMMIT")
    await new Promise((r) => setTimeout(r, 30))
    assert.equal((await pool.query("SELECT mcp_recommendations_state_version AS version FROM bff_project WHERE project_id=$1", [id])).rows[0].version, 1)
  } finally {
    await blocker.query("ROLLBACK")
    blocker.release()
    await pool.query("DELETE FROM bff_project WHERE project_id=$1", [id])
    await pool.end()
  }
})

integration("bounded current Project reads retire ACCESS EXCLUSIVE waits and canceled pool acquisition never dispatches late SQL", async () => {
  const pool = new pg.Pool({ connectionString: databaseUrl, options: "-c search_path=kokoro_bff", max: 1, application_name: "recommendation_bounded_reader" })
  const control = new pg.Pool({ connectionString: databaseUrl, options: "-c search_path=kokoro_bff", max: 2 })
  const repository = new PostgresProjectRepository({ pool }),
    blocker = await control.connect(),
    id = `project_${randomUUID()}`
  const query = (signal) => ({ tenantId: "bounded", subjectId: "owner", projectId: id, signal, deadlineAt: performance.now() + 1000 })
  try {
    await control.query("INSERT INTO bff_project(project_id,tenant_id,owner_id,name,slug) VALUES($1,'bounded','owner','P',$1)", [id])
    await blocker.query("BEGIN;LOCK TABLE bff_project IN ACCESS EXCLUSIVE MODE")
    const controller = new AbortController()
    const rejected = assert.rejects(repository.projectMcpRecommendations(query(controller.signal)))
    await new Promise((r) => setTimeout(r, 25))
    controller.abort()
    await rejected
    await blocker.query("COMMIT")
    await new Promise((r) => setTimeout(r, 40))
    assert.equal(pool.totalCount, 0, "the blocked query's checked-out client is destroyed, not returned for reuse")
    const active = await control.query(
      "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND application_name='recommendation_bounded_reader'",
    )
    assert.equal(active.rows[0].n, 0, "no canceled lock-wait query survives on PostgreSQL")
    const held = await pool.connect()
    let sends = 0
    const original = held.query.bind(held)
    held.query = (...args) => {
      sends++
      return original(...args)
    }
    const attempts = Array.from({ length: 6 }, () => {
      const c = new AbortController()
      const outcome = assert.rejects(repository.projectMcpRecommendations(query(c.signal)))
      c.abort()
      return outcome
    })
    await Promise.all(attempts)
    assert.equal(sends, 0)
    held.release()
    await new Promise((r) => setTimeout(r, 50))
    assert.equal(sends, 0, "late acquisition releases each client without BEGIN/SELECT or any other SQL")
    assert.equal(pool.waitingCount, 0)
    assert.equal(pool.idleCount, pool.totalCount)
    const started = performance.now()
    assert.equal((await repository.projectMcpRecommendations(query(new AbortController().signal))).state_version, "1")
    assert.ok(performance.now() - started < 1000, "recorded bounded reader completes after the locks are released")
  } finally {
    await blocker.query("ROLLBACK")
    blocker.release()
    await pool.end()
    await control.query("DELETE FROM bff_project WHERE project_id=$1", [id])
    await control.end()
  }
})
