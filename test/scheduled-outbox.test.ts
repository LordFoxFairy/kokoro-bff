import assert from "node:assert/strict"
import { createServer } from "node:http"
import { describe, it } from "node:test"

import {
  buildScheduledTaskOutboxPayload,
  parseScheduledTaskOutboxPayload,
  scheduledTaskOutboxTaskFromPayload,
  scheduledTaskRetryDelayMs,
} from "../dist/domain/scheduled-task/outbox.js"
import { scheduledTaskOutboxId } from "../dist/infrastructure/identifiers/scheduled-task-outbox-id.js"
import { ScheduledTaskOutboxDispatcher } from "../dist/application/scheduled-task-outbox-dispatcher.js"
import type { ScheduledTaskOutboxRepository } from "../dist/application/ports/scheduled-task-outbox-repository.js"
import type { ScheduledTaskOutboxCommand, ScheduledTaskOutboxLease } from "../dist/domain/scheduled-task/outbox.js"
import type { ScheduledTaskOutboxDeliveryPort, ScheduledTaskOutboxDeliveryResult } from "../dist/application/ports/scheduled-task-outbox-delivery.js"
import { SchedulerOutboxDelivery } from "../dist/infrastructure/clients/scheduler/outbox-delivery.js"
import { buildSchedulerSchedule } from "../dist/infrastructure/clients/scheduler/schedule.js"

it("accepts owner once timestamp serialization but rejects a different full-precision trigger or due instant", async () => {
  const { tsImport } = await import("tsx/esm/api")
  const { SchedulerOutboxDelivery: Delivery } = await tsImport("../src/infrastructure/clients/scheduler/outbox-delivery.ts", import.meta.url)
  const { buildScheduledTaskOutboxPayload: payload } = await tsImport("../src/domain/scheduled-task/outbox.ts", import.meta.url)
  const once = { ...task, frequency: "once", localDate: "2030-01-01", runAt: new Date("2030-01-01T08:00:00Z") }
  const cmd = { ...command(), payload: payload("register", lineage, once), commandType: "scheduler.register" }
  let mode = "canonical"
  const owner = createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString())
    const consumed = mode.startsWith("exhausted")
    response.setHeader("content-type", "application/json")
    response.end(
      JSON.stringify({
        data: {
          name: body.name,
          status: consumed && mode !== "exhausted-registered" ? "updated" : "registered",
          schedule: {
            ...body,
            id: "00000000-0000-4000-8000-000000000001",
            version: 1,
            run_at: ["different-trigger", "exhausted-trigger"].includes(mode) ? "2030-01-01T08:00:00.001Z" : "2030-01-01T08:00:00Z",
            next_due_at: consumed ? null : mode === "different-due" ? "2030-01-01T08:00:00.0001Z" : "2030-01-01T08:00:00Z",
            paused: consumed ? mode === "exhausted-paused" : body.paused,
            body: mode === "exhausted-revision" ? { ...body.body, task_revision: body.body.task_revision - 1 } : body.body,
            url: mode === "exhausted-url" ? "http://foreign.test/dispatch" : body.url,
          },
        },
        meta: { request_id: lineage.requestId },
      }),
    )
  })
  await new Promise<void>((resolve) => owner.listen(0, "127.0.0.1", resolve))
  const address = owner.address()
  assert.ok(address !== null && typeof address !== "string")
  try {
    const delivery = new Delivery({
      upstreams: { scheduler: `http://127.0.0.1:${address.port}` },
      schedulerServiceToken: "scheduler-token",
      schedulerTargetUrl: "http://bff.test/dispatch",
      upstreamTimeoutMs: 1000,
      upstreamMaxResponseBytes: 1024 * 1024,
    })
    assert.deepEqual(await delivery.deliver(cmd), { outcome: "succeeded" })
    for (mode of ["different-trigger", "different-due"])
      assert.deepEqual(await delivery.deliver(cmd), { outcome: "failed", errorCode: "scheduler_response_invalid" })
    const consumedCommand = { ...cmd, commandType: "scheduler.replace", payload: payload("replace", lineage, { ...once, enabled: false, status: "paused" }) }
    mode = "exhausted"
    assert.deepEqual(await delivery.deliver(consumedCommand), { outcome: "succeeded" })
    for (mode of ["exhausted-trigger", "exhausted-revision", "exhausted-url", "exhausted-registered", "exhausted-paused"])
      // Preserve the existing bounded retry classification for malformed wire shapes.
      assert.deepEqual(await delivery.deliver(consumedCommand), {
        outcome: mode === "exhausted-paused" ? "retryable" : "failed",
        errorCode: "scheduler_response_invalid",
      })
  } finally {
    owner.closeAllConnections()
    await new Promise<void>((resolve) => owner.close(() => resolve()))
  }
})

