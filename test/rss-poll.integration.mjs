import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import test from "node:test"
import { Pool } from "pg"
import { applyCanonicalSchema, loadCanonicalSchema } from "../scripts/apply-schema.mjs"
import { PostgresScheduledTaskRepository } from "../dist/infrastructure/postgres/scheduled-task-repository.js"
import { PostgresScheduledAgentDispatchRepository } from "../dist/infrastructure/postgres/scheduled-agent-dispatch-repository.js"
import { pauseProjectScheduledTasks } from "../dist/infrastructure/postgres/scheduled-task-repository.js"
import { PostgresScheduledTaskRunsReader } from "../dist/infrastructure/postgres/scheduled-task-runs.js"
import { listScheduledTaskRuns } from "../dist/application/scheduled-task-runs-service.js"
import { ScheduledTaskReadService } from "../dist/application/scheduled-task-read-service.js"
import { scheduledTaskDetails } from "../dist/application/scheduled/mappers.js"
import { PostgresRssPollRepository } from "../dist/infrastructure/postgres/rss-poll-repository.js"
import { RssPollService } from "../dist/application/rss-poll-service.js"
import { freezeRssLaunch } from "../dist/infrastructure/clients/agent/rss-launch.js"

const baseUrl = process.env.KOKORO_TEST_POSTGRES_URL
const enabled = Boolean(baseUrl && process.env.KOKORO_TEST_RSS_FRESH === "1")
async function until(check) {
  const end = performance.now() + 2000
  while (performance.now() < end) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.fail("owned RSS fixture cleanup did not finish")
}
test("RSS fresh PG: baseline, receipt, source lifecycle, atomic capacity, ordering and cancellation", { skip: !enabled }, async (t) => {
  const base = new URL(baseUrl)
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(base.hostname))
  const name = `i6_rss_poll_${randomUUID().replaceAll("-", "")}`,
    marker = `i6-rss-${randomUUID()}`
  const adminUrl = new URL(base)
  adminUrl.pathname = "/postgres"
  adminUrl.search = ""
  const admin = new Pool({ connectionString: adminUrl.toString(), max: 1, connectionTimeoutMillis: 1000 })
  const owned = new URL(base)
  owned.pathname = `/${name}`
  owned.search = "?schema=kokoro_bff"
  let pool,
    observer,
    created = false,
    oid
  const before = (await admin.query("SELECT oid::text,datname FROM pg_database ORDER BY oid")).rows
  try {
    await admin.query(`CREATE DATABASE "${name}"`)
    created = true
    await admin.query(`COMMENT ON DATABASE "${name}" IS '${marker}'`)
    oid = (await admin.query("SELECT oid::text FROM pg_database WHERE datname=$1", [name])).rows[0].oid
    await applyCanonicalSchema(owned.toString(), await loadCanonicalSchema())
    const options = { connectionString: owned.toString(), max: 4, options: "-c search_path=kokoro_bff -c timezone=UTC", connectionTimeoutMillis: 1000 }
    pool = new Pool(options)
    observer = new Pool(options)
    const tasks = new PostgresScheduledTaskRepository({ pool })
    const repository = new PostgresRssPollRepository(pool)
    const scope = { tenantId: "tenant", subjectId: "owner" }
    const lineage = (key) => ({ tenantId: "tenant", actorId: "owner", requestId: `request-${key}`, idempotencyKey: key })
    const make = async (id) =>
      tasks.createScheduledTask(
        scope,
        { triggerKind: "rss", feedUrl: "https://feed.example.org/rss", conditions: [], title: id, prompt: "Summarize", autoApprove: false },
        id,
        lineage(id),
      )
    const entry = (id) => ({
      identity: id.toString(16).padStart(64, "0"),
      title: `Entry ${id}`,
      summary: "",
      content: "",
      authors: [],
      categories: [],
      link: null,
      domain: null,
      publishedAt: null,
      updatedAt: null,
      enclosures: [],
    })
    let entries = [entry(1)],
      reads = 0,
      sequence = 0
    const service = new RssPollService({
      repository,
      read: async () => {
        reads++
        return new Uint8Array()
      },
      parse: () => entries,
      freezeLaunch: freezeRssLaunch,
    })
    const identity = (task, extra = {}) => ({
      tenantId: "tenant",
      subjectId: "owner",
      taskId: task.id,
      revision: task.revision,
      epoch: task.triggerEpoch,
      scope: `rss-test:${++sequence}`,
      digest: "a".repeat(64),
      requestId: "request",
      signal: new AbortController().signal,
      deadlineAt: performance.now() + 5000,
      ...extra,
    })
    const due = async (task) =>
      observer.query("UPDATE bff_scheduled_rss_poll SET next_poll_at=clock_timestamp()-interval '1 second' WHERE tenant_id='tenant' AND task_id=$1", [task.id])
    const count = async (table, task) =>
      (await observer.query(`SELECT count(*)::int AS n FROM ${table} WHERE tenant_id='tenant' AND task_id=$1`, [task.id])).rows[0].n
    let task = await make("baseline")
    await t.test("first baseline records identity, no dispatch; receipt replay performs no feed read", async () => {
      const input = identity(task),
        result = await service.poll(input)
      assert.equal(result.summary.outcome, "baseline")
      assert.equal(result.summary.enqueued_count, 0)
      assert.equal(await count("bff_scheduled_rss_seen", task), 1)
      assert.equal(await count("bff_scheduled_agent_dispatch", task), 0)
      const old = reads
      assert.deepEqual(await service.poll({ ...input, deadlineAt: performance.now() + 5000 }), result)
      assert.equal(reads, old)
      await due(task)
      entries = [{ ...entry(1), title: "Changed" }]
      assert.equal((await service.poll(identity(task))).summary.outcome, "unchanged")
      assert.equal(await count("bff_scheduled_agent_dispatch", task), 0)
    })
    await t.test("one fresh identity produces saved genuine launch; order survives repository recreation", async () => {
      entries = [entry(1), entry(3), entry(2)]
      await due(task)
      assert.equal((await service.poll(identity(task))).summary.enqueued_count, 2)
      const rows = (
        await observer.query(
          "SELECT source_item_identity,occurrence_order_key,source_observed_at,source_kind,payload FROM bff_scheduled_agent_dispatch WHERE task_id=$1 ORDER BY occurrence_order_key",
          [task.id],
        )
      ).rows
      assert.deepEqual(
        rows.map((x) => x.source_item_identity),
        [entry(2).identity, entry(3).identity],
      )
      assert.ok(rows.every((x) => x.source_kind === "rss" && x.source_observed_at instanceof Date && typeof x.payload.content === "string"))
      entries = [entry(4)]
      await due(task)
      const restarted = new RssPollService({
        repository: new PostgresRssPollRepository(pool),
        read: async () => new Uint8Array(),
        parse: () => entries,
        freezeLaunch: freezeRssLaunch,
      })
      assert.equal((await restarted.poll(identity(task))).summary.enqueued_count, 1)
      const high = (await observer.query("SELECT rss_order_high_watermark FROM bff_scheduled_agent_scope WHERE task_id=$1", [task.id])).rows[0]
        .rss_order_high_watermark
      assert.ok(high > rows[1].occurrence_order_key)
    })
    await t.test("prompt edit preserves epoch/seen; source change retires seen but preserves unknown dispatch", async () => {
      await observer.query(
        "UPDATE bff_scheduled_agent_dispatch SET admission_unknown_seen=true,status='retryable' WHERE task_id=$1 AND source_item_identity=$2",
        [task.id, entry(2).identity],
      )
      const first = task.triggerEpoch
      task = await tasks.updateScheduledTask(scope, task.id, { prompt: "New prompt" }, lineage("prompt"))
      assert.equal(task.triggerEpoch, first)
      assert.equal(await count("bff_scheduled_rss_seen", task), 4)
      task = await tasks.updateScheduledTask(
        scope,
        task.id,
        { triggerKind: "rss", feedUrl: "https://other.example.org/rss", conditions: [] },
        lineage("source"),
      )
      assert.equal(task.triggerEpoch, (BigInt(first) + 1n).toString())
      assert.equal(await count("bff_scheduled_rss_seen", task), 0)
      const preserved = (
        await observer.query("SELECT status,admission_unknown_seen FROM bff_scheduled_agent_dispatch WHERE task_id=$1 AND source_item_identity=$2", [
          task.id,
          entry(2).identity,
        ])
      ).rows[0]
      assert.deepEqual(preserved, { status: "retryable", admission_unknown_seen: true })
      entries = [entry(9)]
      assert.equal((await service.poll(identity(task))).summary.outcome, "baseline")
    })
    await t.test("two overlapping receipt transactions wait behind real poll lock, one lease wins", async () => {
      const fresh = await make("race"),
        blocker = await observer.connect(),
        pids = new Set()
      const acquire = (client) => pids.add(client.processID)
      pool.on("acquire", acquire)
      let first, second
      try {
        await blocker.query("BEGIN")
        await blocker.query("SELECT task_id FROM bff_scheduled_rss_poll WHERE task_id=$1 FOR UPDATE", [fresh.id])
        first = repository.claim(identity(fresh))
        second = repository.claim(identity(fresh))
        await until(
          async () =>
            pids.size >= 2 &&
            (
              await observer.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE pid=ANY($1::int[]) AND cardinality(pg_blocking_pids(pid))>0", [
                [...pids],
              ])
            ).rows[0].n >= 2,
        )
        await blocker.query("COMMIT")
        const results = await Promise.all([first, second])
        assert.deepEqual(results.map((x) => x.outcome).sort(), ["claimed", "pending"])
        const claim = results.find((x) => x.outcome === "claimed")
        const result = await repository.settle({ lease: claim.lease, entries: [], launches: [], error: null })
        assert.equal(result.outcome, "baseline")
      } finally {
        pool.off("acquire", acquire)
        await blocker.query("ROLLBACK")
        blocker.release()
        await Promise.allSettled([first, second].filter(Boolean))
      }
    })
    await t.test("100k seen retirement is bounded and lock timeout rolls whole source change back", async () => {
      const fresh = await make("retirement")
      await observer.query(
        `INSERT INTO bff_scheduled_rss_seen(tenant_id,task_id,source_epoch,item_identity,content_digest,first_poll_sequence,first_seen_at,matched,dispatch_id)
       SELECT 'tenant',$1,1,lpad(to_hex(n),64,'0'),$2,1,clock_timestamp(),false,NULL FROM generate_series(1,100000) n`,
        [fresh.id, "c".repeat(64)],
      )
      await observer.query(
        "UPDATE bff_scheduled_rss_poll SET initialized=true,poll_sequence=1,seen_count=100000,last_checked_at=clock_timestamp() WHERE task_id=$1",
        [fresh.id],
      )
      const snapshot = async () => {
        const tables = ["bff_scheduled_task", "bff_scheduled_rss_poll", "bff_scheduled_agent_dispatch", "bff_scheduled_agent_scope"]
        const facts = []
        for (const table of tables)
          facts.push(
            (
              await observer.query(`SELECT to_jsonb(r) AS row FROM ${table} r WHERE tenant_id='tenant' AND task_id=$1 ORDER BY to_jsonb(r)::text COLLATE "C"`, [
                fresh.id,
              ])
            ).rows,
          )
        facts.push(
          (
            await observer.query(
              "SELECT count(*)::text AS n,md5(string_agg(item_identity,',' ORDER BY item_identity COLLATE \"C\")) AS digest FROM bff_scheduled_rss_seen WHERE task_id=$1",
              [fresh.id],
            )
          ).rows,
        )
        return facts
      }
      const beforeFacts = await snapshot(),
        blocker = await observer.connect()
      try {
        await blocker.query("BEGIN")
        await blocker.query("SELECT item_identity FROM bff_scheduled_rss_seen WHERE task_id=$1 LIMIT 1 FOR UPDATE", [fresh.id])
        const start = performance.now()
        await assert.rejects(
          tasks.updateScheduledTask(
            scope,
            fresh.id,
            { triggerKind: "rss", feedUrl: "https://changed.example.org/rss", conditions: [] },
            lineage("retire-timeout"),
          ),
          (error) => error.code === "55P03" || error.code === "57014",
        )
        assert.ok(performance.now() - start < 5500)
        assert.deepEqual(await snapshot(), beforeFacts)
      } finally {
        await blocker.query("ROLLBACK")
        blocker.release()
      }
      const start = performance.now()
      const changed = await tasks.updateScheduledTask(
        scope,
        fresh.id,
        { triggerKind: "rss", feedUrl: "https://changed.example.org/rss", conditions: [] },
        lineage("retire-success"),
      )
      const elapsed = performance.now() - start
      assert.ok(elapsed < 5500)
      assert.equal(changed.triggerEpoch, "2")
      assert.equal(await count("bff_scheduled_rss_seen", fresh), 0)
      console.log(JSON.stringify({ oracle: "owned100kRetirement", elapsedMs: Math.round(elapsed), rows: 100000 }))
    })
    await t.test("stale in-flight settlement after pause cannot record seen or dispatch", async () => {
      const fresh = await make("paused"),
        claim = await repository.claim(identity(fresh))
      assert.equal(claim.outcome, "claimed")
      await tasks.updateScheduledTask(scope, fresh.id, { enabled: false, status: "paused" }, lineage("pause"))
      const result = await repository.settle({ lease: claim.lease, entries: [entry(20)], launches: [], error: null })
      assert.equal(result.outcome, "ineligible")
      assert.equal(await count("bff_scheduled_rss_seen", fresh), 0)
    })
    await t.test("capacity includes older epochs: whole poll rolls back fresh identities", async () => {
      let fresh = await make("capacity")
      entries = []
      await service.poll(identity(fresh))
      // Owned saturation fixture only: production admission and launch APIs are not bypassed in other cases.
      await observer.query(
        `INSERT INTO bff_scheduled_agent_dispatch(dispatch_id,tenant_id,task_id,source_kind,source_revision,source_epoch,source_item_identity,source_observed_at,occurrence,occurrence_order_key,subject_id,request_id,idempotency_key,request_digest,run_id,identity_assertion_ref,payload,status,admission_unknown_seen)
       SELECT 'capacity-'||n,'tenant',$1,'rss',1,1,lpad(to_hex(n),64,'0'),clock_timestamp(),'rss:1:'||lpad(to_hex(n),64,'0'),'2026-01-01T00:00:00.'||lpad(n::text,9,'0')||'Z','owner','request','capacity-'||n,$2,'capacity-run-'||n,'assertion','{}','retryable',true FROM generate_series(1,1000) n`,
        [fresh.id, "b".repeat(64)],
      )
      fresh = await tasks.updateScheduledTask(
        scope,
        fresh.id,
        { triggerKind: "rss", feedUrl: "https://next.example.org/rss", conditions: [] },
        lineage("capacity-epoch"),
      )
      assert.equal(fresh.triggerEpoch, "2")
      entries = []
      await service.poll(identity(fresh))
      entries = [entry(2001)]
      await due(fresh)
      const result = await service.poll(identity(fresh))
      assert.equal(result.summary.outcome, "backoff")
      assert.equal(await count("bff_scheduled_rss_seen", fresh), 0)
      assert.equal(await count("bff_scheduled_agent_dispatch", fresh), 1000)
      assert.equal(
        (await observer.query("SELECT last_error_code FROM bff_scheduled_rss_poll WHERE task_id=$1", [fresh.id])).rows[0].last_error_code,
        "queue_full",
      )
      await observer.query("DELETE FROM bff_scheduled_agent_dispatch WHERE dispatch_id='capacity-1000'")
      await observer.query(
        `INSERT INTO bff_scheduled_rss_seen(tenant_id,task_id,source_epoch,item_identity,content_digest,first_poll_sequence,first_seen_at,matched,dispatch_id)
       SELECT 'tenant',$1,2,lpad(to_hex(n),64,'0'),$2,1,clock_timestamp(),false,NULL FROM generate_series(1,99999) n`,
        [fresh.id, "c".repeat(64)],
      )
      await observer.query("UPDATE bff_scheduled_rss_poll SET seen_count=99999,last_error_code=NULL WHERE task_id=$1", [fresh.id])
      entries = [entry(1000001), entry(1000002)]
      await due(fresh)
      assert.equal((await service.poll(identity(fresh))).summary.outcome, "limit_reached")
      assert.equal(
        (await observer.query("SELECT last_error_code FROM bff_scheduled_rss_poll WHERE task_id=$1", [fresh.id])).rows[0].last_error_code,
        "limit_reached",
      )
      const priorReads = reads
      assert.equal((await service.poll(identity(fresh))).summary.outcome, "limit_reached")
      assert.equal(reads, priorReads)
      assert.equal(await count("bff_scheduled_rss_seen", fresh), 99999)
    })
    await t.test("caller cancellation releases exact pending lease for retry; lost COMMIT ACK preserves terminal receipt", async () => {
      const fresh = await make("cancel-retry"),
        controller = new AbortController(),
        input = identity(fresh, { signal: controller.signal })
      let entered
      const reading = new Promise((resolve) => (entered = resolve))
      const cancelling = new RssPollService({
        repository,
        read: async () => {
          entered()
          return new Promise(() => {})
        },
        parse: () => [],
        freezeLaunch: freezeRssLaunch,
      })
      const pending = cancelling.poll(input),
        rejection = assert.rejects(pending)
      await reading
      controller.abort()
      await rejection
      const row = (await observer.query("SELECT lease_token,lease_until FROM bff_scheduled_rss_poll WHERE task_id=$1", [fresh.id])).rows[0]
      assert.deepEqual(row, { lease_token: null, lease_until: null })
      entries = []
      const retry = await service.poll({ ...input, signal: new AbortController().signal, deadlineAt: performance.now() + 5000 })
      assert.equal(retry.summary.outcome, "baseline")
      const lost = await make("lost-ack"),
        lostInput = identity(lost)
      const lossy = new RssPollService({
        repository: {
          claim: (x) => repository.claim(x),
          release: (x) => repository.release(x),
          settle: async (x) => {
            await repository.settle(x)
            throw Error("simulated response lost after real COMMIT")
          },
        },
        read: async () => new Uint8Array(),
        parse: () => [],
        freezeLaunch: freezeRssLaunch,
      })
      await assert.rejects(lossy.poll(lostInput))
      const receipt = (await observer.query("SELECT response_body FROM bff_idempotency_receipt WHERE scope=$1", [lostInput.scope])).rows[0].response_body
      assert.equal(receipt.state, "terminal")
      const result = await service.poll({ ...lostInput, deadlineAt: performance.now() + 5000 })
      assert.equal(result.summary.outcome, "baseline")
      assert.deepEqual(
        (await observer.query("SELECT response_body FROM bff_idempotency_receipt WHERE scope=$1", [lostInput.scope])).rows[0].response_body,
        receipt,
      )
    })
    await t.test("blocked task lock abort destroys only owned lease client; no receipt remains", async () => {
      const fresh = await make("blocked"),
        blocker = await observer.connect(),
        controller = new AbortController()
      let pid
      const acquired = (client) => {
        pid = client.processID
      }
      pool.on("acquire", acquired)
      try {
        await blocker.query("BEGIN")
        await blocker.query("SELECT task_id FROM bff_scheduled_task WHERE task_id=$1 FOR UPDATE", [fresh.id])
        const input = identity(fresh, { signal: controller.signal, deadlineAt: performance.now() + 1500 })
        const pending = repository.claim(input),
          rejected = assert.rejects(pending)
        await until(async () => pid !== undefined && (await observer.query("SELECT cardinality(pg_blocking_pids($1))>0 AS blocked", [pid])).rows[0].blocked)
        controller.abort()
        await rejected
        await until(async () => (await observer.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE pid=$1", [pid])).rows[0].n === 0)
        assert.equal((await observer.query("SELECT count(*)::int AS n FROM bff_idempotency_receipt WHERE scope=$1", [input.scope])).rows[0].n, 0)
        assert.equal((await blocker.query("SELECT 1 AS ok")).rows[0].ok, 1)
      } finally {
        controller.abort()
        pool.off("acquire", acquired)
        await blocker.query("ROLLBACK")
        blocker.release()
      }
    })

    // Prior subcases intentionally retain recovery facts. These are our private fixture rows;
    // retire them only to isolate the global production dispatch claimant below.
    const isolate = async () => {
      await observer.query(
        "UPDATE bff_scheduled_agent_dispatch SET status='failed',admission_unknown_seen=false,admitted_at=NULL,completed_at=clock_timestamp(),lease_owner=NULL,lease_token=NULL,lease_until=NULL",
      )
      await observer.query("UPDATE bff_scheduled_agent_scope SET active_dispatch_id=NULL,active_run_id=NULL")
    }
    const dispatch = new PostgresScheduledAgentDispatchRepository({ pool })
    const claim = () => dispatch.claim({ workerId: "d1", leaseDurationMs: 30000, settlementReserveMs: 100, maxAttempts: 20 })
    const queued = async (id, projectId) => {
      let value = await tasks.createScheduledTask(
        scope,
        {
          triggerKind: "rss",
          feedUrl: "https://feed.example.org/rss",
          conditions: [],
          title: id,
          prompt: "Summarize",
          autoApprove: false,
          ...(projectId ? { projectId } : {}),
        },
        id,
        lineage(id),
      )
      entries = []
      await service.poll(identity(value, projectId ? { projectId } : {}))
      entries = [entry(700001)]
      await due(value)
      assert.equal((await service.poll(identity(value, projectId ? { projectId } : {}))).summary.enqueued_count, 1)
      return value
    }
    const head = async (value) =>
      (await observer.query("SELECT * FROM bff_scheduled_agent_dispatch WHERE task_id=$1 ORDER BY occurrence_order_key", [value.id])).rows[0]
    const active = async (value) =>
      (await observer.query("SELECT active_dispatch_id,active_run_id FROM bff_scheduled_agent_scope WHERE task_id=$1", [value.id])).rows[0]
    const blockedBy = async (pid) => {
      let waiting
      await until(async () => {
        waiting = (
          await observer.query("SELECT pid FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid)) AND datname=current_database() ORDER BY pid", [pid])
        ).rows[0]?.pid
        return waiting !== undefined
      })
      return waiting
    }
    await t.test("D1 real claim and pause lock order: pause wins, then claim wins without cancelling its lease", async () => {
      for (const pauseFirst of [true, false]) {
        await isolate()
        const value = await queued(`barrier-${pauseFirst}`),
          row = await head(value),
          blocker = await observer.connect()
        const running = []
        try {
          await blocker.query("BEGIN")
          await blocker.query("SELECT dispatch_id FROM bff_scheduled_agent_dispatch WHERE dispatch_id=$1 FOR UPDATE", [row.dispatch_id])
          const pause = () => tasks.updateScheduledTask(scope, value.id, { enabled: false, status: "paused" }, lineage(`pause-${pauseFirst}`))
          const first = pauseFirst ? pause() : claim()
          running.push(first)
          const firstPid = await blockedBy(blocker.processID)
          const second = pauseFirst ? claim() : pause()
          running.push(second)
          await blockedBy(firstPid)
          await blocker.query("COMMIT")
          const [a, b] = await Promise.all([first, second])
          const command = pauseFirst ? b : a
          if (pauseFirst) {
            assert.equal(command, null)
            assert.equal((await head(value)).status, "failed")
            assert.deepEqual(await active(value), { active_dispatch_id: null, active_run_id: null })
          } else {
            assert.equal(command.taskId, value.id)
            assert.equal((await head(value)).status, "leased")
            assert.deepEqual(await active(value), { active_dispatch_id: command.dispatchId, active_run_id: command.runId })
          }
        } finally {
          await blocker.query("ROLLBACK")
          blocker.release()
          await Promise.allSettled(running)
        }
      }
    })
    await t.test("D1 Project eligibility rejects deleted and foreign parents; normal parent claims", async () => {
      for (const mode of ["normal", "deleted", "foreign"]) {
        await isolate()
        const projectId = `project-${mode}`
        await observer.query("INSERT INTO bff_project(project_id,tenant_id,owner_id,name,slug) VALUES($1,'tenant','owner',$1,$1)", [projectId])
        const value = await queued(`parent-${mode}`, projectId)
        if (mode === "deleted") await observer.query("UPDATE bff_project SET deleted_at=clock_timestamp() WHERE project_id=$1", [projectId])
        if (mode === "foreign") await observer.query("UPDATE bff_project SET owner_id='other' WHERE project_id=$1", [projectId])
        const command = await claim()
        assert.equal(command?.taskId ?? null, mode === "normal" ? value.id : null)
        if (mode !== "normal") assert.equal((await head(value)).status, "failed")
      }
    })
    await t.test("D1 task owner is rechecked after waiting for the authoritative task lock", async () => {
      await isolate()
      const value = await queued("owner-lock-change"),
        blocker = await observer.connect()
      let pending
      try {
        await blocker.query("BEGIN")
        await blocker.query("SELECT task_id FROM bff_scheduled_task WHERE task_id=$1 FOR UPDATE", [value.id])
        pending = claim()
        await blockedBy(blocker.processID)
        await blocker.query("UPDATE bff_scheduled_task SET owner_id='foreign-owner' WHERE task_id=$1", [value.id])
        await blocker.query("COMMIT")
        assert.equal(await pending, null)
        assert.equal((await head(value)).status, "failed")
      } finally {
        await blocker.query("ROLLBACK")
        blocker.release()
        if (pending) await Promise.allSettled([pending])
      }
    })
    await t.test("D1 exact active release, new source continues, and mismatched run identity is never cleared", async () => {
      await isolate()
      let value = await queued("active-retire"),
        command = await claim()
      assert.equal(await dispatch.releaseNeverSent(command, 0), true)
      const unrelated = await queued("unrelated-active")
      const other = await head(unrelated)
      await observer.query("UPDATE bff_scheduled_agent_scope SET active_dispatch_id=$2,active_run_id=$3 WHERE task_id=$1", [
        unrelated.id,
        other.dispatch_id,
        other.run_id,
      ])
      const untouched = await active(unrelated)
      value = await tasks.updateScheduledTask(
        scope,
        value.id,
        { triggerKind: "rss", feedUrl: "https://next.example.org/rss", conditions: [] },
        lineage("retire-new-source"),
      )
      assert.deepEqual(await active(value), { active_dispatch_id: null, active_run_id: null })
      assert.deepEqual(await active(unrelated), untouched)
      assert.equal((await head(value)).status, "failed")
      // Clear only our unrelated test queue to make the global claim unambiguous.
      await observer.query("UPDATE bff_scheduled_agent_dispatch SET status='failed',completed_at=clock_timestamp() WHERE task_id=$1", [unrelated.id])
      await observer.query("UPDATE bff_scheduled_agent_scope SET active_dispatch_id=NULL,active_run_id=NULL WHERE task_id=$1", [unrelated.id])
      entries = []
      await service.poll(identity(value))
      entries = [entry(700002)]
      await due(value)
      await service.poll(identity(value))
      command = await claim()
      assert.equal(command.taskId, value.id)
      assert.equal(
        (await observer.query("SELECT source_epoch::text FROM bff_scheduled_agent_dispatch WHERE dispatch_id=$1", [command.dispatchId])).rows[0].source_epoch,
        "2",
      )
      assert.equal(await dispatch.releaseNeverSent(command, 0), true)
      // A deliberately inconsistent owned fixture distinguishes dispatch-only from exact pair cleanup.
      await observer.query("UPDATE bff_scheduled_agent_scope SET active_run_id='different-run' WHERE task_id=$1", [value.id])
      await tasks.updateScheduledTask(scope, value.id, { enabled: false, status: "paused" }, lineage("mismatch-pause"))
      assert.deepEqual(await active(value), { active_dispatch_id: command.dispatchId, active_run_id: "different-run" })
      // The claimant's independent ineligible path has the same exact-pair requirement.
      await observer.query("UPDATE bff_scheduled_agent_dispatch SET status='retryable',completed_at=NULL WHERE dispatch_id=$1", [command.dispatchId])
      assert.equal(await claim(), null)
      assert.deepEqual(await active(value), { active_dispatch_id: command.dispatchId, active_run_id: "different-run" })
    })
    await t.test("D1 unknown recovery survives A-B-A and RSS-calendar-RSS epochs plus task deletion with original identity", async () => {
      await isolate()
      let value = await queued("unknown-epochs")
      const original = await claim()
      assert.equal(await dispatch.markUnknown(original, 0, "controlled_unknown"), true)
      const frozen = (x) => ({
        subjectId: x.subjectId,
        runId: x.runId,
        idempotencyKey: x.idempotencyKey,
        identityAssertionRef: x.identityAssertionRef,
        payload: x.payload,
      })
      const baselineIdentity = frozen(original),
        activeBefore = await active(value)
      for (const [index, trigger] of [
        { triggerKind: "rss", feedUrl: "https://b.example.org/rss", conditions: [] },
        { triggerKind: "rss", feedUrl: "https://feed.example.org/rss", conditions: [] },
        { triggerKind: "calendar", frequency: "daily", time: "08:00", timezone: "UTC" },
        { triggerKind: "rss", feedUrl: "https://feed.example.org/rss", conditions: [] },
      ].entries()) {
        value = await tasks.updateScheduledTask(scope, value.id, trigger, lineage(`epoch-roundtrip-${index}`))
        assert.equal(value.triggerEpoch, String(index + 2))
        assert.equal(await count("bff_scheduled_rss_seen", value), 0)
        assert.deepEqual(await active(value), activeBefore)
      }
      assert.equal(await tasks.deleteScheduledTask(scope, value.id, lineage("unknown-delete")), true)
      const recovered = await new PostgresScheduledAgentDispatchRepository({ pool }).claim({
        workerId: "restart",
        leaseDurationMs: 30000,
        settlementReserveMs: 100,
        maxAttempts: 20,
      })
      assert.equal(recovered.admissionUnknownSeen, true)
      assert.deepEqual(frozen(recovered), baselineIdentity)
      assert.deepEqual(await active(value), activeBefore)
    })
    await t.test("D1 calendar-only edits/pause/delete/Project pause retain old dispatch; either kind switch retires never-sent", async () => {
      await isolate()
      const calendarRule = { triggerKind: "calendar", frequency: "daily", time: "08:00", timezone: "UTC" }
      for (const action of ["edit", "pause", "delete", "project", "to-rss"]) {
        const projectId = action === "project" ? "calendar-project" : undefined
        if (projectId) await observer.query("INSERT INTO bff_project(project_id,tenant_id,owner_id,name,slug) VALUES($1,'tenant','owner',$1,$1)", [projectId])
        const value = await tasks.createScheduledTask(
          scope,
          { ...calendarRule, title: `calendar-${action}`, prompt: "Calendar", autoApprove: false, ...(projectId ? { projectId } : {}) },
          `calendar-${action}`,
          lineage(`calendar-${action}`),
        )
        // Owned SQL only arranges an existing historical calendar dispatch, not the behavior under test.
        await observer.query(
          `INSERT INTO bff_scheduled_agent_dispatch(dispatch_id,tenant_id,task_id,source_kind,source_revision,source_epoch,occurrence,occurrence_order_key,subject_id,request_id,idempotency_key,request_digest,run_id,identity_assertion_ref,payload)
          VALUES($1,'tenant',$2,'calendar',1,1,$1,'2026-01-01T00:00:00.000000000Z','owner','request',$1,$3,$1,'assertion','{}')`,
          [`calendar-dispatch-${action}`, value.id, "d".repeat(64)],
        )
        const before = await head(value)
        if (action === "delete") await tasks.deleteScheduledTask(scope, value.id, lineage(`calendar-delete`))
        else if (action === "project") {
          const client = await pool.connect()
          try {
            await client.query("BEGIN")
            await client.query("SELECT project_id FROM bff_project WHERE project_id=$1 FOR UPDATE", [projectId])
            await pauseProjectScheduledTasks(client, scope, projectId, "project-pause", "project-pause")
            await client.query("UPDATE bff_project SET deleted_at=clock_timestamp() WHERE project_id=$1", [projectId])
            await client.query("COMMIT")
          } catch (error) {
            await client.query("ROLLBACK")
            throw error
          } finally {
            client.release()
          }
        } else
          await tasks.updateScheduledTask(
            scope,
            value.id,
            action === "to-rss"
              ? { triggerKind: "rss", feedUrl: "https://feed.example.org/rss", conditions: [] }
              : action === "pause"
                ? { enabled: false, status: "paused" }
                : { prompt: "Changed" },
            lineage(`calendar-${action}-update`),
          )
        const after = await head(value)
        if (action === "to-rss") assert.equal(after.status, "failed")
        else assert.deepEqual(after, before)
      }
      const value = await queued("rss-to-calendar"),
        before = await head(value)
      const changed = await tasks.updateScheduledTask(scope, value.id, calendarRule, lineage("rss-to-calendar"))
      assert.equal(changed.triggerEpoch, "2")
      assert.equal((await head(value)).dispatch_id, before.dispatch_id)
      assert.equal((await head(value)).status, "failed")
      assert.equal(await count("bff_scheduled_rss_seen", value), 0)
      assert.equal(await count("bff_scheduled_rss_poll", value), 0)
    })
    await t.test("D1 controlled same logical instant: two reverse 200 batches persist BigInt high water across restart and genuine reads", async () => {
      await isolate()
      const value = await make("two-batches"),
        fixed = "1767225599999999900"
      const clockSql = "SELECT clock_timestamp() AS now,(EXTRACT(EPOCH FROM clock_timestamp())*1000000000)::numeric(30,0)::text AS nanoseconds"
      const actualBefore = (await observer.query("SELECT clock_timestamp() AS now")).rows[0].now
      let clocks = 0
      const clockPool = {
        connect: async () => {
          const client = await pool.connect()
          return {
            query: async (text, values) => {
              const result = await client.query(text, values)
              if (text === clockSql) {
                clocks++
                return { ...result, rows: result.rows.map((row) => ({ ...row, nanoseconds: fixed })) }
              }
              return result
            },
            release: (...args) => client.release(...args),
            on: (...args) => client.on(...args),
            removeListener: (...args) => client.removeListener(...args),
            once: (...args) => client.once(...args),
          }
        },
      }
      const restarted = () =>
        new RssPollService({
          repository: new PostgresRssPollRepository(clockPool),
          read: async () => new Uint8Array(),
          parse: () => entries,
          freezeLaunch: freezeRssLaunch,
        })
      entries = []
      await restarted().poll(identity(value))
      let firstActive
      for (let batch = 0; batch < 2; batch++) {
        entries = Array.from({ length: 200 }, (_, i) => entry(800000 + batch * 200 + i)).reverse()
        await due(value)
        assert.equal((await restarted().poll(identity(value))).summary.enqueued_count, 200)
        if (batch === 0) {
          const command = await claim()
          assert.equal(command.taskId, value.id)
          firstActive = await active(value)
        } else assert.deepEqual(await active(value), firstActive)
      }
      assert.ok(clocks >= 6)
      const rows = (
        await observer.query(
          'SELECT source_item_identity,occurrence_order_key,source_observed_at FROM bff_scheduled_agent_dispatch WHERE task_id=$1 ORDER BY occurrence_order_key COLLATE "C"',
          [value.id],
        )
      ).rows
      assert.equal(rows.length, 400)
      assert.equal(new Set(rows.map((x) => x.source_item_identity)).size, 400)
      assert.deepEqual(
        rows.map((x) => x.source_item_identity),
        Array.from({ length: 400 }, (_, i) => entry(800000 + i).identity),
      )
      assert.equal(rows[0].occurrence_order_key, "2025-12-31T23:59:59.999999900Z")
      assert.equal(rows[399].occurrence_order_key, "2026-01-01T00:00:00.000000299Z")
      assert.ok(rows.every((x, i) => i === 0 || x.occurrence_order_key > rows[i - 1].occurrence_order_key))
      assert.equal(
        (await observer.query("SELECT rss_order_high_watermark FROM bff_scheduled_agent_scope WHERE task_id=$1", [value.id])).rows[0].rss_order_high_watermark,
        rows[399].occurrence_order_key,
      )
      // now remains the real PostgreSQL observation, not the controlled logical nanosecond value.
      const actualAfter = (await observer.query("SELECT clock_timestamp() AS now")).rows[0].now
      assert.ok(rows.every((x) => x.source_observed_at >= actualBefore && x.source_observed_at <= actualAfter))
      const reader = new ScheduledTaskReadService(
        { snapshots: (owner, signal, id) => tasks.readScheduledTaskSnapshots(owner, signal, id) },
        {
          read: async () => {
            throw Error("pending outbox must not call Scheduler")
          },
        },
      )
      const views = await reader.read(scope, "d1-read", new AbortController().signal, { taskId: value.id })
      const details = scheduledTaskDetails(views[0])
      assert.equal(details.trigger_kind, "rss")
      assert.equal(details.feed_state, "active")
      assert.equal(details.next_run_at, null)
      const query = { ...scope, taskId: value.id, limit: 100, position: null, signal: new AbortController().signal, deadlineAt: performance.now() + 5000 }
      const page = await listScheduledTaskRuns(new PostgresScheduledTaskRunsReader(pool), query, async () => {}, JSON.parse)
      assert.equal(page.items.length, 100)
      assert.ok(page.items.every((item) => item.trigger_kind === "rss" && item.scheduled_for === null && typeof item.observed_at === "string"))
      assert.equal(page.items[0].observed_at, rows[399].source_observed_at.toISOString())
    })
  } finally {
    await pool?.end()
    await observer?.end()
    if (created) {
      const check = (await admin.query("SELECT oid::text,shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=$1", [name])).rows
      assert.deepEqual(check, [{ oid, marker }])
      await until(async () => (await admin.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=$1", [name])).rows[0].n === 0)
      await admin.query(`DROP DATABASE "${name}"`)
      assert.equal((await admin.query("SELECT count(*)::int AS n FROM pg_database WHERE datname=$1", [name])).rows[0].n, 0)
    }
    assert.deepEqual((await admin.query("SELECT oid::text,datname FROM pg_database ORDER BY oid")).rows, before)
    await admin.end()
  }
})
