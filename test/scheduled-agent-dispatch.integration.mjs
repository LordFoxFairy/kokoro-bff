import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { test } from "node:test"
import { Pool } from "pg"
import { assertBffPostgresUrl } from "../dist/config/runtime.js"
import { buildScheduledAgentLaunch, scheduledConversationId } from "../dist/infrastructure/clients/agent/launch.js"
import { PostgresScheduledAgentDispatchRepository } from "../dist/infrastructure/postgres/scheduled-agent-dispatch-repository.js"
import { PostgresSchedulerDispatchReceiptRepository } from "../dist/infrastructure/postgres/scheduler-dispatch-receipt-repository.js"
import { PostgresAgentDispatchOutboxRepository } from "../dist/infrastructure/postgres/agent-dispatch-outbox-repository.js"
import { PostgresScheduledTaskRepository } from "../dist/infrastructure/postgres/scheduled-task-repository.js"
import { PostgresChatSessionStore } from "../dist/infrastructure/postgres/chat-session-store.js"
import { PostgresScheduledTaskExecutionReader } from "../dist/infrastructure/postgres/scheduled-task-execution-reader.js"
import { ScheduledChatSubmission } from "../dist/infrastructure/postgres/scheduled-chat-submission.js"
import { PostgresAgUiConsumerRepository } from "../dist/infrastructure/postgres/agui-consumer-repository.js"
import { PostgresAgUiProjectionRepository } from "../dist/infrastructure/postgres/agui-projection-repository.js"
import { createAgentRunsReader } from "../dist/infrastructure/postgres/project-execution-binding.js"
import { readRunFinalAnswer } from "../dist/infrastructure/postgres/run-final-answer-read.js"
import { AgUiProjectionService } from "../dist/application/agui/project-session-events.js"

const postgresUrl = process.env.KOKORO_TEST_POSTGRES_URL
const integrationTest = postgresUrl ? test : test.skip
const claimOptions = { workerId: "scheduled-worker", leaseDurationMs: 10000, settlementReserveMs: 100, maxAttempts: 8 }

