import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { test } from "node:test"
import pg from "pg"
import { PostgresProjectRepository } from "../src/infrastructure/postgres/project-repository.ts"
const databaseUrl = process.env.KOKORO_TEST_POSTGRES_URL
const integration = databaseUrl ? test : test.skip
integration("real PG personal pins preserve metadata, handle keysets/noops/owner fences, and delete atomically", async () => {
  const url = new URL(databaseUrl)
  assert.match(url.pathname, /^\/kokoro_bff_project_pin_[0-9a-f]{32}$/u, "dedicated Project pin fixture database required")
  const pool = new pg.Pool({ connectionString: databaseUrl, options: "-c search_path=kokoro_bff -c timezone=UTC", max: 5 })
  const repository = new PostgresProjectRepository({ pool }),
    tenantId = `pin_${randomUUID()}`,
    subjectId = "owner",
    scope = { tenantId, subjectId }
  const ids = [`project_${randomUUID()}`, `project_${randomUUID()}`, `project_${randomUUID()}`]
  const q = (id = ids[0]) => ({ ...scope, projectId: id, signal: new AbortController().signal, deadlineAt: performance.now() + 5000 })
  const page = (extra = {}) => repository.listProjectPins({ ...q(), projectId: null, limit: 100, position: null, ...extra })
  const set = (id, value) => repository.setProjectPin({ ...q(id), isPinned: value })
  const del = (id, fingerprint = "a".repeat(64)) => repository.deleteProject(scope, id, `delete-${id}`, fingerprint, "pin-test", new AbortController().signal)
  try {
    for (const id of ids)
      await pool.query("INSERT INTO bff_project(project_id,tenant_id,owner_id,name,slug) VALUES($1,$2,$3,'Pin fixture',$1)", [id, tenantId, subjectId])
    const parent = async (id) => (await pool.query("SELECT to_jsonb(p) AS value,xmin::text AS xmin FROM bff_project p WHERE project_id=$1", [id])).rows[0]
    const before = await parent(ids[0])
    assert.deepEqual(await repository.listProjectPins({ ...q(), limit: 1, position: null }), { items: [], nextPosition: null })
    const results = await Promise.all([set(ids[0], true), set(ids[0], true)])
    assert.deepEqual(results[0], results[1])
    const pinBefore = (
      await pool.query("SELECT to_jsonb(p) AS value,xmin::text AS xmin FROM bff_project_pin p WHERE tenant_id=$1 AND project_id=$2", [tenantId, ids[0]])
    ).rows[0]
    await set(ids[0], true)
    assert.deepEqual(
      (await pool.query("SELECT to_jsonb(p) AS value,xmin::text AS xmin FROM bff_project_pin p WHERE tenant_id=$1 AND project_id=$2", [tenantId, ids[0]]))
        .rows[0],
      pinBefore,
    )
    assert.deepEqual(await parent(ids[0]), before)
    await set(ids[0], false)
    await set(ids[0], false)
    assert.deepEqual(await parent(ids[0]), before)
    for (const id of ids.slice(0, 2)) await set(id, true)
    await pool.query("UPDATE bff_project_pin SET pinned_at='2026-10-27T00:00:00Z' WHERE tenant_id=$1", [tenantId])
    const first = await page({ limit: 1 }),
      second = await page({ limit: 1, position: first.nextPosition })
    assert.deepEqual(
      [...first.items, ...second.items].map((x) => x.projectId),
      ids.slice(0, 2).sort(),
    )
    assert.equal(second.nextPosition, null)
    assert.equal(await repository.listProjectPins({ ...q(), subjectId: "other", limit: 1, position: null }), null)
    assert.equal(await repository.setProjectPin({ ...q(), tenantId: "other", isPinned: false }), null)
    await pool.query("INSERT INTO bff_project_pin(tenant_id,subject_id,project_id) VALUES($1,'other',$2),($1,$3,'orphan')", [tenantId, ids[0], subjectId])
    assert.equal((await page()).items.length, 2, "orphan and foreign subject preferences never leak")
    await assert.rejects(() => del(ids[1], "invalid-digest"))
    assert.equal((await parent(ids[1])).value.deleted_at, null)
    assert.equal((await page()).items.length, 2, "late delete failure rolls back preference cleanup and parent tombstone")
    assert.equal((await del(ids[0])).kind, "accepted")
    assert.equal(
      (await pool.query("SELECT count(*)::int AS count FROM bff_project_pin WHERE tenant_id=$1 AND project_id=$2", [tenantId, ids[0]])).rows[0].count,
      0,
    )
    assert.equal(await set(ids[0], true), null)
    await Promise.all([set(ids[2], true), del(ids[2])])
    assert.equal(
      (await pool.query("SELECT count(*)::int AS count FROM bff_project_pin WHERE tenant_id=$1 AND project_id=$2", [tenantId, ids[2]])).rows[0].count,
      0,
      "concurrent pin/delete never leaves a live association",
    )
    assert.equal(await set(ids[2], false), null)
  } finally {
    for (const table of ["bff_project_pin", "bff_project_deletion", "bff_project_scope_release_outbox", "bff_project"])
      await pool.query(`DELETE FROM ${table} WHERE tenant_id=$1`, [tenantId])
    await pool.end()
  }
})
