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

integrationTest("explicit calendars persist exact selections, frozen once instants and replay before future checks", async () => {
  const { tsImport } = await import("tsx/esm/api")
  const { PostgresScheduledTaskRepository: Repository } = await tsImport("../src/infrastructure/postgres/scheduled-task-repository.ts", import.meta.url)
  const pool = new Pool({ connectionString: postgresUrl, options: "-c search_path=kokoro_bff -c timezone=Pacific/Honolulu", max: 3 })
  const suffix = `calendar_${Date.now()}_${Math.random().toString(16).slice(2)}`
  const scope = ownerScope(suffix, suffix)
  let now = new Date("2029-01-01T00:00:00Z")
  const repository = new Repository({ pool }, undefined, () => now)
  try {
    await pool.query(await readFile(new URL("../database/schema.sql", import.meta.url), "utf8"))
    const monthly = await repository.createScheduledTask(
      scope,
      taskInput(suffix, { frequency: "monthly", monthDays: [31, 18] }),
      `scheduled_month_${suffix}`,
      lineage(suffix, "create-month", suffix),
    )
    assert.deepEqual(monthly.monthDays, [18, 31])
    assert.equal(Object.hasOwn(monthly, "recurrenceAnchorAt"), false)
    const weekly = await repository.updateScheduledTask(
      scope,
      monthly.id,
      { triggerKind: "calendar", frequency: "weekly", time: "09:30", timezone: "UTC", weekdays: [6, 1] },
      lineage(suffix, "switch-week", suffix),
    )
    assert.deepEqual(weekly.weekdays, [1, 6])
    assert.equal(Object.hasOwn(weekly, "monthDays"), false)
    const input = taskInput(suffix, { frequency: "once", localDate: "2030-01-01", timezone: "Asia/Kathmandu" })
    const once = await repository.createScheduledTask(scope, input, `scheduled_once_${suffix}`, lineage(suffix, "create-once", suffix))
    assert.equal(once.localDate, "2030-01-01")
    assert.equal(once.runAt.toISOString(), "2030-01-01T02:15:00.000Z")
    const snapshot = (await pool.query("SELECT payload FROM bff_scheduled_task_outbox WHERE tenant_id=$1 AND task_id=$2", [suffix, once.id])).rows[0].payload
    assert.equal(snapshot.schema_version, 5)
    assert.equal(snapshot.task.run_at, once.runAt.toISOString())
    now = new Date("2031-01-01T00:00:00Z")
    assert.deepEqual(await repository.createScheduledTask(scope, input, once.id, lineage(suffix, "create-once", suffix)), once)
    await assert.rejects(repository.createScheduledTask(scope, input, `scheduled_past_${suffix}`, lineage(suffix, "new-past", suffix)), /ONCE_NOT_FUTURE/u)
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM bff_scheduled_task WHERE tenant_id=$1", [suffix])).rows[0].n, 2)
    let latest = once
    for (const [index, patch] of [
      { title: "After due" },
      { triggerKind: "calendar", frequency: "once", localDate: input.localDate, timezone: input.timezone, time: input.time },
      { enabled: false, status: "paused" },
      { enabled: true, status: "active" },
    ].entries()) {
      latest = await repository.updateScheduledTask(scope, once.id, patch, lineage(suffix, `same-once-${index}`, suffix))
      assert.equal(latest.revision, once.revision + index + 1)
      assert.equal(latest.runAt.toISOString(), once.runAt.toISOString())
      const command = (
        await pool.query("SELECT payload FROM bff_scheduled_task_outbox WHERE tenant_id=$1 AND task_id=$2 AND aggregate_revision=$3", [
          suffix,
          once.id,
          latest.revision,
        ])
      ).rows[0].payload
      assert.equal(command.task.run_at, once.runAt.toISOString())
      assert.equal(command.task.revision, latest.revision)
    }
    const beforeRejected = (await pool.query("SELECT to_jsonb(t) AS row FROM bff_scheduled_task t WHERE tenant_id=$1 ORDER BY task_id", [suffix])).rows
    const outboxCount = (await pool.query("SELECT count(*)::int AS n FROM bff_scheduled_task_outbox WHERE tenant_id=$1", [suffix])).rows[0].n
    await assert.rejects(
      repository.updateScheduledTask(
        scope,
        once.id,
        { triggerKind: "calendar", frequency: "once", time: input.time, timezone: input.timezone, localDate: "2030-01-02" },
        lineage(suffix, "different-past", suffix),
      ),
      /ONCE_NOT_FUTURE/u,
    )
    assert.deepEqual(
      (await pool.query("SELECT to_jsonb(t) AS row FROM bff_scheduled_task t WHERE tenant_id=$1 ORDER BY task_id", [suffix])).rows,
      beforeRejected,
    )
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM bff_scheduled_task_outbox WHERE tenant_id=$1", [suffix])).rows[0].n, outboxCount)
    await assert.rejects(
      pool.query("UPDATE bff_scheduled_task SET weekdays=ARRAY[7]::smallint[] WHERE tenant_id=$1 AND task_id=$2", [suffix, monthly.id]),
      /check constraint/u,
    )
    assert.deepEqual(await repository.findScheduledTask({ ...scope, tenantId: "other" }, once.id), null)
    const reloaded = new Repository({ pool })
    assert.deepEqual(await reloaded.findScheduledTask(scope, once.id), latest)
  } finally {
    await pool.query("DELETE FROM bff_scheduled_task_outbox WHERE tenant_id=$1", [suffix]).catch(() => undefined)
    await pool.query("DELETE FROM bff_scheduled_task WHERE tenant_id=$1", [suffix]).catch(() => undefined)
    await pool.end()
  }
})

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
    triggerKind: "calendar",
    triggerEpoch: "1",
    frequency: "daily",
    time: "08:00",
    timezone: "UTC",
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
          AND column_name IN ('run_at', 'expires_at', 'created_at', 'updated_at', 'available_at', 'lease_until', 'last_error_at', 'completed_at')`,
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
    assert.equal(Object.hasOwn(registerRow.rows[0].payload.task, "recurrence_anchor_at"), false)

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
    assert.equal(await repository.deleteScheduledTask(otherOwnerScope, taskId, lineage(tenants.core, `denied-delete-${suffix}`, `other_${suffix}`)), false)
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
      { triggerKind: "calendar", frequency: "daily", time: "09:00", timezone: "UTC", expiresAt: new Date("2026-09-05T00:00:00.000Z") },
      secondUpdateLineage,
    )
    assert.equal(updatedAgain?.revision, 3)
    assert.equal(Object.hasOwn(updatedAgain, "nextRunAt"), false)
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
    assert.equal(await repository.markScheduledTaskOutboxSucceeded({ ...lease, leaseToken: "stale-token" }, claimNow), false)
    assert.equal(await repository.markScheduledTaskOutboxSucceeded({ ...lease, fence: 99 }, claimNow), false)
    assert.equal(await repository.markScheduledTaskOutboxSucceeded(lease, new Date(claimNow.getTime() + 1)), true)
    assert.equal(await repository.markScheduledTaskOutboxSucceeded(lease, new Date(claimNow.getTime() + 2)), false)

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
    assert.equal(await repositoryB.markScheduledTaskOutboxSucceeded(oldLease, new Date()), false)
    assert.equal(await repositoryB.markScheduledTaskOutboxSucceeded(newLease, new Date()), true)

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

integrationTest("Command success is lease-fenced and cannot alter current task facts", async (t) => {
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

    const taskFact = async (tenantId, taskId) =>
      (await pool.query("SELECT to_jsonb(t) AS fact FROM bff_scheduled_task t WHERE tenant_id=$1 AND task_id=$2", [tenantId, taskId])).rows[0]?.fact

    await t.test("create freezes explicit weekdays without storing an owner next", async () => {
      const weekdays = [0, 4]
      const explicit = await create(tenants.explicit, "explicit", { frequency: "weekly", weekdays })
      assert.deepEqual(explicit.created.weekdays, weekdays)
      assert.equal(Object.hasOwn(explicit.created, "nextRunAt"), false)
      const persisted = await taskFact(tenants.explicit, explicit.taskId)
      assert.deepEqual(persisted.weekdays, weekdays)
      assert.equal(Object.hasOwn(persisted, "next_run_at"), false)
      const pending = await pool.query("SELECT payload FROM bff_scheduled_task_outbox WHERE tenant_id=$1 AND status='pending'", [tenants.explicit])
      assert.equal(pending.rows[0].payload.schema_version, 5)
      assert.deepEqual(pending.rows[0].payload.task.weekdays, weekdays)
      assert.equal(Object.hasOwn(pending.rows[0].payload.task, "next_run_at"), false)
    })

    await t.test("daily creates no implicit selector or cached next", async () => {
      const omitted = await create(tenants.omitted, "omitted")
      assert.equal(Object.hasOwn(omitted.created, "recurrenceAnchorAt"), false)
      assert.equal(Object.hasOwn(omitted.created, "weekdays"), false)
      assert.equal(Object.hasOwn(omitted.created, "nextRunAt"), false)
      const persisted = await taskFact(tenants.omitted, omitted.taskId)
      assert.equal(persisted.weekdays, null)
      assert.equal(Object.hasOwn(persisted, "next_run_at"), false)
      const pending = await pool.query("SELECT payload FROM bff_scheduled_task_outbox WHERE tenant_id=$1 AND status='pending'", [tenants.omitted])
      assert.equal(pending.rows[0].payload.schema_version, 5)
      assert.equal(Object.hasOwn(pending.rows[0].payload.task, "recurrence_anchor_at"), false)
      assert.equal(Object.hasOwn(pending.rows[0].payload.task, "next_run_at"), false)
    })

    await t.test("success settles only the exact command lease and leaves every task field unchanged", async () => {
      const { taskId } = await create(tenants.current, "current")
      const command = await claim(tenants.current, taskId, "worker-current")
      const before = await taskFact(tenants.current, taskId)
      const completedAt = new Date("2026-09-06T12:01:00Z")
      assert.equal(await repository.markScheduledTaskOutboxSucceeded(leasedIdentity(command), completedAt), true)
      assert.deepEqual(await taskFact(tenants.current, taskId), before)
      const {
        rows: [settled],
      } = await pool.query("SELECT status,completed_at,lease_owner,lease_token,lease_until FROM bff_scheduled_task_outbox WHERE outbox_id=$1", [
        command.outboxId,
      ])
      assert.equal(settled.status, "succeeded")
      assert.equal(settled.completed_at.toISOString(), completedAt.toISOString())
      assert.equal(settled.lease_owner, null)
      assert.equal(settled.lease_token, null)
      assert.equal(settled.lease_until, null)
      assert.equal(await repository.markScheduledTaskOutboxSucceeded(leasedIdentity(command), new Date()), false)
    })

    await t.test("pause creates a new command revision that an older success cannot change", async () => {
      const { taskId, scope } = await create(tenants.paused, "paused")
      const oldCommand = await claim(tenants.paused, taskId, "worker-pause-old")
      const paused = await repository.updateScheduledTask(
        scope,
        taskId,
        { status: "paused", enabled: false },
        lineage(tenants.paused, `pause-${suffix}`, suffix),
      )
      assert.equal(paused.revision, 2)
      assert.equal(paused.status, "paused")
      assert.equal(paused.enabled, false)
      const before = await taskFact(tenants.paused, taskId)
      assert.equal(await repository.markScheduledTaskOutboxSucceeded(leasedIdentity(oldCommand), new Date()), true)
      assert.deepEqual(await taskFact(tenants.paused, taskId), before)
      const [current] = await repository.readScheduledTaskSnapshots(scope, new AbortController().signal, taskId)
      assert.equal(current.deliveryStatus, "pending")
    })

    await t.test("late old-revision and stale-lease acknowledgements cannot overwrite or unlock the current task", async () => {
      const { taskId, scope } = await create(tenants.stale, "stale")
      const oldCommand = await claim(tenants.stale, taskId, "worker-stale-old")
      const current = await repository.updateScheduledTask(
        scope,
        taskId,
        { triggerKind: "calendar", frequency: "daily", time: "09:00", timezone: "UTC" },
        lineage(tenants.stale, `replace-${suffix}`, suffix),
      )
      assert.equal(current.revision, 2)
      const before = await taskFact(tenants.stale, taskId)
      for (const invalidLease of [
        { ...leasedIdentity(oldCommand), leaseToken: "stale-token" },
        { ...leasedIdentity(oldCommand), fence: oldCommand.fence + 1 },
      ]) {
        assert.equal(await repository.markScheduledTaskOutboxSucceeded(invalidLease, new Date()), false)
        assert.deepEqual(await taskFact(tenants.stale, taskId), before)
        assert.equal((await pool.query("SELECT status FROM bff_scheduled_task_outbox WHERE outbox_id=$1", [oldCommand.outboxId])).rows[0].status, "leased")
      }
      assert.equal(await repository.markScheduledTaskOutboxSucceeded(leasedIdentity(oldCommand), new Date()), true)
      assert.deepEqual(await taskFact(tenants.stale, taskId), before)
      assert.equal((await repository.readScheduledTaskSnapshots(scope, new AbortController().signal, taskId))[0].deliveryStatus, "pending")
    })

    await t.test("a failed success UPDATE preserves the lease and can recover without any task write", async () => {
      const { taskId } = await create(tenants.rollback, "rollback-next")
      const command = await claim(tenants.rollback, taskId, "worker-rollback-next")
      const before = await taskFact(tenants.rollback, taskId)
      await pool.query(
        `CREATE OR REPLACE FUNCTION ${rollbackFunction}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture next settlement failure'; END; $$`,
      )
      await pool.query(
        `CREATE TRIGGER ${rollbackTrigger} BEFORE UPDATE ON bff_scheduled_task_outbox FOR EACH ROW WHEN (OLD.tenant_id='${tenants.rollback}' AND NEW.status='succeeded') EXECUTE FUNCTION ${rollbackFunction}()`,
      )
      rollbackTriggerInstalled = true
      await assert.rejects(repository.markScheduledTaskOutboxSucceeded(leasedIdentity(command), new Date()), /fixture next settlement failure/u)
      const {
        rows: [failed],
      } = await pool.query("SELECT status,completed_at,lease_owner,lease_token,fence FROM bff_scheduled_task_outbox WHERE outbox_id=$1", [command.outboxId])
      assert.equal(failed.status, "leased")
      assert.equal(failed.completed_at, null)
      assert.equal(failed.lease_owner, command.leaseOwner)
      assert.equal(failed.lease_token, command.leaseToken)
      assert.equal(Number(failed.fence), command.fence)
      assert.deepEqual(await taskFact(tenants.rollback, taskId), before)
      await pool.query(`DROP TRIGGER ${rollbackTrigger} ON bff_scheduled_task_outbox`)
      await pool.query(`DROP FUNCTION ${rollbackFunction}()`)
      rollbackTriggerInstalled = false
      assert.equal(await repository.markScheduledTaskOutboxSucceeded(leasedIdentity(command), new Date()), true)
      assert.deepEqual(await taskFact(tenants.rollback, taskId), before)
      assert.equal((await pool.query("SELECT status FROM bff_scheduled_task_outbox WHERE outbox_id=$1", [command.outboxId])).rows[0].status, "succeeded")
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

