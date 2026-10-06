import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { createServer } from "node:http"
import { test } from "node:test"

import { Pool } from "pg"

import { PostgresScheduledTaskRepository } from "../dist/infrastructure/postgres/scheduled-task-repository.js"
import { ScheduledTaskOutboxDispatcher } from "../dist/application/scheduled-task-outbox-dispatcher.js"
import { SchedulerOutboxDelivery } from "../dist/infrastructure/clients/scheduler/outbox-delivery.js"

const postgresUrl = process.env.KOKORO_TEST_POSTGRES_URL
const integrationTest = postgresUrl ? test : test.skip

function lineage(tenantId, idempotencyKey, suffix) {
  return {
    tenantId,
    actorId: `actor_${suffix}`,
    requestId: `request_${idempotencyKey}`,
    idempotencyKey,
  }
}

function ownerScope(tenantId, suffix) {
  return { tenantId, subjectId: `actor_${suffix}` }
}

function taskInput(suffix, overrides = {}) {
  return {
    title: `Review ${suffix}`,
    prompt: `Review the project for ${suffix}.`,
    frequency: "daily",
    time: "08:00",
    timezone: "UTC",
    recurrenceAnchorAt: new Date("2026-09-04T12:00:00.000Z"),
    autoApprove: false,
    ...overrides,
  }
}

async function count(pool, table, tenantId) {
  const result = await pool.query(`SELECT count(*)::int AS count FROM ${table} WHERE tenant_id = $1`, [tenantId])
  return result.rows[0].count
}