// Every case owns a fresh schema. Never reset the caller's application schema.
async function fixture(context) {
  assertBffPostgresUrl(postgresUrl)
  const schema = `a12_${randomUUID().replaceAll("-", "")}`
  const admin = new Pool({ connectionString: postgresUrl, max: 1 })
  const pool = new Pool({ connectionString: postgresUrl, max: 12, options: `-c search_path=${schema} -c timezone=UTC` })
  context.after(async () => {
    await pool.end()
    try {
      await admin.query(`DROP SCHEMA ${schema} CASCADE`)
    } finally {
      await admin.end()
    }
  })
  await admin.query(`CREATE SCHEMA ${schema}`)
  await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
  const database = { pool, notifyAgUiProjection: async () => undefined }
  const scheduled = new PostgresScheduledAgentDispatchRepository(database)
  const ordinary = new PostgresAgentDispatchOutboxRepository(database)
  const submission = new ScheduledChatSubmission(ordinary)
  const consumers = new PostgresAgUiConsumerRepository(database)
  const projection = new AgUiProjectionService(new PostgresAgUiProjectionRepository(database))
  const receipts = new PostgresSchedulerDispatchReceiptRepository(pool)
  const tasks = new PostgresScheduledTaskRepository(database)
  const tenant = "scheduled-tenant",
    subject = "owner"
  const task = async (taskId = "task") => {
    await pool.query(
      `INSERT INTO bff_scheduled_task(task_id,tenant_id,owner_id,title,prompt,frequency,task_time,timezone,status)
       VALUES($1,$2,$3,'Task','frozen prompt','daily','08:00','UTC','active')`,
      [taskId, tenant, subject],
    )
    return taskId
  }
  const accept = async (taskId, second, projectRef) => {
    const occurrence = `2026-09-01T12:00:${String(second).padStart(2, "0")}.000000001Z`
    const key = `key-${taskId}-${second}`
    const digest = createHash("sha256").update(key).digest("hex")
    const scope = `scope-${key}`
    const launch = buildScheduledAgentLaunch({
      identity: { namespace: tenant, userId: subject },
      requestId: `request-${key}`,
      sessionId: scheduledConversationId(tenant, taskId),
      occurrenceIdentity: digest,
      content: "frozen prompt",
      ...(projectRef === undefined ? {} : { projectRef }),
    })
    const snapshot = {
      tenantId: tenant,
      taskId,
      schedule: `kokoro.scheduled.${taskId}`,
      occurrence,
      idempotencyKey: key,
      actorId: subject,
      taskRevision: 1,
      launch: { requestId: `request-${key}`, ...launch },
    }
    const claimed = await receipts.claim(scope, digest)
    assert.equal(claimed.outcome, "claimed")
    const prepared = await receipts.prepareSnapshot(claimed.claim, snapshot)
    assert.ok(prepared)
    const response = { status: 202, body: { data: launch.receipt } }
    const rejection = { status: 409, body: {} }
    assert.deepEqual(
      await scheduled.accept({
        claim: { ...claimed.claim, ...prepared },
        snapshot,
        response,
        rejections: { task_not_found: rejection, task_not_active: rejection, task_changed: rejection },
      }),
      { outcome: "accepted" },
    )
    assert.deepEqual(await receipts.claim(scope, digest), { outcome: "terminal", response })
    return { ...launch.receipt, sessionId: snapshot.launch.body.session_id }
  }
  const executions = new PostgresScheduledTaskExecutionReader(pool)
  const readExecutions = (scope = { tenantId: tenant, subjectId: subject }) => executions.read(scope, { limit: 20 }, new AbortController().signal)
  const row = async (runId) => (await pool.query("SELECT * FROM bff_scheduled_agent_dispatch WHERE tenant_id=$1 AND run_id=$2", [tenant, runId])).rows[0]
  const active = async (taskId = "task") =>
    (await pool.query("SELECT active_run_id FROM bff_scheduled_agent_scope WHERE tenant_id=$1 AND task_id=$2", [tenant, taskId])).rows[0].active_run_id
  const claimConsumer = async (sessionId) => {
    await pool.query("UPDATE bff_agui_stream SET consumer_next_poll_at='2000-01-01' WHERE tenant_id=$1 AND session_id=$2", [tenant, sessionId])
    const now = new Date().toISOString()
    const leases = await consumers.claimConsumers({ workerId: "standard-consumer", now, leaseUntil: new Date(Date.now() + 10000).toISOString(), limit: 10 })
    const lease = leases.find((value) => value.sessionId === sessionId)
    assert.ok(lease)
    return lease
  }
  const admit = async (runId) => {
    const [lease] = await ordinary.claimAgentDispatchOutbox({ workerId: "ordinary-worker", limit: 1, leaseDurationMs: 10000, maxAttempts: 8 })
    assert.equal(lease.runId, runId)
    assert.equal(await ordinary.markAgentDispatchAdmitted(lease), true)
    return lease
  }
  return {
    pool,
    database,
    scheduled,
    ordinary,
    submission,
    consumers,
    projection,
    receipts,
    tasks,
    tenant,
    subject,
    task,
    accept,
    row,
    active,
    claimConsumer,
    admit,
    readExecutions,
  }
}

function source(sessionId, runId, sequence, kind, payload) {
  const eventId = `event-${sequence}`
  const occurred = new Date(sequence * 1000).toISOString()
  return {
    sourceRunId: runId,
    sourceEventId: eventId,
    sourceSequence: sequence,
    sourceOccurredAt: occurred,
    sourcePayload: { chat_event_id: eventId, session_id: sessionId, run_id: runId, seq: sequence, payload },
    event: kind === null ? null : { event_id: eventId, seq: sequence, session_id: sessionId, run_id: runId, kind, timestamp: occurred, payload },
  }
}
async function progress(f, lease, exhausted) {
  const now = new Date().toISOString()
  return f.consumers.markConsumerProgress(lease, now, now, exhausted)
}