integrationTest("Scheduler receipt schema gates durable settlement without projecting task facts", async (t) => {
  const suffix = `${Date.now()}_${Math.random().toString(16).slice(2)}`
  const cases = ["valid", "missing-meta", "missing-id", "invalid-calendar", "consumed-once", "consumed-revision"]
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
      const consumed = responseMode.startsWith("consumed")
      const ownerSchedule = {
        ...schedule,
        id: "00000000-0000-4000-8000-000000000001",
        next_due_at: consumed ? null : responseMode === "invalid-calendar" ? "2026-02-30T08:00:00.000Z" : (schedule.run_at ?? "2026-09-08T08:00:00.000Z"),
        paused: consumed ? false : schedule.paused,
        body: responseMode === "consumed-revision" ? { ...schedule.body, task_revision: schedule.body.task_revision - 1 } : schedule.body,
        version: 41,
      }
      if (responseMode === "missing-id") delete ownerSchedule.id
      const envelope = {
        data: { name: schedule.name, status: consumed ? "updated" : "registered", schedule: ownerSchedule },
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
        const consumed = name.startsWith("consumed")
        responseMode = consumed ? "valid" : name
        const tenantId = tenants[name]
        const taskId = `scheduled_receipt_${name.replaceAll("-", "_")}_${suffix}`
        await repository.createScheduledTask(
          ownerScope(tenantId, suffix),
          taskInput(suffix, consumed ? { frequency: "once", localDate: "2030-01-01", timezone: "UTC" } : {}),
          taskId,
          lineage(tenantId, `receipt-${name}-${suffix}`, suffix),
        )
        const dispatchNow = new Date(Date.now() + 1_000)
        const dispatcher = new ScheduledTaskOutboxDispatcher(repository, delivery, {
          workerId: `receipt-${name}-${suffix}`,
          batchSize: 1,
          maxAttempts: 1,
          clock: () => dispatchNow,
        })
        if (consumed) {
          assert.equal(await dispatcher.runOnce(), 1, "register the initial definition before the consumed replacement fixture")
          await repository.updateScheduledTask(
            ownerScope(tenantId, suffix),
            taskId,
            { enabled: false, status: "paused" },
            lineage(tenantId, `consumed-${name}`, suffix),
          )
          responseMode = name
        }
        const before = (await pool.query("SELECT to_jsonb(t) AS row FROM bff_scheduled_task t WHERE tenant_id=$1 AND task_id=$2", [tenantId, taskId])).rows
        const ownerRequestCount = ownerRequests.length
        assert.equal(await dispatcher.runOnce(), 1)
        assert.equal(ownerRequests.length, ownerRequestCount + 1)
        assert.deepEqual(ownerRequests.at(-1), { mode: name, taskId })
        const state = await pool.query(
          `SELECT task.revision, command.status
             FROM bff_scheduled_task AS task
             JOIN bff_scheduled_task_outbox AS command
               ON command.tenant_id = task.tenant_id AND command.task_id = task.task_id
            WHERE task.tenant_id = $1 AND task.task_id = $2
            ORDER BY command.aggregate_revision DESC LIMIT 1`,
          [tenantId, taskId],
        )
        assert.equal(Number(state.rows[0].revision), consumed ? 2 : 1)
        if (name === "valid" || name === "consumed-once") {
          assert.equal(state.rows[0].status, "succeeded")
          assert.deepEqual(
            (await pool.query("SELECT to_jsonb(t) AS row FROM bff_scheduled_task t WHERE tenant_id=$1 AND task_id=$2", [tenantId, taskId])).rows,
            before,
          )
        } else {
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
      `SELECT task.status AS task_status, task.enabled, task.revision,
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
      assert.equal(persisted.command_status, "failed")
      assert.equal(persisted.last_error_code, "invalid_schedule")
      assert.ok(persisted.completed_at)
      assert.equal(persisted.lease_owner, null)
      assert.equal(persisted.lease_token, null)
    })

    await t.test("current active replace failure projects failed without advancing revision", async () => {
      const { taskId, scope } = await create(tenants.replace, "replace")
      const register = await claim(tenants.replace, taskId, "worker-replace-register")
      assert.equal(await repository.markScheduledTaskOutboxSucceeded(leasedIdentity(register), new Date()), true)
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
        `SELECT task.status AS task_status,task.enabled,task.revision,
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
      assert.equal(result.rows[0].command_status, "retryable")
      assert.equal(result.rows[0].last_error_code, "scheduler_target_unavailable")
      assert.equal(result.rows[0].completed_at, null)
    })

    await t.test("an old revision failure terminates its command without overwriting the current task", async () => {
      const { taskId, scope } = await create(tenants.stale, "stale")
      const oldCommand = await claim(tenants.stale, taskId, "worker-stale-failure")
      const current = await repository.updateScheduledTask(
        scope,
        taskId,
        { prompt: "New revision remains active." },
        lineage(tenants.stale, `replace-stale-${suffix}`, suffix),
      )
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
      assert.equal(await repository.markScheduledTaskOutboxSucceeded(leasedIdentity(register), new Date()), true)
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
      assert.equal(await repository.markScheduledTaskOutboxSucceeded(leasedIdentity(register), new Date()), true)
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
      assert.equal(
        await repository.markScheduledTaskOutboxFailed({ ...leasedIdentity(command), leaseToken: "wrong-token" }, "invalid_schedule", new Date()),
        false,
      )
      assert.equal(
        await repository.markScheduledTaskOutboxFailed({ ...leasedIdentity(command), fence: command.fence + 1 }, "invalid_schedule", new Date()),
        false,
      )
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

integrationTest("current read snapshots bind exact command revisions and cancel blocked SQL without retaining clients", async () => {
  const { tsImport } = await import("tsx/esm/api")
  const { PostgresScheduledTaskRepository: Repository } = await tsImport("../src/infrastructure/postgres/scheduled-task-repository.ts", import.meta.url)
  const pool = new Pool({ connectionString: postgresUrl, options: "-c search_path=kokoro_bff", max: 3 })
  const id = `current_${Date.now()}_${Math.random().toString(16).slice(2)}`
  const scope = ownerScope(id, id)
  const repository = new Repository({ pool })
  const signal = new AbortController().signal
  let blocker
  try {
    const task = await repository.createScheduledTask(scope, taskInput(id), `scheduled_${id}`, lineage(id, "current-create", id))
    assert.deepEqual(await repository.readScheduledTaskSnapshots(scope, signal), [{ task, deliveryStatus: "pending", projectAvailable: true }])
    assert.deepEqual(await repository.readScheduledTaskSnapshots({ ...scope, subjectId: "foreign" }, signal), [])
    const [command] = await repository.claimScheduledTaskOutbox({ workerId: id, limit: 1, leaseDurationMs: 30000, now: new Date() })
    assert.ok(command)
    assert.equal(await repository.markScheduledTaskOutboxSucceeded(command, new Date()), true)
    assert.equal((await repository.readScheduledTaskSnapshots(scope, signal, task.id))[0].deliveryStatus, "succeeded")
    const changed = await repository.updateScheduledTask(scope, task.id, { title: "Changed" }, lineage(id, "current-update", id))
    assert.equal(changed.revision, task.revision + 1)
    assert.equal(
      (await repository.readScheduledTaskSnapshots(scope, signal, task.id))[0].deliveryStatus,
      "pending",
      "old succeeded command is not current readiness",
    )
    blocker = await pool.connect()
    await blocker.query("BEGIN")
    await blocker.query("LOCK bff_scheduled_task IN ACCESS EXCLUSIVE MODE")
    const controller = new AbortController()
    const pending = repository.readScheduledTaskSnapshots(scope, controller.signal)
    const timer = setTimeout(() => controller.abort(), 30)
    try {
      await assert.rejects(pending, /cancel|abort/iu)
    } finally {
      clearTimeout(timer)
    }
    await blocker.query("ROLLBACK")
    blocker.release()
    blocker = undefined
    assert.equal((await repository.readScheduledTaskSnapshots(scope, signal)).length, 1)
    const held = await Promise.all([pool.connect(), pool.connect(), pool.connect()])
    try {
      const controller = new AbortController()
      const queued = repository.readScheduledTaskSnapshots(scope, controller.signal)
      assert.equal(pool.waitingCount, 1)
      controller.abort()
      await assert.rejects(queued, /cancel|abort/iu)
      const removed = new Promise((resolve) => pool.once("remove", resolve))
      held.shift().release()
      let watchdog
      try {
        await Promise.race([
          removed,
          new Promise((_, reject) => {
            watchdog = setTimeout(() => reject(Error("cancelled pool waiter retained its late client")), 1000)
          }),
        ])
      } finally {
        clearTimeout(watchdog)
      }
      assert.equal(pool.waitingCount, 0)
    } finally {
      for (const client of held) client.release()
    }
    await repository.deleteScheduledTask(scope, task.id, lineage(id, "current-delete", id))
    assert.deepEqual(await repository.readScheduledTaskSnapshots(scope, signal, task.id), [])
  } finally {
    if (blocker) {
      await blocker.query("ROLLBACK").catch(() => undefined)
      blocker.release()
    }
    await pool.query("DELETE FROM bff_scheduled_task_outbox WHERE tenant_id=$1", [id])
    await pool.query("DELETE FROM bff_scheduled_task WHERE tenant_id=$1", [id])
    await pool.end()
  }
})