integrationTest("ScheduledTask outbox is atomic, idempotent, tenant-scoped, and restart-recoverable", async () => {
  const suffix = `${Date.now()}_${Math.random().toString(16).slice(2)}`
  const tenants = {
    rollback: `outbox_rollback_${suffix}`,
    core: `outbox_core_${suffix}`,
    claim: `outbox_claim_${suffix}`,
    recovery: `outbox_recovery_${suffix}`,
    concurrent: `outbox_concurrent_${suffix}`,
  }
  const pools = []
  const pool = new Pool({ connectionString: postgresUrl, options: "-c search_path=kokoro_bff -c timezone=UTC", max: 10 })
  pools.push(pool)
  const schema = await readFile(new URL("../database/schema.sql", import.meta.url), "utf8")
  const repository = new PostgresScheduledTaskRepository({ pool })
  const rollbackKey = `rollback-${suffix}`
  const functionName = `fixture_fail_scheduled_outbox_${suffix.replace(/[^a-zA-Z0-9_]/gu, "_")}`
  const triggerName = `fixture_fail_scheduled_outbox_trigger_${suffix.replace(/[^a-zA-Z0-9_]/gu, "_")}`
  let triggerInstalled = false

  try {
    await pool.query(schema)
    const precision = await pool.query(
      `SELECT table_name, column_name, datetime_precision
         FROM information_schema.columns
        WHERE table_name IN ('bff_scheduled_task', 'bff_scheduled_task_outbox')
          AND column_name IN ('recurrence_anchor_at', 'next_run_at', 'expires_at', 'created_at', 'updated_at', 'available_at', 'lease_until', 'last_error_at', 'completed_at')`,
    )
    assert.ok(precision.rows.length >= 10)
    assert.ok(precision.rows.every((row) => Number(row.datetime_precision) === 3))

    await pool.query(
      `CREATE OR REPLACE FUNCTION ${functionName}() RETURNS trigger
       LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture outbox failure'; END; $$`,
    )
    await pool.query(
      `CREATE TRIGGER ${triggerName}
         BEFORE INSERT ON bff_scheduled_task_outbox
         FOR EACH ROW WHEN (NEW.idempotency_key = '${rollbackKey}')
         EXECUTE FUNCTION ${functionName}()`,
    )
    triggerInstalled = true

    await assert.rejects(
      repository.createScheduledTask(
        ownerScope(tenants.rollback, suffix),
        taskInput(suffix),
        `scheduled_rollback_${suffix}`,
        lineage(tenants.rollback, rollbackKey, suffix),
      ),
    )
    assert.equal(await count(pool, "bff_scheduled_task", tenants.rollback), 0)
    assert.equal(await count(pool, "bff_scheduled_task_outbox", tenants.rollback), 0)

    await pool.query(`DROP TRIGGER ${triggerName} ON bff_scheduled_task_outbox`)
    await pool.query(`DROP FUNCTION ${functionName}()`)
    triggerInstalled = false

    const projectId = `project_${suffix}`
    await pool.query(
      `INSERT INTO bff_project (project_id, tenant_id, owner_id, name, slug)
       VALUES ($1, $2, $3, $4, $5)`,
      [projectId, tenants.core, `actor_${suffix}`, "Outbox fixture", `outbox-${suffix}`],
    )
    const taskId = `scheduled_core_${suffix}`
    const createLineage = lineage(tenants.core, `create-${suffix}`, suffix)
    const coreScope = ownerScope(tenants.core, suffix)
    const created = await repository.createScheduledTask(coreScope, taskInput(suffix, { projectId }), taskId, createLineage)
    const duplicate = await repository.createScheduledTask(
      coreScope,
      taskInput(`${suffix}-different`, { projectId, prompt: "A different retry body." }),
      taskId,
      createLineage,
    )
    assert.deepEqual(duplicate, created)
    assert.equal(await count(pool, "bff_scheduled_task", tenants.core), 1)
    assert.equal(await count(pool, "bff_scheduled_task_outbox", tenants.core), 1)
    const registerRow = await pool.query(
      `SELECT command_type, tenant_id, actor_id, request_id, idempotency_key, aggregate_revision, payload
         FROM bff_scheduled_task_outbox
        WHERE tenant_id = $1 AND task_id = $2`,
      [tenants.core, taskId],
    )
    assert.equal(registerRow.rows[0].command_type, "scheduler.register")
    assert.equal(registerRow.rows[0].tenant_id, tenants.core)
    assert.equal(registerRow.rows[0].actor_id, createLineage.actorId)
    assert.equal(registerRow.rows[0].request_id, createLineage.requestId)
    assert.equal(registerRow.rows[0].idempotency_key, createLineage.idempotencyKey)
    assert.equal(Number(registerRow.rows[0].aggregate_revision), 1)
    assert.equal(registerRow.rows[0].payload.lineage.tenant_id, tenants.core)
    assert.equal(registerRow.rows[0].payload.task.recurrence_anchor_at, "2026-09-04T12:00:00.000Z")

    assert.deepEqual(await repository.listScheduledTasks(ownerScope(`${tenants.core}_other`, suffix)), [])
    assert.equal(await repository.findScheduledTask(ownerScope(`${tenants.core}_other`, suffix), taskId), null)

    const otherOwnerScope = { tenantId: tenants.core, subjectId: `actor_other_${suffix}` }
    assert.deepEqual(await repository.listScheduledTasks(otherOwnerScope), [])
    assert.equal(await repository.findScheduledTask(otherOwnerScope, taskId), null)
    const beforeDeniedOutbox = await count(pool, "bff_scheduled_task_outbox", tenants.core)
    assert.equal(
      await repository.updateScheduledTask(
        otherOwnerScope,
        taskId,
        { prompt: "Cross-owner update." },
        lineage(tenants.core, `denied-update-${suffix}`, `other_${suffix}`),
      ),
      null,
    )
    assert.equal(
      await repository.deleteScheduledTask(
        otherOwnerScope,
        taskId,
        lineage(tenants.core, `denied-delete-${suffix}`, `other_${suffix}`),
      ),
      false,
    )
    assert.equal(await count(pool, "bff_scheduled_task_outbox", tenants.core), beforeDeniedOutbox)

    const updateLineage = lineage(tenants.core, `update-${suffix}`, suffix)
    const updated = await repository.updateScheduledTask(coreScope, taskId, { prompt: "Updated prompt." }, updateLineage)
    assert.equal(updated?.revision, 2)
    const duplicateUpdate = await repository.updateScheduledTask(coreScope, taskId, { prompt: "A different retry body." }, updateLineage)
    assert.equal(duplicateUpdate?.revision, 2)
    assert.equal(duplicateUpdate?.prompt, "Updated prompt.")

    const secondUpdateLineage = lineage(tenants.core, `update-2-${suffix}`, suffix)
    const updatedAgain = await repository.updateScheduledTask(
      coreScope,
      taskId,
      { time: "09:00", expiresAt: new Date("2026-09-05T00:00:00.000Z") },
      secondUpdateLineage,
    )
    assert.equal(updatedAgain?.revision, 3)
    assert.equal(updatedAgain?.nextRunAt, null)
    assert.equal(updatedAgain?.expiresAt?.toISOString(), "2026-09-05T00:00:00.000Z")
    assert.equal(await count(pool, "bff_scheduled_task_outbox", tenants.core), 3)

    const deleteLineage = lineage(tenants.core, `delete-${suffix}`, suffix)
    assert.equal(await repository.deleteScheduledTask(coreScope, taskId, deleteLineage), true)
    assert.equal(await repository.deleteScheduledTask(coreScope, taskId, deleteLineage), true)
    assert.equal(await repository.findScheduledTask(coreScope, taskId), null)
    assert.equal(await count(pool, "bff_scheduled_task_outbox", tenants.core), 4)
    const deleteRow = await pool.query(
      `SELECT command_type, actor_id, request_id, idempotency_key
         FROM bff_scheduled_task_outbox
        WHERE tenant_id = $1 AND task_id = $2 AND command_type = 'scheduler.delete'`,
      [tenants.core, taskId],
    )
    assert.equal(deleteRow.rows.length, 1)
    assert.equal(deleteRow.rows[0].actor_id, deleteLineage.actorId)
    assert.equal(deleteRow.rows[0].request_id, deleteLineage.requestId)
    assert.equal(deleteRow.rows[0].idempotency_key, deleteLineage.idempotencyKey)

    // Keep the claim assertions isolated from the earlier CRUD snapshots. In
    // production these rows are drained by the same dispatcher; this fixture
    // only needs to reserve the queue for the lease/fence checks below.
    await pool.query(
      `UPDATE bff_scheduled_task_outbox
          SET status = 'succeeded', completed_at = CURRENT_TIMESTAMP(3)
        WHERE tenant_id = $1 AND status = 'pending'`,
      [tenants.core],
    )

    const claimTaskId = `scheduled_claim_${suffix}`
    const claimLineage = lineage(tenants.claim, `claim-${suffix}`, suffix)
    await repository.createScheduledTask(ownerScope(tenants.claim, suffix), taskInput(suffix), claimTaskId, claimLineage)
    const claimNow = new Date(Date.now() + 1000)
    const claimed = (
      await repository.claimScheduledTaskOutbox({
        workerId: `worker-a-${suffix}`,
        limit: 1,
        leaseDurationMs: 5000,
        now: claimNow,
      })
    )[0]
    assert.ok(claimed)
    assert.equal(claimed.status, "leased")
    assert.equal(claimed.attemptCount, 1)
    assert.equal(claimed.fence, 1)
    assert.ok(claimed.leaseUntil instanceof Date)
    assert.deepEqual(
      await repository.claimScheduledTaskOutbox({
        workerId: `worker-b-${suffix}`,
        limit: 1,
        leaseDurationMs: 5000,
        now: claimNow,
      }),
      [],
    )
    const lease = {
      outboxId: claimed.outboxId,
      leaseOwner: claimed.leaseOwner,
      leaseToken: claimed.leaseToken,
      fence: claimed.fence,
    }
    const claimProjection = confirmedNext(claimed, new Date("2026-09-05T12:00:00.000Z"))
    assert.equal(await repository.markScheduledTaskOutboxSucceeded({ ...lease, leaseToken: "stale-token" }, claimNow, claimProjection), false)
    assert.equal(await repository.markScheduledTaskOutboxSucceeded({ ...lease, fence: 99 }, claimNow, claimProjection), false)
    assert.equal(await repository.markScheduledTaskOutboxSucceeded(lease, new Date(claimNow.getTime() + 1), claimProjection), true)
    assert.equal(await repository.markScheduledTaskOutboxSucceeded(lease, new Date(claimNow.getTime() + 2), claimProjection), false)

    const recoveryTaskId = `scheduled_recovery_${suffix}`
    const recoveryLineage = lineage(tenants.recovery, `recovery-${suffix}`, suffix)
    await repository.createScheduledTask(ownerScope(tenants.recovery, suffix), taskInput(suffix), recoveryTaskId, recoveryLineage)
    const poolA = new Pool({ connectionString: postgresUrl, options: "-c search_path=kokoro_bff -c timezone=UTC", max: 2 })
    const poolB = new Pool({ connectionString: postgresUrl, options: "-c search_path=kokoro_bff -c timezone=UTC", max: 2 })
    pools.push(poolA, poolB)
    const repositoryA = new PostgresScheduledTaskRepository({ pool: poolA })
    const repositoryB = new PostgresScheduledTaskRepository({ pool: poolB })
    const beforeRestart = (
      await repositoryA.claimScheduledTaskOutbox({
        workerId: `worker-restart-a-${suffix}`,
        limit: 1,
        leaseDurationMs: 50,
        now: new Date(Date.now() + 1000),
      })
    )[0]
    assert.ok(beforeRestart)
    await poolA.end()
    const afterRestart = (
      await repositoryB.claimScheduledTaskOutbox({
        workerId: `worker-restart-b-${suffix}`,
        limit: 1,
        leaseDurationMs: 5000,
        now: new Date(beforeRestart.leaseUntil.getTime() + 10),
      })
    )[0]
    assert.ok(afterRestart)
    assert.equal(afterRestart.outboxId, beforeRestart.outboxId)
    assert.ok(afterRestart.fence > beforeRestart.fence)
    const oldLease = {
      outboxId: beforeRestart.outboxId,
      leaseOwner: beforeRestart.leaseOwner,
      leaseToken: beforeRestart.leaseToken,
      fence: beforeRestart.fence,
    }
    const newLease = {
      outboxId: afterRestart.outboxId,
      leaseOwner: afterRestart.leaseOwner,
      leaseToken: afterRestart.leaseToken,
      fence: afterRestart.fence,
    }
    const recoveryProjection = confirmedNext(afterRestart, new Date("2026-09-05T12:00:00.000Z"))
    assert.equal(await repositoryB.markScheduledTaskOutboxSucceeded(oldLease, new Date(), recoveryProjection), false)
    assert.equal(await repositoryB.markScheduledTaskOutboxSucceeded(newLease, new Date(), recoveryProjection), true)

    const concurrentTaskIds = Array.from({ length: 4 }, (_, index) => `scheduled_concurrent_${suffix}_${index}`)
    for (const [index, concurrentTaskId] of concurrentTaskIds.entries()) {
      const concurrentLineage = lineage(tenants.concurrent, `concurrent-${suffix}-${index}`, suffix)
      await repository.createScheduledTask(ownerScope(tenants.concurrent, suffix), taskInput(suffix), concurrentTaskId, concurrentLineage)
    }
    const poolC = new Pool({ connectionString: postgresUrl, options: "-c search_path=kokoro_bff -c timezone=UTC", max: 2 })
    const poolD = new Pool({ connectionString: postgresUrl, options: "-c search_path=kokoro_bff -c timezone=UTC", max: 2 })
    pools.push(poolC, poolD)
    const [claimedC, claimedD] = await Promise.all([
      new PostgresScheduledTaskRepository({ pool: poolC }).claimScheduledTaskOutbox({
        workerId: `worker-c-${suffix}`,
        limit: 10,
        leaseDurationMs: 5000,
        now: new Date(Date.now() + 1000),
      }),
      new PostgresScheduledTaskRepository({ pool: poolD }).claimScheduledTaskOutbox({
        workerId: `worker-d-${suffix}`,
        limit: 10,
        leaseDurationMs: 5000,
        now: new Date(Date.now() + 1000),
      }),
    ])
    const claimedIds = [...claimedC, ...claimedD].map((command) => command.outboxId)
    assert.equal(new Set(claimedIds).size, claimedIds.length)
    assert.equal(claimedIds.length, concurrentTaskIds.length)
  } finally {
    if (triggerInstalled) {
      await pool.query(`DROP TRIGGER IF EXISTS ${triggerName} ON bff_scheduled_task_outbox`).catch(() => undefined)
      await pool.query(`DROP FUNCTION IF EXISTS ${functionName}()`).catch(() => undefined)
    }
    await pool.query("DELETE FROM bff_scheduled_task_outbox WHERE tenant_id = ANY($1::text[])", [Object.values(tenants)]).catch(() => undefined)
    await pool.query("DELETE FROM bff_scheduled_task WHERE tenant_id = ANY($1::text[])", [Object.values(tenants)]).catch(() => undefined)
    await pool.query("DELETE FROM bff_project WHERE tenant_id = ANY($1::text[])", [Object.values(tenants)]).catch(() => undefined)
    for (const candidate of pools.reverse()) await candidate.end().catch(() => undefined)
  }
})

