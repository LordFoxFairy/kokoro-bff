import { strictParseRawJson } from "../dist/infrastructure/raw-json.js"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { test } from "node:test"
import { Pool } from "pg"
import { applyCanonicalSchema, loadCanonicalSchema } from "../scripts/apply-schema.mjs"
import { PostgresScheduledTaskRunsReader } from "../dist/infrastructure/postgres/scheduled-task-runs.js"
import { listScheduledTaskRuns } from "../dist/application/scheduled-task-runs-service.js"
import { scheduledSourceEventDigest } from "../dist/application/scheduled-source-event-digest.js"

// A dedicated temporary database is created from the caller's existing loopback instance.
// No normal owner schema or Redis is accessed, no worker/Agent is started.
const baseUrl = process.env.KOKORO_TEST_POSTGRES_URL
const enabled = Boolean(baseUrl && process.env.KOKORO_TEST_SCHEDULED_RUNS_FRESH === "1")
async function until(check, milliseconds = 2000) {
  const deadline = performance.now() + milliseconds
  while (performance.now() < deadline) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.fail("owned fixture did not reach bounded cleanup state")
}
test("I4 fresh PG metadata: exact current qualification, terminal integrity, nanoseconds, changes and lease retirement", { skip: !enabled }, async (t) => {
  const base = new URL(baseUrl)
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(base.hostname), "existing loopback PG only")
  const name = `kokoro_i4_runs_${randomUUID().replaceAll("-", "")}`,
    marker = `i4-owned-${randomUUID()}`
  const adminUrl = new URL(base)
  adminUrl.pathname = "/postgres"
  adminUrl.search = ""
  const admin = new Pool({ connectionString: adminUrl.toString(), max: 1, connectionTimeoutMillis: 1000, application_name: "kokoro-i4-runs-fixture-admin" })
  const ownedUrl = new URL(base)
  ownedUrl.pathname = `/${name}`
  ownedUrl.search = "?schema=kokoro_bff"
  let pool,
    observer,
    created = false,
    oid
  try {
    const databasesBefore = (await admin.query("SELECT oid::text,datname FROM pg_database ORDER BY oid")).rows
    await admin.query(`CREATE DATABASE "${name}"`)
    created = true
    await admin.query(`COMMENT ON DATABASE "${name}" IS '${marker}'`)
    oid = (await admin.query("SELECT oid::text FROM pg_database WHERE datname=$1", [name])).rows[0].oid
    console.log(JSON.stringify({ fixture: name, oid, registered: true, normalDatabases: databasesBefore.length }))
    await applyCanonicalSchema(ownedUrl.toString(), await loadCanonicalSchema())
    pool = new Pool({
      connectionString: ownedUrl.toString(),
      max: 2,
      options: "-c search_path=kokoro_bff -c timezone=UTC",
      application_name: "kokoro-i4-runs-reader",
    })
    observer = new Pool({
      connectionString: ownedUrl.toString(),
      max: 2,
      options: "-c search_path=kokoro_bff -c timezone=UTC",
      application_name: "kokoro-i4-runs-observer",
    })
    assert.equal((await observer.query("SELECT current_database() AS name")).rows[0].name, name)
    assert.ok((await observer.query("SELECT to_regclass('kokoro_bff.ix_bff_scheduled_source_terminal_run') AS relation")).rows[0].relation)
    const reader = new PostgresScheduledTaskRunsReader(pool),
      query = (extra = {}) => ({
        tenantId: "tenant",
        subjectId: "owner",
        taskId: null,
        limit: 2,
        position: null,
        deadlineAt: performance.now() + 2000,
        signal: new AbortController().signal,
        ...extra,
      })
    const read = (q = query(), revalidate = async () => {}) => listScheduledTaskRuns(reader, q, revalidate, strictParseRawJson)
    const project = `project_${randomUUID()}`
    await observer.query("INSERT INTO bff_project(project_id,tenant_id,owner_id,name,slug) VALUES($1,'tenant','owner','Project','project')", [project])
    for (const [id, owner, parent, status] of [
      ["personal", "owner", null, "paused"],
      ["project", "owner", project, "failed"],
      ["foreign", "other", null, "active"],
      ["orphan", "owner", "missing", "active"],
    ]) {
      await observer.query(
        "INSERT INTO bff_scheduled_task(trigger_kind,trigger_epoch,task_id,tenant_id,owner_id,title,prompt,frequency,task_time,timezone,enabled,status,project_id) VALUES('calendar',1,$1,'tenant',$2,$1,'p','daily','08:00','UTC',FALSE,$3,$4)",
        [id, owner, status, parent],
      )
    }
    let sequence = 0
    const dispatch = async (task, order, options = {}) => {
      const id = `d${++sequence}`,
        run = `run${sequence}`,
        owner = task === "foreign" ? "other" : "owner",
        status = options.status ?? "pending"
      await observer.query(
        `INSERT INTO bff_scheduled_agent_dispatch(source_kind,source_revision,source_epoch,dispatch_id,tenant_id,task_id,occurrence,occurrence_order_key,subject_id,request_id,idempotency_key,request_digest,run_id,identity_assertion_ref,payload,status,admitted_at,completed_at)
        VALUES('calendar',1,1,$1,'tenant',$2,$3,$3,$4,'request',$1,$5,$6,'assertion','{}',$7,CASE WHEN $7 IN ('admitted','terminal') THEN CURRENT_TIMESTAMP ELSE NULL END,CASE WHEN $7 IN ('terminal','failed') THEN CURRENT_TIMESTAMP ELSE NULL END)`,
        [id, task, order, owner, "0".repeat(64), run, status],
      )
      return { id, run, task }
    }
    const newer = await dispatch("personal", "2026-10-21T00:00:00.000000009Z"),
      older = await dispatch("project", "2026-10-21T00:00:00.000000008Z")
    await dispatch("foreign", "2026-10-22T00:00:00.000000001Z")
    await dispatch("orphan", "2026-10-23T00:00:00.000000001Z")
    await t.test("eligibility precedes LIMIT; paused and disabled are historical qualification", async () => {
      const page = await read(query({ limit: 1 }))
      assert.equal(page.items[0].task_id, "personal")
      assert.deepEqual(page.nextPosition, { orderKey: "2026-10-21T00:00:00.000000009Z", dispatchId: newer.id })
      const next = await read(query({ limit: 1, position: page.nextPosition }))
      assert.equal(next.items[0].task_id, "project")
      assert.equal(next.nextPosition, null)
      assert.equal(await read(query({ taskId: "foreign" })), null)
      assert.equal(await read(query({ taskId: "orphan" })), null)
      assert.equal(await read(query({ tenantId: "other", taskId: "personal" })), null)
    })
    await t.test("current Project removal excludes its records and exact filtered read is private missing", async () => {
      await observer.query("UPDATE bff_project SET deleted_at=CURRENT_TIMESTAMP WHERE project_id=$1", [project])
      assert.deepEqual(
        (await read()).items.map((i) => i.task_id),
        ["personal"],
      )
      assert.equal(await read(query({ taskId: "project" })), null)
      await observer.query("UPDATE bff_project SET deleted_at=NULL WHERE project_id=$1", [project])
    })
    await t.test("final task revision and parent eligibility changes fail the whole snapshot", async () => {
      await assert.rejects(
        read(query(), async () => {
          await observer.query("UPDATE bff_scheduled_task SET revision=revision+1 WHERE task_id='personal'")
        }),
      )
      await assert.rejects(
        read(query(), async () => {
          await observer.query("UPDATE bff_project SET owner_id='other' WHERE project_id=$1", [project])
        }),
      )
      await observer.query("UPDATE bff_project SET owner_id='owner' WHERE project_id=$1", [project])
    })
    const terminal = async (d, sourceSequence = 1, payload = '{"status":"completed"}') => {
      const raw = {
        chat_event_id: `e${sourceSequence}`,
        session_id: `scheduled:${d.task}`,
        run_id: d.run,
        source_index: 0,
        event_type: "run.completed",
        payload_json: payload,
        seq: sourceSequence,
        created_at: 1792540800000,
      }
      await observer.query(
        `INSERT INTO bff_scheduled_agent_source_event(tenant_id,task_id,source_sequence,source_event_id,source_run_id,source_owner,source_digest,source_occurred_at,event_type,source_payload) VALUES('tenant',$1,$2,$3,$4,'kokoro-agent',$5,$6,'run.completed',$7)`,
        [d.task, sourceSequence, raw.chat_event_id, d.run, scheduledSourceEventDigest(raw), new Date(raw.created_at), raw],
      )
    }
    await t.test("strict exact terminal identity, conflicting terminals and raw byte markers", async () => {
      await observer.query(
        "UPDATE bff_scheduled_agent_dispatch SET status='terminal',admitted_at=CURRENT_TIMESTAMP,completed_at=CURRENT_TIMESTAMP WHERE dispatch_id=$1",
        [older.id],
      )
      await terminal(older)
      assert.equal((await read(query({ taskId: "project" }))).items[0].state, "completed")
      await terminal(older, 2)
      await assert.rejects(read(query({ taskId: "project" })))
      await observer.query("DELETE FROM bff_scheduled_agent_source_event WHERE tenant_id='tenant' AND task_id='project' AND source_sequence=2")
      await observer.query("UPDATE bff_scheduled_agent_source_event SET source_digest=$1 WHERE task_id='project'", ["f".repeat(64)])
      await assert.rejects(read(query({ taskId: "project" })))
      await observer.query(
        "UPDATE bff_scheduled_agent_source_event SET source_payload=jsonb_set(source_payload,'{payload_json}',to_jsonb(repeat('x',65537))) WHERE task_id='project'",
      )
      const snapshot = await reader.readSnapshot(query({ taskId: "project" }))
      assert.equal(snapshot.rows[0].terminals[0].payload, null)
      await assert.rejects(read(query({ taskId: "project" })))
    })
    await t.test("PG bounds metadata before transfer and exact saturated late checkout returns with zero SQL", async () => {
      await observer.query("UPDATE bff_scheduled_task SET title=repeat('x',1048577) WHERE task_id='personal'")
      await assert.rejects(reader.readSnapshot(query({ taskId: "personal" })))
      await observer.query("UPDATE bff_scheduled_task SET title='personal' WHERE task_id='personal'")
      const held = [await pool.connect(), await pool.connect()],
        controller = new AbortController(),
        acquired = [],
        released = []
      const onAcquire = (client) => acquired.push(client),
        onRelease = (error, client) => {
          if (acquired.includes(client)) released.push({ error, client })
        }
      pool.on("acquire", onAcquire)
      pool.on("release", onRelease)
      try {
        const started = performance.now(),
          pending = reader.readSnapshot(query({ signal: controller.signal })),
          rejected = assert.rejects(pending)
        await until(() => pool.waitingCount === 1)
        controller.abort()
        await rejected
        assert.ok(performance.now() - started < 800)
        assert.equal(pool.waitingCount, 1)
        assert.deepEqual(acquired, [])
        const exact = held[0],
          before = (await observer.query("SELECT query,query_start::text,state FROM pg_stat_activity WHERE pid=$1", [exact.processID])).rows
        held.shift().release()
        await until(() => released.length === 1 && pool.waitingCount === 0)
        assert.equal(acquired[0], exact)
        assert.equal(released[0].client, exact)
        assert.equal(released[0].error, undefined)
        assert.deepEqual((await observer.query("SELECT query,query_start::text,state FROM pg_stat_activity WHERE pid=$1", [exact.processID])).rows, before)
        assert.equal(held.length, 1)
        assert.equal(pool.idleCount, 1)
      } finally {
        controller.abort()
        pool.off("acquire", onAcquire)
        pool.off("release", onRelease)
        for (const client of held) client.release()
      }
      await until(() => pool.waitingCount === 0 && pool.idleCount === 2)
      assert.equal((await read(query({ taskId: "personal" }))).items.length, 1)
    })
    await t.test("noncooperative blocked SQL destroys only acquired backend and pool recovers", async () => {
      const blocker = await observer.connect(),
        survivor = await pool.connect(),
        controller = new AbortController()
      let pid
      const acquired = (client) => {
        pid = client.processID
      }
      pool.on("acquire", acquired)
      try {
        const survivorPid = survivor.processID
        await blocker.query("BEGIN")
        await blocker.query("LOCK TABLE bff_scheduled_task IN ACCESS EXCLUSIVE MODE")
        // Keep the server lock timeout inside the unchanged 2s backend-retirement observation window.
        const pending = reader.readSnapshot(query({ signal: controller.signal, deadlineAt: performance.now() + 1000 })),
          rejected = assert.rejects(pending)
        await until(async () => pid !== undefined && (await observer.query("SELECT cardinality(pg_blocking_pids($1))>0 AS blocked", [pid])).rows[0].blocked)
        controller.abort()
        await rejected
        await until(async () => (await observer.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE pid=$1", [pid])).rows[0].n === 0)
        assert.equal((await survivor.query("SELECT pg_backend_pid() AS pid")).rows[0].pid, survivorPid)
      } finally {
        controller.abort()
        pool.off("acquire", acquired)
        await blocker.query("ROLLBACK")
        blocker.release()
        survivor.release()
      }
      assert.equal((await read(query({ taskId: "personal" }))).items.length, 1)
    })
    await pool.end()
    pool = undefined
    await observer.end()
    observer = undefined
    await until(async () => (await admin.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=$1", [name])).rows[0].n === 0)
    assert.equal((await admin.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=$1", [name])).rows[0].n, 0)
    const before = databasesBefore.filter((row) => row.datname !== name)
    assert.deepEqual((await admin.query("SELECT oid::text,datname FROM pg_database WHERE datname<>$1 ORDER BY oid", [name])).rows, before)
  } finally {
    await pool?.end()
    await observer?.end()
    if (created) {
      const check = (await admin.query("SELECT oid::text,shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=$1", [name])).rows
      assert.deepEqual(check, [{ oid, marker }])
      await until(async () => (await admin.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=$1", [name])).rows[0].n === 0)
      assert.equal((await admin.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=$1", [name])).rows[0].n, 0)
      await admin.query(`DROP DATABASE "${name}"`)
      assert.equal((await admin.query("SELECT count(*)::int AS n FROM pg_database WHERE datname=$1", [name])).rows[0].n, 0)
      console.log(JSON.stringify({ fixture: name, oid, removed: true, remainingBackends: 0, redisAccess: false }))
    }
    await admin.end()
  }
})