it("freezes explicit rule selections and once instant in outbox5 without old-format decoding", async () => {
  const { tsImport } = await import("tsx/esm/api")
  const {
    buildScheduledTaskOutboxPayload: build,
    parseScheduledTaskOutboxPayload: parse,
    scheduledTaskOutboxTaskFromPayload: internal,
  } = await tsImport("../src/domain/scheduled-task/outbox.ts", import.meta.url)
  const lineage = { tenantId: "tenant", actorId: "owner", requestId: "request", idempotencyKey: "create-calendar" }
  const base = {
    triggerKind: "calendar" as const,
    triggerEpoch: "1",
    taskId: "scheduled_calendar",
    ownerId: "owner",
    title: "Calendar",
    prompt: "Review",
    frequency: "weekly",
    weekdays: [0, 2, 6],
    time: "08:15",
    timezone: "UTC",
    autoApprove: false,
    enabled: true,
    status: "active",
    revision: 1,
  }
  const payload = build("register", lineage, base)
  assert.equal(payload.schema_version, 5)
  assert.deepEqual(payload.task.weekdays, [0, 2, 6])
  assert.equal(Object.hasOwn(payload.task, "recurrence_anchor_at"), false)
  assert.deepEqual(internal(parse(payload).task), base)
  assert.throws(() => parse({ ...payload, schema_version: 3 }), /UNSUPPORTED/u)
  const once = { ...base, frequency: "once", weekdays: undefined, localDate: "2030-01-01", runAt: new Date("2030-01-01T08:15:00Z") }
  const oncePayload = build("register", lineage, once)
  assert.equal(oncePayload.task.run_at, "2030-01-01T08:15:00.000Z")
  assert.equal(internal(parse(oncePayload).task).runAt.toISOString(), once.runAt.toISOString())
  assert.throws(() => parse({ ...oncePayload, task: { ...oncePayload.task, run_at: undefined } }), /INVALID/u)
  for (const run_at of ["2030-02-30T08:15:00.000Z", "2030-01-01T08:15:00.0001Z", "2030-01-01T08:15:00+00:00"])
    assert.throws(() => parse({ ...oncePayload, task: { ...oncePayload.task, run_at } }), /INVALID/u)
})

const task = {
  triggerKind: "calendar" as const,
  triggerEpoch: "1",
  taskId: "scheduled_fixture",
  projectId: "project_fixture",
  ownerId: "actor_fixture",
  title: "Daily review",
  prompt: "Review the project.",
  frequency: "daily" as const,
  time: "08:00",
  timezone: "UTC",
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
  public settlements: Array<ScheduledTaskOutboxLease & { completedAt: Date }> = []
  public retryable: Array<{ id: string; nextAttemptAt: Date; errorCode: string }> = []
  public failed: Array<{ id: string; errorCode: string }> = []

  public async claimScheduledTaskOutbox(): Promise<ScheduledTaskOutboxCommand[]> {
    const next = this.queued.shift()
    return next === undefined ? [] : [next]
  }

  public async markScheduledTaskOutboxSucceeded(lease: ScheduledTaskOutboxLease, completedAt: Date): Promise<boolean> {
    this.succeeded.push(lease.outboxId)
    this.settlements.push({ ...lease, completedAt })
    return true
  }

  public async markScheduledTaskOutboxRetryable(lease: ScheduledTaskOutboxCommand, nextAttemptAt: Date, errorCode: string): Promise<boolean> {
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
    return (
      this.results.shift() ?? {
        outcome: "succeeded",
      }
    )
  }
}