function leasedIdentity(command) {
  return {
    outboxId: command.outboxId,
    leaseOwner: command.leaseOwner,
    leaseToken: command.leaseToken,
    fence: command.fence,
  }
}

function confirmedNext(command, nextRunAt) {
  return {
    taskId: command.taskId,
    taskRevision: command.taskRevision,
    nextRunAt,
  }
}

integrationTest("Scheduler-confirmed next is nullable, revision-fenced, and atomic with outbox settlement", async (t) => {
  const suffix = `${Date.now()}_${Math.random().toString(16).slice(2)}`
  const tenants = {
    explicit: `next_explicit_${suffix}`,
    omitted: `next_omitted_${suffix}`,
    current: `next_current_${suffix}`,
    paused: `next_paused_${suffix}`,
    stale: `next_stale_${suffix}`,
    rollback: `next_rollback_${suffix}`,
  }
  const pool = new Pool({ connectionString: postgresUrl, options: "-c search_path=kokoro_bff -c timezone=UTC", max: 6 })
  const repository = new PostgresScheduledTaskRepository({ pool })
  const schema = await readFile(new URL("../database/schema.sql", import.meta.url), "utf8")
  const rollbackFunction = `fixture_fail_next_settlement_${suffix.replace(/[^a-zA-Z0-9_]/gu, "_")}`
  const rollbackTrigger = `fixture_fail_next_settlement_trigger_${suffix.replace(/[^a-zA-Z0-9_]/gu, "_")}`
  let rollbackTriggerInstalled = false

  async function create(tenantId, label, overrides = {}) {
    const taskId = `scheduled_${label}_${suffix}`
    const scope = ownerScope(tenantId, suffix)
    const created = await repository.createScheduledTask(scope, taskInput(suffix, overrides), taskId, lineage(tenantId, `create-${label}-${suffix}`, suffix))
    return { taskId, scope, created }
  }

  async function claim(tenantId, taskId, worker) {
    const commands = await repository.claimScheduledTaskOutbox({
      workerId: `${worker}-${suffix}`,
      limit: 100,
      leaseDurationMs: 30_000,
      now: new Date(Date.now() + 1_000),
    })
    assert.ok(commands.length > 0)
    assert.ok(commands.every((command) => Object.values(tenants).includes(command.tenantId)))
    const matches = commands.filter((command) => command.tenantId === tenantId && command.taskId === taskId)
    assert.equal(matches.length, 1)
    return matches[0]
  }

  try {
    await pool.query(schema)

    await t.test("create keeps an explicit anchor separate from pending next", async () => {
      const explicitAnchor = new Date("2026-09-06T12:00:00.000Z")
      const explicit = await create(tenants.explicit, "explicit", { recurrenceAnchorAt: explicitAnchor })
      assert.equal(explicit.created.recurrenceAnchorAt.toISOString(), explicitAnchor.toISOString())
      assert.equal(explicit.created.nextRunAt, null)
      const persisted = await pool.query(
        `SELECT recurrence_anchor_at, next_run_at
           FROM bff_scheduled_task
          WHERE tenant_id = $1`,
        [tenants.explicit],
      )
      assert.equal(new Date(persisted.rows[0].recurrence_anchor_at).toISOString(), explicitAnchor.toISOString())
      assert.equal(persisted.rows[0].next_run_at, null)
      const pending = await pool.query(
        `SELECT payload
           FROM bff_scheduled_task_outbox
          WHERE tenant_id = $1 AND status = 'pending'`,
        [tenants.explicit],
      )
      assert.equal(pending.rows[0].payload.schema_version, 2)
      assert.equal(pending.rows[0].payload.task.recurrence_anchor_at, explicitAnchor.toISOString())
      assert.equal(Object.hasOwn(pending.rows[0].payload.task, "next_run_at"), false)
    })

    await t.test("create freezes an omitted anchor once while keeping pending next null", async () => {
      const before = Date.now()
      const omitted = await create(tenants.omitted, "omitted", { recurrenceAnchorAt: undefined })
      const after = Date.now()
      assert.ok(omitted.created.recurrenceAnchorAt instanceof Date)
      assert.ok(omitted.created.recurrenceAnchorAt.getTime() >= before && omitted.created.recurrenceAnchorAt.getTime() <= after)
      assert.equal(omitted.created.nextRunAt, null)
      const persisted = await pool.query(
        `SELECT recurrence_anchor_at, next_run_at
           FROM bff_scheduled_task
          WHERE tenant_id = $1`,
        [tenants.omitted],
      )
      assert.equal(new Date(persisted.rows[0].recurrence_anchor_at).toISOString(), omitted.created.recurrenceAnchorAt.toISOString())
      assert.equal(persisted.rows[0].next_run_at, null)
      const pending = await pool.query(
        `SELECT payload
           FROM bff_scheduled_task_outbox
          WHERE tenant_id = $1 AND status = 'pending'`,
        [tenants.omitted],
      )
      assert.equal(pending.rows[0].payload.schema_version, 2)
      assert.equal(pending.rows[0].payload.task.recurrence_anchor_at, omitted.created.recurrenceAnchorAt.toISOString())
      assert.equal(Object.hasOwn(pending.rows[0].payload.task, "next_run_at"), false)
    })

    await t.test("the current revision projects owner next and settles the exact lease atomically", async () => {
      const { taskId } = await create(tenants.current, "current", { recurrenceAnchorAt: new Date("2026-09-07T12:00:00.000Z") })
      const command = await claim(tenants.current, taskId, "worker-current")
      const nextRunAt = new Date("2026-09-08T12:00:00.000Z")
      assert.equal(
        await repository.markScheduledTaskOutboxSucceeded(leasedIdentity(command), new Date("2026-09-06T12:01:00.000Z"), confirmedNext(command, nextRunAt)),
        true,
      )
      const state = await pool.query(
        `SELECT task.next_run_at, task.revision, command.status, command.completed_at
           FROM bff_scheduled_task AS task
           JOIN bff_scheduled_task_outbox AS command
             ON command.tenant_id = task.tenant_id AND command.task_id = task.task_id
          WHERE task.tenant_id = $1 AND task.task_id = $2`,
        [tenants.current, taskId],
      )
      assert.equal(new Date(state.rows[0].next_run_at).toISOString(), nextRunAt.toISOString())
      assert.equal(Number(state.rows[0].revision), command.taskRevision)
      assert.equal(state.rows[0].status, "succeeded")
      assert.ok(state.rows[0].completed_at)
    })

    await t.test("pausing creates a new revision and clears a previously confirmed next", async () => {
      const { taskId, scope } = await create(tenants.paused, "paused", { recurrenceAnchorAt: new Date("2026-09-07T12:00:00.000Z") })
      await pool.query("UPDATE bff_scheduled_task SET next_run_at = $3::timestamptz WHERE tenant_id = $1 AND task_id = $2", [
        tenants.paused,
        taskId,
        new Date("2026-09-08T12:00:00.000Z"),
      ])
      const paused = await repository.updateScheduledTask(
        scope,
        taskId,
        { status: "paused", enabled: false },
        lineage(tenants.paused, `pause-${suffix}`, suffix),
      )
      assert.equal(paused?.revision, 2)
      assert.equal(paused?.status, "paused")
      assert.equal(paused?.enabled, false)
      assert.equal(paused?.nextRunAt, null)
      const persisted = await pool.query("SELECT next_run_at FROM bff_scheduled_task WHERE tenant_id = $1 AND task_id = $2", [tenants.paused, taskId])
      assert.equal(persisted.rows[0].next_run_at, null)
    })

    await t.test("late old-revision and stale-lease acknowledgements cannot overwrite the current task", async () => {
      const { taskId, scope } = await create(tenants.stale, "stale", { recurrenceAnchorAt: new Date("2026-09-07T12:00:00.000Z") })
      const oldCommand = await claim(tenants.stale, taskId, "worker-stale-old")
      const current = await repository.updateScheduledTask(scope, taskId, { time: "09:00" }, lineage(tenants.stale, `replace-${suffix}`, suffix))
      assert.equal(current?.revision, 2)
      assert.equal(current?.nextRunAt, null)

      const oldNext = new Date("2026-09-08T12:00:00.000Z")
      for (const invalidLease of [
        { ...leasedIdentity(oldCommand), leaseToken: "stale-token" },
        { ...leasedIdentity(oldCommand), fence: oldCommand.fence + 1 },
      ]) {
        assert.equal(
          await repository.markScheduledTaskOutboxSucceeded(
            invalidLease,
            new Date("2026-09-06T12:00:30.000Z"),
            confirmedNext(oldCommand, new Date("2026-09-09T12:00:00.000Z")),
          ),
          false,
        )
        const protectedState = await pool.query(
          `SELECT task.next_run_at, command.status
             FROM bff_scheduled_task AS task
             JOIN bff_scheduled_task_outbox AS command
               ON command.tenant_id = task.tenant_id AND command.task_id = task.task_id
            WHERE task.tenant_id = $1 AND task.task_id = $2 AND command.outbox_id = $3`,
          [tenants.stale, taskId, oldCommand.outboxId],
        )
        assert.equal(protectedState.rows[0].next_run_at, null)
        assert.equal(protectedState.rows[0].status, "leased")
      }
      assert.equal(
        await repository.markScheduledTaskOutboxSucceeded(leasedIdentity(oldCommand), new Date("2026-09-06T12:01:00.000Z"), confirmedNext(oldCommand, oldNext)),
        true,
      )
      const state = await pool.query("SELECT revision, next_run_at FROM bff_scheduled_task WHERE tenant_id = $1 AND task_id = $2", [tenants.stale, taskId])
      assert.equal(Number(state.rows[0].revision), 2)
      assert.equal(state.rows[0].next_run_at, null)
    })

    await t.test("projection and success settlement roll back together on a mid-transaction SQL failure", async () => {
      const { taskId } = await create(tenants.rollback, "rollback-next", { recurrenceAnchorAt: new Date("2026-09-07T12:00:00.000Z") })
      const command = await claim(tenants.rollback, taskId, "worker-rollback-next")
      await pool.query(
        `CREATE OR REPLACE FUNCTION ${rollbackFunction}() RETURNS trigger
         LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture next settlement failure'; END; $$`,
      )
      await pool.query(
        `CREATE TRIGGER ${rollbackTrigger}
           BEFORE UPDATE ON bff_scheduled_task_outbox
           FOR EACH ROW
           WHEN (OLD.tenant_id = '${tenants.rollback}' AND NEW.status = 'succeeded')
           EXECUTE FUNCTION ${rollbackFunction}()`,
      )
      rollbackTriggerInstalled = true
      const projectedNext = new Date("2026-09-08T12:00:00.000Z")
      await assert.rejects(
        repository.markScheduledTaskOutboxSucceeded(leasedIdentity(command), new Date("2026-09-06T12:01:00.000Z"), confirmedNext(command, projectedNext)),
        /fixture next settlement failure/u,
      )
      const rolledBack = await pool.query(
        `SELECT task.next_run_at, command.status, command.lease_owner, command.lease_token, command.fence
           FROM bff_scheduled_task AS task
           JOIN bff_scheduled_task_outbox AS command
             ON command.tenant_id = task.tenant_id AND command.task_id = task.task_id
          WHERE task.tenant_id = $1 AND task.task_id = $2`,
        [tenants.rollback, taskId],
      )
      assert.equal(rolledBack.rows[0].next_run_at, null)
      assert.equal(rolledBack.rows[0].status, "leased")
      assert.equal(rolledBack.rows[0].lease_owner, command.leaseOwner)
      assert.equal(rolledBack.rows[0].lease_token, command.leaseToken)
      assert.equal(Number(rolledBack.rows[0].fence), command.fence)

      await pool.query(`DROP TRIGGER ${rollbackTrigger} ON bff_scheduled_task_outbox`)
      await pool.query(`DROP FUNCTION ${rollbackFunction}()`)
      rollbackTriggerInstalled = false
      assert.equal(
        await repository.markScheduledTaskOutboxSucceeded(leasedIdentity(command), new Date("2026-09-06T12:02:00.000Z"), confirmedNext(command, projectedNext)),
        true,
      )
      const recovered = await pool.query(
        `SELECT task.next_run_at, command.status
           FROM bff_scheduled_task AS task
           JOIN bff_scheduled_task_outbox AS command
             ON command.tenant_id = task.tenant_id AND command.task_id = task.task_id
          WHERE task.tenant_id = $1 AND task.task_id = $2`,
        [tenants.rollback, taskId],
      )
      assert.equal(new Date(recovered.rows[0].next_run_at).toISOString(), projectedNext.toISOString())
      assert.equal(recovered.rows[0].status, "succeeded")
    })
  } finally {
    if (rollbackTriggerInstalled) {
      await pool.query(`DROP TRIGGER IF EXISTS ${rollbackTrigger} ON bff_scheduled_task_outbox`).catch(() => undefined)
      await pool.query(`DROP FUNCTION IF EXISTS ${rollbackFunction}()`).catch(() => undefined)
    }
    await pool.query("DELETE FROM bff_scheduled_task_outbox WHERE tenant_id = ANY($1::text[])", [Object.values(tenants)]).catch(() => undefined)
    await pool.query("DELETE FROM bff_scheduled_task WHERE tenant_id = ANY($1::text[])", [Object.values(tenants)]).catch(() => undefined)
    await pool.end()
  }
})

