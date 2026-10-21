import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { createServer } from "node:net"
import { test } from "node:test"
import { Pool } from "pg"
import { PostgresBffDatabase } from "../dist/infrastructure/postgres/client.js"
import { findActiveResourceProjectId } from "../dist/infrastructure/postgres/project-resource-access.js"

// Root must supply its isolated installed temporary database explicitly. No database or schema is created here.
const postgresUrl = process.env.KOKORO_TEST_POSTGRES_URL
const ownedDatabase = process.env.KOKORO_TEST_PROJECT_RESOURCE_DATABASE
const enabled = Boolean(postgresUrl && ownedDatabase)
async function until(check, milliseconds = 2000) {
  const deadline = performance.now() + milliseconds
  while (performance.now() < deadline) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.fail("owned resource did not reach its bounded cleanup state")
}

test("real PG Project resource leases: current scope, saturated pool, exact blocked backend retirement and recovery", { skip: !enabled }, async () => {
  const url = new URL(postgresUrl)
  assert.equal(decodeURIComponent(url.pathname.slice(1)), ownedDatabase, "explicit Root-owned temporary database only")
  assert.ok(!["postgres", "template0", "template1"].includes(ownedDatabase))
  const database = new PostgresBffDatabase(postgresUrl, "redis://127.0.0.1:1/8")
  const observer = new Pool({ connectionString: postgresUrl, max: 2, connectionTimeoutMillis: 1000, options: "-c search_path=kokoro_bff" })
  const suffix = randomUUID(),
    scope = { tenantId: `i3-${suffix}`, subjectId: `owner-${suffix}` }
  const projectId = `project_${randomUUID()}`,
    slug = `i3-${suffix}`
  let inserted = false
  try {
    assert.equal((await observer.query("SELECT current_database() AS name")).rows[0].name, ownedDatabase)
    assert.ok((await observer.query("SELECT to_regclass('kokoro_bff.bff_project') AS relation")).rows[0].relation)
    await observer.query("INSERT INTO bff_project(project_id,tenant_id,owner_id,name,slug) VALUES($1,$2,$3,$4,$4)", [
      projectId,
      scope.tenantId,
      scope.subjectId,
      slug,
    ])
    inserted = true
    const read = (current = scope, ref = projectId, signal = new AbortController().signal, deadline = performance.now() + 3000) =>
      findActiveResourceProjectId(database, current, ref, signal, deadline)
    assert.equal(await read(scope, slug), projectId)
    assert.equal(await read({ ...scope, subjectId: "other" }), null)
    assert.equal(await read({ ...scope, tenantId: "other" }), null)
    await observer.query("UPDATE bff_project SET deleted_at=CURRENT_TIMESTAMP WHERE project_id=$1 AND tenant_id=$2", [projectId, scope.tenantId])
    assert.equal(await read(), null)
    await observer.query("UPDATE bff_project SET deleted_at=NULL WHERE project_id=$1 AND tenant_id=$2", [projectId, scope.tenantId])

    const held = [],
      acquisitions = [],
      releases = [],
      cancellation = new AbortController(),
      acquireListeners = database.pool.listeners("acquire"),
      releaseListeners = database.pool.listeners("release")
    const onLateAcquire = (client) => acquisitions.push(client)
    const onLateRelease = (error, client) => {
      if (acquisitions.includes(client)) releases.push({ client, error })
    }
    let pending
    try {
      for (let index = 0; index < 10; index++) held.push(await database.pool.connect())
      database.pool.on("acquire", onLateAcquire)
      database.pool.on("release", onLateRelease)
      const started = performance.now()
      pending = read(scope, projectId, cancellation.signal)
      const rejection = assert.rejects(pending)
      await until(() => database.pool.waitingCount === 1)
      cancellation.abort()
      await rejection
      assert.ok(performance.now() - started < 800, "caller does not wait for pool checkout")
      assert.equal(database.pool.waitingCount, 1, "caller cancellation does not claim to cancel the public Pool checkout")
      assert.deepEqual(acquisitions, [])
      assert.deepEqual(releases, [])
      assert.equal(database.pool.totalCount, 10)
      assert.equal(database.pool.idleCount, 0)
      const returned = held[0]
      const activity = async () =>
        (
          await observer.query("SELECT query,query_start::text AS query_start,state,xact_start::text AS xact_start FROM pg_stat_activity WHERE pid=$1", [
            returned.processID,
          ])
        ).rows
      const beforeLate = await activity()
      assert.equal(beforeLate.length, 1)
      assert.equal(beforeLate[0].state, "idle")
      assert.equal(beforeLate[0].xact_start, null)
      held.shift().release()
      await until(() => releases.length === 1 && database.pool.waitingCount === 0 && database.pool.idleCount === 1)
      assert.deepEqual(acquisitions, [returned], "the exact returned lease serves the already retired checkout")
      assert.equal(releases[0].client, returned)
      assert.equal(releases[0].error, undefined, "an unbegun late lease returns normally exactly once")
      assert.equal(returned.listenerCount("error"), 1, "only the Pool idle error listener remains")
      assert.deepEqual(await activity(), beforeLate, "the exact late backend executes no SQL or transaction")
      assert.equal(held.length, 9)
      assert.equal(database.pool.totalCount, 10)
      assert.equal(database.pool.idleCount, 1, "the other nine leases remain held")
    } finally {
      cancellation.abort()
      database.pool.off("acquire", onLateAcquire)
      database.pool.off("release", onLateRelease)
      for (const lease of held) lease.release()
      if (pending) await pending.catch(() => undefined)
      await until(() => database.pool.waitingCount === 0 && database.pool.idleCount === database.pool.totalCount)
    }
    assert.deepEqual(database.pool.listeners("acquire"), acquireListeners)
    assert.deepEqual(database.pool.listeners("release"), releaseListeners)
    assert.deepEqual(
      {
        total: database.pool.totalCount,
        idle: database.pool.idleCount,
        waiting: database.pool.waitingCount,
      },
      { total: 10, idle: 10, waiting: 0 },
    )
    assert.equal(await read(), projectId, "pool recovers after pending checkout cancellation")

    const blocker = await observer.connect(),
      survivor = await database.pool.connect()
    let blockedPid
    const onAcquire = (client) => {
      blockedPid = client.processID
    }
    database.pool.on("acquire", onAcquire)
    try {
      const survivorPid = (await survivor.query("SELECT pg_backend_pid() AS pid")).rows[0].pid
      await blocker.query("BEGIN")
      // Only the explicitly owned temporary database is locked; ordinary row locks do not block this SELECT.
      await blocker.query("LOCK TABLE bff_project IN ACCESS EXCLUSIVE MODE")
      const cancellation = new AbortController()
      const pending = read(scope, projectId, cancellation.signal)
      const rejection = assert.rejects(pending)
      await until(
        async () => blockedPid !== undefined && (await observer.query("SELECT cardinality(pg_blocking_pids($1)) > 0 AS blocked", [blockedPid])).rows[0].blocked,
      )
      cancellation.abort()
      await rejection
      await until(async () => (await observer.query("SELECT count(*)::int AS count FROM pg_stat_activity WHERE pid=$1", [blockedPid])).rows[0].count === 0)
      assert.equal((await survivor.query("SELECT pg_backend_pid() AS pid")).rows[0].pid, survivorPid, "another exact lease is untouched")
    } finally {
      database.pool.off("acquire", onAcquire)
      await blocker.query("ROLLBACK")
      blocker.release()
      survivor.release()
    }
    assert.equal(await read(), projectId, "fresh owner query succeeds after exact backend retirement")

    const closed = createServer()
    await new Promise((resolve) => closed.listen(0, "127.0.0.1", resolve))
    const port = closed.address().port
    await new Promise((resolve) => closed.close(resolve))
    const failedUrl = new URL(postgresUrl)
    failedUrl.hostname = "127.0.0.1"
    failedUrl.port = String(port)
    const failed = new PostgresBffDatabase(failedUrl.toString(), "redis://127.0.0.1:1/8")
    try {
      const started = performance.now()
      await assert.rejects(findActiveResourceProjectId(failed, scope, projectId, new AbortController().signal, started + 2000))
      assert.ok(performance.now() - started < 2000)
      assert.equal(failed.pool.waitingCount, 0)
    } finally {
      await failed.close()
    }
  } finally {
    if (inserted)
      await observer.query("DELETE FROM bff_project WHERE project_id=$1 AND tenant_id=$2 AND owner_id=$3", [projectId, scope.tenantId, scope.subjectId])
    await database.close()
    await observer.end()
  }
})