integrationTest("accepted occurrences allocate ordinary messages only at ordered activation and survive task deletion", async (context) => {
  const f = await fixture(context)
  await f.task()
  const later = await f.accept("task", 2)
  const earlier = await f.accept("task", 1)
  assert.equal((await f.pool.query("SELECT 1 FROM bff_conversation")).rowCount, 0)
  assert.equal((await f.pool.query("SELECT 1 FROM bff_message")).rowCount, 0)
  assert.equal((await f.pool.query("SELECT 1 FROM bff_agent_dispatch_outbox")).rowCount, 0)
  // Accepted work is frozen even when the owning task subsequently disappears.
  assert.equal(
    await f.tasks.deleteScheduledTask({ tenantId: f.tenant, subjectId: f.subject }, "task", {
      tenantId: f.tenant,
      actorId: f.subject,
      requestId: "delete-task",
      idempotencyKey: "delete-task",
    }),
    true,
  )
  const command = await f.scheduled.claim(claimOptions)
  assert.equal(command.runId, earlier.run_id)
  assert.deepEqual(await f.submission.deliver(command, 4000), { outcome: "submitted" })
  assert.equal((await f.row(earlier.run_id)).status, "submitted")
  assert.equal((await f.row(earlier.run_id)).admitted_at, null)
  const queuedRead = await f.readExecutions()
  assert.ok(queuedRead.executions.every((value) => value.state === "queued"))
  assert.deepEqual((await f.readExecutions({ tenantId: "foreign", subjectId: f.subject })).executions, [])
  assert.deepEqual((await f.readExecutions({ tenantId: f.tenant, subjectId: "foreign" })).executions, [])
  assert.equal((await f.row(later.run_id)).status, "pending")
  assert.deepEqual((await f.pool.query("SELECT role,message_seq,content FROM bff_message ORDER BY message_seq")).rows, [
    { role: "user", message_seq: "1", content: "frozen prompt" },
    { role: "assistant", message_seq: "2", content: "" },
  ])
  const ordinaryRow = (await f.pool.query("SELECT payload,status FROM bff_agent_dispatch_outbox")).rows[0]
  assert.equal(ordinaryRow.status, "pending")
  assert.equal(ordinaryRow.payload.schema_version, 3)
  assert.equal(ordinaryRow.payload.launch.trace.source, "kokoro-bff")
  const readers = createAgentRunsReader(f.database)
  assert.deepEqual(await readers.readSubmittedAgentRun({ tenantId: f.tenant, runId: earlier.run_id }), {
    tenantId: f.tenant,
    userId: f.subject,
    runId: earlier.run_id,
    conversationId: earlier.sessionId,
  })
  assert.equal(await readers.readSubmittedAgentRun({ tenantId: "foreign", runId: earlier.run_id }), null)
  assert.equal(await f.scheduled.claim(claimOptions), null)
  await f.admit(earlier.run_id)
  assert.equal(await f.scheduled.reconcileActive(), true)
  assert.equal((await f.row(earlier.run_id)).status, "admitted")
  // A late, earlier callback cannot replace the occurrence already fixed as active.
  await f.pool.query(
    "INSERT INTO bff_scheduled_task(task_id,tenant_id,owner_id,title,prompt,frequency,task_time,timezone,status) VALUES('task',$1,$2,'Task','changed','daily','08:00','UTC','active')",
    [f.tenant, f.subject],
  )
  await f.accept("task", 0)
  assert.equal(await f.active(), earlier.run_id)
  assert.equal(await f.scheduled.claim(claimOptions), null)
})

integrationTest("standard AG-UI terminal persists results while only exhausted source progress releases the next occurrence", async (context) => {
  const f = await fixture(context)
  await f.task()
  const first = await f.accept("task", 1),
    second = await f.accept("task", 2)
  const command = await f.scheduled.claim(claimOptions)
  assert.deepEqual(await f.submission.deliver(command, 4000), { outcome: "submitted" })
  await f.admit(first.run_id)
  const consumer = await f.claimConsumer(first.sessionId)
  const events = [
    source(first.sessionId, first.run_id, 1, "run.created", { run_id: first.run_id }),
    source(first.sessionId, first.run_id, 2, "message.completed", { segment_id: "final-segment", content: "Final answer" }),
    source(first.sessionId, first.run_id, 3, "run.completed", { status: "completed", final_segment_id: "final-segment" }),
  ]
  await f.projection.ingest(f.tenant, first.sessionId, events, consumer)
  assert.equal((await f.row(first.run_id)).status, "terminal")
  assert.equal(await f.active(), first.run_id)
  assert.equal(await f.scheduled.claim(claimOptions), null)
  assert.equal(await f.scheduled.markUnknown(command, 0, "late-adapter"), false)
  const final = await readRunFinalAnswer(f.pool, {
    tenantId: f.tenant,
    subjectId: f.subject,
    conversationId: first.sessionId,
    runId: first.run_id,
    finalMessageId: "final-segment",
    signal: new AbortController().signal,
    deadlineAt: performance.now() + 3000,
  })
  assert.equal(final?.segment_id, "final-segment")
  const completedRead = (await f.readExecutions()).executions.find((value) => value.run_id === first.run_id)
  assert.equal(completedRead.state, "completed")
  assert.equal(completedRead.conversation_id, first.sessionId)
  assert.equal(completedRead.assistant_message_id, first.assistant_message_id)
  const waitingRead = (await f.readExecutions()).executions.find((value) => value.run_id === second.run_id)
  assert.equal(waitingRead.state, "queued")
  assert.equal(waitingRead.conversation_id, null)
  assert.equal(waitingRead.assistant_message_id, null)
  assert.equal(await progress(f, consumer, false), true)
  assert.equal(await f.active(), first.run_id)
  const resumed = await f.claimConsumer(first.sessionId)
  assert.equal(resumed.sourceHighWatermark, 3)
  // A legitimate duplicate terminal is bookkeeping-only, and still advances the one continuous source cursor.
  const bookkeeping = await f.projection.ingest(
    f.tenant,
    first.sessionId,
    [source(first.sessionId, first.run_id, 4, "run.completed", { status: "completed", final_segment_id: "final-segment" })],
    resumed,
  )
  assert.equal(bookkeeping.insertedSources, 1)
  assert.equal(bookkeeping.insertedFrames, 0)
  assert.equal(await progress(f, { ...resumed, leaseToken: "stale" }, true), false)
  assert.equal(await f.active(), first.run_id)
  assert.equal(await progress(f, resumed, true), true)
  assert.equal(await f.active(), null)
  const next = await f.scheduled.claim(claimOptions)
  assert.equal(next.runId, second.run_id)
  assert.deepEqual(await f.submission.deliver(next, 4000), { outcome: "submitted" })
  assert.deepEqual(
    (await f.pool.query("SELECT message_seq FROM bff_message ORDER BY message_seq")).rows.map((value) => value.message_seq),
    ["1", "2", "3", "4"],
  )
})