integrationTest("Scheduler receipt schema gates next projection before durable settlement", async (t) => {
  const suffix = `${Date.now()}_${Math.random().toString(16).slice(2)}`
  const cases = ["valid", "missing-meta", "missing-id", "invalid-calendar"]
  const tenants = Object.fromEntries(cases.map((name) => [name, `next_receipt_${name.replaceAll("-", "_")}_${suffix}`]))
  const pool = new Pool({ connectionString: postgresUrl, options: "-c search_path=kokoro_bff -c timezone=UTC", max: 4 })
  const repository = new PostgresScheduledTaskRepository({ pool })
  const schema = await readFile(new URL("../database/schema.sql", import.meta.url), "utf8")
  let responseMode = "valid"
  const ownerRequests = []
  const owner = createServer((request, response) => {
    const chunks = []
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
    request.on("end", () => {
      const schedule = JSON.parse(Buffer.concat(chunks).toString("utf8"))
      ownerRequests.push({ mode: responseMode, taskId: schedule.body?.task_id })
      const ownerSchedule = {
        ...schedule,
        id: "00000000-0000-4000-8000-000000000001",
        next_due_at: responseMode === "invalid-calendar" ? "2026-02-30T08:00:00.000Z" : "2026-09-08T08:00:00.000Z",
        version: 41,
      }
      if (responseMode === "missing-id") delete ownerSchedule.id
      const envelope = {
        data: { name: schedule.name, status: "registered", schedule: ownerSchedule },
        meta: { request_id: request.headers["x-request-id"] },
      }
      if (responseMode === "missing-meta") delete envelope.meta
      response.setHeader("content-type", "application/json")
      response.end(JSON.stringify(envelope))
    })
  })
  await new Promise((resolve, reject) => {
    owner.once("error", reject)
    owner.listen(0, "127.0.0.1", resolve)
  })
  const address = owner.address()
  if (address === null || typeof address === "string") throw new Error("fixture Scheduler did not bind")
  const delivery = new SchedulerOutboxDelivery({
    upstreams: { scheduler: `http://127.0.0.1:${address.port}` },
    schedulerServiceToken: "fixture-scheduler-token",
    schedulerTargetUrl: "http://bff.test/internal/bff/scheduled-tasks/dispatch",
    upstreamTimeoutMs: 1000,
    upstreamMaxResponseBytes: 1024 * 1024,
  })

  try {
    await pool.query(schema)
    for (const name of cases) {
      await t.test(name, async () => {
        responseMode = name
        const tenantId = tenants[name]
        const taskId = `scheduled_receipt_${name.replaceAll("-", "_")}_${suffix}`
        await repository.createScheduledTask(
          ownerScope(tenantId, suffix),
          taskInput(suffix, { recurrenceAnchorAt: new Date("2026-09-07T08:00:00.000Z") }),
          taskId,
          lineage(tenantId, `receipt-${name}-${suffix}`, suffix),
        )
        const ownerRequestCount = ownerRequests.length
        const dispatchNow = new Date(Date.now() + 1_000)
        const dispatcher = new ScheduledTaskOutboxDispatcher(repository, delivery, {
          workerId: `receipt-${name}-${suffix}`,
          batchSize: 1,
          maxAttempts: 1,
          clock: () => dispatchNow,
        })
        assert.equal(await dispatcher.runOnce(), 1)
        assert.equal(ownerRequests.length, ownerRequestCount + 1)
        assert.deepEqual(ownerRequests.at(-1), { mode: name, taskId })
        const state = await pool.query(
          `SELECT task.next_run_at, command.status
             FROM bff_scheduled_task AS task
             JOIN bff_scheduled_task_outbox AS command
               ON command.tenant_id = task.tenant_id AND command.task_id = task.task_id
            WHERE task.tenant_id = $1 AND task.task_id = $2`,
          [tenantId, taskId],
        )
        if (name === "valid") {
          assert.equal(new Date(state.rows[0].next_run_at).toISOString(), "2026-09-08T08:00:00.000Z")
          assert.equal(state.rows[0].status, "succeeded")
        } else {
          assert.equal(state.rows[0].next_run_at, null)
          assert.notEqual(state.rows[0].status, "succeeded")
        }
      })
    }
  } finally {
    await pool.query("DELETE FROM bff_scheduled_task_outbox WHERE tenant_id = ANY($1::text[])", [Object.values(tenants)]).catch(() => undefined)
    await pool.query("DELETE FROM bff_scheduled_task WHERE tenant_id = ANY($1::text[])", [Object.values(tenants)]).catch(() => undefined)
    await pool.end()
    await new Promise((resolve) => owner.close(() => resolve()))
  }
})

