import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { test } from "node:test"

import { Pool } from "pg"

import { PostgresScheduledTaskRepository } from "../dist/infrastructure/postgres/scheduled-task-repository.js"

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

function taskInput(suffix, overrides = {}) {
  return {
    title: `Review ${suffix}`,
    prompt: `Review the project for ${suffix}.`,
    frequency: "daily",
    time: "08:00",
    timezone: "UTC",
    nextRunAt: new Date("2026-09-04T12:00:00.000Z"),
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
  const pool = new Pool({ connectionString: postgresUrl, max: 10 })
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
          AND column_name IN ('next_run_at', 'expires_at', 'created_at', 'updated_at', 'available_at', 'lease_until', 'last_error_at', 'completed_at')`,
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
        tenants.rollback,
        `actor_${suffix}`,
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
      `INSERT INTO bff_project (project_id, tenant_id, name, slug)
       VALUES ($1, $2, $3, $4)`,
      [projectId, tenants.core, "Outbox fixture", `outbox-${suffix}`],
    )
    const taskId = `scheduled_core_${suffix}`
    const createLineage = lineage(tenants.core, `create-${suffix}`, suffix)
    const created = await repository.createScheduledTask(
      tenants.core,
      createLineage.actorId,
      taskInput(suffix, { projectId }),
      taskId,
      createLineage,
    )
    const duplicate = await repository.createScheduledTask(
      tenants.core,
      createLineage.actorId,
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
    assert.equal(registerRow.rows[0].payload.task.next_run_at, "2026-09-04T12:00:00.000Z")

    assert.deepEqual(await repository.listScheduledTasks(`${tenants.core}_other`), [])
    assert.equal(await repository.findScheduledTask(`${tenants.core}_other`, taskId), null)

    const updateLineage = lineage(tenants.core, `update-${suffix}`, suffix)
    const updated = await repository.updateScheduledTask(
      tenants.core,
      taskId,
      { prompt: "Updated prompt." },
      updateLineage,
    )
    assert.equal(updated?.revision, 2)
    const duplicateUpdate = await repository.updateScheduledTask(
      tenants.core,
      taskId,
      { prompt: "A different retry body." },
      updateLineage,
    )
    assert.equal(duplicateUpdate?.revision, 2)
    assert.equal(duplicateUpdate?.prompt, "Updated prompt.")

    const secondUpdateLineage = lineage(tenants.core, `update-2-${suffix}`, suffix)
    const updatedAgain = await repository.updateScheduledTask(
      tenants.core,
      taskId,
      { time: "09:00", expiresAt: new Date("2026-09-05T00:00:00.000Z") },
      secondUpdateLineage,
    )
    assert.equal(updatedAgain?.revision, 3)
    assert.equal(updatedAgain?.nextRunAt instanceof Date, true)
    assert.equal(updatedAgain?.expiresAt?.toISOString(), "2026-09-05T00:00:00.000Z")
    assert.equal(await count(pool, "bff_scheduled_task_outbox", tenants.core), 3)

    const deleteLineage = lineage(tenants.core, `delete-${suffix}`, suffix)
    assert.equal(await repository.deleteScheduledTask(tenants.core, taskId, deleteLineage), true)
    assert.equal(await repository.deleteScheduledTask(tenants.core, taskId, deleteLineage), true)
    assert.equal(await repository.findScheduledTask(tenants.core, taskId), null)
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
    await repository.createScheduledTask(tenants.claim, claimLineage.actorId, taskInput(suffix), claimTaskId, claimLineage)
    const claimNow = new Date(Date.now() + 1000)
    const claimed = (await repository.claimScheduledTaskOutbox({
      workerId: `worker-a-${suffix}`,
      limit: 1,
      leaseDurationMs: 5000,
      now: claimNow,
    }))[0]
    assert.ok(claimed)
    assert.equal(claimed.status, "leased")
    assert.equal(claimed.attemptCount, 1)
    assert.equal(claimed.fence, 1)
    assert.ok(claimed.leaseUntil instanceof Date)
    assert.deepEqual(await repository.claimScheduledTaskOutbox({
      workerId: `worker-b-${suffix}`,
      limit: 1,
      leaseDurationMs: 5000,
      now: claimNow,
    }), [])
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
    await repository.createScheduledTask(tenants.recovery, recoveryLineage.actorId, taskInput(suffix), recoveryTaskId, recoveryLineage)
    const poolA = new Pool({ connectionString: postgresUrl, max: 2 })
    const poolB = new Pool({ connectionString: postgresUrl, max: 2 })
    pools.push(poolA, poolB)
    const repositoryA = new PostgresScheduledTaskRepository({ pool: poolA })
    const repositoryB = new PostgresScheduledTaskRepository({ pool: poolB })
    const beforeRestart = (await repositoryA.claimScheduledTaskOutbox({
      workerId: `worker-restart-a-${suffix}`,
      limit: 1,
      leaseDurationMs: 50,
      now: new Date(Date.now() + 1000),
    }))[0]
    assert.ok(beforeRestart)
    await poolA.end()
    const afterRestart = (await repositoryB.claimScheduledTaskOutbox({
      workerId: `worker-restart-b-${suffix}`,
      limit: 1,
      leaseDurationMs: 5000,
      now: new Date(beforeRestart.leaseUntil.getTime() + 10),
    }))[0]
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
      await repository.createScheduledTask(tenants.concurrent, concurrentLineage.actorId, taskInput(suffix), concurrentTaskId, concurrentLineage)
    }
    const poolC = new Pool({ connectionString: postgresUrl, max: 2 })
    const poolD = new Pool({ connectionString: postgresUrl, max: 2 })
    pools.push(poolC, poolD)
    const [claimedC, claimedD] = await Promise.all([
      new PostgresScheduledTaskRepository({ pool: poolC }).claimScheduledTaskOutbox({ workerId: `worker-c-${suffix}`, limit: 10, leaseDurationMs: 5000, now: new Date(Date.now() + 1000) }),
      new PostgresScheduledTaskRepository({ pool: poolD }).claimScheduledTaskOutbox({ workerId: `worker-d-${suffix}`, limit: 10, leaseDurationMs: 5000, now: new Date(Date.now() + 1000) }),
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