integrationTest("source gaps and identity conflicts keep the scheduled gate and standard ledger unchanged", async (context) => {
  const f = await fixture(context)
  await f.task()
  const accepted = await f.accept("task", 1)
  const command = await f.scheduled.claim(claimOptions)
  await f.submission.deliver(command, 4000)
  await f.admit(accepted.run_id)
  const lease = await f.claimConsumer(accepted.sessionId)
  const started = source(accepted.sessionId, accepted.run_id, 1, "run.created", { run_id: accepted.run_id })
  await f.projection.ingest(f.tenant, accepted.sessionId, [started], lease)
  await assert.rejects(
    f.projection.ingest(f.tenant, accepted.sessionId, [source(accepted.sessionId, accepted.run_id, 3, "run.completed", { status: "completed" })], lease),
  )
  await assert.rejects(f.projection.ingest(f.tenant, accepted.sessionId, [{ ...started, sourcePayload: { changed: true } }], lease))
  const state = (await f.pool.query("SELECT source_high_watermark FROM bff_agui_stream")).rows[0]
  assert.equal(state.source_high_watermark, "1")
  assert.equal((await f.pool.query("SELECT 1 FROM bff_agui_source_event")).rowCount, 1)
  assert.equal((await f.row(accepted.run_id)).status, "submitted")
  assert.equal(await f.active(), accepted.run_id)
  assert.equal(await f.scheduled.claim(claimOptions), null)
})