integrationTest("terminal Scheduler failure projects only the current active task revision", async (t) => {
  const suffix = `${Date.now()}_${Math.random().toString(16).slice(2)}`
  const tenants = {
    current: `failure_current_${suffix}`,
    replace: `failure_replace_${suffix}`,
    retryable: `failure_retryable_${suffix}`,
    stale: `failure_stale_${suffix}`,
    paused: `failure_paused_${suffix}`,
    deleted: `failure_deleted_${suffix}`,
    lease: `failure_lease_${suffix}`,
    rollback: `failure_rollback_${suffix}`,
  }
  const pool = new Pool({ connectionString: postgresUrl, options: "-c search_path=kokoro_bff -c timezone=UTC", max: 6 })
  const repository = new PostgresScheduledTaskRepository({ pool })
  const schema = await readFile(new URL("../database/schema.sql", import.meta.url), "utf8")
  const rollbackFunction = `fixture_fail_terminal_settlement_${suffix.replace(/[^a-zA-Z0-9_]/gu, "_")}`
  const rollbackTrigger = `fixture_fail_terminal_settlement_trigger_${suffix.replace(/[^a-zA-Z0-9_]/gu, "_")}`
  let rollbackTriggerInstalled = false

  async function create(tenantId, label) {
    const taskId = `scheduled_failure_${label}_${suffix}`
    const scope = ownerScope(tenantId, suffix)
    await repository.createScheduledTask(scope, taskInput(suffix), taskId, lineage(tenantId, `create-${label}-${suffix}`, suffix))
    return { taskId, scope }
  }

  async function claim(tenantId, taskId, worker) {
    const commands = await repository.claimScheduledTaskOutbox({
      workerId: `${worker}-${suffix}`,
      limit: 100,
      leaseDurationMs: 30_000,
      now: new Date(Date.now() + 1_000),
    })
    const matches = commands.filter((command) => command.tenantId === tenantId && command.taskId === taskId)
    assert.equal(matches.length, 1)
    return matches[0]
  }

  async function state(tenantId, taskId, outboxId) {
    const result = await pool.query(
      `SELECT task.status AS task_status, task.enabled, task.revision, task.next_run_at,
              command.status AS command_status, command.last_error_code, command.completed_at,
              command.lease_owner, command.lease_token, command.fence
         FROM bff_scheduled_task_outbox AS command
         LEFT JOIN bff_scheduled_task AS task
           ON task.tenant_id = command.tenant_id AND task.task_id = command.task_id
        WHERE command.tenant_id = $1 AND command.task_id = $2 AND command.outbox_id = $3`,
      [tenantId, taskId, outboxId],
    )
    assert.equal(result.rows.length, 1)
    return result.rows[0]
  }

  try {
    await pool.query(schema)

    await t.test("current active register failure is atomic with the terminal outbox", async () => {
      const { taskId } = await create(tenants.current, "current")
      const command = await claim(tenants.current, taskId, "worker-current-failure")
      assert.equal(await repository.markScheduledTaskOutboxFailed(leasedIdentity(command), "invalid_schedule", new Date()), true)
      const persisted = await state(tenants.current, taskId, command.outboxId)
      assert.equal(persisted.task_status, "failed")
      assert.equal(persisted.enabled, true)
      assert.equal(Number(persisted.revision), 1)
      assert.equal(persisted.next_run_at, null)
      assert.equal(persisted.command_status, "failed")
      assert.equal(persisted.last_error_code, "invalid_schedule")
      assert.ok(persisted.completed_at)
      assert.equal(persisted.lease_owner, null)
      assert.equal(persisted.lease_token, null)
    })

    await t.test("current active replace failure projects failed without advancing revision", async () => {
      const { taskId, scope } = await create(tenants.replace, "replace")
      const register = await claim(tenants.replace, taskId, "worker-replace-register")
      assert.equal(
        await repository.markScheduledTaskOutboxSucceeded(
          leasedIdentity(register),
          new Date(),
          confirmedNext(register, new Date("2026-09-08T08:00:00.000Z")),
        ),
        true,
      )
      const replaced = await repository.updateScheduledTask(
        scope,
        taskId,
        { prompt: "Current active replacement." },
        lineage(tenants.replace, `replace-current-${suffix}`, suffix),
      )
      assert.equal(replaced?.revision, 2)
      const replace = await claim(tenants.replace, taskId, "worker-replace-failure")
      assert.equal(replace.commandType, "scheduler.replace")
      assert.equal(await repository.markScheduledTaskOutboxFailed(leasedIdentity(replace), "invalid_schedule", new Date()), true)
      const persisted = await state(tenants.replace, taskId, replace.outboxId)
      assert.equal(persisted.task_status, "failed")
      assert.equal(persisted.enabled, true)
      assert.equal(Number(persisted.revision), 2)
      assert.equal(persisted.next_run_at, null)
      assert.equal(persisted.command_status, "failed")
    })

    await t.test("retryable delivery keeps the current task active before terminal exhaustion", async () => {
      const { taskId } = await create(tenants.retryable, "retryable")
      const dispatcher = new ScheduledTaskOutboxDispatcher(
        repository,
        { deliver: async () => ({ outcome: "retryable", errorCode: "scheduler_target_unavailable" }) },
        {
          workerId: `worker-retryable-${suffix}`,
          batchSize: 100,
          maxAttempts: 3,
          clock: () => new Date(Date.now() + 1_000),
          random: () => 0,
        },
      )
      assert.ok((await dispatcher.runOnce()) >= 1)
      const result = await pool.query(
        `SELECT task.status AS task_status,task.enabled,task.revision,task.next_run_at,
                command.status AS command_status,command.last_error_code,command.completed_at
           FROM bff_scheduled_task AS task
           JOIN bff_scheduled_task_outbox AS command
             ON command.tenant_id=task.tenant_id AND command.task_id=task.task_id
          WHERE task.tenant_id=$1 AND task.task_id=$2`,
        [tenants.retryable, taskId],
      )
      assert.equal(result.rows.length, 1)
      assert.equal(result.rows[0].task_status, "active")
      assert.equal(result.rows[0].enabled, true)
      assert.equal(Number(result.rows[0].revision), 1)
      assert.equal(result.rows[0].next_run_at, null)
      assert.equal(result.rows[0].command_status, "retryable")
      assert.equal(result.rows[0].last_error_code, "scheduler_target_unavailable")
      assert.equal(result.rows[0].completed_at, null)
    })

    await t.test("an old revision failure terminates its command without overwriting the current task", async () => {
      const { taskId, scope } = await create(tenants.stale, "stale")
      const oldCommand = await claim(tenants.stale, taskId, "worker-stale-failure")
      const current = await repository.updateScheduledTask(scope, taskId, { prompt: "New revision remains active." }, lineage(tenants.stale, `replace-stale-${suffix}`, suffix))
      assert.equal(current?.revision, 2)
      assert.equal(await repository.markScheduledTaskOutboxFailed(leasedIdentity(oldCommand), "invalid_schedule", new Date()), true)
      const persisted = await state(tenants.stale, taskId, oldCommand.outboxId)
      assert.equal(persisted.task_status, "active")
      assert.equal(persisted.enabled, true)
      assert.equal(Number(persisted.revision), 2)
      assert.equal(persisted.command_status, "failed")
    })

    await t.test("a current paused task is not rewritten by terminal replace failure", async () => {
      const { taskId, scope } = await create(tenants.paused, "paused")
      const register = await claim(tenants.paused, taskId, "worker-paused-register")
      assert.equal(
        await repository.markScheduledTaskOutboxSucceeded(
          leasedIdentity(register),
          new Date(),
          confirmedNext(register, new Date("2026-09-08T08:00:00.000Z")),
        ),
        true,
      )
      const paused = await repository.updateScheduledTask(
        scope,
        taskId,
        { enabled: false, status: "paused" },
        lineage(tenants.paused, `pause-${suffix}`, suffix),
      )
      assert.equal(paused?.revision, 2)
      const replace = await claim(tenants.paused, taskId, "worker-paused-replace")
      assert.equal(await repository.markScheduledTaskOutboxFailed(leasedIdentity(replace), "invalid_schedule", new Date()), true)
      const persisted = await state(tenants.paused, taskId, replace.outboxId)
      assert.equal(persisted.task_status, "paused")
      assert.equal(persisted.enabled, false)
      assert.equal(Number(persisted.revision), 2)
      assert.equal(persisted.command_status, "failed")
    })

    await t.test("delete failure does not recreate a physically deleted task", async () => {
      const { taskId, scope } = await create(tenants.deleted, "deleted")
      const register = await claim(tenants.deleted, taskId, "worker-delete-register")
      assert.equal(
        await repository.markScheduledTaskOutboxSucceeded(
          leasedIdentity(register),
          new Date(),
          confirmedNext(register, new Date("2026-09-08T08:00:00.000Z")),
        ),
        true,
      )
      await repository.deleteScheduledTask(scope, taskId, lineage(tenants.deleted, `delete-${suffix}`, suffix))
      const deletion = await claim(tenants.deleted, taskId, "worker-delete-failure")
      assert.equal(deletion.commandType, "scheduler.delete")
      assert.equal(await repository.markScheduledTaskOutboxFailed(leasedIdentity(deletion), "invalid_schedule", new Date()), true)
      assert.equal(await repository.findScheduledTask(scope, taskId), null)
      const persisted = await state(tenants.deleted, taskId, deletion.outboxId)
      assert.equal(persisted.task_status, null)
      assert.equal(persisted.command_status, "failed")
    })

    await t.test("wrong lease identity cannot change either task or outbox", async () => {
      const { taskId } = await create(tenants.lease, "lease")
      const command = await claim(tenants.lease, taskId, "worker-invalid-lease")
      assert.equal(await repository.markScheduledTaskOutboxFailed({ ...leasedIdentity(command), leaseToken: "wrong-token" }, "invalid_schedule", new Date()), false)
      assert.equal(await repository.markScheduledTaskOutboxFailed({ ...leasedIdentity(command), fence: command.fence + 1 }, "invalid_schedule", new Date()), false)
      const protectedState = await state(tenants.lease, taskId, command.outboxId)
      assert.equal(protectedState.task_status, "active")
      assert.equal(protectedState.command_status, "leased")
      assert.equal(protectedState.lease_owner, command.leaseOwner)
      assert.equal(protectedState.lease_token, command.leaseToken)
      assert.equal(Number(protectedState.fence), command.fence)
    })

    await t.test("task projection and terminal settlement roll back and recover together", async () => {
      const { taskId } = await create(tenants.rollback, "rollback")
      const command = await claim(tenants.rollback, taskId, "worker-rollback-failure")
      await pool.query(
        `CREATE OR REPLACE FUNCTION ${rollbackFunction}() RETURNS trigger
         LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture terminal settlement failure'; END; $$`,
      )
      await pool.query(
        `CREATE TRIGGER ${rollbackTrigger}
           BEFORE UPDATE ON bff_scheduled_task_outbox
           FOR EACH ROW
           WHEN (OLD.tenant_id = '${tenants.rollback}' AND NEW.status = 'failed')
           EXECUTE FUNCTION ${rollbackFunction}()`,
      )
      rollbackTriggerInstalled = true
      await assert.rejects(
        repository.markScheduledTaskOutboxFailed(leasedIdentity(command), "invalid_schedule", new Date()),
        /fixture terminal settlement failure/u,
      )
      const rolledBack = await state(tenants.rollback, taskId, command.outboxId)
      assert.equal(rolledBack.task_status, "active")
      assert.equal(rolledBack.command_status, "leased")
      assert.equal(rolledBack.lease_owner, command.leaseOwner)
      assert.equal(rolledBack.lease_token, command.leaseToken)
      assert.equal(Number(rolledBack.fence), command.fence)

      await pool.query(`DROP TRIGGER ${rollbackTrigger} ON bff_scheduled_task_outbox`)
      await pool.query(`DROP FUNCTION ${rollbackFunction}()`)
      rollbackTriggerInstalled = false
      assert.equal(await repository.markScheduledTaskOutboxFailed(leasedIdentity(command), "invalid_schedule", new Date()), true)
      const recovered = await state(tenants.rollback, taskId, command.outboxId)
      assert.equal(recovered.task_status, "failed")
      assert.equal(recovered.command_status, "failed")
    })
  } finally {
    if (rollbackTriggerInstalled) {
      await pool.query(`DROP TRIGGER IF EXISTS ${rollbackTrigger} ON bff_scheduled_task_outbox`).catch(() => undefined)
      await pool.query(`DROP FUNCTION IF EXISTS ${rollbackFunction}()`).catch(() => undefined)
    }
    await pool.query("DELETE FROM bff_scheduled_task_outbox WHERE tenant_id = ANY($1::text[])", [Object.values(tenants)]).catch(() => undefined)
    await pool.query("DELETE FROM bff_scheduled_task WHERE tenant_id = ANY($1::text[])", [Object.values(tenants)]).catch(() => undefined)
    await pool.end()
  }
})
