import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { test } from "node:test"
import { Pool } from "pg"
import { PostgresBffRepositories } from "../dist/infrastructure/postgres/repositories.js"
import { scheduledSourceEventDigest } from "../dist/application/scheduled-source-event-digest.js"
import { buildScheduledAgentLaunch } from "../dist/infrastructure/clients/agent/launch.js"
import { schedulerDispatchDigest, schedulerDispatchScope, schedulerOccurrenceIdentity } from "../dist/infrastructure/clients/scheduler/dispatch-identity.js"
import { schedulerScheduleName } from "../dist/infrastructure/clients/scheduler/schedule.js"
const postgresUrl = process.env.KOKORO_TEST_POSTGRES_URL,
  redisUrl = process.env.KOKORO_TEST_REDIS_URL
const integrationTest = postgresUrl && redisUrl ? test : test.skip

async function waitForBlockedBy(pool, blockerPid) {
  const deadline = Date.now() + 3000
  while (Date.now() < deadline) {
    const result = await pool.query("SELECT 1 FROM pg_stat_activity a WHERE $1 = ANY(pg_blocking_pids(a.pid)) AND a.wait_event_type='Lock'", [blockerPid])
    if (result.rowCount > 0) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error("scheduled barrier did not block on the expected backend")
}
async function waitForBlockedCount(pool, blockerPid, expected) {
  const deadline = Date.now() + 3000
  while (Date.now() < deadline) {
    const result = await pool.query("SELECT count(*)::int count FROM pg_stat_activity a WHERE $1 = ANY(pg_blocking_pids(a.pid)) AND a.wait_event_type='Lock'", [
      blockerPid,
    ])
    if (result.rows[0].count >= expected) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error("scheduled barrier did not observe every expected waiter")
}
integrationTest("scheduled scope fixes the active head and advances a session-level terminal cursor", async () => {
  const pool = new Pool({
    connectionString: postgresUrl,
    options: "-c search_path=kokoro_bff -c timezone=UTC",
  })
  let store
  const tenant = "scheduled_gate"
  try {
    await pool.query(
      "DROP TABLE IF EXISTS bff_scheduled_agent_source_event,bff_scheduled_agent_dispatch,bff_scheduled_agent_scope,bff_agui_cursor_tombstone,bff_agui_event,bff_agui_source_event,bff_conversation_artifact,bff_agui_stream,bff_agent_cancellation_outbox,bff_agent_dispatch_outbox,bff_share,bff_message,bff_conversation,bff_idempotency_receipt,bff_scheduled_task_outbox,bff_scheduled_task,bff_project_instruction_revision,bff_project CASCADE",
    )
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    store = new PostgresBffRepositories(postgresUrl, redisUrl)
    const task = "task",
      session = "scheduled:task",
      subject = "owner"
    await pool.query("INSERT INTO bff_scheduled_agent_scope(tenant_id,task_id,session_id,subject_id) VALUES($1,$2,$3,$4)", [tenant, task, session, subject])
    const launchPayload = (taskId, runId, requestId) =>
      JSON.stringify({
        request_id: requestId,
        run_id: runId,
        session_id: `scheduled:${taskId}`,
        feature_key: "chat",
        message_id: `message_${runId}`,
        content: "go",
        selected_skill_source_refs: [],
        trace: { source: "kokoro-bff-scheduler" },
      })
    const insert = async (id, order, run) =>
      pool.query(
        `INSERT INTO bff_scheduled_agent_dispatch(dispatch_id,tenant_id,task_id,occurrence,occurrence_order_key,subject_id,request_id,idempotency_key,request_digest,run_id,identity_assertion_ref,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)`,
        [
          id,
          tenant,
          task,
          order.replace(".000000000Z", "Z"),
          order,
          subject,
          `request_${id}`,
          `key_${id}`,
          "a".repeat(64),
          run,
          "bff:x",
          JSON.stringify({
            request_id: `request_${id}`,
            run_id: run,
            session_id: session,
            feature_key: "chat",
            message_id: `message_${id}`,
            content: "go",
            selected_skill_source_refs: [],
            trace: { source: "kokoro-bff-scheduler" },
          }),
        ],
      )
    await insert("a", "2026-09-01T12:00:02.000000000Z", "run_a")
    const a = await store.scheduledAgentDispatch.claim({
      workerId: "worker",
      leaseDurationMs: 5000,
      settlementReserveMs: 50,
      maxAttempts: 8,
    })
    assert.equal(a?.runId, "run_a")
    await insert("b", "2026-09-01T12:00:01.000000000Z", "run_b")
    assert.equal(
      await store.scheduledAgentDispatch.claim({
        workerId: "other",
        leaseDurationMs: 5000,
        settlementReserveMs: 50,
        maxAttempts: 8,
      }),
      null,
    )
    const otherTask = "task_ready"
    await pool.query("INSERT INTO bff_scheduled_agent_scope(tenant_id,task_id,session_id,subject_id) VALUES($1,$2,$3,$4)", [
      tenant,
      "task_future",
      "scheduled:task_future",
      subject,
    ])
    await pool.query("INSERT INTO bff_scheduled_agent_scope(tenant_id,task_id,session_id,subject_id) VALUES($1,$2,$3,$4)", [
      tenant,
      otherTask,
      `scheduled:${otherTask}`,
      subject,
    ])
    await pool.query(
      `INSERT INTO bff_scheduled_agent_dispatch(dispatch_id,tenant_id,task_id,occurrence,occurrence_order_key,subject_id,request_id,idempotency_key,request_digest,run_id,identity_assertion_ref,payload,status,available_at) VALUES('future',$1,'task_future','2026-09-01T12:00:00Z','2026-09-01T12:00:00.000000000Z',$2,'qf','kf',$3,'run_future','bff:x',$4::jsonb,'retryable',clock_timestamp()+interval '1 hour')`,
      [tenant, subject, "c".repeat(64), launchPayload("task_future", "run_future", "qf")],
    )
    await pool.query(
      `INSERT INTO bff_scheduled_agent_dispatch(dispatch_id,tenant_id,task_id,occurrence,occurrence_order_key,subject_id,request_id,idempotency_key,request_digest,run_id,identity_assertion_ref,payload) VALUES('ready',$1,$2,'2026-09-01T12:00:00Z','2026-09-01T12:00:00.000000000Z',$3,'qr','kr',$4,'run_ready','bff:x',$5::jsonb)`,
      [tenant, otherTask, subject, "d".repeat(64), launchPayload(otherTask, "run_ready", "qr")],
    )
    const ready = await store.scheduledAgentDispatch.claim({
      workerId: "ready_worker",
      leaseDurationMs: 5000,
      settlementReserveMs: 50,
      maxAttempts: 8,
    })
    assert.equal(ready?.runId, "run_ready")
    assert.equal(await store.scheduledAgentDispatch.markNotAdmitted(ready, 0, "fixture_not_admitted"), true)

    const orderedTask = "task_ordered"
    await pool.query("INSERT INTO bff_scheduled_agent_scope(tenant_id,task_id,session_id,subject_id) VALUES($1,$2,$3,$4)", [
      tenant,
      orderedTask,
      `scheduled:${orderedTask}`,
      subject,
    ])
    const orderedInsert = async (dispatchId, occurrence, order, runId) =>
      pool.query(
        `INSERT INTO bff_scheduled_agent_dispatch(dispatch_id,tenant_id,task_id,occurrence,occurrence_order_key,subject_id,request_id,idempotency_key,request_digest,run_id,identity_assertion_ref,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'bff:x',$11::jsonb)`,
        [
          dispatchId,
          tenant,
          orderedTask,
          occurrence,
          order,
          subject,
          `q_${dispatchId}`,
          `k_${dispatchId}`,
          dispatchId.repeat(64).slice(0, 64),
          runId,
          launchPayload(orderedTask, runId, `q_${dispatchId}`),
        ],
      )
    await orderedInsert("f", "2026-09-01T12:00:00.000000010Z", "2026-09-01T12:00:00.000000010Z", "run_later")
    await orderedInsert("e", "2026-09-01T12:00:00.000000001Z", "2026-09-01T12:00:00.000000001Z", "run_earlier")
    const competing = await Promise.all([
      store.scheduledAgentDispatch.claim({
        workerId: "left",
        leaseDurationMs: 5000,
        settlementReserveMs: 50,
        maxAttempts: 8,
      }),
      store.scheduledAgentDispatch.claim({
        workerId: "right",
        leaseDurationMs: 5000,
        settlementReserveMs: 50,
        maxAttempts: 8,
      }),
    ])
    assert.deepEqual(competing.map((claim) => claim?.runId ?? null).sort(), [null, "run_earlier"])
    const earlier = competing.find((claim) => claim !== null)
    assert.equal(await store.scheduledAgentDispatch.markNotAdmitted(earlier, 0, "fixture_not_admitted"), true)
    const later = await store.scheduledAgentDispatch.claim({
      workerId: "later",
      leaseDurationMs: 5000,
      settlementReserveMs: 50,
      maxAttempts: 8,
    })
    assert.equal(later?.runId, "run_later")
    assert.equal(await store.scheduledAgentDispatch.markUnknown(later, 0, "timeout"), true)
    const sticky = await store.scheduledAgentDispatch.claim({
      workerId: "sticky",
      leaseDurationMs: 5000,
      settlementReserveMs: 50,
      maxAttempts: 8,
    })
    assert.equal(sticky?.runId, "run_later")
    assert.equal(await store.scheduledAgentDispatch.markNotAdmitted(sticky, 0, "late_rejection"), true)
    assert.deepEqual((await pool.query("SELECT status,admission_unknown_seen FROM bff_scheduled_agent_dispatch WHERE dispatch_id='f'")).rows, [
      { status: "retryable", admission_unknown_seen: true },
    ])
    const neverSent = await store.scheduledAgentDispatch.claim({
      workerId: "never_sent",
      leaseDurationMs: 5000,
      settlementReserveMs: 50,
      maxAttempts: 8,
    })
    assert.equal(neverSent?.runId, "run_later")
    assert.equal(await store.scheduledAgentDispatch.releaseNeverSent(neverSent, 0), true)
    assert.deepEqual(
      (
        await pool.query(
          "SELECT d.status,d.admission_unknown_seen,s.active_dispatch_id,s.active_run_id FROM bff_scheduled_agent_dispatch d JOIN bff_scheduled_agent_scope s ON s.tenant_id=d.tenant_id AND s.task_id=d.task_id WHERE d.dispatch_id='f'",
        )
      ).rows,
      [
        {
          status: "retryable",
          admission_unknown_seen: true,
          active_dispatch_id: "f",
          active_run_id: "run_later",
        },
      ],
    )
    await pool.query("DELETE FROM bff_scheduled_agent_dispatch WHERE tenant_id=$1 AND task_id=$2", [tenant, orderedTask])
    await pool.query("DELETE FROM bff_scheduled_agent_scope WHERE tenant_id=$1 AND task_id=$2", [tenant, orderedTask])

    const consumer = await store.scheduledAgentDispatch.claimConsumer({
      workerId: "consumer",
      leaseDurationMs: 5000,
      settlementReserveMs: 50,
    })
    assert.ok(consumer)
    assert.equal(consumer.sourceHighWatermark, 0)
    const payload = {
      chat_event_id: "event_1",
      session_id: session,
      run_id: "run_a",
      source_index: 0,
      chat_message_id: null,
      event_type: "run.completed",
      payload_json: '{"status":"completed"}',
      seq: 1,
      created_at: Date.now(),
    }
    const malformedFailure = {
      ...payload,
      chat_event_id: "bad_failure",
      event_type: "run.failed",
      payload_json: '{"status":"failed","code":"invented","retryable":false}',
    }
    await assert.rejects(
      store.scheduledAgentDispatch.commitSourcePage(
        consumer,
        [
          {
            sourceSequence: 1,
            sourceEventId: "bad_failure",
            sourceRunId: "run_a",
            sourceDigest: scheduledSourceEventDigest(malformedFailure),
            sourceOccurredAt: new Date(payload.created_at).toISOString(),
            eventType: "run.failed",
            sourcePayload: malformedFailure,
          },
        ],
        1,
        false,
      ),
      /SOURCE_IDENTITY_INVALID/,
    )
    assert.deepEqual(
      (await pool.query("SELECT source_sequence FROM bff_scheduled_agent_source_event WHERE tenant_id=$1 AND task_id=$2", [tenant, task])).rows,
      [],
    )

    await assert.rejects(
      store.scheduledAgentDispatch.commitSourcePage(
        consumer,
        [
          {
            sourceSequence: 1,
            sourceEventId: "event_1",
            sourceRunId: "run_a",
            sourceDigest: scheduledSourceEventDigest(payload),
            sourceOccurredAt: new Date(payload.created_at).toISOString(),
            eventType: "run.completed",
            sourcePayload: payload,
          },
          {
            sourceSequence: 2,
            sourceEventId: "after_terminal",
            sourceRunId: "run_a",
            sourceDigest: "b".repeat(64),
            sourceOccurredAt: new Date(payload.created_at + 1).toISOString(),
            eventType: "activity",
            sourcePayload: {
              ...payload,
              chat_event_id: "after_terminal",
              run_id: "run_a",
              seq: 2,
              event_type: "activity",
              payload_json: "{}",
            },
          },
        ],
        2,
        false,
      ),
      /SOURCE_AFTER_TERMINAL/,
    )
    assert.deepEqual(
      (await pool.query("SELECT source_sequence FROM bff_scheduled_agent_source_event WHERE tenant_id=$1 AND task_id=$2", [tenant, task])).rows,
      [],
    )
    assert.equal(
      await store.scheduledAgentDispatch.commitSourcePage(
        consumer,
        [
          {
            sourceSequence: 1,
            sourceEventId: "event_1",
            sourceRunId: "run_a",
            sourceDigest: scheduledSourceEventDigest(payload),
            sourceOccurredAt: new Date(payload.created_at).toISOString(),
            eventType: "run.completed",
            sourcePayload: payload,
          },
          {
            sourceSequence: 2,
            sourceEventId: "history_after_terminal",
            sourceRunId: "run_history",
            sourceDigest: scheduledSourceEventDigest({
              ...payload,
              chat_event_id: "history_after_terminal",
              run_id: "run_history",
              seq: 2,
              event_type: "activity",
              payload_json: "{}",
            }),
            sourceOccurredAt: new Date(payload.created_at + 1).toISOString(),
            eventType: "activity",
            sourcePayload: {
              ...payload,
              chat_event_id: "history_after_terminal",
              run_id: "run_history",
              seq: 2,
              event_type: "activity",
              payload_json: "{}",
            },
          },
        ],
        2,
        false,
      ),
      true,
    )
    assert.equal(await store.scheduledAgentDispatch.markAdmitted(a), false)
    assert.equal(
      await store.scheduledAgentDispatch.claim({
        workerId: "blocked_during_drain",
        leaseDurationMs: 5000,
        settlementReserveMs: 50,
        maxAttempts: 8,
      }),
      null,
    )
    const drainLease = await store.scheduledAgentDispatch.claimConsumer({
      workerId: "drain_consumer",
      leaseDurationMs: 5000,
      settlementReserveMs: 50,
    })
    assert.ok(drainLease)
    assert.equal(drainLease.sourceHighWatermark, 2)
    const drained = {
      ...payload,
      chat_event_id: "history_page_2",
      run_id: "run_history",
      seq: 3,
      event_type: "activity",
      payload_json: "{}",
    }
    assert.equal(
      await store.scheduledAgentDispatch.commitSourcePage(
        drainLease,
        [
          {
            sourceSequence: 3,
            sourceEventId: "history_page_2",
            sourceRunId: "run_history",
            sourceDigest: scheduledSourceEventDigest(drained),
            sourceOccurredAt: new Date(payload.created_at + 2).toISOString(),
            eventType: "activity",
            sourcePayload: drained,
          },
        ],
        3,
        true,
      ),
      true,
    )
    const b = await store.scheduledAgentDispatch.claim({
      workerId: "worker_b",
      leaseDurationMs: 5000,
      settlementReserveMs: 50,
      maxAttempts: 8,
    })
    assert.equal(b?.runId, "run_b")
    assert.deepEqual(
      (await pool.query("SELECT active_run_id,source_high_watermark::text FROM bff_scheduled_agent_scope WHERE tenant_id=$1 AND task_id=$2", [tenant, task]))
        .rows,
      [{ active_run_id: "run_b", source_high_watermark: "3" }],
    )
  } finally {
    if (store) await store.close().catch(() => undefined)
    await pool.query("DELETE FROM bff_scheduled_agent_source_event WHERE tenant_id=$1", [tenant]).catch(() => undefined)
    await pool.query("DELETE FROM bff_scheduled_agent_dispatch WHERE tenant_id=$1", [tenant]).catch(() => undefined)
    await pool.query("DELETE FROM bff_scheduled_agent_scope WHERE tenant_id=$1", [tenant]).catch(() => undefined)
    await pool.end()
  }
})

integrationTest("expired dispatch lease fences the stale winner while never-sent releases only the current nonce", async () => {
  const pool = new Pool({
    connectionString: postgresUrl,
    options: "-c search_path=kokoro_bff -c timezone=UTC",
  })
  const suffix = `${Date.now()}_${Math.random().toString(16).slice(2)}`
  const tenant = `scheduled_fence_${suffix}`
  const task = `task_${suffix}`
  const dispatch = `dispatch_${suffix}`
  const run = `run_${suffix}`
  let store
  try {
    await pool.query("INSERT INTO bff_scheduled_agent_scope(tenant_id,task_id,session_id,subject_id) VALUES($1,$2,$3,'owner')", [
      tenant,
      task,
      `scheduled:${task}`,
    ])
    await pool.query(
      `INSERT INTO bff_scheduled_agent_dispatch(dispatch_id,tenant_id,task_id,occurrence,occurrence_order_key,subject_id,request_id,idempotency_key,request_digest,run_id,identity_assertion_ref,payload) VALUES($1,$2,$3,'2026-09-01T12:00:00Z','2026-09-01T12:00:00.000000000Z','owner','request','key',$4,$5,'bff:x','{}')`,
      [dispatch, tenant, task, "5".repeat(64), run],
    )
    store = new PostgresBffRepositories(postgresUrl, redisUrl)
    const stale = await store.scheduledAgentDispatch.claim({
      workerId: "stale",
      leaseDurationMs: 100,
      settlementReserveMs: 10,
      maxAttempts: 8,
    })
    assert.ok(stale)
    await pool.query("SELECT pg_sleep(0.12)")
    const winner = await store.scheduledAgentDispatch.claim({
      workerId: "winner",
      leaseDurationMs: 5000,
      settlementReserveMs: 50,
      maxAttempts: 8,
    })
    assert.equal(winner?.runId, run)
    assert.ok(winner.fence > stale.fence)
    assert.equal(await store.scheduledAgentDispatch.releaseNeverSent(stale, 0), false)
    assert.equal(await store.scheduledAgentDispatch.markAdmitted(stale), false)
    assert.equal(await store.scheduledAgentDispatch.releaseNeverSent(winner, 0), true)
    assert.deepEqual(
      (
        await pool.query(
          "SELECT d.status,d.lease_token,s.active_dispatch_id,s.active_run_id FROM bff_scheduled_agent_dispatch d JOIN bff_scheduled_agent_scope s ON s.tenant_id=d.tenant_id AND s.task_id=d.task_id WHERE d.dispatch_id=$1",
          [dispatch],
        )
      ).rows,
      [
        {
          status: "retryable",
          lease_token: null,
          active_dispatch_id: dispatch,
          active_run_id: run,
        },
      ],
    )
  } finally {
    if (store) await store.close().catch(() => undefined)
    await pool.query("DELETE FROM bff_scheduled_agent_dispatch WHERE tenant_id=$1", [tenant]).catch(() => undefined)
    await pool.query("DELETE FROM bff_scheduled_agent_scope WHERE tenant_id=$1", [tenant]).catch(() => undefined)
    await pool.end()
  }
})

integrationTest("consumer claim locks scope then active dispatch and starts its terminal-drain lease after the lock barrier", async () => {
  const pool = new Pool({
    connectionString: postgresUrl,
    options: "-c search_path=kokoro_bff -c timezone=UTC",
  })
  const tenant = "scheduled_consumer_barrier"
  const task = "task_consumer_barrier"
  let store
  let locker
  let pendingClaim
  try {
    store = new PostgresBffRepositories(postgresUrl, redisUrl)
    await pool.query(
      "INSERT INTO bff_scheduled_agent_scope(tenant_id,task_id,session_id,subject_id,active_dispatch_id,active_run_id,consumer_next_poll_at) VALUES($1,$2,$3,$4,'barrier_dispatch','run_barrier','2000-01-01')",
      [tenant, task, `scheduled:${task}`, "owner"],
    )
    const payload = {
      request_id: "qb",
      run_id: "run_barrier",
      session_id: `scheduled:${task}`,
      feature_key: "chat",
      message_id: "message_barrier",
      content: "go",
      selected_skill_source_refs: [],
      trace: { source: "kokoro-bff-scheduler" },
    }
    await pool.query(
      `INSERT INTO bff_scheduled_agent_dispatch(dispatch_id,tenant_id,task_id,occurrence,occurrence_order_key,subject_id,request_id,idempotency_key,request_digest,run_id,identity_assertion_ref,payload,status,admitted_at) VALUES('barrier_dispatch',$1,$2,'2026-09-01T12:00:00Z','2026-09-01T12:00:00.000000000Z','owner','qb','kb',$3,'run_barrier','bff:x',$4::jsonb,'admitted',clock_timestamp())`,
      [tenant, task, "e".repeat(64), JSON.stringify(payload)],
    )
    locker = await pool.connect()
    await locker.query("BEGIN")
    const blockerPid = (await locker.query("SELECT pg_backend_pid() pid")).rows[0].pid
    await locker.query("SELECT 1 FROM bff_scheduled_agent_dispatch WHERE dispatch_id='barrier_dispatch' FOR UPDATE")
    await locker.query("UPDATE bff_scheduled_agent_dispatch SET status='terminal',completed_at=clock_timestamp() WHERE dispatch_id='barrier_dispatch'")
    pendingClaim = store.scheduledAgentDispatch.claimConsumer({
      workerId: "terminal_drain_consumer",
      leaseDurationMs: 100,
      settlementReserveMs: 10,
    })
    await waitForBlockedBy(pool, blockerPid)
    await locker.query("COMMIT")
    locker.release()
    locker = undefined
    const lease = await pendingClaim
    pendingClaim = undefined
    assert.ok(lease)
    assert.equal(lease.taskId, task)
    assert.ok(lease.leaseRemainingMs > 10)
    assert.equal(await store.scheduledAgentDispatch.releaseConsumer(lease, 0), true)
    assert.deepEqual(
      (
        await pool.query("SELECT active_dispatch_id,active_run_id,consumer_lease_token FROM bff_scheduled_agent_scope WHERE tenant_id=$1 AND task_id=$2", [
          tenant,
          task,
        ])
      ).rows,
      [
        {
          active_dispatch_id: "barrier_dispatch",
          active_run_id: "run_barrier",
          consumer_lease_token: null,
        },
      ],
    )
  } finally {
    if (locker) {
      await locker.query("ROLLBACK").catch(() => undefined)
      locker.release()
    }
    await pendingClaim?.catch(() => undefined)
    if (store) await store.close().catch(() => undefined)
    await pool.query("DELETE FROM bff_scheduled_agent_dispatch WHERE tenant_id=$1", [tenant]).catch(() => undefined)
    await pool.query("DELETE FROM bff_scheduled_agent_scope WHERE tenant_id=$1", [tenant]).catch(() => undefined)
    await pool.end()
  }
})

integrationTest("source resumes from non-zero N plus one across a real repository restart and releases only after the drain page", async () => {
  const pool = new Pool({
    connectionString: postgresUrl,
    options: "-c search_path=kokoro_bff -c timezone=UTC",
  })
  const suffix = `${Date.now()}_${Math.random().toString(16).slice(2)}`
  const tenant = `scheduled_restart_${suffix}`
  const task = `task_${suffix}`
  const dispatch = `dispatch_${suffix}`
  const run = `run_${suffix}`
  let firstStore
  let restartedStore
  try {
    await pool.query(
      "INSERT INTO bff_scheduled_agent_scope(tenant_id,task_id,session_id,subject_id,active_dispatch_id,active_run_id,source_high_watermark,consumer_next_poll_at) VALUES($1,$2,$3,'owner',$4,$5,7,'2000-01-01')",
      [tenant, task, `scheduled:${task}`, dispatch, run],
    )
    await pool.query(
      `INSERT INTO bff_scheduled_agent_dispatch(dispatch_id,tenant_id,task_id,occurrence,occurrence_order_key,subject_id,request_id,idempotency_key,request_digest,run_id,identity_assertion_ref,payload,status,admitted_at) VALUES($1,$2,$3,'2026-09-01T12:00:00Z','2026-09-01T12:00:00.000000000Z','owner','request','key',$4,$5,'bff:x','{}','admitted',clock_timestamp())`,
      [dispatch, tenant, task, "1".repeat(64), run],
    )
    await pool.query(
      `INSERT INTO bff_scheduled_agent_source_event(tenant_id,task_id,source_sequence,source_event_id,source_run_id,source_owner,source_digest,source_occurred_at,event_type,source_payload)
         SELECT $1,$2,n,'history_'||n,$3,'kokoro-agent',repeat('a',64),clock_timestamp(),'activity','{}'::jsonb FROM generate_series(1,7) n`,
      [tenant, task, run],
    )
    firstStore = new PostgresBffRepositories(postgresUrl, redisUrl)
    const firstLease = await firstStore.scheduledAgentDispatch.claimConsumer({
      workerId: "before_restart",
      leaseDurationMs: 5000,
      settlementReserveMs: 50,
    })
    assert.equal(firstLease?.sourceHighWatermark, 7)
    const terminalPayload = {
      chat_event_id: `terminal_${suffix}`,
      session_id: `scheduled:${task}`,
      run_id: run,
      seq: 8,
      event_type: "run.completed",
      payload_json: '{"status":"completed"}',
    }
    assert.equal(
      await firstStore.scheduledAgentDispatch.commitSourcePage(
        firstLease,
        [
          {
            sourceSequence: 8,
            sourceEventId: terminalPayload.chat_event_id,
            sourceRunId: run,
            sourceDigest: scheduledSourceEventDigest(terminalPayload),
            sourceOccurredAt: new Date().toISOString(),
            eventType: "run.completed",
            sourcePayload: terminalPayload,
          },
        ],
        8,
        false,
      ),
      true,
    )
    await firstStore.close()
    firstStore = undefined
    restartedStore = new PostgresBffRepositories(postgresUrl, redisUrl)
    const restartedLease = await restartedStore.scheduledAgentDispatch.claimConsumer({
      workerId: "after_restart",
      leaseDurationMs: 5000,
      settlementReserveMs: 50,
    })
    assert.equal(restartedLease?.sourceHighWatermark, 8)
    const historyPayload = {
      chat_event_id: `history_${suffix}`,
      session_id: `scheduled:${task}`,
      run_id: `foreign_${suffix}`,
      seq: 9,
      event_type: "activity",
      payload_json: "{}",
    }
    assert.equal(
      await restartedStore.scheduledAgentDispatch.commitSourcePage(
        restartedLease,
        [
          {
            sourceSequence: 9,
            sourceEventId: historyPayload.chat_event_id,
            sourceRunId: historyPayload.run_id,
            sourceDigest: scheduledSourceEventDigest(historyPayload),
            sourceOccurredAt: new Date().toISOString(),
            eventType: "activity",
            sourcePayload: historyPayload,
          },
        ],
        9,
        true,
      ),
      true,
    )
    assert.deepEqual(
      (
        await pool.query(
          "SELECT source_high_watermark::text,active_dispatch_id,active_run_id FROM bff_scheduled_agent_scope WHERE tenant_id=$1 AND task_id=$2",
          [tenant, task],
        )
      ).rows,
      [
        {
          source_high_watermark: "9",
          active_dispatch_id: null,
          active_run_id: null,
        },
      ],
    )
  } finally {
    if (firstStore) await firstStore.close().catch(() => undefined)
    if (restartedStore) await restartedStore.close().catch(() => undefined)
    await pool.query("DELETE FROM bff_scheduled_agent_source_event WHERE tenant_id=$1", [tenant]).catch(() => undefined)
    await pool.query("DELETE FROM bff_scheduled_agent_dispatch WHERE tenant_id=$1", [tenant]).catch(() => undefined)
    await pool.query("DELETE FROM bff_scheduled_agent_scope WHERE tenant_id=$1", [tenant]).catch(() => undefined)
    await pool.end()
  }
})

integrationTest("source gap and run or event identity conflicts roll back cursor ledger and dispatch atomically", async () => {
  const pool = new Pool({
    connectionString: postgresUrl,
    options: "-c search_path=kokoro_bff -c timezone=UTC",
  })
  const suffix = `${Date.now()}_${Math.random().toString(16).slice(2)}`
  const tenant = `scheduled_conflict_${suffix}`
  const task = `task_${suffix}`
  const dispatch = `dispatch_${suffix}`
  const run = `run_${suffix}`
  let store
  try {
    await pool.query(
      "INSERT INTO bff_scheduled_agent_scope(tenant_id,task_id,session_id,subject_id,active_dispatch_id,active_run_id,consumer_next_poll_at) VALUES($1,$2,$3,'owner',$4,$5,'2000-01-01')",
      [tenant, task, `scheduled:${task}`, dispatch, run],
    )
    await pool.query(
      `INSERT INTO bff_scheduled_agent_dispatch(dispatch_id,tenant_id,task_id,occurrence,occurrence_order_key,subject_id,request_id,idempotency_key,request_digest,run_id,identity_assertion_ref,payload,status,admitted_at) VALUES($1,$2,$3,'2026-09-01T12:00:00Z','2026-09-01T12:00:00.000000000Z','owner','request','key',$4,$5,'bff:x','{}','admitted',clock_timestamp())`,
      [dispatch, tenant, task, "2".repeat(64), run],
    )
    store = new PostgresBffRepositories(postgresUrl, redisUrl)
    const lease = await store.scheduledAgentDispatch.claimConsumer({
      workerId: "conflict",
      leaseDurationMs: 5000,
      settlementReserveMs: 50,
    })
    const base = {
      chat_event_id: `event_${suffix}`,
      session_id: `scheduled:${task}`,
      run_id: run,
      seq: 1,
      event_type: "activity",
      payload_json: "{}",
    }
    const invalidBatches = [
      [
        {
          sourceSequence: 2,
          sourceEventId: base.chat_event_id,
          sourceRunId: run,
          sourceDigest: scheduledSourceEventDigest(base),
          sourceOccurredAt: new Date().toISOString(),
          eventType: "activity",
          sourcePayload: { ...base, seq: 2 },
        },
      ],
      [
        {
          sourceSequence: 1,
          sourceEventId: base.chat_event_id,
          sourceRunId: run,
          sourceDigest: scheduledSourceEventDigest(base),
          sourceOccurredAt: new Date().toISOString(),
          eventType: "activity",
          sourcePayload: { ...base, run_id: `wrong_${suffix}` },
        },
      ],
      [
        {
          sourceSequence: 1,
          sourceEventId: base.chat_event_id,
          sourceRunId: run,
          sourceDigest: scheduledSourceEventDigest(base),
          sourceOccurredAt: new Date().toISOString(),
          eventType: "activity",
          sourcePayload: { ...base, chat_event_id: `wrong_${suffix}` },
        },
      ],
      [
        {
          sourceSequence: 1,
          sourceEventId: base.chat_event_id,
          sourceRunId: run,
          sourceDigest: "f".repeat(64),
          sourceOccurredAt: new Date().toISOString(),
          eventType: "activity",
          sourcePayload: base,
        },
      ],
    ]
    for (const batch of invalidBatches) {
      await assert.rejects(store.scheduledAgentDispatch.commitSourcePage(lease, batch, batch[0].sourceSequence, false), /SOURCE_(GAP|IDENTITY_INVALID)/)
      assert.deepEqual(
        (await pool.query("SELECT source_high_watermark::text FROM bff_scheduled_agent_scope WHERE tenant_id=$1 AND task_id=$2", [tenant, task])).rows,
        [{ source_high_watermark: "0" }],
      )
      assert.equal((await pool.query("SELECT 1 FROM bff_scheduled_agent_source_event WHERE tenant_id=$1", [tenant])).rowCount, 0)
      assert.deepEqual((await pool.query("SELECT status,completed_at FROM bff_scheduled_agent_dispatch WHERE dispatch_id=$1", [dispatch])).rows, [
        { status: "admitted", completed_at: null },
      ])
    }
    await pool.query(
      `INSERT INTO bff_scheduled_agent_source_event(tenant_id,task_id,source_sequence,source_event_id,source_run_id,source_owner,source_digest,source_occurred_at,event_type,source_payload) VALUES($1,$2,99,$3,$4,'kokoro-agent',$5,clock_timestamp(),'activity','{}')`,
      [tenant, task, base.chat_event_id, run, "e".repeat(64)],
    )
    await assert.rejects(
      store.scheduledAgentDispatch.commitSourcePage(
        lease,
        [
          {
            sourceSequence: 1,
            sourceEventId: base.chat_event_id,
            sourceRunId: run,
            sourceDigest: scheduledSourceEventDigest(base),
            sourceOccurredAt: new Date().toISOString(),
            eventType: "activity",
            sourcePayload: base,
          },
        ],
        1,
        false,
      ),
      /duplicate key value/,
    )
    assert.deepEqual(
      (await pool.query("SELECT source_high_watermark::text FROM bff_scheduled_agent_scope WHERE tenant_id=$1 AND task_id=$2", [tenant, task])).rows,
      [{ source_high_watermark: "0" }],
    )
    assert.equal((await pool.query("SELECT 1 FROM bff_scheduled_agent_source_event WHERE tenant_id=$1", [tenant])).rowCount, 1)
    assert.deepEqual((await pool.query("SELECT status,completed_at FROM bff_scheduled_agent_dispatch WHERE dispatch_id=$1", [dispatch])).rows, [
      { status: "admitted", completed_at: null },
    ])
    await pool.query("DELETE FROM bff_scheduled_agent_source_event WHERE tenant_id=$1 AND task_id=$2", [tenant, task])
    await pool.query(
      `INSERT INTO bff_scheduled_agent_source_event(tenant_id,task_id,source_sequence,source_event_id,source_run_id,source_owner,source_digest,source_occurred_at,event_type,source_payload) VALUES($1,$2,1,$3,$4,'kokoro-agent',$5,clock_timestamp(),'activity','{}')`,
      [tenant, task, `stored_${suffix}`, run, "d".repeat(64)],
    )
    await assert.rejects(
      store.scheduledAgentDispatch.commitSourcePage(
        lease,
        [
          {
            sourceSequence: 1,
            sourceEventId: base.chat_event_id,
            sourceRunId: run,
            sourceDigest: scheduledSourceEventDigest(base),
            sourceOccurredAt: new Date().toISOString(),
            eventType: "activity",
            sourcePayload: base,
          },
        ],
        1,
        false,
      ),
      /duplicate key value/,
    )
    assert.deepEqual(
      (await pool.query("SELECT source_high_watermark::text FROM bff_scheduled_agent_scope WHERE tenant_id=$1 AND task_id=$2", [tenant, task])).rows,
      [{ source_high_watermark: "0" }],
    )
    assert.equal((await pool.query("SELECT 1 FROM bff_scheduled_agent_source_event WHERE tenant_id=$1", [tenant])).rowCount, 1)
  } finally {
    if (store) await store.close().catch(() => undefined)
    await pool.query("DELETE FROM bff_scheduled_agent_source_event WHERE tenant_id=$1", [tenant]).catch(() => undefined)
    await pool.query("DELETE FROM bff_scheduled_agent_dispatch WHERE tenant_id=$1", [tenant]).catch(() => undefined)
    await pool.query("DELETE FROM bff_scheduled_agent_scope WHERE tenant_id=$1", [tenant]).catch(() => undefined)
    await pool.end()
  }
})

integrationTest("a locked slow scope does not block another scope and one scope has exactly one lease winner", async () => {
  const pool = new Pool({
    connectionString: postgresUrl,
    options: "-c search_path=kokoro_bff -c timezone=UTC",
    max: 10,
  })
  const suffix = `${Date.now()}_${Math.random().toString(16).slice(2)}`
  const tenant = `scheduled_parallel_${suffix}`
  let store
  let locker
  try {
    for (const name of ["slow", "fast"]) {
      const task = `${name}_${suffix}`
      await pool.query("INSERT INTO bff_scheduled_agent_scope(tenant_id,task_id,session_id,subject_id) VALUES($1,$2,$3,'owner')", [
        tenant,
        task,
        `scheduled:${task}`,
      ])
      await pool.query(
        `INSERT INTO bff_scheduled_agent_dispatch(dispatch_id,tenant_id,task_id,occurrence,occurrence_order_key,subject_id,request_id,idempotency_key,request_digest,run_id,identity_assertion_ref,payload) VALUES($1,$2,$3,'2026-09-01T12:00:00Z','2026-09-01T12:00:00.000000000Z','owner',$4,$5,$6,$7,'bff:x','{}')`,
        [`${name}_dispatch_${suffix}`, tenant, task, `${name}_request`, `${name}_key`, (name === "slow" ? "3" : "4").repeat(64), `${name}_run_${suffix}`],
      )
    }
    store = new PostgresBffRepositories(postgresUrl, redisUrl)
    locker = await pool.connect()
    await locker.query("BEGIN")
    await locker.query("SELECT 1 FROM bff_scheduled_agent_scope WHERE tenant_id=$1 AND task_id=$2 FOR UPDATE", [tenant, `slow_${suffix}`])
    const fast = await store.scheduledAgentDispatch.claim({
      workerId: "fast_worker",
      leaseDurationMs: 5000,
      settlementReserveMs: 50,
      maxAttempts: 8,
    })
    assert.equal(fast?.taskId, `fast_${suffix}`)
    const sameScope = await Promise.all([
      store.scheduledAgentDispatch.claim({
        workerId: "same_left",
        leaseDurationMs: 5000,
        settlementReserveMs: 50,
        maxAttempts: 8,
      }),
      store.scheduledAgentDispatch.claim({
        workerId: "same_right",
        leaseDurationMs: 5000,
        settlementReserveMs: 50,
        maxAttempts: 8,
      }),
    ])
    assert.deepEqual(sameScope, [null, null])
    await locker.query("COMMIT")
    locker.release()
    locker = undefined
    const slowWinners = await Promise.all([
      store.scheduledAgentDispatch.claim({
        workerId: "slow_left",
        leaseDurationMs: 5000,
        settlementReserveMs: 50,
        maxAttempts: 8,
      }),
      store.scheduledAgentDispatch.claim({
        workerId: "slow_right",
        leaseDurationMs: 5000,
        settlementReserveMs: 50,
        maxAttempts: 8,
      }),
    ])
    assert.equal(slowWinners.filter((value) => value?.taskId === `slow_${suffix}`).length, 1)
  } finally {
    if (locker) {
      await locker.query("ROLLBACK").catch(() => undefined)
      locker.release()
    }
    if (store) await store.close().catch(() => undefined)
    await pool.query("DELETE FROM bff_scheduled_agent_dispatch WHERE tenant_id=$1", [tenant]).catch(() => undefined)
    await pool.query("DELETE FROM bff_scheduled_agent_scope WHERE tenant_id=$1", [tenant]).catch(() => undefined)
    await pool.end()
  }
})

integrationTest("active terminal and next claim serialize behind the exact scope blocker without exposing the wrong head", async () => {
  const pool = new Pool({
    connectionString: postgresUrl,
    options: "-c search_path=kokoro_bff -c timezone=UTC",
    max: 12,
  })
  const suffix = `${Date.now()}_${Math.random().toString(16).slice(2)}`
  const tenant = `scheduled_terminal_claim_${suffix}`
  const task = `task_${suffix}`
  const aDispatch = `a_dispatch_${suffix}`
  const bDispatch = `b_dispatch_${suffix}`
  const aRun = `a_run_${suffix}`
  const bRun = `b_run_${suffix}`
  let store
  let locker
  let terminalOperation
  let claimOperation
  try {
    await pool.query(
      "INSERT INTO bff_scheduled_agent_scope(tenant_id,task_id,session_id,subject_id,active_dispatch_id,active_run_id,consumer_next_poll_at) VALUES($1,$2,$3,'owner',$4,$5,'2000-01-01')",
      [tenant, task, `scheduled:${task}`, aDispatch, aRun],
    )
    for (const [dispatch, run, order, status] of [
      [aDispatch, aRun, "2026-09-01T12:00:00.000000001Z", "admitted"],
      [bDispatch, bRun, "2026-09-01T12:00:00.000000002Z", "pending"],
    ]) {
      await pool.query(
        `INSERT INTO bff_scheduled_agent_dispatch(dispatch_id,tenant_id,task_id,occurrence,occurrence_order_key,subject_id,request_id,idempotency_key,request_digest,run_id,identity_assertion_ref,payload,status,admitted_at) VALUES($1,$2,$3,$4,$4,'owner',$5,$6,$7,$8,'bff:x','{}',$9,CASE WHEN $9='admitted' THEN clock_timestamp() ELSE NULL END)`,
        [dispatch, tenant, task, order, `request_${dispatch}`, `key_${dispatch}`, (status === "admitted" ? "6" : "7").repeat(64), run, status],
      )
    }
    store = new PostgresBffRepositories(postgresUrl, redisUrl)
    const consumer = await store.scheduledAgentDispatch.claimConsumer({
      workerId: "terminal",
      leaseDurationMs: 5000,
      settlementReserveMs: 50,
    })
    assert.equal(consumer?.taskId, task)
    const payload = {
      chat_event_id: `terminal_${suffix}`,
      session_id: `scheduled:${task}`,
      run_id: aRun,
      seq: 1,
      event_type: "run.completed",
      payload_json: '{"status":"completed"}',
    }
    locker = await pool.connect()
    await locker.query("BEGIN")
    const blockerPid = (await locker.query("SELECT pg_backend_pid() pid")).rows[0].pid
    await locker.query("SELECT 1 FROM bff_scheduled_agent_scope WHERE tenant_id=$1 AND task_id=$2 FOR UPDATE", [tenant, task])
    terminalOperation = store.scheduledAgentDispatch.commitSourcePage(
      consumer,
      [
        {
          sourceSequence: 1,
          sourceEventId: payload.chat_event_id,
          sourceRunId: aRun,
          sourceDigest: scheduledSourceEventDigest(payload),
          sourceOccurredAt: new Date().toISOString(),
          eventType: "run.completed",
          sourcePayload: payload,
        },
      ],
      1,
      true,
    )
    await waitForBlockedCount(pool, blockerPid, 1)
    claimOperation = store.scheduledAgentDispatch.claim({
      workerId: "next",
      leaseDurationMs: 5000,
      settlementReserveMs: 50,
      maxAttempts: 8,
    })
    assert.equal(
      await Promise.race([claimOperation, new Promise((_, reject) => setTimeout(() => reject(new Error("SKIP LOCKED claim did not return")), 1000))]),
      null,
    )
    claimOperation = undefined
    await locker.query("COMMIT")
    locker.release()
    locker = undefined
    assert.equal(await terminalOperation, true)
    terminalOperation = undefined
    const next = await store.scheduledAgentDispatch.claim({
      workerId: "next_after_terminal",
      leaseDurationMs: 5000,
      settlementReserveMs: 50,
      maxAttempts: 8,
    })
    assert.equal(next?.dispatchId, bDispatch)
    assert.equal(next?.runId, bRun)
    assert.deepEqual(
      (
        await pool.query(
          "SELECT active_dispatch_id,active_run_id,source_high_watermark::text FROM bff_scheduled_agent_scope WHERE tenant_id=$1 AND task_id=$2",
          [tenant, task],
        )
      ).rows,
      [
        {
          active_dispatch_id: bDispatch,
          active_run_id: bRun,
          source_high_watermark: "1",
        },
      ],
    )
  } finally {
    if (locker) {
      await locker.query("ROLLBACK").catch(() => undefined)
      locker.release()
    }
    await Promise.allSettled([terminalOperation, claimOperation].filter(Boolean))
    if (store) await store.close().catch(() => undefined)
    await pool.query("DELETE FROM bff_scheduled_agent_source_event WHERE tenant_id=$1", [tenant]).catch(() => undefined)
    await pool.query("DELETE FROM bff_scheduled_agent_dispatch WHERE tenant_id=$1", [tenant]).catch(() => undefined)
    await pool.query("DELETE FROM bff_scheduled_agent_scope WHERE tenant_id=$1", [tenant]).catch(() => undefined)
    await pool.end()
  }
})

async function waitForScheduledAcceptBlock(pool, blockerPid, resource) {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    const result = await pool.query(
      `SELECT a.pid FROM pg_stat_activity a
        WHERE $1 = ANY(pg_blocking_pids(a.pid)) AND a.wait_event_type = 'Lock'
          AND strpos(a.query, $2) > 0`,
      [blockerPid, resource],
    )
    if (result.rowCount === 1) return result.rows[0].pid
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`scheduled accept did not block on the exact ${resource} backend`)
}

async function waitForScheduledAcceptLeaseExpiry(pool, blockerPid, acceptPid, resource, leaseUntil) {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    const result = await pool.query(
      `SELECT clock_timestamp() >= $1::timestamptz AS expired,
              EXISTS(SELECT 1 FROM pg_stat_activity a WHERE a.pid = $2
                AND $3 = ANY(pg_blocking_pids(a.pid)) AND a.wait_event_type = 'Lock'
                AND strpos(a.query, $4) > 0) AS blocked`,
      [leaseUntil, acceptPid, blockerPid, resource],
    )
    assert.equal(result.rows[0].blocked, true, "the same accept must remain blocked until the database confirms lease expiry")
    if (result.rows[0].expired) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error("scheduled accept lease did not expire according to the database clock")
}

async function scheduledAcceptFacts(pool, tenant, task, receiptScope) {
  const receipt = await pool.query("SELECT fingerprint,status,response_body FROM bff_idempotency_receipt WHERE scope=$1", [receiptScope])
  const scope = await pool.query("SELECT row_to_json(s) AS fact FROM bff_scheduled_agent_scope s WHERE tenant_id=$1 AND task_id=$2", [tenant, task])
  const dispatch = await pool.query(
    "SELECT row_to_json(d) AS fact FROM bff_scheduled_agent_dispatch d WHERE tenant_id=$1 AND task_id=$2 ORDER BY dispatch_id",
    [tenant, task],
  )
  const source = await pool.query(
    "SELECT row_to_json(e) AS fact FROM bff_scheduled_agent_source_event e WHERE tenant_id=$1 AND task_id=$2 ORDER BY source_sequence",
    [tenant, task],
  )
  return { receipt: receipt.rows, scope: scope.rows, dispatch: dispatch.rows, source: source.rows }
}

for (const resource of ["bff_scheduled_task", "bff_scheduled_agent_scope"]) {
  for (const expired of [false, true]) {
    integrationTest(
      `scheduled accept ${expired ? "rejects an expired receipt lease" : "preserves unexpired acceptance and exact ACK replay"} after the ${resource} lock barrier`,
      { timeout: 15_000 },
      async () => {
        const pool = new Pool({ connectionString: postgresUrl, options: "-c search_path=kokoro_bff -c timezone=UTC", max: 10 })
        const suffix = randomUUID()
        const tenant = `scheduled_accept_${suffix}`
        const task = `task_${suffix}`
        const owner = `owner_${suffix}`
        const key = `key_${suffix}`
        const receiptScope = schedulerDispatchScope(tenant, key)
        let store
        let locker
        let acceptOperation
        try {
          await pool.query(
            `INSERT INTO bff_scheduled_task(task_id,tenant_id,owner_id,title,prompt,frequency,task_time,timezone,next_run_at,status)
             VALUES($1,$2,$3,'Accept lease','go','daily','08:00','UTC','2026-09-01T08:00:00Z','active')`,
            [task, tenant, owner],
          )
          if (resource === "bff_scheduled_agent_scope") {
            await pool.query("INSERT INTO bff_scheduled_agent_scope(tenant_id,task_id,session_id,subject_id) VALUES($1,$2,$3,$4)", [
              tenant,
              task,
              `scheduled:${task}`,
              owner,
            ])
          }
          store = new PostgresBffRepositories(postgresUrl, redisUrl)
          const schedule = schedulerScheduleName(task)
          const occurrence = "2026-09-01T12:00:00.123456789Z"
          const digest = schedulerDispatchDigest({
            tenantId: tenant,
            schedule,
            occurrence,
            body: { tenant_id: tenant, task_id: task, owner_id: owner, prompt: "go", auto_approve: false, timezone: "UTC" },
          })
          const claimed = await store.schedulerDispatchReceipts.claim(receiptScope, digest)
          assert.equal(claimed.outcome, "claimed")
          const launch = buildScheduledAgentLaunch({
            identity: { namespace: tenant, userId: owner },
            requestId: `request_${suffix}`,
            sessionId: `scheduled:${task}`,
            occurrenceIdentity: schedulerOccurrenceIdentity({ tenantId: tenant, schedule, occurrence }),
            content: "go",
          })
          const snapshot = {
            tenantId: tenant,
            schedule,
            occurrence,
            idempotencyKey: key,
            actorId: owner,
            taskId: task,
            taskRevision: 1,
            launch: { requestId: `request_${suffix}`, ...launch },
          }
          const prepared = await store.schedulerDispatchReceipts.prepareSnapshot(claimed.claim, snapshot)
          assert.ok(prepared)
          const input = {
            claim: { ...claimed.claim, ...prepared, snapshot },
            snapshot,
            rejections: r67AcceptanceRejections(`request_${suffix}`),
            response: { status: 202, body: { data: { task_id: task, run_id: launch.receipt.run_id }, meta: { request_id: `request_${suffix}` } } },
          }
          locker = await pool.connect()
          await locker.query("BEGIN")
          const blockerPid = (await locker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid
          // The table name is selected solely from the two fixed test cases above.
          await locker.query(`SELECT 1 FROM ${resource} WHERE tenant_id=$1 AND task_id=$2 FOR UPDATE`, [tenant, task])
          if (expired) {
            await pool.query(
              `UPDATE bff_idempotency_receipt
                  SET response_body=jsonb_set(response_body,'{lease_until}',to_jsonb((clock_timestamp()+interval '1 second')::text))
                WHERE scope=$1`,
              [receiptScope],
            )
          }
          const before = await scheduledAcceptFacts(pool, tenant, task, receiptScope)
          assert.equal(before.receipt[0].status, 102)
          assert.equal(before.receipt[0].response_body.state, "pending")
          assert.deepEqual(before.dispatch, [])
          assert.deepEqual(before.source, [])
          const leaseUntil = before.receipt[0].response_body.lease_until
          const validBeforeAccept = await pool.query("SELECT clock_timestamp() < $1::timestamptz AS valid", [leaseUntil])
          assert.equal(validBeforeAccept.rows[0].valid, true, "accept must start with a live receipt lease")
          // Settle failures immediately as data so barrier failures cannot leave an unhandled rejection.
          acceptOperation = store.scheduledAgentDispatch.accept(input).then(
            (accepted) => ({ accepted }),
            (error) => ({ error }),
          )
          const acceptPid = await waitForScheduledAcceptBlock(pool, blockerPid, resource)
          if (expired) {
            await waitForScheduledAcceptLeaseExpiry(pool, blockerPid, acceptPid, resource, leaseUntil)
          } else {
            const validAtRelease = await pool.query("SELECT clock_timestamp() < $1::timestamptz AS valid", [leaseUntil])
            assert.equal(validAtRelease.rows[0].valid, true)
          }
          await locker.query("COMMIT")
          locker.release()
          locker = undefined
          const outcome = await acceptOperation
          acceptOperation = undefined
          if (outcome.error) throw outcome.error
          const after = await scheduledAcceptFacts(pool, tenant, task, receiptScope)
          if (expired) {
            assert.deepEqual(
              { accepted: outcome.accepted, ...after },
              { accepted: { outcome: "claim_lost" }, ...before },
              "an expired accept must roll back all scope/dispatch writes and preserve the original pending receipt",
            )
          } else {
            assert.deepEqual(outcome.accepted, { outcome: "accepted" })
            assert.equal(after.scope.length, 1)
            assert.equal(after.scope[0].fact.session_id, `scheduled:${task}`)
            assert.equal(after.scope[0].fact.subject_id, owner)
            assert.equal(after.dispatch.length, 1)
            assert.equal(after.dispatch[0].fact.run_id, launch.receipt.run_id)
            assert.equal(after.dispatch[0].fact.status, "pending")
            assert.equal(after.dispatch[0].fact.attempt_count, 0)
            assert.deepEqual(after.source, [])
            assert.equal(after.receipt[0].status, 202)
            assert.equal(after.receipt[0].response_body.state, "terminal")
            assert.deepEqual(after.receipt[0].response_body.response, input.response)
            await store.close()
            store = new PostgresBffRepositories(postgresUrl, redisUrl)
            // This is the same terminal claim branch that returns the original callback ACK.
            assert.deepEqual(await store.schedulerDispatchReceipts.claim(receiptScope, digest), { outcome: "terminal", response: input.response })
            assert.deepEqual(await store.scheduledAgentDispatch.accept(input), { outcome: "claim_lost" })
            assert.deepEqual(await scheduledAcceptFacts(pool, tenant, task, receiptScope), after)
          }
        } finally {
          if (locker) {
            await locker.query("ROLLBACK").catch(() => undefined)
            locker.release()
          }
          if (acceptOperation) await acceptOperation
          if (store) await store.close()
          await pool.query("DELETE FROM bff_scheduled_agent_source_event WHERE tenant_id=$1 AND task_id=$2", [tenant, task])
          await pool.query("DELETE FROM bff_scheduled_agent_dispatch WHERE tenant_id=$1 AND task_id=$2", [tenant, task])
          await pool.query("DELETE FROM bff_scheduled_agent_scope WHERE tenant_id=$1 AND task_id=$2", [tenant, task])
          await pool.query("DELETE FROM bff_scheduled_task WHERE tenant_id=$1 AND task_id=$2", [tenant, task])
          await pool.query("DELETE FROM bff_idempotency_receipt WHERE scope=$1", [receiptScope])
          await pool.end()
        }
      },
    )
  }
}

function r67AcceptanceRejections(requestId) {
  const response = (status, code, message) => ({ status, body: { error: { code, message }, meta: { request_id: requestId } } })
  return {
    task_not_found: response(404, "scheduled_task_not_found", "Scheduled task was not found"),
    task_not_active: response(409, "scheduled_task_not_active", "Scheduled task is not active"),
    task_changed: response(409, "invalid_scheduler_dispatch", "Scheduler dispatch does not match the stored task"),
  }
}

{
  const resource = "bff_scheduled_task"
  for (const expired of [false, true]) {
    integrationTest(
      `R67 paused rejection ${expired ? "does not settle an expired receipt lease" : "is terminal with an unexpired lease"} after the task lock barrier`,
      async () => {
        const pool = new Pool({ connectionString: postgresUrl, options: "-c search_path=kokoro_bff -c timezone=UTC", max: 10 })
        const suffix = randomUUID()
        const tenant = `scheduled_rejection_${suffix}`
        const task = `task_${suffix}`
        const owner = `owner_${suffix}`
        const key = `key_${suffix}`
        const receiptScope = schedulerDispatchScope(tenant, key)
        let store
        let locker
        let acceptOperation
        try {
          await pool.query(
            `INSERT INTO bff_scheduled_task(task_id,tenant_id,owner_id,title,prompt,frequency,task_time,timezone,next_run_at,status,enabled)
             VALUES($1,$2,$3,'Rejection lease','go','daily','08:00','UTC','2026-09-01T08:00:00Z','paused',false)`,
            [task, tenant, owner],
          )
          store = new PostgresBffRepositories(postgresUrl, redisUrl)
          const schedule = schedulerScheduleName(task)
          const occurrence = "2026-09-01T12:00:00.123456789Z"
          const digest = schedulerDispatchDigest({
            tenantId: tenant,
            schedule,
            occurrence,
            body: { tenant_id: tenant, task_id: task, owner_id: owner, prompt: "go", auto_approve: false, timezone: "UTC" },
          })
          const claimed = await store.schedulerDispatchReceipts.claim(receiptScope, digest)
          assert.equal(claimed.outcome, "claimed")
          const launch = buildScheduledAgentLaunch({
            identity: { namespace: tenant, userId: owner },
            requestId: `request_${suffix}`,
            sessionId: `scheduled:${task}`,
            occurrenceIdentity: schedulerOccurrenceIdentity({ tenantId: tenant, schedule, occurrence }),
            content: "go",
          })
          const snapshot = {
            tenantId: tenant,
            schedule,
            occurrence,
            idempotencyKey: key,
            actorId: owner,
            taskId: task,
            taskRevision: 1,
            launch: { requestId: `request_${suffix}`, ...launch },
          }
          const prepared = await store.schedulerDispatchReceipts.prepareSnapshot(claimed.claim, snapshot)
          assert.ok(prepared)
          const input = {
            claim: { ...claimed.claim, ...prepared, snapshot },
            snapshot,
            rejections: r67AcceptanceRejections(`request_${suffix}`),
            response: { status: 202, body: { data: { task_id: task, run_id: launch.receipt.run_id }, meta: { request_id: `request_${suffix}` } } },
          }
          locker = await pool.connect()
          await locker.query("BEGIN")
          const blockerPid = (await locker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid
          // The table name is selected solely from the two fixed test cases above.
          await locker.query(`SELECT 1 FROM ${resource} WHERE tenant_id=$1 AND task_id=$2 FOR UPDATE`, [tenant, task])
          if (expired) {
            await pool.query(
              `UPDATE bff_idempotency_receipt
                  SET response_body=jsonb_set(response_body,'{lease_until}',to_jsonb((clock_timestamp()+interval '1 second')::text))
                WHERE scope=$1`,
              [receiptScope],
            )
          }
          const before = await scheduledAcceptFacts(pool, tenant, task, receiptScope)
          assert.equal(before.receipt[0].status, 102)
          assert.equal(before.receipt[0].response_body.state, "pending")
          assert.deepEqual(before.dispatch, [])
          assert.deepEqual(before.source, [])
          const leaseUntil = before.receipt[0].response_body.lease_until
          const validBeforeAccept = await pool.query("SELECT clock_timestamp() < $1::timestamptz AS valid", [leaseUntil])
          assert.equal(validBeforeAccept.rows[0].valid, true, "accept must start with a live receipt lease")
          // Settle failures immediately as data so barrier failures cannot leave an unhandled rejection.
          acceptOperation = store.scheduledAgentDispatch.accept(input).then(
            (accepted) => ({ accepted }),
            (error) => ({ error }),
          )
          const acceptPid = await waitForScheduledAcceptBlock(pool, blockerPid, resource)
          if (expired) {
            await waitForScheduledAcceptLeaseExpiry(pool, blockerPid, acceptPid, resource, leaseUntil)
          } else {
            const validAtRelease = await pool.query("SELECT clock_timestamp() < $1::timestamptz AS valid", [leaseUntil])
            assert.equal(validAtRelease.rows[0].valid, true)
          }
          await locker.query("COMMIT")
          locker.release()
          locker = undefined
          const outcome = await acceptOperation
          acceptOperation = undefined
          if (outcome.error) throw outcome.error
          const after = await scheduledAcceptFacts(pool, tenant, task, receiptScope)
          if (expired) {
            assert.deepEqual(
              { accepted: outcome.accepted, ...after },
              { accepted: { outcome: "claim_lost" }, ...before },
              "an expired rejection must preserve the original pending receipt and all execution facts",
            )
          } else {
            assert.deepEqual(outcome.accepted, { outcome: "rejected", response: input.rejections.task_not_active })
            assert.deepEqual(after.scope, before.scope)
            assert.deepEqual(after.dispatch, before.dispatch)
            assert.deepEqual(after.source, before.source)
            assert.equal(after.receipt[0].status, 409)
            assert.equal(after.receipt[0].response_body.state, "terminal")
            assert.deepEqual(after.receipt[0].response_body.response, input.rejections.task_not_active)
            await store.close()
            store = new PostgresBffRepositories(postgresUrl, redisUrl)
            // Reopening must return the same durable rejection, not attempt to enqueue again.
            assert.deepEqual(await store.schedulerDispatchReceipts.claim(receiptScope, digest), {
              outcome: "terminal",
              response: input.rejections.task_not_active,
            })
            assert.deepEqual(await store.scheduledAgentDispatch.accept(input), { outcome: "claim_lost" })
            assert.deepEqual(await scheduledAcceptFacts(pool, tenant, task, receiptScope), after)
          }
        } finally {
          if (locker) {
            await locker.query("ROLLBACK").catch(() => undefined)
            locker.release()
          }
          if (acceptOperation) await acceptOperation
          if (store) await store.close()
          await pool.query("DELETE FROM bff_scheduled_agent_source_event WHERE tenant_id=$1 AND task_id=$2", [tenant, task])
          await pool.query("DELETE FROM bff_scheduled_agent_dispatch WHERE tenant_id=$1 AND task_id=$2", [tenant, task])
          await pool.query("DELETE FROM bff_scheduled_agent_scope WHERE tenant_id=$1 AND task_id=$2", [tenant, task])
          await pool.query("DELETE FROM bff_scheduled_task WHERE tenant_id=$1 AND task_id=$2", [tenant, task])
          await pool.query("DELETE FROM bff_idempotency_receipt WHERE scope=$1", [receiptScope])
          await pool.end()
        }
      },
    )
  }
}
