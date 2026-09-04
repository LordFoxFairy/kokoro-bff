import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  buildScheduledTaskOutboxPayload,
  scheduledTaskOutboxTaskFromPayload,
  scheduledTaskRetryDelayMs,
} from "../dist/domain/scheduled-task/outbox.js"
import { scheduledTaskOutboxId } from "../dist/infrastructure/identifiers/scheduled-task-outbox-id.js"
import { ScheduledTaskOutboxDispatcher } from "../dist/application/scheduled-task-outbox-dispatcher.js"
import type {
  ScheduledTaskOutboxRepository,
} from "../dist/application/ports/scheduled-task-outbox-repository.js"
import type {
  ScheduledTaskOutboxCommand,
} from "../dist/domain/scheduled-task/outbox.js"
import type {
  ScheduledTaskOutboxDeliveryPort,
  ScheduledTaskOutboxDeliveryResult,
} from "../dist/application/ports/scheduled-task-outbox-delivery.js"

const task = {
  taskId: "scheduled_fixture",
  projectId: "project_fixture",
  ownerId: "actor_fixture",
  title: "Daily review",
  prompt: "Review the project.",
  frequency: "daily" as const,
  time: "08:00",
  timezone: "UTC",
  nextRunAt: new Date("2026-09-01T08:00:00.000Z"),
  autoApprove: true,
  enabled: true,
  status: "active" as const,
  revision: 3,
}

const lineage = {
  tenantId: "tenant_fixture",
  actorId: "actor_fixture",
  requestId: "req_fixture",
  idempotencyKey: "schedule-fixture",
}

function command(attemptCount = 1): ScheduledTaskOutboxCommand {
  return {
    outboxId: scheduledTaskOutboxId("tenant_fixture", "scheduled_fixture", "replace", "schedule-fixture"),
    tenantId: "tenant_fixture",
    taskId: "scheduled_fixture",
    commandType: "scheduler.replace",
    payload: buildScheduledTaskOutboxPayload("replace", lineage, task),
    actorId: "actor_fixture",
    requestId: "req_fixture",
    idempotencyKey: "schedule-fixture",
    taskRevision: 3,
    status: "leased",
    attemptCount,
    availableAt: new Date("2026-09-04T12:00:00.000Z"),
    leaseOwner: "worker_fixture",
    leaseToken: "lease_fixture",
    leaseUntil: new Date("2026-09-04T12:01:00.000Z"),
    fence: attemptCount,
  }
}

class FixtureOutboxRepository implements ScheduledTaskOutboxRepository {
  public queued: ScheduledTaskOutboxCommand[] = []
  public succeeded: string[] = []
  public retryable: Array<{ id: string; nextAttemptAt: Date; errorCode: string }> = []
  public failed: Array<{ id: string; errorCode: string }> = []

  public async claimScheduledTaskOutbox(): Promise<ScheduledTaskOutboxCommand[]> {
    const next = this.queued.shift()
    return next === undefined ? [] : [next]
  }

  public async markScheduledTaskOutboxSucceeded(lease: ScheduledTaskOutboxCommand): Promise<boolean> {
    this.succeeded.push(lease.outboxId)
    return true
  }

  public async markScheduledTaskOutboxRetryable(
    lease: ScheduledTaskOutboxCommand,
    nextAttemptAt: Date,
    errorCode: string,
  ): Promise<boolean> {
    this.retryable.push({ id: lease.outboxId, nextAttemptAt, errorCode })
    return true
  }

  public async markScheduledTaskOutboxFailed(lease: ScheduledTaskOutboxCommand, errorCode: string): Promise<boolean> {
    this.failed.push({ id: lease.outboxId, errorCode })
    return true
  }
}

class FixtureDelivery implements ScheduledTaskOutboxDeliveryPort {
  public readonly results: ScheduledTaskOutboxDeliveryResult[]
  public readonly commands: ScheduledTaskOutboxCommand[] = []

  public constructor(results: ScheduledTaskOutboxDeliveryResult[]) {
    this.results = [...results]
  }

