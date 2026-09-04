import {
  scheduledTaskRetryDelayMs,
  type ScheduledTaskOutboxCommand,
} from "../domain/scheduled-task/outbox.js"
import type { ScheduledTaskOutboxDeliveryPort } from "./ports/scheduled-task-outbox-delivery.js"
import type { ScheduledTaskOutboxRepository } from "./ports/scheduled-task-outbox-repository.js"

export type ScheduledTaskOutboxDispatcherOptions = {
  workerId: string
  batchSize?: number
  leaseDurationMs?: number
  maxAttempts?: number
  pollIntervalMs?: number
  clock?: () => Date
  random?: () => number
}

const DEFAULT_BATCH_SIZE = 10
const DEFAULT_LEASE_DURATION_MS = 30_000
const DEFAULT_MAX_ATTEMPTS = 8
const DEFAULT_POLL_INTERVAL_MS = 250

function positiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value < 1) throw new Error("SCHEDULED_TASK_OUTBOX_DISPATCHER_OPTION_INVALID")
  return value
}

function leaseFor(command: ScheduledTaskOutboxCommand): {
  outboxId: string
  leaseOwner: string
  leaseToken: string
  fence: number
} {
  return {
    outboxId: command.outboxId,
    leaseOwner: command.leaseOwner,
    leaseToken: command.leaseToken,
    fence: command.fence,
  }
}

/**
 * Claims ScheduledTask commands, performs external delivery outside the DB
 * transaction, and conditionally settles them with lease/fence predicates.
 */
export class ScheduledTaskOutboxDispatcher {
  private readonly batchSize: number
  private readonly leaseDurationMs: number
  private readonly maxAttempts: number
  private readonly pollIntervalMs: number
  private readonly clock: () => Date
  private readonly random: () => number
  private timer: ReturnType<typeof setInterval> | null = null
  private activeCycle: Promise<number> | null = null

  public constructor(
    private readonly repository: ScheduledTaskOutboxRepository,
    private readonly delivery: ScheduledTaskOutboxDeliveryPort,
    options: ScheduledTaskOutboxDispatcherOptions,
  ) {
    if (options.workerId.trim() === "") throw new Error("SCHEDULED_TASK_OUTBOX_WORKER_ID_REQUIRED")
    this.workerId = options.workerId
    this.batchSize = positiveInteger(options.batchSize, DEFAULT_BATCH_SIZE)
    this.leaseDurationMs = positiveInteger(options.leaseDurationMs, DEFAULT_LEASE_DURATION_MS)
    this.maxAttempts = positiveInteger(options.maxAttempts, DEFAULT_MAX_ATTEMPTS)
    this.pollIntervalMs = positiveInteger(options.pollIntervalMs, DEFAULT_POLL_INTERVAL_MS)
    this.clock = options.clock ?? (() => new Date())
    this.random = options.random ?? Math.random
  }

  private readonly workerId: string

  /** Run one bounded claim/deliver/settle cycle. Concurrent calls coalesce. */
  public runOnce(): Promise<number> {
    if (this.activeCycle !== null) return this.activeCycle
    const cycle = this.executeCycle()
    this.activeCycle = cycle
    void cycle.then(
      () => { if (this.activeCycle === cycle) this.activeCycle = null },
      () => { if (this.activeCycle === cycle) this.activeCycle = null },
    )
    return cycle
  }

  public start(): void {
    if (this.timer !== null) return
    this.timer = setInterval(() => {
      void this.runOnce().catch(() => undefined)
    }, this.pollIntervalMs)
    this.timer.unref?.()
    void this.runOnce().catch(() => undefined)
  }

  public async stop(): Promise<void> {
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
    const active = this.activeCycle
    if (active !== null) await active.catch(() => undefined)
  }

  private async executeCycle(): Promise<number> {
    const now = this.clock()
    const commands = await this.repository.claimScheduledTaskOutbox({
      workerId: this.workerId,
      limit: this.batchSize,
      leaseDurationMs: this.leaseDurationMs,
      now,
    })
    for (const command of commands) await this.process(command)
    return commands.length
  }

  private async process(command: ScheduledTaskOutboxCommand): Promise<void> {
    let result
    try {
      result = await this.delivery.deliver(command)
    } catch {
      result = { outcome: "retryable" as const, errorCode: "scheduled_task_outbox_delivery_error" }
    }
    const settledAt = this.clock()
    const lease = leaseFor(command)
    if (result.outcome === "succeeded") {
      await this.repository.markScheduledTaskOutboxSucceeded(lease, settledAt).catch(() => false)
      return
    }
    if (result.outcome === "failed" || command.attemptCount >= this.maxAttempts) {
      await this.repository.markScheduledTaskOutboxFailed(lease, result.errorCode, settledAt).catch(() => false)
      return
    }
    const delayMs = scheduledTaskRetryDelayMs(command.attemptCount, this.random())
    const nextAttemptAt = new Date(settledAt.getTime() + delayMs)
    await this.repository.markScheduledTaskOutboxRetryable(lease, nextAttemptAt, result.errorCode, settledAt).catch(() => false)
  }
}