describe("ScheduledTask durable outbox", () => {
  it("builds a versioned scheduler command with complete lineage and stable identity", () => {
    const payload = buildScheduledTaskOutboxPayload("replace", lineage, task)
    assert.deepEqual(payload, {
      schema_version: 5,
      command_type: "scheduler.replace",
      lineage: {
        tenant_id: "tenant_fixture",
        actor_id: "actor_fixture",
        request_id: "req_fixture",
        idempotency_key: "schedule-fixture",
      },
      task: {
        trigger_kind: "calendar",
        trigger_epoch: "1",
        task_id: "scheduled_fixture",
        project_id: "project_fixture",
        owner_id: "actor_fixture",
        title: "Daily review",
        prompt: "Review the project.",
        frequency: "daily",
        time: "08:00",
        timezone: "UTC",
        auto_approve: true,
        enabled: true,
        status: "active",
        revision: 3,
      },
    })
    assert.throws(() => parseScheduledTaskOutboxPayload({ ...payload, schema_version: 2 }), /SCHEMA_VERSION_UNSUPPORTED/u)
    const internal = scheduledTaskOutboxTaskFromPayload(payload.task)
    assert.equal(Object.hasOwn(internal, "recurrenceAnchorAt"), false)
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
    const delivery = new FixtureDelivery([{ outcome: "retryable", errorCode: "scheduler_timeout" }, { outcome: "succeeded" }])
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
    assert.deepEqual(repository.settlements[0], {
      outboxId: command(2).outboxId,
      leaseOwner: command(2).leaseOwner,
      leaseToken: command(2).leaseToken,
      fence: command(2).fence,
      completedAt: now,
    })
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

  it("reconciles create conflicts only on the canonical stable owner code", async () => {
    const methods: string[] = []
    const owner = createServer((request, response) => {
      methods.push(request.method ?? "")
      response.setHeader("content-type", "application/json")
      if (request.method === "POST") {
        response.statusCode = 409
        response.end(JSON.stringify({ error: { code: "schedule_already_exists", message: "exists" }, meta: { request_id: "req_fixture" } }))
      } else {
        response.end(
          JSON.stringify({
            data: {
              name: "kokoro.scheduled.scheduled_fixture",
              status: "updated",
              schedule: {
                ...buildSchedulerSchedule(
                  { ...task, id: task.taskId },
                  "tenant_fixture",
                  "actor_fixture",
                  "http://bff.test/internal/bff/scheduled-tasks/dispatch",
                ),
                id: "00000000-0000-4000-8000-000000000001",
                next_due_at: "2026-09-05T08:00:00.000Z",
                version: 9,
              },
            },
            meta: { request_id: "req_fixture" },
          }),
        )
      }
    })
    await new Promise<void>((resolve, reject) => {
      owner.once("error", reject)
      owner.listen(0, "127.0.0.1", resolve)
    })
    const address = owner.address()
    if (address === null || typeof address === "string") throw new Error("server did not bind")
    try {
      const delivery = new SchedulerOutboxDelivery({
        upstreams: { scheduler: `http://127.0.0.1:${address.port}` },
        schedulerServiceToken: "scheduler-token",
        schedulerTargetUrl: "http://bff.test/internal/bff/scheduled-tasks/dispatch",
        upstreamTimeoutMs: 1000,
        upstreamMaxResponseBytes: 1024 * 1024,
      } as never)
      assert.deepEqual(await delivery.deliver({ ...command(), commandType: "scheduler.register" }), {
        outcome: "succeeded",
      })
      assert.deepEqual(methods, ["POST", "PUT"])
    } finally {
      await new Promise<void>((resolve) => owner.close(() => resolve()))
    }
  })
})

for (const frequency of ["daily", "weekly", "monthly"] as const) {
  it(`rejects own run_at on non-once ${frequency} outbox payload`, async () => {
    const { tsImport } = await import("tsx/esm/api")
    const { buildScheduledTaskOutboxPayload: build, parseScheduledTaskOutboxPayload: parse } = await tsImport(
      "../src/domain/scheduled-task/outbox.ts",
      import.meta.url,
    )
    const rule = { ...task, frequency, ...(frequency === "weekly" ? { weekdays: [1] } : {}), ...(frequency === "monthly" ? { monthDays: [1] } : {}) }
    const payload = build("register", lineage, rule)
    assert.throws(() => parse({ ...payload, task: { ...payload.task, run_at: "2030-01-01T08:00:00.000Z" } }), /INVALID/u)
  })
}