  public async deliver(commandToDeliver: ScheduledTaskOutboxCommand): Promise<ScheduledTaskOutboxDeliveryResult> {
    this.commands.push(commandToDeliver)
    return this.results.shift() ?? { outcome: "succeeded" }
  }
}

describe("ScheduledTask durable outbox", () => {
  it("builds a versioned scheduler command with complete lineage and stable identity", () => {
    const payload = buildScheduledTaskOutboxPayload("replace", lineage, task)
    assert.deepEqual(payload, {
      schema_version: 1,
      command_type: "scheduler.replace",
      lineage: {
        tenant_id: "tenant_fixture",
        actor_id: "actor_fixture",
        request_id: "req_fixture",
        idempotency_key: "schedule-fixture",
      },
      task: {
        task_id: "scheduled_fixture",
        project_id: "project_fixture",
        owner_id: "actor_fixture",
        title: "Daily review",
        prompt: "Review the project.",
        frequency: "daily",
        time: "08:00",
        timezone: "UTC",
        next_run_at: "2026-09-01T08:00:00.000Z",
        auto_approve: true,
        enabled: true,
        status: "active",
        revision: 3,
      },
    })
    const internal = scheduledTaskOutboxTaskFromPayload(payload.task)
    assert.ok(internal.nextRunAt instanceof Date)
    assert.equal(internal.nextRunAt.toISOString(), "2026-09-01T08:00:00.000Z")
    assert.equal(
      scheduledTaskOutboxId("tenant_fixture", "scheduled_fixture", "replace", "schedule-fixture"),
      "scheduled_outbox_a9418ff083b15fea19f73ac7c64a3f52",
    )
    assert.notEqual(
      scheduledTaskOutboxId("tenant_fixture", "scheduled_fixture", "replace", "other-key"),
      scheduledTaskOutboxId("tenant_fixture", "scheduled_fixture", "replace", "schedule-fixture"),
    )
  })

  it("uses exponential backoff with bounded jitter", () => {
    assert.equal(scheduledTaskRetryDelayMs(1, 0), 1000)
    assert.equal(scheduledTaskRetryDelayMs(3, 0), 4000)
    assert.equal(scheduledTaskRetryDelayMs(3, 1), 4800)
  })

  it("claims, retries, and completes through the lease-aware port", async () => {
    const repository = new FixtureOutboxRepository()
    repository.queued.push(command(1), command(2))
    const delivery = new FixtureDelivery([
      { outcome: "retryable", errorCode: "scheduler_timeout" },
      { outcome: "succeeded" },
    ])
    let now = new Date("2026-09-04T12:00:00.000Z")
    const dispatcher = new ScheduledTaskOutboxDispatcher(repository, delivery, {
      workerId: "worker_fixture",
      clock: () => now,
      random: () => 0,
      maxAttempts: 3,
    })

    assert.equal(await dispatcher.runOnce(), 1)
    assert.equal(repository.retryable.length, 1)
    assert.equal(repository.retryable[0]?.errorCode, "scheduler_timeout")
    assert.equal(repository.retryable[0]?.nextAttemptAt.toISOString(), "2026-09-04T12:00:01.000Z")

    now = new Date("2026-09-04T12:00:02.000Z")
    assert.equal(await dispatcher.runOnce(), 1)
    assert.deepEqual(repository.succeeded, [command().outboxId])
    assert.equal(delivery.commands.length, 2)
  })

  it("moves a command to terminal failure after the attempt budget", async () => {
    const repository = new FixtureOutboxRepository()
    repository.queued.push(command(3))
    const delivery = new FixtureDelivery([{ outcome: "retryable", errorCode: "scheduler_unavailable" }])
    const dispatcher = new ScheduledTaskOutboxDispatcher(repository, delivery, {
      workerId: "worker_fixture",
      clock: () => new Date("2026-09-04T12:00:00.000Z"),
      maxAttempts: 3,
    })

    assert.equal(await dispatcher.runOnce(), 1)
    assert.deepEqual(repository.failed, [{ id: command().outboxId, errorCode: "scheduler_unavailable" }])
    assert.equal(repository.retryable.length, 0)
  })
})
