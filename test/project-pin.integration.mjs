import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { test } from "node:test"
import pg from "pg"
import { createProjectPins } from "../src/infrastructure/postgres/project-pin.ts"
import { deleteProjectAggregate } from "../src/infrastructure/postgres/project-delete.ts"
import { createProjectGrantStore } from "../src/infrastructure/postgres/project-grants.ts"
const databaseUrl = process.env.KOKORO_TEST_POSTGRES_URL
const integration = databaseUrl ? test : test.skip
integration("real PG personal pins preserve metadata, handle keysets/noops/owner fences, and delete atomically", async () => {
  const url = new URL(databaseUrl)
  assert.match(url.pathname, /^\/kokoro_bff_project_pin_[0-9a-f]{32}$/u, "dedicated Project pin fixture database required")
  const pool = new pg.Pool({ connectionString: databaseUrl, options: "-c search_path=kokoro_bff -c timezone=UTC", max: 5 })
  const pins = createProjectPins({ pool }),
    tenantId = `pin_${randomUUID()}`,
    subjectId = "owner",
    scope = { tenantId, subjectId }
  const ids = [`project_${randomUUID()}`, `project_${randomUUID()}`, `project_${randomUUID()}`]
  const q = (id = ids[0]) => ({ ...scope, projectId: id, signal: new AbortController().signal, deadlineAt: performance.now() + 5000 })
  const page = (extra = {}) => pins.listPins({ ...q(), projectId: null, limit: 100, position: null, ...extra })
  const set = (id, value) => pins.setPin({ ...q(id), isPinned: value })
  const del = (id, fingerprint = "a".repeat(64)) =>
    deleteProjectAggregate({ pool }, scope, id, `delete-${id}`, fingerprint, "pin-test", new AbortController().signal)
  try {
    for (const id of ids)
      await pool.query("INSERT INTO bff_project(project_id,tenant_id,owner_id,name,slug) VALUES($1,$2,$3,'Pin fixture',$1)", [id, tenantId, subjectId])
    const parent = async (id) => (await pool.query("SELECT to_jsonb(p) AS value,xmin::text AS xmin FROM bff_project p WHERE project_id=$1", [id])).rows[0]
    const before = await parent(ids[0])
    assert.deepEqual(await pins.listPins({ ...q(), limit: 1, position: null }), { items: [], nextPosition: null })
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
    assert.equal(await pins.listPins({ ...q(), subjectId: "other", limit: 1, position: null }), null)
    assert.equal(await pins.setPin({ ...q(), tenantId: "other", isPinned: false }), null)
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

integration("real PG shared Project pins remain personal and recheck grants after waiting for the Project lock", async (t) => {
  const url = new URL(databaseUrl)
  assert.match(url.pathname, /^\/kokoro_bff_project_pin_[0-9a-f]{32}$/u)
  const pool = new pg.Pool({ connectionString: databaseUrl, options: "-c search_path=kokoro_bff -c timezone=UTC", max: 5 })
  t.after(() => pool.end())
  const tenantId = `shared_pin_${randomUUID()}`,
    projectId = `project_${randomUUID()}`
  const owner = { tenantId, subjectId: "owner" },
    viewer = { tenantId, subjectId: "viewer" }
  const pins = createProjectPins({ pool }),
    grants = createProjectGrantStore(pool)
  const lifetime = () => ({ signal: new AbortController().signal, deadlineAt: performance.now() + 5000 })
  const set = (scope, isPinned) => pins.setPin({ ...scope, projectId, isPinned, ...lifetime() })
  const list = (scope, id = projectId) => pins.listPins({ ...scope, projectId: id, limit: 100, position: null, ...lifetime() })
  const grant = (version, role, key, expires_at = null) =>
    grants.mutate({
      ...owner,
      projectId,
      targetSubjectId: viewer.subjectId,
      expectedAccessVersion: version,
      body: { role, expires_at },
      receiptScope: JSON.stringify([tenantId, key]),
      fingerprint: key.padEnd(64, "a"),
      ...lifetime(),
    })
  await pool.query("INSERT INTO bff_project(project_id,tenant_id,owner_id,name,slug) VALUES($1,$2,$3,'Shared pin',$1)", [projectId, tenantId, owner.subjectId])
  assert.equal((await grant("1", "viewer", "viewer-pin")).kind, "committed")
  const parent = () =>
    pool.query("SELECT to_jsonb(p) AS value,xmin::text AS xmin FROM bff_project p WHERE tenant_id=$1 AND project_id=$2", [tenantId, projectId])
  const before = (await parent()).rows
  assert.deepEqual(await list(viewer), { items: [], nextPosition: null })
  const first = await set(viewer, true)
  assert.equal(first.isPinned, true, "viewer changes only their preference, not Project content")
  assert.deepEqual(await set(viewer, true), first)
  assert.deepEqual(await list(owner), { items: [], nextPosition: null }, "owner does not inherit a recipient's pin")
  await set(owner, true)
  await set(viewer, false)
  assert.equal((await list(owner)).items.length, 1)
  assert.equal((await list(viewer)).items.length, 0)
  assert.deepEqual((await parent()).rows, before, "pinning never updates shared Project metadata or access_version")
  assert.equal(await set({ ...viewer, tenantId: `${tenantId}_other` }, true), null)

  const blocker = await pool.connect()
  let waiting
  try {
    await blocker.query("BEGIN")
    const pid = (await blocker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid
    await blocker.query("SELECT project_id FROM bff_project WHERE tenant_id=$1 AND project_id=$2 FOR UPDATE", [tenantId, projectId])
    waiting = set(viewer, true)
    let observed = false
    const end = performance.now() + 5000
    while (performance.now() < end) {
      const result = await pool.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1::int=ANY(pg_blocking_pids(pid))) AS waiting", [pid])
      if (result.rows[0].waiting) {
        observed = true
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    assert.ok(observed, "pin mutation waits for the same Project lock used by grant mutations")
    await blocker.query("UPDATE bff_project_grant SET revoked_at=statement_timestamp() WHERE tenant_id=$1 AND project_id=$2 AND subject_id=$3", [
      tenantId,
      projectId,
      viewer.subjectId,
    ])
    await blocker.query("COMMIT")
    assert.equal(await waiting, null, "fresh read after the lock wait rejects the revoked grant")
  } finally {
    await blocker.query("ROLLBACK")
    blocker.release()
    if (waiting) await waiting
  }
  assert.equal(await list(viewer), null)
  assert.deepEqual(await list(viewer, null), { items: [], nextPosition: null })
  assert.equal((await grant("2", "editor", "editor-pin")).kind, "committed")
  assert.equal((await set(viewer, true)).isPinned, true)
  await pool.query("UPDATE bff_project_grant SET expires_at=statement_timestamp()-interval '1 second' WHERE tenant_id=$1 AND project_id=$2 AND subject_id=$3", [
    tenantId,
    projectId,
    viewer.subjectId,
  ])
  assert.deepEqual(await list(viewer, null), { items: [], nextPosition: null }, "expired grants filter previously pinned Projects")
  assert.equal(await set(viewer, false), null)
  assert.equal((await list(owner)).items.length, 1)
})