integrationTest("lease expiry fences stale Chat insertion and both sides of a submission crash replay stable identities", async (context) => {
  const f = await fixture(context)
  await f.task()
  const accepted = await f.accept("task", 1)
  const old = await f.scheduled.claim(claimOptions)
  const failedBefore = new ScheduledChatSubmission({
    commitChatTurn: async () => {
      throw new Error("before-commit")
    },
  })
  assert.equal((await failedBefore.deliver(old, 4000)).outcome, "unknown")
  assert.equal(await f.scheduled.markUnknown(old, 0, "before-commit"), true)
  const renewed = await f.scheduled.claim(claimOptions)
  assert.ok(renewed.fence > old.fence)
  assert.equal((await f.submission.deliver(old, 4000)).outcome, "not_admitted")
  assert.equal((await f.pool.query("SELECT 1 FROM bff_conversation")).rowCount, 0)
  assert.equal(await f.scheduled.releaseNeverSent(old, 0), false)
  // The worker waits behind the real scheduled scope lock while its lease expires.
  const blocker = await f.pool.connect()
  let blockedSubmission
  try {
    await blocker.query("BEGIN")
    await blocker.query("SELECT 1 FROM bff_scheduled_agent_scope WHERE tenant_id=$1 AND task_id=$2 FOR UPDATE", [f.tenant, "task"])
    const blockerPid = (await blocker.query("SELECT pg_backend_pid() pid")).rows[0].pid
    blockedSubmission = f.submission.deliver(renewed, 4000)
    const deadline = Date.now() + 1500
    let observed = false
    while (Date.now() < deadline) {
      const waiters = await f.pool.query("SELECT 1 FROM pg_stat_activity a WHERE $1=ANY(pg_blocking_pids(a.pid)) AND a.wait_event_type='Lock'", [blockerPid])
      if (waiters.rowCount > 0) {
        observed = true
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    assert.equal(observed, true, "the activation must wait behind its scheduled scope fence")
    await blocker.query("UPDATE bff_scheduled_agent_dispatch SET lease_until=clock_timestamp()-interval '1 second' WHERE dispatch_id=$1", [renewed.dispatchId])
    await blocker.query("COMMIT")
    assert.equal((await blockedSubmission).outcome, "not_admitted")
  } finally {
    await blocker.query("ROLLBACK").catch(() => undefined)
    blocker.release()
    await blockedSubmission
  }
  assert.equal((await f.pool.query("SELECT 1 FROM bff_message")).rowCount, 0)
  const current = await f.scheduled.claim(claimOptions)
  const failedAfter = new ScheduledChatSubmission({
    commitChatTurn: async (value) => {
      await f.ordinary.commitChatTurn(value)
      throw new Error("after-commit")
    },
  })
  assert.equal((await failedAfter.deliver(current, 4000)).outcome, "unknown")
  assert.equal((await f.row(accepted.run_id)).status, "submitted")
  assert.equal(await f.scheduled.markUnknown(current, 0, "after-commit"), false)
  assert.deepEqual(await f.submission.deliver(current, 4000), { outcome: "submitted" })
  assert.equal((await f.pool.query("SELECT 1 FROM bff_message")).rowCount, 2)
  assert.equal((await f.pool.query("SELECT 1 FROM bff_agent_dispatch_outbox WHERE run_id=$1", [accepted.run_id])).rowCount, 1)
})

integrationTest("ordinary never-admitted failure releases the gate and Conversation tombstones are never recreated", async (context) => {
  const f = await fixture(context)
  await f.task()
  const first = await f.accept("task", 1),
    second = await f.accept("task", 2)
  const command = await f.scheduled.claim(claimOptions)
  await f.submission.deliver(command, 4000)
  const chat = new PostgresChatSessionStore(f.database)
  assert.equal(await chat.deleteConversation(f.tenant, f.subject, first.sessionId, "delete"), true)
  assert.ok((await f.readExecutions()).executions.every((value) => value.conversation_id === null && value.assistant_message_id === null))
  assert.equal(await f.scheduled.reconcileActive(), true)
  assert.equal((await f.row(first.run_id)).status, "failed")
  assert.equal((await f.row(first.run_id)).admitted_at, null)
  assert.equal(await f.active(), null)
  const next = await f.scheduled.claim(claimOptions)
  assert.equal(next.runId, second.run_id)
  assert.equal((await f.submission.deliver(next, 4000)).outcome, "not_admitted")
  assert.equal(await f.scheduled.markNotAdmitted(next, 0, "conversation_deleted"), true)
  assert.deepEqual((await f.pool.query("SELECT status FROM bff_conversation")).rows, [{ status: "deleted" }])
  assert.equal((await f.pool.query("SELECT 1 FROM bff_message")).rowCount, 2)
  assert.equal((await f.pool.query("SELECT 1 FROM bff_agent_dispatch_outbox")).rowCount, 1)
})

integrationTest("admitted Conversation deletion retains cancellation and the truthful gate without manufacturing source exhaustion", async (context) => {
  const f = await fixture(context)
  await f.task()
  const accepted = await f.accept("task", 1)
  const command = await f.scheduled.claim(claimOptions)
  await f.submission.deliver(command, 4000)
  await f.admit(accepted.run_id)
  await f.scheduled.reconcileActive()
  assert.equal(await new PostgresChatSessionStore(f.database).deleteConversation(f.tenant, f.subject, accepted.sessionId, "delete-admitted"), true)
  assert.equal((await f.pool.query("SELECT run_id FROM bff_agent_cancellation_outbox")).rows[0].run_id, accepted.run_id)
  assert.equal(await f.scheduled.reconcileActive(), false)
  assert.equal((await f.row(accepted.run_id)).status, "admitted")
  assert.equal(await f.active(), accepted.run_id)
  assert.equal((await f.pool.query("SELECT consumer_state FROM bff_agui_stream")).rows[0].consumer_state, "stopped")
})

integrationTest("two workers have one scope winner while a locked independent scope is skipped", async (context) => {
  const f = await fixture(context)
  await f.task("a-slow")
  await f.task("z-ready")
  await f.accept("a-slow", 1)
  await f.accept("z-ready", 1)
  const blocker = await f.pool.connect()
  try {
    await blocker.query("BEGIN")
    await blocker.query("SELECT 1 FROM bff_scheduled_agent_scope WHERE task_id='a-slow' FOR UPDATE")
    const ready = await f.scheduled.claim(claimOptions)
    assert.equal(ready.taskId, "z-ready")
    await blocker.query("COMMIT")
    const results = await Promise.all([f.scheduled.claim(claimOptions), f.scheduled.claim({ ...claimOptions, workerId: "other-worker" })])
    const winners = results.filter(Boolean)
    assert.equal(winners.length, 1)
    assert.equal(winners[0].taskId, "a-slow")
    const outcomes = await Promise.all([f.submission.deliver(winners[0], 4000), f.submission.deliver(winners[0], 4000)])
    assert.deepEqual(outcomes, [{ outcome: "submitted" }, { outcome: "submitted" }])
    assert.equal((await f.pool.query("SELECT 1 FROM bff_agent_dispatch_outbox")).rowCount, 1)
    assert.equal((await f.pool.query("SELECT 1 FROM bff_message")).rowCount, 2)
  } finally {
    await blocker.query("ROLLBACK").catch(() => undefined)
    blocker.release()
  }
})

integrationTest("project activation uses current owner instructions and filtering hides deleted parents", async (context) => {
  const f = await fixture(context)
  const project = `project_${randomUUID()}`
  await f.pool.query(
    "INSERT INTO bff_project(project_id,tenant_id,owner_id,name,slug,instruction) VALUES($1,$2,$3,'Project','project','Current instruction')",
    [project, f.tenant, f.subject],
  )
  await f.task()
  await f.pool.query("UPDATE bff_scheduled_task SET project_id=$1 WHERE task_id='task'", [project])
  const accepted = await f.accept("task", 1, project)
  assert.deepEqual(await f.submission.deliver(await f.scheduled.claim(claimOptions), 4000), { outcome: "submitted" })
  const ordinary = (await f.pool.query("SELECT execution_project_ref,payload FROM bff_agent_dispatch_outbox WHERE run_id=$1", [accepted.run_id])).rows[0]
  assert.equal(ordinary.execution_project_ref, project)
  assert.equal(ordinary.payload.launch.project_instruction, "Current instruction")
  const reader = new PostgresScheduledTaskExecutionReader(f.pool)
  const scope = { tenantId: f.tenant, subjectId: f.subject },
    signal = new AbortController().signal
  assert.equal((await reader.read(scope, { limit: 20, projectId: project }, signal)).executions[0].project_id, project)
  assert.deepEqual((await reader.read(scope, { limit: 20, projectId: "other-project" }, signal)).executions, [])
  await f.pool.query("UPDATE bff_project SET deleted_at=clock_timestamp() WHERE project_id=$1", [project])
  assert.deepEqual((await reader.read(scope, { limit: 20, projectId: project }, signal)).executions, [])
})

for (const outcome of ["cancelled", "failed"]) {
  integrationTest(`standard ${outcome} terminal preserves its result class and drains through the sole source consumer`, async (context) => {
    const f = await fixture(context)
    await f.task()
    const accepted = await f.accept("task", 1)
    await f.submission.deliver(await f.scheduled.claim(claimOptions), 4000)
    await f.admit(accepted.run_id)
    const lease = await f.claimConsumer(accepted.sessionId)
    const terminal =
      outcome === "cancelled"
        ? source(accepted.sessionId, accepted.run_id, 2, "run.completed", { status: "cancelled" })
        : source(accepted.sessionId, accepted.run_id, 2, "run.failed", {
            failure: { source: "agent", code: "model_unavailable", retryable: true },
            message: "Agent run failed",
          })
    await f.projection.ingest(
      f.tenant,
      accepted.sessionId,
      [source(accepted.sessionId, accepted.run_id, 1, "run.created", { run_id: accepted.run_id }), terminal],
      lease,
    )
    assert.equal((await f.row(accepted.run_id)).status, "terminal")
    assert.equal((await f.readExecutions()).executions[0].state, outcome)
    assert.equal(await f.active(), accepted.run_id)
    assert.equal(await progress(f, lease, true), true)
    assert.equal(await f.active(), null)
  })
}
